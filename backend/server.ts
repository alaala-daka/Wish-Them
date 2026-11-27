/**
 * Function 入口装配：路由匹配 → 鉴权 → 幂等 → 业务处理 → 统一响应。
 *
 * 平台约束落地位置：
 * - 物理前缀 /functions/v1/{app|app-d<32hex>} 在这里剥离（lib/http.ts#logicalPath）；
 * - 全局 Bearer 鉴权只认应用自签 JWT（lib/auth.ts），不使用网关注入身份；
 * - 写操作幂等由 app.idempotency_keys 占位实现（lib/idempotency.ts），不假设事务；
 * - 未预期异常一律 500 + requestId，堆栈只进 Function 日志。
 *
 * 本文件不依赖 Deno 专属 API，也不 import 平台注入模块（_qoder），
 * 因此本地可以用假数据库直接驱动同一套路由。
 */
import { routes } from './routes/manifest.ts';
import { ensureSeeded, markSeedEnabled } from './domain/seed-init.ts';
import { authenticate, requirePrincipal } from './lib/auth.ts';
import { ConfigError } from './lib/config.ts';
import { AppError, methodNotAllowed, notFound, serviceUnavailable } from './lib/errors.ts';
import { clientIp, hashIp } from './lib/ip.ts';
import { corsHeaders, logicalPath, preflightResponse, readJson } from './lib/http.ts';
import { newRequestId } from './lib/id.ts';
import * as idempotency from './lib/idempotency.ts';
import { log, logError } from './lib/log.ts';
import { createApiLimiter } from './lib/rate-limit.ts';
import { fail, failUnexpected } from './lib/respond.ts';
import type { AppDeps, Ctx, Handler, Principal, RouteDef } from './lib/types.ts';

interface Compiled {
  route: RouteDef;
  handler: Handler;
  pattern: string[];
}

const compiled: Compiled[] = routes.map((entry) => ({
  route: entry.route,
  handler: entry.default,
  pattern: entry.route.path.split('/').filter((segment) => segment.length > 0),
}));

export type Fetch = (request: Request) => Promise<Response>;

export function createApp(deps: AppDeps): Fetch {
  const clock = deps.now ?? (() => new Date());
  const allowOrigins = deps.config.corsAllowOrigins;
  const apiLimiter = createApiLimiter(deps.config.apiPerMinute);
  // 幂等占位行保留 7 天：平台没有 cron，改为每个隔离实例冷启动时清一次
  let swept = false;
  // 启动播种每个实例只尝试一次：失败不阻塞业务，状态由 /api/health/deep 暴露
  let seedStarted = false;
  let seedTask: Promise<void> | null = null;
  if (deps.config.seedOnStart) markSeedEnabled();

  return async function fetch(request: Request): Promise<Response> {
    const requestId = newRequestId();
    if (deps.config.seedOnStart && !seedStarted) {
      seedStarted = true;
      seedTask = ensureSeeded(deps.db).then(
        () => undefined,
        (error) => {
          log('error', 'seed_failed', {
            requestId,
            reason: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : String(error).slice(0, 300),
          });
        },
      );
    }
    if (seedTask) await seedTask;
    if (!swept) {
      swept = true;
      void idempotency.sweepExpired(deps.db, clock()).catch(() => {});
    }
    try {
      const response = await dispatch(deps, request, requestId, clock, apiLimiter);
      return decorate(response, request, requestId, allowOrigins);
    } catch (error) {
      if (error instanceof ConfigError) {
        // 密钥缺失属于部署问题：固定 503，缺哪一项只进日志，不出网
        logError(requestId, undefined, error);
        return decorate(fail(serviceUnavailable(), requestId), request, requestId, allowOrigins);
      }
      if (error instanceof AppError) return decorate(fail(error, requestId), request, requestId, allowOrigins);
      logError(requestId, undefined, error);
      return decorate(failUnexpected(requestId), request, requestId, allowOrigins);
    }
  };
}

type Matched =
  | { kind: 'ok'; route: RouteDef; handler: Handler; params: Record<string, string> }
  | { kind: 'method'; allowed: string[] }
  | { kind: 'none' };

async function dispatch(
  deps: AppDeps,
  request: Request,
  requestId: string,
  clock: () => Date,
  apiLimiter: (subject: string, now: Date) => void,
): Promise<Response> {
  if (request.method === 'OPTIONS') return preflightResponse(request, deps.config.corsAllowOrigins);

  const now = clock();
  const path = logicalPath(new URL(request.url));
  const matched = match(request.method, path);
  if (matched.kind === 'none') throw notFound('route_not_found', '接口不存在。');
  if (matched.kind === 'method') throw methodNotAllowed(matched.allowed);
  const { route, handler, params } = matched;

  const body = await readBody(request, route);
  const ipHash = await hashIp(clientIp(request), deps.config.ipSalt);
  const principal: Principal | null = await resolvePrincipal(deps, request, route, now);
  // 存活/依赖探针不参与兜底限流，避免实例异常时把监控一起挡在门外
  if (!route.path.startsWith('/api/health')) {
    apiLimiter(principal ? `u:${principal.userId}` : ipHash ? `i:${ipHash}` : 'a:anon', now);
  }

  const ctx: Ctx = {
    request, requestId, now, config: deps.config, db: deps.db, storage: deps.storage,
    ai: deps.ai, params, path, body, ipHash, principal: principal ?? undefined,
  };

  const claim = await openIdempotency(deps, ctx, route, body);
  if (claim?.replay) return claim.replay;
  if (claim) ctx.idempotency = claim.claim;

  let response: Response;
  try {
    response = await handler(ctx);
  } catch (error) {
    if (claim && error instanceof AppError) await idempotency.markFailed(deps.db, claim.claim, error.status, now);
    throw error;
  }
  // 5xx 不写成功存档：同键重试应当重新执行，而不是把故障固化成"已完成"
  if (claim && response.status < 500) await idempotency.markSucceeded(deps.db, claim.claim, response, now);
  return response;
}

function match(method: string, path: string): Matched {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  const allowed = new Set<string>();
  let hit: { route: RouteDef; handler: Handler; params: Record<string, string> } | null = null;
  for (const entry of compiled) {
    const params = matchSegments(entry.pattern, segments);
    if (!params) continue;
    allowed.add(entry.route.method);
    // 同一路径同一方法只可能注册一次（check-routes.ts 校验），后到即最终结果
    if (entry.route.method === method) hit = { route: entry.route, handler: entry.handler, params };
  }
  if (hit) return { kind: 'ok', ...hit };
  if (allowed.size > 0) return { kind: 'method', allowed: [...allowed] };
  return { kind: 'none' };
}

function matchSegments(pattern: string[], segments: string[]): Record<string, string> | null {
  if (pattern.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index++) {
    const token = pattern[index];
    const value = segments[index];
    if (token.startsWith(':')) {
      // 路径参数只接受 UUID/短码字符形，编码后的斜杠进不来
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) return null;
      params[token.slice(1)] = value;
    } else if (token !== value) {
      return null;
    }
  }
  return params;
}

async function readBody(request: Request, route: RouteDef): Promise<Record<string, unknown>> {
  if (request.method === 'GET' || request.method === 'HEAD' || route.maxBodyBytes === 0) return {};
  return readJson(request, route.maxBodyBytes);
}

async function resolvePrincipal(deps: AppDeps, request: Request, route: RouteDef, now: Date): Promise<Principal | null> {
  if (route.auth === 'bearer') return requirePrincipal(deps.db, deps.config, request, now);
  // auth=none 但带了 Token：解析失败不阻断游客操作，只是这次不认为你已登录
  try {
    return await authenticate(deps.db, deps.config, request, now);
  } catch {
    return null;
  }
}

async function openIdempotency(
  deps: AppDeps,
  ctx: Ctx,
  route: RouteDef,
  body: Record<string, unknown>,
): Promise<idempotency.IdempotencyDecision | null> {
  if (!idempotency.needsClaim(route, ctx.request)) return null;
  const key = idempotency.requiredKey(ctx.request);
  ctx.idempotencyKey = key;
  const claim = await idempotency.claim(deps.db, {
    principal: idempotencySubject(ctx),
    operation: route.operation,
    key,
    fingerprint: await idempotency.fingerprintOf(ctx.config, ctx.request.method, ctx.path, body),
    now: ctx.now,
  });
  return claim;
}

/** 幂等主体：已登录用用户 id，游客用 ip 摘要，都没有则退化为 anon */
function idempotencySubject(ctx: Ctx): string {
  if (ctx.principal) return `u:${ctx.principal.userId}`;
  if (ctx.ipHash) return `i:${ctx.ipHash}`;
  return 'a:anon';
}

function decorate(response: Response, request: Request, requestId: string, allowOrigins: string[]): Response {
  const headers = new Headers(response.headers);
  headers.set('x-request-id', requestId);
  for (const [name, value] of Object.entries(corsHeaders(request, allowOrigins))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

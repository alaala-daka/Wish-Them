/**
 * POST /api/auth/guest —— 匿名创建账号，同时返回访问令牌与恢复码
 *
 * 游客即正式账号：不做手机号/unionid 绑定，恢复码是唯一找回凭证。
 * 携带 x-demo-session 时走演示身份（is_demo = true），与真实数据完全隔离，且不返回恢复码。
 *
 * 调用示例（真实游客）：
 *   curl -X POST https://<site>/functions/v1/app/api/auth/guest \\
 *        -H 'content-type: application/json' -H 'x-client: web' \\
 *        -d '{"nickname":"小满","channel":"douyin"}'
 *
 * 调用示例（演示身份；同一 session id 重复调用得到同一账号）：
 *   curl -X POST https://<site>/functions/v1/app/api/auth/guest \\
 *        -H 'content-type: application/json' -H 'x-demo-session: 4e2a...' -d '{}'
 *
 * 返回 200：
 *   { code: 0, data: { user: {...}, session: { access_token, token_type, expires_at },
 *                      recovery_code: 'AX3F9-...', recovery_code_notice: '仅展示一次…' } }
 * 错误：400 invalid_parameter / 429 guest_too_many_registrations / 503 database_unavailable
 */
import { badRequest } from '../../lib/errors.ts';
import { clientIp, hashIp, requestClient } from '../../lib/ip.ts';
import { UUID_PATTERN } from '../../lib/patterns.ts';
import { enforceWindow, hourlyWindow } from '../../lib/quota.ts';
import { ok } from '../../lib/respond.ts';
import { validate, type FieldSpec } from '../../lib/validate.ts';
import { resolveDemoUser } from '../../domain/demo.ts';
import { createUser, issueSession, toUserDto, type Session } from '../../domain/users.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/auth/guest',
  method: 'POST',
  auth: 'none',
  operation: 'auth.guest',
  // 恢复码明文只在响应里出现一次，不允许落库存档 ⇒ 本接口不启用幂等重放
  idempotent: 'none',
  maxBodyBytes: 2048,
};

/** 头像只允许内置编号，禁止外链（防追踪与 SSRF） */
const AVATARS = Array.from({ length: 12 }, (_, index) => `default_${String(index + 1).padStart(2, '0')}`);

const BODY: Record<string, FieldSpec> = {
  nickname: { type: 'string', max: 32 },
  avatar: { type: 'enum', values: AVATARS },
  channel: { type: 'enum', values: ['xiaohongshu', 'douyin', 'wechat', 'bilibili', 'friend', 'other'] },
};

export default async function guest(ctx: Ctx): Promise<Response> {
  const body = validate<{ nickname?: string; avatar?: string; channel?: string }>(ctx.body, BODY).value;
  const ipHash = await hashIp(clientIp(ctx.request), ctx.config.ipSalt);
  const client = requestClient(ctx.request);
  const demoSessionId = (ctx.request.headers.get('x-demo-session') ?? '').trim();

  if (demoSessionId && !UUID_PATTERN.test(demoSessionId)) {
    throw badRequest('invalid_parameter', 'x-demo-session 必须是 UUID。');
  }
  if (ipHash) await guardRegistrations(ctx, ipHash, demoSessionId !== '');

  if (demoSessionId) {
    const demo = await resolveDemoUser(ctx.db, ctx.config, demoSessionId.toLowerCase(), ipHash, client, ctx.now);
    const session = await issueSession(ctx.db, ctx.config, demo.user, {
      client,
      isDemo: true,
      ttlSeconds: ctx.config.demoTtlHours * 3_600,
    }, ctx.now);
    return ok({ user: toUserDto(demo.user), session: publicSession(session), is_new: demo.isNew }, ctx.requestId);
  }

  const created = await createUser(ctx.db, ctx.config, {
    client,
    regChannel: body.channel ?? null,
    regIpHash: ipHash,
    isDemo: false,
    nickname: body.nickname,
    avatar: body.avatar,
  }, ctx.now);
  const session = await issueSession(ctx.db, ctx.config, created.user, { client, isDemo: false }, ctx.now);
  return ok({
    user: toUserDto(created.user),
    session: publicSession(session),
    recovery_code: created.recoveryCode,
    recovery_code_notice: '恢复码只显示这一次，请立刻截图或抄写保存；丢失后无法找回账号。',
  }, ctx.requestId);
}

/**
 * 同主体重复注册限制。
 * 可信 client-ip 尚未在部署环境验证 ⇒ 阈值从宽（真实 10/小时、演示 30/小时），
 * 只挡误触和脚本刷屏，真正防滥用要靠平台 WAF。
 */
async function guardRegistrations(ctx: Ctx, ipHash: string, isDemo: boolean): Promise<void> {
  const window = hourlyWindow(ctx.now, 1);
  const spec = isDemo
    ? { column: 'ip_hash', table: 'demo_sessions', limit: ctx.config.demoPerHour, errorCode: 'demo_too_many_sessions', message: '演示次数太多啦，明天再来。' }
    : { column: 'reg_ip_hash', table: 'users', limit: ctx.config.guestPerHour, errorCode: 'guest_too_many_registrations', message: '创建次数有点多，休息一下再试。' };
  await enforceWindow(ctx.db, spec.table, {
    column: spec.column,
    value: ipHash,
    since: window.since,
    now: ctx.now,
    resetAt: window.resetAt,
    limit: spec.limit,
    errorCode: spec.errorCode,
    message: spec.message,
    // 演示账号也写在 users 里且带 reg_ip_hash；真实注册计数必须排除 is_demo，
    // 否则同一个 IP 点几次演示就会把真实注册额度吃光（演示次数已由 demo_sessions 单独计数）。
    equals: isDemo ? undefined : [['is_demo', false] as const],
  });
}

function publicSession(session: Session) {
  return { access_token: session.accessToken, token_type: session.tokenType, expires_at: session.expiresAt };
}

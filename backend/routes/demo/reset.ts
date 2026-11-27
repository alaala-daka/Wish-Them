/**
 * POST /api/demo/reset —— 重置演示会话到初始状态（仅演示会话）
 *
 * 清理演示子表后用真实引擎重建：第 3 天进度、2 条打卡、账本累计 168 元。
 * 会话 id 与演示 token 不变，客户端可直接重新拉取 /api/demo/state。
 *
 * 错误：401 demo_session_expired / 403 demo_required / 404 demo_session_missing
 *       409 demo_session_busy / 503 task_pool_empty / 503 reward_pool_empty
 */
import { internal } from '../../lib/errors.ts';
import { ok } from '../../lib/respond.ts';
import { requireDemoUser } from '../../lib/auth.ts';
import { resetDemo } from '../../domain/demo.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/demo/reset',
  method: 'POST',
  auth: 'bearer',
  operation: 'demo.reset',
  idempotent: 'optional',
  maxBodyBytes: 512,
};

export default async function demoReset(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  requireDemoUser(principal);
  return ok(await resetDemo(ctx.db, ctx.config, principal, ctx.now), ctx.requestId);
}
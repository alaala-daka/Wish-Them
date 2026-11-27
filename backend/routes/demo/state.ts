/**
 * GET /api/demo/state —— 读取演示状态（愿签详情 / 今日任务 / 账本 / 结算状态）
 *
 * 只认演示 token；真实 token 访问返回 403 demo_required，演示 token 也不能读真实接口。
 * 演示会话过期后返回 401 demo_session_expired，客户端重新 POST /api/demo/session 即可。
 *
 * 错误：401 invalid_token / 401 demo_session_expired / 403 demo_required / 404 demo_session_missing
 */
import { internal } from '../../lib/errors.ts';
import { ok } from '../../lib/respond.ts';
import { requireDemoUser } from '../../lib/auth.ts';
import { readDemoState } from '../../domain/demo.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/demo/state',
  method: 'GET',
  auth: 'bearer',
  operation: 'demo.state',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function demoState(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  requireDemoUser(principal);
  return ok(await readDemoState(ctx.db, ctx.config, principal, ctx.now), ctx.requestId);
}
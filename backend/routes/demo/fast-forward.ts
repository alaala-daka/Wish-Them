/**
 * POST /api/demo/fast-forward —— 一键补齐 7 天并自动结算（仅演示会话）
 *
 * 复用真实任务生成、打卡、账本与结算引擎：7 天任务逐日按当天时钟打卡，
 * 每个契约周记账并给已完成的钱任务登记兼职收入，最后调用 settleWish 自动结算。
 * 满勤 ⇒ double_realized；返回结算后最新的演示状态。
 *
 * 错误：401 demo_session_expired / 403 demo_required / 403 demo_forbidden
 *       404 demo_session_missing / 409 demo_session_busy / 503 task_pool_empty / 503 reward_pool_empty
 */
import { internal } from '../../lib/errors.ts';
import { ok } from '../../lib/respond.ts';
import { requireDemoUser } from '../../lib/auth.ts';
import { fastForwardDemo } from '../../domain/demo.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/demo/fast-forward',
  method: 'POST',
  auth: 'bearer',
  operation: 'demo.fast_forward',
  // 重复快进会重建同一套预置数据，结果一致；带幂等键时按传入体重放
  idempotent: 'optional',
  maxBodyBytes: 512,
};

export default async function demoFastForward(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  requireDemoUser(principal);
  return ok(await fastForwardDemo(ctx.db, ctx.config, principal, ctx.now), ctx.requestId);
}
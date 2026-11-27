/**
 * POST /api/demo/scenario —— 切换结局并重播（仅演示会话）
 *
 * 入参：{ outcome: 'double_realized' | 'cyber_only' | 'failed' }
 * - double_realized：7 天全勤 + 钱任务完成 + 收入入账 → 双重兑现
 * - cyber_only：必做全勤、钱任务留空 → 赛博实现
 * - failed：前 5 天完成、后 2 天留空 → 未实现（unrealized）
 * 三档都会清理演示子表后重放真实任务/账本/结算引擎，可反复切换。
 *
 * 错误：400 invalid_parameter / 401 demo_session_expired / 403 demo_required
 *       404 demo_session_missing / 409 demo_session_busy / 503 task_pool_empty / 503 reward_pool_empty
 */
import { internal } from '../../lib/errors.ts';
import { ok } from '../../lib/respond.ts';
import { validate } from '../../lib/validate.ts';
import { requireDemoUser } from '../../lib/auth.ts';
import { applyDemoScenario, type DemoScenario } from '../../domain/demo.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/demo/scenario',
  method: 'POST',
  auth: 'bearer',
  operation: 'demo.scenario',
  idempotent: 'optional',
  maxBodyBytes: 512,
};

export default async function demoScenario(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  requireDemoUser(principal);
  const { value } = validate<{ outcome: string }>(ctx.body, {
    outcome: { type: 'enum', required: true, values: ['double_realized', 'cyber_only', 'failed'] },
  });
  const result = await applyDemoScenario(
    ctx.db,
    ctx.config,
    principal,
    value.outcome as DemoScenario,
    ctx.now,
  );
  return ok(result, ctx.requestId);
}
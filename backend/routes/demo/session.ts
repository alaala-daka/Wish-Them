/**
 * POST /api/demo/session —— 创建演示会话（比赛演示入口，无需真实登录）
 *
 * 生成独立的演示 token（is_demo=true），并用真实愿签/任务/账本引擎铺好预置人设：
 * 异地大三学生，替妈妈许愿腿疼，第 3 天进度，2 条打卡记录，账本累计 168 元。
 * 演示数据挂在 is_demo 账号 + demo_sessions 上，与真实用户/愿签物理隔离；
 * 会话 TTL 走 DEMO_TTL_HOURS（默认 24h），单 IP 每小时上限走 DEMO_PER_HOUR（默认 30）。
 *
 * 调用示例：
 *   curl -X POST https://<site>/functions/v1/app/api/demo/session \
 *        -H 'content-type: application/json' -d '{}'
 *
 * 返回 201：{ code:0, data:{ session:{demo_session_id, access_token, token_type, expires_at},
 *            user, persona, state:{wish, today_tasks, ledger, settlement, ...} } }
 * 错误：429 demo_too_many_sessions / 503 task_pool_empty / 503 reward_pool_empty
 * 说明：演示 token 不能访问真实写接口（AI/分享/公开池），所有演示改动只在演示命名空间闭环。
 */
import { created } from '../../lib/respond.ts';
import { clientIp, hashIp, requestClient } from '../../lib/ip.ts';
import { createDemoSession } from '../../domain/demo.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/demo/session',
  method: 'POST',
  auth: 'none',
  operation: 'demo.session',
  // 响应里带演示 token，不落库存档 ⇒ 不启用幂等重放
  idempotent: 'none',
  maxBodyBytes: 512,
};

export default async function demoSession(ctx: Ctx): Promise<Response> {
  const ipHash = await hashIp(clientIp(ctx.request), ctx.config.ipSalt);
  const grant = await createDemoSession(ctx.db, ctx.config, ipHash, requestClient(ctx.request), ctx.now);
  return created(grant, ctx.requestId);
}
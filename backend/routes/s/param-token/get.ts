/**
 * GET /api/s/:token —— 匿名分享页（无需登录）
 *
 * 只返回白名单：愿望文案/标题、关系、类别、状态、结局标签、契约日期、第几天。
 * 不存在 answers / ledger / proof / photo / files / reward / user_id / nickname 字段。
 *
 * 错误：404 share_not_found（不存在/已轮换）/ 404 share_revoked（已撤销）
 */
import { ok } from '../../../lib/respond.ts';
import { readSharedWish } from '../../../domain/share.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/s/:token',
  method: 'GET',
  auth: 'none',
  operation: 'share.view',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function readSharePage(ctx: Ctx): Promise<Response> {
  const view = await readSharedWish(ctx.db, ctx.params.token, ctx.now);
  return ok(view, ctx.requestId);
}
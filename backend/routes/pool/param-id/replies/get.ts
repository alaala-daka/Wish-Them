/**
 * GET /api/pool/:id/replies —— 回信列表（匿名可读，时间倒序，游标分页）
 *
 * 只返回 published；不返回 author_id。hidden/deleted 的回信不出现。
 * 错误：400 invalid_parameter / 404 pool_hidden
 */
import { ok } from '../../../../lib/respond.ts';
import { parsePage, parseUuidParam } from '../../../../lib/validate.ts';
import { listReplies } from '../../../../domain/reply.ts';
import type { Ctx, RouteDef } from '../../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/pool/:id/replies',
  method: 'GET',
  auth: 'none',
  operation: 'reply.list',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function listPoolReplies(ctx: Ctx): Promise<Response> {
  const postId = parseUuidParam(ctx.params.id);
  const page = parsePage(new URL(ctx.request.url));
  return ok(await listReplies(ctx.db, postId, page), ctx.requestId);
}
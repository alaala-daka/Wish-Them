/**
 * DELETE /api/replies/:id —— 删除回信（回信作者或帖主；重复删除幂等）
 *
 * 错误：400 invalid_parameter / 403 not_reply_owner / 404 reply_not_found
 */
import { internal } from '../../lib/errors.ts';
import { ok } from '../../lib/respond.ts';
import { parseUuidParam } from '../../lib/validate.ts';
import { deleteReply } from '../../domain/reply.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/replies/:id',
  method: 'DELETE',
  auth: 'bearer',
  operation: 'reply.delete',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function deleteReplyRoute(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const replyId = parseUuidParam(ctx.params.id);
  return ok(await deleteReply(ctx.db, principal, replyId, ctx.now), ctx.requestId);
}
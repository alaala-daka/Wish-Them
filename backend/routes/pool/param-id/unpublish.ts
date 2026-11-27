/**
 * POST /api/pool/:id/unpublish —— 作者下架公开池帖子（重复下架幂等）
 *
 * 错误：403 not_post_author / 404 pool_not_found
 */
import { internal } from '../../../lib/errors.ts';
import { ok } from '../../../lib/respond.ts';
import { parseUuidParam } from '../../../lib/validate.ts';
import { unpublishPoolPost } from '../../../domain/pool.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/pool/:id/unpublish',
  method: 'POST',
  auth: 'bearer',
  operation: 'pool.unpublish',
  idempotent: 'optional',
  maxBodyBytes: 256,
};

export default async function unpublishPoolPostRoute(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const postId = parseUuidParam(ctx.params.id);
  return ok(await unpublishPoolPost(ctx.db, principal, postId, ctx.now), ctx.requestId);
}
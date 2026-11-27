/**
 * DELETE /api/wishes/:id/share —— 撤销分享链接（仅作者；重复撤销幂等）
 *
 * 撤销后 GET /api/s/:token 返回 404 share_revoked；重新 POST 会轮换出新 token。
 * 错误：403 wish_forbidden / 404 wish_not_found / 404 share_not_found / 409 share_conflict
 */
import { internal } from '../../../../lib/errors.ts';
import { ok } from '../../../../lib/respond.ts';
import { parseUuidParam } from '../../../../lib/validate.ts';
import { requireAuthor } from '../../../../domain/wish.ts';
import { revokeShareLink } from '../../../../domain/share.ts';
import type { Ctx, RouteDef } from '../../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/wishes/:id/share',
  method: 'DELETE',
  auth: 'bearer',
  operation: 'share.revoke',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function revokeWishShare(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const wishId = parseUuidParam(ctx.params.id);
  const wish = await requireAuthor(ctx.db, wishId, principal.userId);
  const share = await revokeShareLink(ctx.db, wish, ctx.now);
  return ok({
    share: {
      status: share.status,
      revoked_at: share.revoked_at ?? null,
      token: share.token,
    },
  }, ctx.requestId);
}
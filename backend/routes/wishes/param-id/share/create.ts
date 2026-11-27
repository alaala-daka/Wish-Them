/**
 * POST /api/wishes/:id/share —— 生成/轮换只读分享链接（仅作者）
 *
 * 同一愿签只有一条当前链接：重复调用会换新 token，旧链接立即失效。
 * 响应不含五问、账本、文件；url 只是前端可直接打开的站点地址。
 *
 * 错误：400 share_not_before_sign / 403 wish_forbidden / 404 wish_not_found /
 *       409 share_conflict
 */
import { internal } from '../../../../lib/errors.ts';
import { created } from '../../../../lib/respond.ts';
import { requireRealUser } from '../../../../lib/auth.ts';
import { parseUuidParam } from '../../../../lib/validate.ts';
import { requireAuthor } from '../../../../domain/wish.ts';
import { createShareLink } from '../../../../domain/share.ts';
import type { Ctx, RouteDef } from '../../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/wishes/:id/share',
  method: 'POST',
  auth: 'bearer',
  operation: 'wish.share',
  idempotent: 'optional',
  maxBodyBytes: 256,
};

export default async function createWishShare(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  requireRealUser(principal);
  const wishId = parseUuidParam(ctx.params.id);
  const wish = await requireAuthor(ctx.db, wishId, principal.userId);
  const share = await createShareLink(ctx.db, wish, ctx.now);
  const origin = new URL(ctx.request.url).origin;
  return created({
    share: {
      token: share.token,
      url: `${origin}/s/${String(share.token)}`,
      api_path: `/api/s/${String(share.token)}`,
      status: share.status,
      visits: Number(share.visits ?? 0),
      created_at: share.created_at,
      revoked_at: share.revoked_at ?? null,
    },
  }, ctx.requestId);
}
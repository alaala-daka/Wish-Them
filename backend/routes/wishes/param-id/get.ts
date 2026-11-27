/**
 * GET /api/wishes/:id —— 愿签详情（作者视角，**不含五问明文**）
 *
 * 五问答案的唯一解密出口是后续轮次的 GET /api/wishes/:id/answers；
 * 本接口只回愿签本身与分类留痕，密文列一律不出网。
 *
 * 调用示例：
 *   curl https://<site>/functions/v1/app/api/wishes/<wish_id> -H 'authorization: Bearer <access_token>'
 *
 * 返回 200：{ code: 0, data: { wish: {...status, days, start_date, end_date, settle_open_at} } }
 * 错误：400 invalid_parameter（id 非 UUID）/ 401 invalid_token / 404 wish_not_found（含「不是你的」）
 */
import { internal } from '../../../lib/errors.ts';
import { ok } from '../../../lib/respond.ts';
import { parseUuidParam } from '../../../lib/validate.ts';
import { findOwnedWish, toWishDto } from '../../../domain/wish.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/wishes/:id',
  method: 'GET',
  auth: 'bearer',
  operation: 'wish.read',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function wishRead(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const wishId = parseUuidParam(ctx.params.id);
  const wish = await findOwnedWish(ctx.db, wishId, principal.userId);
  return ok({ wish: toWishDto(wish) }, ctx.requestId);
}
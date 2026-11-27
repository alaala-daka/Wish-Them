/**
 * GET /api/wishes/:id/settlement —— 获取两幕结算结果
 *
 * 第一幕（赛博实现）：结局类型、是否盖章、任务完成明细、结算时间；
 * 第二幕（现实兑现）：累计兑现金额、匹配礼物与价格区间、差额档位与文案、信件模板。
 * 仅作者可读（403）；未结算返回 400 wish_not_settled，响应体不含任何礼物名称/价格。
 *
 * 调用示例：
 *   curl https://<site>/functions/v1/app/api/wishes/<wish_id>/settlement \
 *        -H 'authorization: Bearer <access_token>'
 *
 * 返回 200：{ code: 0, data: { wish_id, settlement_version, first_act, second_act, extension } }
 * 错误：401 invalid_token / 403 wish_forbidden / 404 wish_not_found /
 *       400 wish_not_settled / 409 settlement_missing
 */
import { internal } from '../../../lib/errors.ts';
import { ok } from '../../../lib/respond.ts';
import { parseUuidParam } from '../../../lib/validate.ts';
import { requireAuthor } from '../../../domain/wish.ts';
import { readSettlement } from '../../../domain/settlement.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/wishes/:id/settlement',
  method: 'GET',
  auth: 'bearer',
  operation: 'wish.settlement',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function wishSettlement(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const wishId = parseUuidParam(ctx.params.id);
  const wish = await requireAuthor(ctx.db, wishId, principal.userId);
  const settlement = await readSettlement(ctx.db, wish);
  return ok(settlement, ctx.requestId);
}
/**
 * GET /api/wishes —— 我的愿签列表（创建时间倒序，游标分页）
 *
 * 只返回当前账号的数据：查询带 user_id 谓词，演示账号因此看不到真实愿签，反之亦然。
 *
 * 调用示例：
 *   curl 'https://<site>/functions/v1/app/api/wishes?limit=20' -H 'authorization: Bearer <access_token>'
 *   curl 'https://<site>/functions/v1/app/api/wishes?limit=20&cursor=<next_cursor>' -H 'authorization: Bearer <token>'
 *
 * 返回 200：{ code: 0, data: { items: [WishSummary], next_cursor: string|null, has_more: bool, limit } }
 * 错误：400 invalid_parameter（limit 越界）/ 400 invalid_cursor / 401 invalid_token
 */
import { internal } from '../../lib/errors.ts';
import { ok } from '../../lib/respond.ts';
import { parsePage } from '../../lib/validate.ts';
import { listWishes } from '../../domain/wish.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/wishes',
  method: 'GET',
  auth: 'bearer',
  operation: 'wish.list',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function wishList(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const page = parsePage(new URL(ctx.request.url));
  const result = await listWishes(ctx.db, principal.userId, page);
  return ok(result, ctx.requestId);
}
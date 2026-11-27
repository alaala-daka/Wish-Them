/**
 * GET /api/me —— 当前账号概览
 *
 * 只返回本人可见的基础资料与登录态；恢复码摘要、注册 IP 哈希永不出网。
 * 本轮不含愿望/账本统计（第 3–5 轮补 wishes_summary、ledger_summary）。
 *
 * 调用示例：
 *   curl https://<site>/functions/v1/app/api/me -H 'authorization: Bearer <access_token>'
 *
 * 返回 200：
 *   { code: 0, data: { user: { id, nickname, avatar, client, is_demo, settings, created_at },
 *                      session: { token_id, expires_at, product_today, device_count } } }
 * 错误：401 invalid_token / token_expired / token_revoked / 403 account_frozen
 */
import { internal } from '../../lib/errors.ts';
import { ok } from '../../lib/respond.ts';
import { productDate } from '../../lib/time.ts';
import { countActiveTokens, findUser, toUserDto } from '../../domain/users.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/me',
  method: 'GET',
  auth: 'bearer',
  operation: 'me.read',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function readMe(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const user = await findUser(ctx.db, principal.userId);
  if (!user) throw internal('账号不存在');

  return ok({
    user: toUserDto(user),
    session: {
      token_id: principal.tokenId,
      expires_at: principal.tokenExpiresAt,
      // 04:00 日界：客户端据此判断"今天"该不该刷新任务
      product_today: productDate(ctx.now),
      device_count: await countActiveTokens(ctx.db, principal.userId, ctx.now),
    },
  }, ctx.requestId);
}

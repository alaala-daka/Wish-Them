/**
 * POST /api/auth/logout —— 退出登录（撤销当前令牌，可选撤销全部设备）
 *
 * 只改 app.auth_tokens 的状态，不做黑名单缓存：鉴权中间件每次都按 jti 查库，
 * 因此撤销即时生效，且平台无需额外组件。
 *
 * 调用示例（只退当前设备）：
 *   curl -X POST https://<site>/functions/v1/app/api/auth/logout \\
 *        -H 'authorization: Bearer <access_token>' -H 'content-type: application/json' -d '{}'
 *
 * 调用示例（退出所有设备）：
 *   curl -X POST .../api/auth/logout -H 'authorization: Bearer <t>' -d '{"all_devices":true}'
 *
 * 返回 200：{ code: 0, data: { revoked_tokens: 1 } }
 * 错误：401 invalid_token / 400 invalid_parameter
 */
import { affected } from '../../lib/db.ts';
import { internal } from '../../lib/errors.ts';
import { ok } from '../../lib/respond.ts';
import { validate } from '../../lib/validate.ts';
import { revokeAllTokens } from '../../domain/users.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/auth/logout',
  method: 'POST',
  auth: 'bearer',
  operation: 'auth.logout',
  // 重复调用只会命中 0 行，天然幂等，无需 Idempotency-Key
  idempotent: 'none',
  maxBodyBytes: 256,
};

export default async function logout(ctx: Ctx): Promise<Response> {
  const body = validate<{ all_devices?: boolean }>(ctx.body, { all_devices: { type: 'bool' } }).value;
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');

  let revoked = await affected(
    ctx.db.from('auth_tokens')
      .update({ status: 'revoked', revoked_at: ctx.now.toISOString(), updated_at: ctx.now.toISOString() })
      .eq('id', principal.tokenId).eq('status', 'active'),
    'revoke current token',
  );
  if (body.all_devices === true) {
    revoked += await revokeAllTokens(ctx.db, principal.userId, ctx.now);
  }
  return ok({ revoked_tokens: revoked }, ctx.requestId);
}

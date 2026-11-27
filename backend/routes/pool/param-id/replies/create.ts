/**
 * POST /api/pool/:id/replies —— 给公开池帖子回信（登录）
 *
 * 入参：{ content ≤80 }；敏感内容即时拒绝；同帖每人每天一条；总日限走 REPLY_PER_DAY。
 * 本轮即时发布，无先审后发。
 *
 * 错误：400 content_too_long / sensitive_content / replies_disabled /
 *       404 pool_hidden / 409 reply_daily_limit / 429 reply_rate_limited
 */
import { badRequest, internal } from '../../../../lib/errors.ts';
import { created } from '../../../../lib/respond.ts';
import { requireRealUser } from '../../../../lib/auth.ts';
import { parseUuidParam, validate } from '../../../../lib/validate.ts';
import { requireVisiblePost } from '../../../../domain/pool.ts';
import { createReply } from '../../../../domain/reply.ts';
import type { Ctx, RouteDef } from '../../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/pool/:id/replies',
  method: 'POST',
  auth: 'bearer',
  operation: 'reply.create',
  idempotent: 'optional',
  maxBodyBytes: 512,
};

export default async function createPoolReply(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  requireRealUser(principal);
  const postId = parseUuidParam(ctx.params.id);
  const { value } = validate<{ content: string }>(ctx.body, {
    content: { type: 'text', required: true, min: 1, max: 200 },
  });
  if (value.content.length > 80) {
    throw badRequest('content_too_long', '回信不能超过 80 字。', { max_length: 80 });
  }
  const post = await requireVisiblePost(ctx.db, postId);
  return created(await createReply(ctx.db, ctx.config, principal, post, value.content, ctx.now), ctx.requestId);
}
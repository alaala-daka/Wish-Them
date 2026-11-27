/**
 * POST /api/pool/publish —— 把已结算愿签发布到公开池（仅作者）
 *
 * 入参：{ wish_id, category, is_anonymous?=true, excerpt?≤120 }
 * 发布即公开，无人工审核；摘要由服务端脱敏后落库。
 * 同一愿签只有一条帖子：重复发布返回原帖，不重复计数。
 *
 * 错误：400 wish_not_settled / pool_hidden / invalid_parameter /
 *       403 wish_forbidden / 404 wish_not_found / 429 publish_quota_exceeded
 */
import { internal } from '../../lib/errors.ts';
import { created, ok } from '../../lib/respond.ts';
import { requireRealUser } from '../../lib/auth.ts';
import { validate } from '../../lib/validate.ts';
import { requireAuthor } from '../../domain/wish.ts';
import { POOL_CATEGORIES, publishWish, toPoolPostDto } from '../../domain/pool.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/pool/publish',
  method: 'POST',
  auth: 'bearer',
  operation: 'pool.publish',
  idempotent: 'optional',
  maxBodyBytes: 1024,
};

type PublishBody = {
  wish_id: string;
  category: string;
  is_anonymous?: boolean;
  excerpt?: string;
}

export default async function publishPoolPost(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  requireRealUser(principal);
  const { value } = validate<PublishBody>(ctx.body, {
    wish_id: { type: 'uuid', required: true },
    category: { type: 'enum', required: true, values: POOL_CATEGORIES },
    is_anonymous: { type: 'bool' },
    excerpt: { type: 'text', min: 1, max: 120 },
  });
  const wish = await requireAuthor(ctx.db, value.wish_id, principal.userId);
  const result = await publishWish(ctx.db, ctx.config, principal, wish, {
    category: value.category,
    isAnonymous: value.is_anonymous ?? true,
    excerpt: value.excerpt ?? null,
  }, ctx.now);
  const body = { post: toPoolPostDto(result.post) };
  return result.created ? created(body, ctx.requestId) : ok(body, ctx.requestId);
}
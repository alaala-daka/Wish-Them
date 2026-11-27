/**
 * GET /api/pool —— 公开池列表（匿名可读，最新优先，游标分页）
 *
 * query：category?（六类）、limit≤50、cursor?
 * 只返回 published 且非演示帖子；hidden/deleted 永不出现在列表里。
 * 出参不含 author_id / wish_id / 五问 / 账本 / 文件。
 */
import { badRequest } from '../../lib/errors.ts';
import { ok } from '../../lib/respond.ts';
import { parsePage } from '../../lib/validate.ts';
import { POOL_CATEGORIES, listPoolPosts } from '../../domain/pool.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/pool',
  method: 'GET',
  auth: 'none',
  operation: 'pool.list',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function listPool(ctx: Ctx): Promise<Response> {
  const url = new URL(ctx.request.url);
  const category = url.searchParams.get('category');
  if (category !== null && !(POOL_CATEGORIES as readonly string[]).includes(category)) {
    throw badRequest('invalid_parameter', 'category 必须是六类愿望之一。', { fields: { category: 'unsupported category' } });
  }
  const sort = url.searchParams.get('sort');
  if (sort !== null && sort !== 'latest') {
    throw badRequest('invalid_parameter', 'sort 目前只支持 latest。', { fields: { sort: 'unsupported sort' } });
  }
  const page = parsePage(url);
  const result = await listPoolPosts(ctx.db, { ...page, category });
  return ok(result, ctx.requestId);
}
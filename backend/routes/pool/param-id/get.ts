/**
 * GET /api/pool/:id —— 公开池帖子详情（匿名可读）
 *
 * 只返回公开字段 + 实时回信数；hidden/deleted 一律 404 pool_hidden。
 * 错误：400 invalid_parameter（id 非 UUID）/ 404 pool_hidden
 */
import { ok } from '../../../lib/respond.ts';
import { parseUuidParam } from '../../../lib/validate.ts';
import { readPoolPost } from '../../../domain/pool.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/pool/:id',
  method: 'GET',
  auth: 'none',
  operation: 'pool.detail',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function readPoolDetail(ctx: Ctx): Promise<Response> {
  const postId = parseUuidParam(ctx.params.id);
  return ok(await readPoolPost(ctx.db, postId), ctx.requestId);
}
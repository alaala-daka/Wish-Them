/**
 * GET /api/health —— 存活探针（只读内存，不访问数据库）
 *
 * 调用示例：
 *   curl https://<site>/functions/v1/app/api/health
 *
 * 返回：{ code: 0, data: { status: 'ok', version: 'v1' }, message: 'ok' }
 */
import { ok } from '../../lib/respond.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/health',
  method: 'GET',
  auth: 'none',
  operation: 'health.ping',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function health(ctx: Ctx): Promise<Response> {
  return ok({ status: 'ok', version: ctx.config.apiVersion, time: ctx.now.toISOString() }, ctx.requestId);
}

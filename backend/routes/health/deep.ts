/**
 * GET /api/health/deep —— 依赖探针：真的打一次数据库
 *
 * 调用示例：
 *   curl https://<site>/functions/v1/app/api/health/deep
 *
 * 返回：{ code: 0, data: { status: 'ok', database: 'up' } }
 * 数据库不可用时：{ code: 503, errorCode: 'database_unavailable' }
 */
import { exists } from '../../lib/db.ts';
import { AppError, unavailable } from '../../lib/errors.ts';
import { ok } from '../../lib/respond.ts';
import { seedSnapshot } from '../../domain/seed-init.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/health/deep',
  method: 'GET',
  auth: 'none',
  operation: 'health.deep',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function healthDeep(ctx: Ctx): Promise<Response> {
  let database: 'up' | 'down' = 'up';
  try {
    // 用最小的主键探测查询代替 SELECT 1（迁移子集不支持自定义函数/SELECT 表达式）
    await exists(ctx.db.from('users').select('id').limit(1));
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    database = 'down';
  }
  if (database === 'down') throw unavailable('database_unavailable', '依赖服务未就绪。');
  return ok({ status: 'ok', database, version: ctx.config.apiVersion, seed: seedSnapshot() }, ctx.requestId);
}

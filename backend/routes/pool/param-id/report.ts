/**
 * POST /api/pool/:id/report —— 举报公开池帖子
 *
 * 同一用户对同一帖子只记一次；同一帖子满阈值（默认 3）自动 hidden。
 * 入参：{ reason_code: privacy|harassment|illegal|spam|sexual|other, detail?≤200 }
 *
 * 错误：400 invalid_parameter / 404 pool_hidden / 409 report_duplicate / 429 report_rate_limited
 */
import { internal } from '../../../lib/errors.ts';
import { created } from '../../../lib/respond.ts';
import { requireRealUser } from '../../../lib/auth.ts';
import { parseUuidParam, validate } from '../../../lib/validate.ts';
import { REPORT_REASONS, reportPoolPost } from '../../../domain/pool.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/pool/:id/report',
  method: 'POST',
  auth: 'bearer',
  operation: 'pool.report',
  idempotent: 'optional',
  maxBodyBytes: 1024,
};

type ReportBody = {
  reason_code: string;
  detail?: string;
}

export default async function reportPoolPostRoute(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  requireRealUser(principal);
  const postId = parseUuidParam(ctx.params.id);
  const { value } = validate<ReportBody>(ctx.body, {
    reason_code: { type: 'enum', required: true, values: REPORT_REASONS },
    detail: { type: 'text', min: 1, max: 200 },
  });
  const result = await reportPoolPost(ctx.db, ctx.config, principal, postId, {
    reasonCode: value.reason_code,
    detail: value.detail ?? '',
  }, ctx.now);
  return created(result, ctx.requestId);
}
/**
 * POST /api/uploads/:id/url —— 为已就绪文件签发 600 秒访问 URL（仅归属者）
 *
 * 响应里的 url 是短时能力，不写库、不打日志；重复调用只是重新签发。
 * 错误：403 file_forbidden / 404 file_not_found / 400 file_not_ready / 503 storage_unavailable
 */
import { internal } from '../../../lib/errors.ts';
import { ok } from '../../../lib/respond.ts';
import { parseUuidParam } from '../../../lib/validate.ts';
import { createFileUrl } from '../../../domain/upload.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/uploads/:id/url',
  method: 'POST',
  auth: 'bearer',
  operation: 'upload.url',
  idempotent: 'none',
  maxBodyBytes: 256,
};

export default async function uploadUrl(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const fileId = parseUuidParam(ctx.params.id);
  return ok(await createFileUrl(ctx.db, ctx.storage, principal, fileId), ctx.requestId);
}
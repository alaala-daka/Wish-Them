/**
 * POST /api/uploads/complete —— 上传完成校验（两段式直传第二步）
 *
 * 服务端 download 实测字节：大小 ≤200KB、文件头与声明的 MIME 一致后才标 ready。
 * 重复调用是幂等的：已 ready 直接返回同一个 file。
 *
 * 错误：400 upload_pending / verification_failed / file_too_large / upload_expired /
 *       403 file_forbidden / 404 file_not_found / 503 storage_unavailable
 */
import { internal } from '../../lib/errors.ts';
import { ok } from '../../lib/respond.ts';
import { validate } from '../../lib/validate.ts';
import { completeUpload, toFileDto } from '../../domain/upload.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/uploads/complete',
  method: 'POST',
  auth: 'bearer',
  operation: 'upload.complete',
  idempotent: 'optional',
  maxBodyBytes: 512,
};

export default async function uploadComplete(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const { value } = validate<{ file_id: string }>(ctx.body, {
    file_id: { type: 'uuid', required: true },
  });
  const file = await completeUpload(ctx.db, ctx.storage, principal, value.file_id, ctx.now);
  return ok({ file: toFileDto(file), file_id: String(file.id) }, ctx.requestId);
}
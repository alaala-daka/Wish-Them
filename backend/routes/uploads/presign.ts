/**
 * POST /api/uploads/presign —— 申请上传凭证（两段式直传第一步）
 *
 * 入参：{ filename, mime_type, purpose, size_bytes?, wish_id? }
 * 出参：file（pending）+ upload_url + 必须携带的 content-type。
 *
 * 本路由不启用幂等存档：响应含短时签名上传 URL，按 docs/02 §10「签名 URL 不入库」，
 * 重试会生成新的 pending 行（由 expires_at 惰性清理），不会产生业务重复。
 *
 * 错误：400 file_too_large / mime_type_unsupported / purpose_unsupported /
 *       invalid_parameter / 403 wish_forbidden / 429 upload_rate_limited / 503 storage_unavailable
 */
import { badRequest, internal } from '../../lib/errors.ts';
import { created } from '../../lib/respond.ts';
import { validate } from '../../lib/validate.ts';
import {
  UPLOAD_ALLOWED_MIME,
  UPLOAD_MAX_BYTES,
  UPLOAD_PURPOSES,
  presignUpload,
  type PresignInput,
  type UploadPurpose,
} from '../../domain/upload.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/uploads/presign',
  method: 'POST',
  auth: 'bearer',
  operation: 'upload.presign',
  idempotent: 'none',
  maxBodyBytes: 1024,
};

type PresignBody = {
  purpose: UploadPurpose;
  mime_type: string;
  filename: string;
  size_bytes?: number;
  wish_id?: string;
}

export default async function uploadPresign(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');

  const { value } = validate<PresignBody>(ctx.body, {
    purpose: { type: 'string', required: true, max: 32 },
    mime_type: { type: 'string', required: true, max: 64 },
    filename: { type: 'string', required: true, min: 1, max: 128 },
    size_bytes: { type: 'int', min: 1 },
    wish_id: { type: 'uuid' },
  });
  if (!(UPLOAD_PURPOSES as readonly string[]).includes(value.purpose)) {
    throw badRequest('purpose_unsupported', '不支持的图片用途。', { allowed: UPLOAD_PURPOSES });
  }
  if (!(UPLOAD_ALLOWED_MIME as readonly string[]).includes(value.mime_type)) {
    throw badRequest('mime_type_unsupported', '只支持 JPEG / PNG / WebP 图片。', { allowed: UPLOAD_ALLOWED_MIME });
  }
  if (value.size_bytes !== undefined && value.size_bytes > UPLOAD_MAX_BYTES) {
    throw badRequest('file_too_large', `图片不能超过 ${UPLOAD_MAX_BYTES / 1024}KB。`, { max_bytes: UPLOAD_MAX_BYTES });
  }

  const input: PresignInput = {
    purpose: value.purpose as UploadPurpose,
    mimeType: value.mime_type,
    filename: value.filename,
    sizeBytes: value.size_bytes ?? null,
    wishId: value.wish_id ?? null,
  };
  const result = await presignUpload(ctx.db, ctx.storage, ctx.config, principal, input, ctx.now);
  return created({
    file: result.file,
    file_id: (result.file as Record<string, unknown>).id,
    upload_url: result.uploadUrl,
    upload_method: 'PUT',
    required_headers: result.requiredHeaders,
    expires_at: result.expiresAt,
    max_bytes: result.maxBytes,
    allowed_mime_types: result.allowedMimeTypes,
  }, ctx.requestId);
}
/**
 * PATCH /api/me —— 修改基础设置（部分字段）
 *
 * 语义：提交的字段整体替换，未提交的保持不变；空 body 或全部字段未变 → 400 no-op。
 * 这里不碰恢复码（只由 /api/auth/recover 轮换）与账号状态（后台侧，本轮不做）。
 *
 * 调用示例：
 *   curl -X PATCH https://<site>/functions/v1/app/api/me \\
 *        -H 'authorization: Bearer <access_token>' -H 'content-type: application/json' \\
 *        -d '{"nickname":"小满","profile_text":"陪她把这周过完","wish_style_tags":["低预算","出门"],"share_default_public":false}'
 *
 * 返回 200：{ code: 0, data: { user: {...}, updated_fields: ['nickname', ...] } }
 * 错误：400 invalid_parameter（含 details.fields）/ 401 invalid_token / 403 demo_forbidden
 */
import { badRequest, internal, unprocessable } from '../../lib/errors.ts';
import { ok } from '../../lib/respond.ts';
import { updateProfile, findUser, toUserDto } from '../../domain/users.ts';
import { validate, type FieldSpec } from '../../lib/validate.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/me',
  method: 'PATCH',
  auth: 'bearer',
  operation: 'me.update',
  // 重复提交同一 body 结果一致，幂等只用于挡住连点导致的重复写入
  idempotent: 'optional',
  maxBodyBytes: 4096,
};

const BODY: Record<string, FieldSpec> = {
  nickname: { type: 'string', min: 1, max: 32 },
  avatar: { type: 'enum', values: Array.from({ length: 12 }, (_, i) => `default_${String(i + 1).padStart(2, '0')}`) },
  profile_text: { type: 'text', min: 1, max: 100 },
  wish_style_tags: { type: 'string[]', max: 3 },
  share_default_public: { type: 'bool' },
};

/** 单次提交可改的字段数很小，逐个比对成本低于引入 diff 库 */
const COLUMNS: Record<string, string> = {
  nickname: 'nickname',
  avatar: 'avatar',
  profile_text: 'profile_text',
  wish_style_tags: 'wish_style_tags',
  share_default_public: 'share_default_public',
};

export default async function updateMe(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const body = validate<Record<string, unknown>>(ctx.body, BODY);
  if (body.present.length === 0) {
    throw unprocessable('no_op', '至少修改一个字段。');
  }
  // 标签单项长度独立校验：数组类型只约束条数
  for (const tag of (body.value.wish_style_tags as string[] | undefined) ?? []) {
    if (tag.length > 12) throw badRequest('invalid_parameter', '每个风格标签不超过 12 个字符。', { fields: { wish_style_tags: 'item too long' } });
  }

  const current = await findUser(ctx.db, principal.userId);
  if (!current) throw internal('账号不存在');
  const patch: Record<string, unknown> = {};
  const updated: string[] = [];
  for (const [field, column] of Object.entries(COLUMNS)) {
    if (!(field in body.value)) continue;
    const next = body.value[field];
    if (sameValue(current[column], next)) continue;
    patch[column] = next;
    updated.push(field);
  }
  if (updated.length === 0) throw unprocessable('no_op', '提交的内容与当前一致。');

  const user = await updateProfile(ctx.db, principal.userId, patch, ctx.now);
  if (!user) throw internal('资料更新失败');
  return ok({ user: toUserDto(user), updated_fields: updated }, ctx.requestId);
}

/** jsonb 数组按 JSON 文本比较即可（顺序变化视为一次真实修改） */
function sameValue(stored: unknown, next: unknown): boolean {
  if (Array.isArray(stored) || Array.isArray(next)) return JSON.stringify(stored ?? null) === JSON.stringify(next ?? null);
  return stored === next;
}

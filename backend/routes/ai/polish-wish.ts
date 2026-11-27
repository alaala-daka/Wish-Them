/**
 * POST /api/ai/polish-wish —— 愿望润色建议（第 8 轮 P0 唯一开放的 AI 能力）
 *
 * 只返回建议，不写库、不改愿签：客户端必须让用户主动点选后才调用愿签编辑接口。
 * 所有响应带 ai_label='AI辅助' 与 label_required=true，前端展示建议时必须保留标签。
 * 模板兜底（未配置 Agents 端点 / 超时 / 调用失败 / 输出不合格 / 每日额度用尽）不阻塞主流程；
 * 相同用户 + 相同输入命中缓存，不重复调用、不重复计费。
 *
 * 调用示例：
 *   curl -X POST https://<site>/functions/v1/app/api/ai/polish-wish \
 *        -H 'authorization: Bearer <access_token>' -H 'content-type: application/json' \
 *        -d '{"wish_text":"姥姥的腿疼能轻一些，别再一个人在家扛着。","relation":"姥姥","wish_type":"body"}'
 *
 * 返回 200：{ code:0, data:{ ai_assisted:true, ai_label:'AI辅助', suggestions:[{id,text,label}],
 *            source:'agent'|'template', fallback, fallback_reason, cached, quota:{...}, notice } }
 * 错误：400 invalid_parameter / 401 invalid_token / 403 demo_forbidden
 *       409 idempotency_key_reuse（幂等键复用但入参不同）/ 503 ai_template_invalid（兜底模板被改坏）
 */
import { internal } from '../../lib/errors.ts';
import { ok } from '../../lib/respond.ts';
import { validate, type FieldSpec } from '../../lib/validate.ts';
import { requireRealUser } from '../../lib/auth.ts';
import { classifyWish, RELATIONS, WISH_TYPES } from '../../domain/rules.ts';
import { polishWish, resolveAiAdapter } from '../../domain/ai.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/ai/polish-wish',
  method: 'POST',
  auth: 'bearer',
  operation: 'ai.polish',
  // 建议结果按输入内容缓存在 ai_suggestions；带了幂等键时按键重放，不带也能安全重试
  idempotent: 'optional',
  maxBodyBytes: 2048,
};

type PolishBody = {
  wish_text: string;
  relation?: string;
  wish_type?: string;
}

const BODY: Record<string, FieldSpec> = {
  wish_text: { type: 'text', required: true, min: 1, max: 120 },
  relation: { type: 'enum', values: RELATIONS },
  wish_type: { type: 'enum', values: WISH_TYPES },
};

export default async function polishWishRoute(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  // 演示会话不能触发真实 AI 调用：接口、模型额度和缓存都只属于真实账号
  requireRealUser(principal);
  const { value } = validate<PolishBody>(ctx.body, BODY);
  const wishType = value.wish_type ?? classifyWish(value.wish_text).wishType;
  const outcome = await polishWish(
    ctx.db,
    ctx.config,
    principal,
    resolveAiAdapter(ctx.config, ctx.ai),
    {
      wishText: value.wish_text,
      relation: value.relation ?? '一个陌生人',
      wishType,
    },
    ctx.now,
  );
  return ok(outcome, ctx.requestId);
}
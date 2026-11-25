/**
 * POST /api/tasks/:id/checkin —— 完成今天的任务（提交即完成，不审核图片内容、不做 AI 验收）
 *
 * 必填 proof_id：app.files 里的对象存储文件 id，须属于当前账号、purpose=checkin_proof、status=ready。
 * 可选 note ≤30 字。重复提交同一任务不报错：任务状态保持 done，覆盖证明与备注，返回 already_done:true。
 * 支持 Idempotency-Key：同键同内容重放字节级返回首次响应；同键不同内容 409。
 *
 * 调用示例：
 *   curl -X POST https://<site>/functions/v1/app/api/tasks/<task_id>/checkin \
 *        -H 'authorization: Bearer <access_token>' -H 'content-type: application/json' \
 *        -H 'idempotency-key: 8f2b1d64-5c3e-4a9b-9d21-3f0e7c1a6b52' \
 *        -d '{"proof_id":"<file_uuid>","note":"陪她走了两圈"}'
 *
 * 返回 200：{ code: 0, data: { task:Task(status:"done"), checkin:Checkin, already_done:bool, notice } }
 * 错误：400 invalid_parameter / 400 wish_not_active / 400 task_not_today / 400 makeup_required /
 *       400 invalid_task_state / 400 proof_not_found / 400 proof_not_ready /
 *       400 proof_purpose_mismatch / 400 proof_wish_mismatch / 403 wish_forbidden / 403 proof_forbidden /
 *       404 task_not_found / 404 wish_not_found / 409 idempotency_key_reuse /
 *       409 checkin_conflict / 429 checkin_rate_limited（CHECKIN_PER_MINUTE，默认 10/分钟）
 */
import { badRequest, internal } from '../../../lib/errors.ts';
import { ok } from '../../../lib/respond.ts';
import { parseUuidParam, validate, type FieldSpec } from '../../../lib/validate.ts';
import { checkinTask, requireTaskAuthor, toCheckinDto } from '../../../domain/checkin.ts';
import { toTaskDto } from '../../../domain/task.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/tasks/:id/checkin',
  method: 'POST',
  auth: 'bearer',
  operation: 'task.checkin',
  idempotent: 'optional',
  maxBodyBytes: 1024,
};

const BODY: Record<string, FieldSpec> = {
  proof_id: { type: 'uuid', required: true },
  note: { type: 'text', min: 0, max: 30 },
  /** 金钱任务必填：用户自填的实际省下/挣到金额（分） */
  amount_cents: { type: 'money', min: 1, maxCents: 200_000 },
};

export default async function taskCheckin(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const taskId = parseUuidParam(ctx.params.id);
  const body = validate<Record<string, unknown>>(ctx.body, BODY);
  const proofId = String(body.value.proof_id);
  const note = body.value.note === undefined ? '' : String(body.value.note);
  const amountCents = body.value.amount_cents === undefined ? undefined : Number(body.value.amount_cents);

  const { task, wish } = await requireTaskAuthor(ctx.db, taskId, principal.userId);
  if (String(task.side ?? '') === 'money' && amountCents === undefined) {
    throw badRequest('amount_required', '金钱任务需要填写这次实际省下或挣到的金额。', {
      fields: { amount_cents: 'required for money task' },
    });
  }
  const result = await checkinTask(
    ctx.db,
    ctx.config,
    principal,
    task,
    wish,
    { proofId, note, amountCents },
    ctx.now,
  );
  return ok({
    task: toTaskDto(result.task),
    checkin: toCheckinDto(result.checkin),
    already_done: result.already_done,
    notice: result.notice,
  }, ctx.requestId);
}
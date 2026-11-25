/**
 * POST /api/tasks/:id/makeup —— 用本周补卡券补一条 missed 任务
 *
 * 规则：每愿签每自然周 1 张券（签约首周立契时发，后续周访问今日页时惰性发）；
 * 只补本周漏卡，过期作废；券不足返回 makeup_ticket_unavailable。
 * 补卡后任务状态 missed → made_up，并写一条 is_makeup=true 的打卡；补卡不扣分、不弹红字。
 *
 * 调用示例：
 *   curl -X POST https://<site>/functions/v1/app/api/tasks/<task_id>/makeup \
 *        -H 'authorization: Bearer <access_token>' -H 'content-type: application/json' \
 *        -d '{"proof_id":"<file_uuid>","note":"昨天补上"}'
 *
 * 返回 200：{ code: 0, data: { task:Task(status:"made_up"), checkin:Checkin,
 *            ticket:{status:"used",...}, no_penalty:true } }
 * 错误：400 invalid_parameter / 400 wish_not_active / 400 already_made_up / 400 task_not_missed /
 *       400 makeup_window_closed / 400 makeup_ticket_unavailable / 400 makeup_ticket_expired /
 *       400 proof_not_found / 400 proof_not_ready / 403 wish_forbidden / 403 proof_forbidden /
 *       404 task_not_found / 404 wish_not_found / 409 task_state_conflict /
 *       409 idempotency_key_reuse
 */
import { badRequest, internal } from '../../../lib/errors.ts';
import { ok } from '../../../lib/respond.ts';
import { parseUuidParam, validate, type FieldSpec } from '../../../lib/validate.ts';
import { makeUpTask, requireTaskAuthor, toCheckinDto, toMakeupTicketDto } from '../../../domain/checkin.ts';
import { toTaskDto } from '../../../domain/task.ts';
import type { Ctx, RouteDef } from '../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/tasks/:id/makeup',
  method: 'POST',
  auth: 'bearer',
  operation: 'task.makeup',
  idempotent: 'optional',
  maxBodyBytes: 1024,
};

const BODY: Record<string, FieldSpec> = {
  proof_id: { type: 'uuid', required: true },
  note: { type: 'text', min: 0, max: 30 },
  amount_cents: { type: 'money', min: 1, maxCents: 200_000 },
};

export default async function taskMakeup(ctx: Ctx): Promise<Response> {
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
  const result = await makeUpTask(ctx.db, principal, task, wish, { proofId, note, amountCents }, ctx.now);
  return ok({
    task: toTaskDto(result.task),
    checkin: toCheckinDto(result.checkin),
    ticket: toMakeupTicketDto(result.ticket),
    no_penalty: true,
  }, ctx.requestId);
}
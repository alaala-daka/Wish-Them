/**
 * GET /api/wishes/:id/tasks/today —— 今日任务（只回当天，不回总天数与剩余天数）
 *
 * 访问即触发惰性日界处理：把「今天之前仍未完成」的 pending 任务标成 missed（无定时任务）。
 * 仅愿签作者可读；非作者按本轮要求返回 403（与列表/详情的 404 口径不同）。
 * 顺带发放本周补卡券（按自然周一张，过期作废），返回在 makeup_ticket 里。
 *
 * 调用示例：
 *   curl https://<site>/functions/v1/app/api/wishes/<wish_id>/tasks/today \
 *        -H 'authorization: Bearer <access_token>'
 *
 * 返回 200：{ code: 0, data: { wish_id, date, tasks: [{ id, type, title, status,
 *            is_must, is_optional, proof_kind, time_slot, min_budget_cents, checkin }],
 *            makeup_ticket: { id, week_start, week_index, status, expires_at } | null } }
 * 错误：400 invalid_parameter（id 非 UUID）/ 400 wish_not_active / 401 invalid_token
 *       403 wish_forbidden / 404 wish_not_found
 */
import { rowsAs } from '../../../../lib/db.ts';
import { badRequest, internal } from '../../../../lib/errors.ts';
import { ok } from '../../../../lib/respond.ts';
import { productDate } from '../../../../lib/time.ts';
import { parseUuidParam } from '../../../../lib/validate.ts';
import { listTasksByDate, sweepMissedTasks, toTaskDto } from '../../../../domain/task.ts';
import { ensureCurrentWeekTicket, toCheckinDto, toMakeupTicketDto } from '../../../../domain/checkin.ts';
import type { CheckinRow } from '../../../../domain/checkin.ts';
import { requireAuthor } from '../../../../domain/wish.ts';
import type { Ctx, RouteDef } from '../../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/wishes/:id/tasks/today',
  method: 'GET',
  auth: 'bearer',
  operation: 'wish.today_tasks',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function wishTodayTasks(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const wishId = parseUuidParam(ctx.params.id);
  const wish = await requireAuthor(ctx.db, wishId, principal.userId);

  if (String(wish.status ?? '') !== 'active') {
    throw badRequest('wish_not_active', '愿签还没立契或已经结束，暂无今日任务。', { status: wish.status });
  }

  const today = productDate(ctx.now);
  await sweepMissedTasks(ctx.db, wishId, today, ctx.now);
  const tasks = await listTasksByDate(ctx.db, wishId, today);

  const taskIds = tasks.map((task) => String(task.id));
  const checkins = taskIds.length === 0
    ? []
    : await rowsAs<CheckinRow>(
      ctx.db.from('checkins').select('*').in('task_id', taskIds).limit(10),
      'read today checkins',
    );
  const checkinByTask = new Map(checkins.map((row) => [String(row.task_id), row]));

  const ticket = await ensureCurrentWeekTicket(ctx.db, wish, today, ctx.now);
  return ok({
    wish_id: wishId,
    date: today,
    tasks: tasks.map((task) => {
      const checkin = checkinByTask.get(String(task.id));
      return {
        ...toTaskDto(task),
        checkin: checkin ? toCheckinDto(checkin) : null,
      };
    }),
    makeup_ticket: ticket ? toMakeupTicketDto(ticket) : null,
  }, ctx.requestId);
}
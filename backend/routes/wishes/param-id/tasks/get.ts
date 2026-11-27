/**
 * GET /api/wishes/:id/tasks —— 读取愿签的全部任务（可选按日期过滤）
 *
 * 前端「账本」「结算」「今日」都需要整份任务表：今日接口只回当天，愿签详情不返回任务，
 * 因此这里补一条只读列表接口。任务与打卡一次返回，避免前端 N+1 请求。
 *
 * 查询参数：
 *   date?  YYYY-MM-DD，只看某一天；省略时返回契约内全部任务。
 *
 * 调用示例：
 *   curl "https://<site>/functions/v1/app/api/wishes/<wish_id>/tasks" \
 *        -H 'authorization: Bearer <access_token>'
 *   curl "https://<site>/functions/v1/app/api/wishes/<wish_id>/tasks?date=2026-05-20" \
 *        -H 'authorization: Bearer <access_token>'
 *
 * 返回 200：{ code: 0, data: { wish_id, date, tasks: [Task(+checkin: Checkin|null)] } }
 * 错误：400 invalid_parameter / 401 invalid_token / 403 wish_forbidden / 404 wish_not_found
 */
import { rowsAs } from '../../../../lib/db.ts';
import { badRequest, internal } from '../../../../lib/errors.ts';
import { ok } from '../../../../lib/respond.ts';
import { isValidYmd, productDate } from '../../../../lib/time.ts';
import { parseUuidParam } from '../../../../lib/validate.ts';
import { listTasks, listTasksByDate, sweepMissedTasks, toTaskDto } from '../../../../domain/task.ts';
import { toCheckinDto } from '../../../../domain/checkin.ts';
import type { CheckinRow } from '../../../../domain/checkin.ts';
import { requireAuthor } from '../../../../domain/wish.ts';
import type { Ctx, RouteDef } from '../../../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/wishes/:id/tasks',
  method: 'GET',
  auth: 'bearer',
  operation: 'wish.tasks',
  idempotent: 'none',
  maxBodyBytes: 0,
};

export default async function wishTasks(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (!principal) throw internal('鉴权中间件未注入身份');
  const wishId = parseUuidParam(ctx.params.id);

  const url = new URL(ctx.request.url);
  const rawDate = url.searchParams.get('date');
  const date = rawDate === null ? null : rawDate;
  if (date !== null && !isValidYmd(date)) {
    throw badRequest('invalid_parameter', 'date 必须是 YYYY-MM-DD。', {
      fields: { date: 'must be YYYY-MM-DD' },
    });
  }

  const wish = await requireAuthor(ctx.db, wishId, principal.userId);
  const status = String(wish.status ?? '');
  if (status === 'active') {
    await sweepMissedTasks(ctx.db, wishId, productDate(ctx.now), ctx.now);
  }

  const tasks = date === null
    ? await listTasks(ctx.db, wishId)
    : await listTasksByDate(ctx.db, wishId, date);
  const taskIds = tasks.map((task) => String(task.id));
  const checkins = taskIds.length === 0
    ? []
    : await rowsAs<CheckinRow>(
      ctx.db.from('checkins').select('*').in('task_id', taskIds).limit(taskIds.length),
      'read task checkins',
    );
  const checkinByTask = new Map(checkins.map((row) => [String(row.task_id), row]));

  return ok({
    wish_id: wishId,
    date,
    tasks: tasks.map((task) => {
      const checkin = checkinByTask.get(String(task.id));
      return { ...toTaskDto(task), checkin: checkin ? toCheckinDto(checkin) : null };
    }),
  }, ctx.requestId);
}

/**
 * 路由汇总：文件即路由，本文件是唯一的注册点。
 *
 * 新增接口的步骤：在 api/<模块>/<动作>.ts 里导出 `route` + `default`，然后在这里加一行。
 * tools/scripts/check-routes.ts 会在本地校验：
 *   1) 同一 (method, path) 不重复注册；2) 路径以 /api/ 开头且带 :param 时声明一致；
 *   3) 写操作（POST/PATCH/DELETE）的 idempotent 不为 'none' 时必须能算出 operation。
 */
import type { RouteModule } from '../lib/types.ts';
import healthDeep, { route as healthDeepRoute } from './health/deep.ts';
import health, { route as healthRoute } from './health/index.ts';
import guest, { route as guestRoute } from './auth/guest.ts';
import logout, { route as logoutRoute } from './auth/logout.ts';
import recover, { route as recoverRoute } from './auth/recover.ts';
import readMe, { route as meRoute } from './me/get.ts';
import updateMe, { route as meUpdateRoute } from './me/update.ts';
import createWish, { route as wishCreateRoute } from './wishes/create.ts';
import listWishes, { route as wishListRoute } from './wishes/get.ts';
import readWish, { route as wishReadRoute } from './wishes/param-id/get.ts';
import saveAnswers, { route as wishAnswersRoute } from './wishes/param-id/answers.ts';
import signContract, { route as wishContractRoute } from './wishes/param-id/contract.ts';
import wishTasks, { route as wishTasksRoute } from './wishes/param-id/tasks/get.ts';
import wishTodayTasks, { route as wishTodayTasksRoute } from './wishes/param-id/tasks/today.ts';
import wishSettle, { route as wishSettleRoute } from './wishes/param-id/settle.ts';
import wishSettlement, { route as wishSettlementRoute } from './wishes/param-id/settlement.ts';
import wishExtend, { route as wishExtendRoute } from './wishes/param-id/extend.ts';
import wishLedger, { route as wishLedgerRoute } from './wishes/param-id/ledger/get.ts';
import ledgerWeekBudget, { route as ledgerWeekRoute } from './ledger/weeks/param-weekStart/update.ts';
import ledgerEntryCreate, { route as ledgerEntryRoute } from './ledger/entries/create.ts';
import taskCheckin, { route as taskCheckinRoute } from './tasks/param-id/checkin.ts';
import taskMakeup, { route as taskMakeupRoute } from './tasks/param-id/makeup.ts';
import uploadPresign, { route as uploadPresignRoute } from './uploads/presign.ts';
import uploadComplete, { route as uploadCompleteRoute } from './uploads/complete.ts';
import uploadUrl, { route as uploadUrlRoute } from './uploads/param-id/url.ts';
import shareCreate, { route as shareCreateRoute } from './wishes/param-id/share/create.ts';
import shareRevoke, { route as shareRevokeRoute } from './wishes/param-id/share/index.ts';
import shareView, { route as shareViewRoute } from './s/param-token/get.ts';
import poolList, { route as poolListRoute } from './pool/get.ts';
import poolPublish, { route as poolPublishRoute } from './pool/publish.ts';
import poolDetail, { route as poolDetailRoute } from './pool/param-id/get.ts';
import poolReport, { route as poolReportRoute } from './pool/param-id/report.ts';
import poolUnpublish, { route as poolUnpublishRoute } from './pool/param-id/unpublish.ts';
import poolReplyCreate, { route as poolReplyCreateRoute } from './pool/param-id/replies/create.ts';
import poolReplyList, { route as poolReplyListRoute } from './pool/param-id/replies/get.ts';
import replyDelete, { route as replyDeleteRoute } from './replies/param-id.ts';
import aiPolishWish, { route as aiPolishWishRoute } from './ai/polish-wish.ts';
import demoSession, { route as demoSessionRoute } from './demo/session.ts';
import demoState, { route as demoStateRoute } from './demo/state.ts';
import demoFastForward, { route as demoFastForwardRoute } from './demo/fast-forward.ts';
import demoScenario, { route as demoScenarioRoute } from './demo/scenario.ts';
import demoReset, { route as demoResetRoute } from './demo/reset.ts';

export const routes: RouteModule[] = [
  { route: healthRoute, default: health },
  { route: healthDeepRoute, default: healthDeep },
  { route: guestRoute, default: guest },
  { route: recoverRoute, default: recover },
  { route: logoutRoute, default: logout },
  { route: meRoute, default: readMe },
  { route: meUpdateRoute, default: updateMe },
  { route: wishCreateRoute, default: createWish },
  { route: wishListRoute, default: listWishes },
  { route: wishReadRoute, default: readWish },
  { route: wishAnswersRoute, default: saveAnswers },
  { route: wishContractRoute, default: signContract },
  { route: wishTasksRoute, default: wishTasks },
  { route: wishTodayTasksRoute, default: wishTodayTasks },
  { route: wishSettleRoute, default: wishSettle },
  { route: wishSettlementRoute, default: wishSettlement },
  { route: wishExtendRoute, default: wishExtend },
  { route: wishLedgerRoute, default: wishLedger },
  { route: ledgerWeekRoute, default: ledgerWeekBudget },
  { route: ledgerEntryRoute, default: ledgerEntryCreate },
  { route: taskCheckinRoute, default: taskCheckin },
  { route: taskMakeupRoute, default: taskMakeup },
  { route: uploadPresignRoute, default: uploadPresign },
  { route: uploadCompleteRoute, default: uploadComplete },
  { route: uploadUrlRoute, default: uploadUrl },
  { route: shareCreateRoute, default: shareCreate },
  { route: shareRevokeRoute, default: shareRevoke },
  { route: shareViewRoute, default: shareView },
  { route: poolListRoute, default: poolList },
  { route: poolPublishRoute, default: poolPublish },
  { route: poolDetailRoute, default: poolDetail },
  { route: poolReportRoute, default: poolReport },
  { route: poolUnpublishRoute, default: poolUnpublish },
  { route: poolReplyCreateRoute, default: poolReplyCreate },
  { route: poolReplyListRoute, default: poolReplyList },
  { route: replyDeleteRoute, default: replyDelete },
  { route: aiPolishWishRoute, default: aiPolishWish },
  { route: demoSessionRoute, default: demoSession },
  { route: demoStateRoute, default: demoState },
  { route: demoFastForwardRoute, default: demoFastForward },
  { route: demoScenarioRoute, default: demoScenario },
  { route: demoResetRoute, default: demoReset },
];

/**
 * POST /api/auth/recover —— 用恢复码找回账号，换发新的访问令牌
 *
 * 语义：恢复码是唯一凭证 ⇒ 找回成功即视为"账号易主"，
 * 因此撤销该用户全部有效 token，并轮换恢复码（旧码立刻失效）。
 * 校验全部在服务端做：响应不区分"码不存在/已用过"，统一 invalid_credentials，防枚举。
 *
 * 调用示例：
 *   curl -X POST https://<site>/functions/v1/app/api/auth/recover \\
 *        -H 'content-type: application/json' -H 'x-client: web' \\
 *        -d '{"recovery_code":"AX3F9-KM2PQ-8RSTV-WYZ01-23456-ABCD"}'
 *
 * 返回 200：
 *   { code: 0, data: { user: {...}, session: { access_token, ... },
 *                      recovery_code: '<新码，仅展示一次>', revoked_tokens: 2 } }
 * 错误：400 invalid_parameter / 401 invalid_credentials / 429 auth_too_many_attempts
 */
import { count, write } from '../../lib/db.ts';
import { rateLimited, unauthorized } from '../../lib/errors.ts';
import { clientIp, hashIp } from '../../lib/ip.ts';
import { normalizeRecoveryCode } from '../../lib/recovery.ts';
import { ok } from '../../lib/respond.ts';
import { enforceWindow, hourlyWindow } from '../../lib/quota.ts';
import { validate } from '../../lib/validate.ts';
import { findUserByRecoveryCode, issueSession, revokeAllTokens, rotateRecoveryCode, toUserDto } from '../../domain/users.ts';
import type { Ctx, RouteDef } from '../../lib/types.ts';

export const route: RouteDef = {
  path: '/api/auth/recover',
  method: 'POST',
  auth: 'none',
  operation: 'auth.recover',
  // 响应含新恢复码，禁止存档重放
  idempotent: 'none',
  maxBodyBytes: 1024,
};

/** 失败次数上限：命中即锁到窗口结束，挡住慢速撞码；总次数上限用 RECOVER_PER_HOUR */
const FAILURES_PER_HOUR = 8;
const SCAN_LIMIT = 64;

export default async function recover(ctx: Ctx): Promise<Response> {
  const { recovery_code: rawCode } = validate<{ recovery_code: string }>(ctx.body, {
    recovery_code: { type: 'string', required: true, max: 200 },
  }).value;

  const ipHash = await hashIp(clientIp(ctx.request), ctx.config.ipSalt);
  const window = hourlyWindow(ctx.now, 1);
  if (ipHash) {
    await enforceWindow(ctx.db, 'auth_attempts', {
      column: 'ip_hash', value: ipHash, since: window.since, now: ctx.now,
      limit: ctx.config.recoverPerHour, errorCode: 'auth_too_many_attempts',
      message: '尝试次数太多了，歇一会儿再试。', resetAt: window.resetAt,
    });
    const failures = await count(
      ctx.db.from('auth_attempts').select('id')
        .eq('kind', 'recover').eq('ip_hash', ipHash).eq('succeeded', false)
        .gte('created_at', window.since).limit(SCAN_LIMIT),
      'count recover failures',
    );
    if (failures >= FAILURES_PER_HOUR) {
      const retrySeconds = Math.max(1, Math.ceil((window.resetAt.getTime() - ctx.now.getTime()) / 1000));
      throw rateLimited('auth_too_many_attempts', '恢复码连续多次不正确，请稍后再试。', retrySeconds);
    }
  }

  // 归一化失败也走"无效凭证"分支，不告诉客户端是格式错还是码错
  const compact = normalizeRecoveryCode(rawCode);
  const user = compact ? await findUserByRecoveryCode(ctx.db, ctx.config, compact) : null;
  if (!user || String(user.status ?? '') !== 'active') {
    await recordAttempt(ctx, ipHash, null, false);
    throw unauthorized('invalid_credentials', '恢复码不正确。');
  }

  const revoked = await revokeAllTokens(ctx.db, String(user.id), ctx.now);
  const newCode = await rotateRecoveryCode(ctx.db, ctx.config, String(user.id), ctx.now);
  const session = await issueSession(
    ctx.db, ctx.config,
    { ...user, id: String(user.id) },
    { client: headerClient(ctx), isDemo: user.is_demo === true },
    ctx.now,
  );
  await recordAttempt(ctx, ipHash, String(user.id), true);

  return ok({
    user: toUserDto(user),
    session: { access_token: session.accessToken, token_type: session.tokenType, expires_at: session.expiresAt },
    recovery_code: newCode,
    recovery_code_notice: '旧恢复码已失效，请保存新码；其他设备需要重新登录。',
    revoked_tokens: revoked,
  }, ctx.requestId);
}

async function recordAttempt(ctx: Ctx, ipHash: string | null, userId: string | null, succeeded: boolean): Promise<void> {
  const at = ctx.now.toISOString();
  await write(ctx.db.from('auth_attempts').insert({
    id: crypto.randomUUID(),
    kind: 'recover',
    ip_hash: ipHash,
    user_id: userId,
    succeeded: succeeded,
    created_at: at,
    updated_at: at,
  }).select('id'), 'record auth attempt');
}

function headerClient(ctx: Ctx): string {
  const declared = ctx.request.headers.get('x-client')?.trim().toLowerCase();
  return declared === 'web' || declared === 'mp' || declared === 'app' ? declared : 'web';
}

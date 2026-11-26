/**
 * 本地冒烟测试：不依赖 Deno、不连云上数据库，直接驱动 backend/server.ts 的路由。
 *
 *   node tools/local/smoke.ts
 *
 * 覆盖：健康检查、游客注册（含恢复码格式）、Bearer 鉴权正反例、资料部分更新、
 * 空操作与参数校验、恢复码找回（旧 token 立即失效）、退出登录、限流、幂等重放、路由 404/405；
 * 第 3 轮追加：愿签创建/五问加密/签署与任务引擎/查询分页/状态机/演示隔离/创建上限可配置。
 * 第 4 轮追加：今日任务/惰性日界/打卡覆盖/补卡券/限频。
 * 第 5 轮追加：账本默认预算/预算修改与历史锁/支出与超预算/兼职收入关联/跨周实时聚合/幂等。
 * 第 7 轮追加：两段式上传（presign→直传→complete 实测字节）/分享轮换与撤销/公开池发布与举报隐藏/回信/限流。
 * 第 8 轮追加：AI 润色（模板/agent/超时/异常/坏输出/额度/缓存/幂等/脱敏/标签）、
 *             演示会话（预置人设/快进结算/三档结局/重置/隔离/过期清理/限流）。
 * 配置表种子直接读 database/seed/*.json（与线上导入同一份），因此任务抽取走的是真实候选池。
 * 这里通过不代表线上通过：Qoder Database / Storage 的真实行为仍需部署后验证。
 */
import { createApp } from '../../backend/server.ts';
import { createLocalDeps } from './deps.ts';
import type { Envelope } from '../../backend/lib/respond.ts';
import type { AiAdapter } from '../../backend/lib/types.ts';

const deps = createLocalDeps();
const app = createApp(deps);

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
    return;
  }
  failures.push(name);
  console.log(`  FAIL ${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
}

interface CallOptions {
  method?: string;
  path: string;
  token?: string;
  body?: unknown;
  ip?: string;
  headers?: Record<string, string>;
}

async function invoke(target: typeof app, options: CallOptions): Promise<{ status: number; envelope: Envelope<never>; raw: string; headers: Headers }> {
  const headers: Record<string, string> = {
    'x-forwarded-for': options.ip ?? '203.0.113.10',
    'user-agent': 'Mozilla/5.0 (smoke-test)',
    ...options.headers,
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let body: string | undefined;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }
  const response = await target(new Request(`https://example.test/functions/v1/app${options.path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body,
  }));
  const raw = await response.text();
  return { status: response.status, envelope: JSON.parse(raw) as Envelope<never>, raw, headers: response.headers };
}

const call = (options: CallOptions) => invoke(app, options);

type Data = Record<string, unknown>;
const data = (response: { envelope: Envelope<never> }): Data => (response.envelope.data ?? {}) as Data;

// ── 1. 健康检查 ────────────────────────────────────────────────────────────
{
  const health = await call({ path: '/api/health' });
  check('GET /api/health → 200 code 0', health.status === 200 && health.envelope.code === 0, health.envelope);
  check(
    '统一安全响应头：JSON + nosniff + DENY + CSP + no-store + HSTS',
    health.headers.get('content-type') === 'application/json; charset=utf-8'
      && health.headers.get('x-content-type-options') === 'nosniff'
      && health.headers.get('x-frame-options') === 'DENY'
      && String(health.headers.get('content-security-policy')).includes("default-src 'none'")
      && health.headers.get('cache-control') === 'no-store'
      && String(health.headers.get('strict-transport-security')).includes('max-age=31536000')
      && health.headers.get('referrer-policy') === 'no-referrer',
    [...health.headers.entries()],
  );
  const deep = await call({ path: '/api/health/deep' });
  check('GET /api/health/deep → 200 database up', deep.status === 200 && data(deep).database === 'up', deep.envelope);
}

// ── 2. 游客注册 ────────────────────────────────────────────────────────────
const first = await call({ path: '/api/auth/guest', body: { nickname: '小满', channel: 'douyin' }, ip: '203.0.113.1' });
check('POST /api/auth/guest → 200 code 0', first.status === 200 && first.envelope.code === 0, first.envelope);
const firstUser = data(first).user as Data | undefined;
const firstSession = data(first).session as Data | undefined;
const firstToken = String(firstSession?.access_token ?? '');
const recoveryCode = String(data(first).recovery_code ?? '');
check('返回 user.id 与 is_demo=false', typeof firstUser?.id === 'string' && firstUser?.is_demo === false, firstUser);
check('返回 3 段 JWT', firstToken.split('.').length === 3, firstToken.slice(0, 24));
check('恢复码 26 位 Base32（分组后 31 字符）', recoveryCode.replace(/-/g, '').length === 26, recoveryCode);
check('令牌有效期 30 天', Date.parse(String(firstSession?.expires_at)) - deps.clock.now.getTime() === 30 * 86_400_000, firstSession?.expires_at);
check('响应不含恢复码摘要/IP 摘要', !/recovery_code_hash|reg_ip_hash|token_hash/.test(first.raw), first.raw.slice(0, 120));

// ── 3. Bearer 鉴权正反例 ───────────────────────────────────────────────────
{
  const anonymous = await call({ path: '/api/me' });
  check('无 Token → 401 invalid_token', anonymous.status === 401 && anonymous.envelope.errorCode === 'invalid_token', anonymous.envelope);
  const garbage = await call({ path: '/api/me', token: 'not-a-jwt' });
  check('畸形 Token → 401 invalid_token', garbage.status === 401 && garbage.envelope.errorCode === 'invalid_token', garbage.envelope);
  const parts = firstToken.split('.');
  const tampered = `${parts[0]}.${parts[1]}.${'A'.repeat(parts[2].length)}`;
  const forged = await call({ path: '/api/me', token: tampered });
  check('篡改签名 → 401 invalid_token', forged.status === 401 && forged.envelope.errorCode === 'invalid_token', forged.envelope);
  const future = await call({ path: '/api/me', token: firstToken }, );
  check('正常 Token → 200', future.status === 200, future.envelope);
  deps.clock.advance(31 * 86_400_000);
  const expired = await call({ path: '/api/me', token: firstToken });
  check('超过 30 天 → 401 token_expired', expired.status === 401 && expired.envelope.errorCode === 'token_expired', expired.envelope);
  deps.clock.advance(-31 * 86_400_000);
}

// ── 4. 资料查询与部分更新 ──────────────────────────────────────────────────
{
  const me = await call({ path: '/api/me', token: firstToken });
  check('GET /api/me → nickname 与设备数', data(me).user && (data(me).user as Data).nickname === '小满' && data(me).session !== undefined, me.envelope);
  const productToday = String((data(me).session as Data).product_today ?? '');
  check('product_today 用 04:00 日界', /^\d{4}-\d{2}-\d{2}$/.test(productToday), productToday);

  const patched = await call({
    method: 'PATCH', path: '/api/me', token: firstToken,
    body: { nickname: '阿满', wish_style_tags: ['低预算', '出门'], share_default_public: false },
  });
  const patchedUser = data(patched).user as Data;
  check(
    'PATCH /api/me → 字段生效',
    patched.status === 200 && patchedUser.nickname === '阿满' && patchedUser.share_default_public === false
      && JSON.stringify(patchedUser.wish_style_tags) === JSON.stringify(['低预算', '出门']),
    patched.envelope,
  );
  check('PATCH 只回本次修改的字段', JSON.stringify(data(patched).updated_fields) === '["nickname","wish_style_tags","share_default_public"]', data(patched).updated_fields);

  const noop = await call({ method: 'PATCH', path: '/api/me', token: firstToken, body: {} });
  check('空提交 → 422 no_op', noop.status === 422 && noop.envelope.errorCode === 'no_op', noop.envelope);
  const same = await call({ method: 'PATCH', path: '/api/me', token: firstToken, body: { nickname: '阿满' } });
  check('提交值未变化 → 422 no_op', same.status === 422 && same.envelope.errorCode === 'no_op', same.envelope);
  const tooLong = await call({ method: 'PATCH', path: '/api/me', token: firstToken, body: { nickname: 'x'.repeat(33) } });
  check('昵称超长 → 400 + details.fields', tooLong.status === 400 && (tooLong.envelope.details as Data)?.fields !== undefined, tooLong.envelope);
  const badType = await call({ method: 'PATCH', path: '/api/me', token: firstToken, body: { share_default_public: 'yes' } });
  check('布尔字段传字符串 → 400', badType.status === 400, badType.envelope);
  const longTag = await call({ method: 'PATCH', path: '/api/me', token: firstToken, body: { wish_style_tags: ['x'.repeat(13)] } });
  check('风格标签单项超 12 字 → 400（数组类型只约束条数）', longTag.status === 400 && longTag.envelope.errorCode === 'invalid_parameter', longTag.envelope);
  const unknown = await call({ method: 'PATCH', path: '/api/me', token: firstToken, body: { role: 'admin' } });
  check('未声明字段被忽略 → 422（等价空提交）', unknown.status === 422, unknown.envelope);

  const cleaned = await call({ method: 'PATCH', path: '/api/me', token: firstToken, body: { nickname: '阿\u0007甘' } });
  check(
    '控制字符（NUL/BEL 等）被清洗后入库',
    cleaned.status === 200 && String((data(cleaned).user as Data)?.nickname) === '阿甘',
    data(cleaned).user,
  );
  const xss = '<img src=x onerror=alert(1)>';
  const stored = await call({ method: 'PATCH', path: '/api/me', token: firstToken, body: { profile_text: xss } });
  check(
    'XSS 串按纯文本原样存储，响应仍是 JSON（不渲染 HTML）',
    stored.status === 200 && String((data(stored).user as Data)?.profile_text) === xss
      && stored.headers.get('content-type') === 'application/json; charset=utf-8'
      && stored.headers.get('x-content-type-options') === 'nosniff',
    data(stored).user,
  );
}

// ── 5. 幂等重放 ────────────────────────────────────────────────────────────
{
  const key = crypto.randomUUID();
  const body = { nickname: '幂等昵称' };
  const once = await call({ method: 'PATCH', path: '/api/me', token: firstToken, body, headers: { 'idempotency-key': key } });
  const twice = await call({ method: 'PATCH', path: '/api/me', token: firstToken, body, headers: { 'idempotency-key': key } });
  check('首次带键 → 200', once.status === 200, once.envelope);
  check('同键重放 → 200 + 存档响应一致', twice.status === 200 && twice.raw === once.raw, { once: once.status, twice: twice.status });
  const otherBody = await call({ method: 'PATCH', path: '/api/me', token: firstToken, body: { nickname: '换个值' }, headers: { 'idempotency-key': key } });
  check('同键不同内容 → 409 idempotency_key_reuse', otherBody.status === 409 && otherBody.envelope.errorCode === 'idempotency_key_reuse', otherBody.envelope);
  const badKey = await call({ method: 'PATCH', path: '/api/me', token: firstToken, body, headers: { 'idempotency-key': 'nope' } });
  check('幂等键非 UUID → 400', badKey.status === 400, badKey.envelope);
}

// ── 6. 恢复码找回（旧令牌即时失效） ────────────────────────────────────────
{
  const wrong = await call({ path: '/api/auth/recover', body: { recovery_code: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ' }, ip: '203.0.113.9' });
  check('恢复码不正确 → 401 invalid_credentials', wrong.status === 401 && wrong.envelope.errorCode === 'invalid_credentials', wrong.envelope);
  const short = await call({ path: '/api/auth/recover', body: { recovery_code: 'ABCD' }, ip: '203.0.113.9' });
  check('恢复码格式错误也回 401（不泄露格式差异）', short.status === 401 && short.envelope.errorCode === 'invalid_credentials', short.envelope);

  const recovered = await call({ path: '/api/auth/recover', body: { recovery_code: recoveryCode }, ip: '203.0.113.9' });
  const newSession = data(recovered).session as Data;
  check('找回成功 → 200 + 新 token', recovered.status === 200 && String(newSession?.access_token ?? '').split('.').length === 3, recovered.envelope);
  check('找回后下发新恢复码', String(data(recovered).recovery_code ?? '') !== recoveryCode, recovered.envelope);
  const stale = await call({ path: '/api/me', token: firstToken });
  check('旧 token 已撤销 → 401 token_revoked', stale.status === 401 && stale.envelope.errorCode === 'token_revoked', stale.envelope);
  const reuseOldCode = await call({ path: '/api/auth/recover', body: { recovery_code: recoveryCode }, ip: '203.0.113.9' });
  check('旧恢复码失效 → 401', reuseOldCode.status === 401, reuseOldCode.envelope);

  const newToken = String(newSession.access_token);
  const meAgain = await call({ path: '/api/me', token: newToken });
  check('新 token 可继续访问且 user.id 不变', meAgain.status === 200 && (data(meAgain).user as Data).id === firstUser?.id, meAgain.envelope);

  const loggedOut = await call({ method: 'POST', path: '/api/auth/logout', token: newToken, body: {} });
  check('POST /api/auth/logout → revoked_tokens 1', loggedOut.status === 200 && data(loggedOut).revoked_tokens === 1, loggedOut.envelope);
  const afterLogout = await call({ path: '/api/me', token: newToken });
  check('退出后访问 → 401 token_revoked', afterLogout.status === 401 && afterLogout.envelope.errorCode === 'token_revoked', afterLogout.envelope);
  const logoutAgain = await call({ method: 'POST', path: '/api/auth/logout', token: newToken, body: {} });
  check('重复退出 → 401（token 已撤销）', logoutAgain.status === 401, logoutAgain.status);
}

// ── 7. 注册限流 ────────────────────────────────────────────────────────────
{
  let blocked = 0;
  for (let index = 0; index < 12; index++) {
    const response = await call({ path: '/api/auth/guest', body: {}, ip: '198.51.100.7' });
    if (response.status === 429) blocked++;
  }
  check('同一 IP 第 11 次起 429 guest_too_many_registrations', blocked >= 2, { blocked });
  const retryAfterHeader = await call({ path: '/api/auth/guest', body: {}, ip: '198.51.100.7' });
  check('429 带 retry-after', Number(retryAfterHeader.envelope.details?.retryAfterSeconds ?? 0) > 0, retryAfterHeader.envelope);
  const otherIp = await call({ path: '/api/auth/guest', body: {}, ip: '198.51.100.8' });
  check('换 IP 仍可注册', otherIp.status === 200, otherIp.envelope);
}

// ── 8. 演示身份隔离 ────────────────────────────────────────────────────────
{
  const sessionId = crypto.randomUUID();
  const demo = await call({ path: '/api/auth/guest', body: {}, headers: { 'x-demo-session': sessionId } });
  check('演示注册 → 200 + is_demo true', demo.status === 200 && (data(demo).user as Data).is_demo === true, demo.envelope);
  check('演示响应不含恢复码', data(demo).recovery_code === undefined, Object.keys(demo.envelope.data as Data));
  const demoToken = String((data(demo).session as Data).access_token);
  const demoClaims = JSON.parse(Buffer.from(demoToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { iat: number; exp: number };
  check('演示 token 有效期 = 24h（不跟着真实会话 30 天跑）', demoClaims.exp - demoClaims.iat === 24 * 3600, demoClaims);
  check('演示身份可读 /api/me', (await call({ path: '/api/me', token: demoToken })).status === 200, demoToken.slice(0, 12));
  const again = await call({ path: '/api/auth/guest', body: {}, headers: { 'x-demo-session': sessionId } });
  check('同一 demo_session 复用同一账号', (data(again).user as Data).id === (data(demo).user as Data).id, { a: (data(demo).user as Data).id, b: (data(again).user as Data).id });
  const badSession = await call({ path: '/api/auth/guest', body: {}, headers: { 'x-demo-session': 'not-a-uuid' } });
  check('demo_session 非 UUID → 400', badSession.status === 400, badSession.envelope);
  const realClaims = JSON.parse(Buffer.from(firstToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { iat: number; exp: number };
  check('真实 token 有效期 = 30 天', realClaims.exp - realClaims.iat === 30 * 24 * 3600, realClaims);
}

// ── 9. 路由与前缀 ──────────────────────────────────────────────────────────
{
  const missing = await call({ path: '/api/nope' });
  check('未知路径 → 404 route_not_found', missing.status === 404 && missing.envelope.errorCode === 'route_not_found', missing.envelope);
  const wrongMethod = await call({ method: 'DELETE', path: '/api/me', token: firstToken });
  check('方法不支持 → 405 method_not_allowed', wrongMethod.status === 405 && wrongMethod.envelope.errorCode === 'method_not_allowed', wrongMethod.envelope);
  const allowHeader = wrongMethod.headers.get('allow') ?? '';
  check('405 带 Allow 头且列出该路径支持的动词', allowHeader.includes('GET') && allowHeader.includes('PATCH'), allowHeader);
  const bare = await app(new Request('https://example.test/api/health'));
  check('缺少 /functions/v1/app 前缀 → 404（只接受物理路径，见 http.ts）', bare.status === 404, bare.status);
  const otherApp = await app(new Request('https://example.test/functions/v1/other/api/health'));
  check('其他 Function 前缀 → 404', otherApp.status === 404, otherApp.status);
  const noType = await app(new Request('https://example.test/functions/v1/app/api/auth/guest', { method: 'POST', body: '{}' }));
  check('缺 content-type → 415', noType.status === 415, noType.status);
  const huge = await app(new Request('https://example.test/functions/v1/app/api/auth/guest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname: 'x'.repeat(5000) }),
  }));
  check('超过 maxBodyBytes → 413', huge.status === 413, huge.status);
}

// ── 10. 愿签：创建 → 五问 → 签署 → 查询 ────────────────────────────────────
const author = await call({ path: '/api/auth/guest', body: { nickname: '许愿人' }, ip: '203.0.113.20' });
const authorToken = String((data(author).session as Data).access_token);
const authorUserId = String((data(author).user as Data).id);
const stranger = await call({ path: '/api/auth/guest', body: {}, ip: '203.0.113.21' });
const strangerToken = String((data(stranger).session as Data).access_token);
const strangerUserId = String((data(stranger).user as Data).id);

const WISH_TEXT = '姥姥的腿疼能轻一些，别再一个人在家扛着。';
const newWish = (overrides: Data = {}): Data => ({ relation: '姥姥', nickname: '姥姥', pronoun: 'she', wish_text: WISH_TEXT, ...overrides });
const postWish = (body: Data, key = crypto.randomUUID(), token = authorToken) =>
  call({ path: '/api/wishes', token, body, headers: { 'idempotency-key': key } });
const putAnswers = (id: string, body: Data, token = authorToken) =>
  call({ method: 'PUT', path: `/api/wishes/${id}/answers`, token, body });
const postContract = (id: string, body: Data, token = authorToken, headers: Record<string, string> = {}) =>
  call({ path: `/api/wishes/${id}/contract`, token, body, headers });

/** 日历断言独立于 backend/lib/time.ts 写一遍，避免「用被测代码验证被测代码」 */
const isoAddDays = (date: string, count: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + count)).toISOString().slice(0, 10);
};
const isWeekend = (date: string): boolean => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
const weekendCount = (start: string, days: number): number => {
  let total = 0;
  for (let day = 0; day < days; day++) if (isWeekend(isoAddDays(start, day))) total++;
  return total;
};

let wishId = '';
let secondWishId = '';

// 10a 创建草稿
{
  const noKey = await call({ path: '/api/wishes', token: authorToken, body: newWish() });
  check('POST /api/wishes 缺 Idempotency-Key → 400 idempotency_key_required', noKey.status === 400 && noKey.envelope.errorCode === 'idempotency_key_required', noKey.envelope);
  const noToken = await call({ path: '/api/wishes', body: newWish(), headers: { 'idempotency-key': crypto.randomUUID() } });
  check('未登录创建 → 401', noToken.status === 401, noToken.envelope);

  const key = crypto.randomUUID();
  const created = await postWish(newWish(), key);
  const wish = data(created).wish as Data;
  wishId = String(wish?.id ?? '');
  check('创建草稿 → 201 + status draft', created.status === 201 && wish?.status === 'draft', created.envelope);
  check('关键词规则识别为 body（疼/腿 命中 2 > 一个人 命中 1）', wish?.wish_type === 'body' && wish?.classifier_type === 'body', wish);
  check('置信度是基点整数 6667（2/3）', wish?.classifier_confidence_bps === 6667, wish?.classifier_confidence_bps);
  check('标题由原文确定性派生且 ≤30 字', typeof wish?.title === 'string' && (wish.title as string).length <= 30 && WISH_TEXT.startsWith(wish.title as string), wish?.title);
  check('详情出参不含 user_id', wish?.user_id === undefined, Object.keys(wish ?? {}));
  check('布尔字段是 true/false 而不是 1/0', wish?.five_questions_done === false && wish?.is_public === false && wish?.is_demo === false, wish);
  check('创建响应不含五问密文列与恢复码', !/q1_worry_enc|q5_gift_enc|recovery_code/.test(created.raw), created.raw.slice(0, 160));

  const replay = await postWish(newWish(), key);
  check('同键重放 → 201 且响应逐字节一致', replay.status === 201 && replay.raw === created.raw, { once: created.status, twice: replay.status });
  const reuse = await postWish(newWish({ wish_text: '换个愿望' }), key);
  check('同键不同内容 → 409 idempotency_key_reuse', reuse.status === 409 && reuse.envelope.errorCode === 'idempotency_key_reuse', reuse.envelope);
  const another = await postWish(newWish());
  secondWishId = String((data(another).wish as Data).id);
  check('换键再建 → 另一个草稿', another.status === 201 && secondWishId !== wishId, another.envelope);

  const badBodies: Array<[string, Data]> = [
    ['relation 非法枚举', newWish({ relation: '外星人' })],
    ['wish_text 全空白', newWish({ wish_text: '   ' })],
    ['wish_text 超 120 字', newWish({ wish_text: '愿'.repeat(121) })],
    ['nickname 超 8 字', newWish({ nickname: '称'.repeat(9) })],
    ['pronoun 非法枚举', newWish({ pronoun: 'it' })],
  ];
  for (const [name, body] of badBodies) {
    const bad = await postWish(body);
    check(`创建参数错误：${name} → 400 invalid_parameter + details.fields`, bad.status === 400 && bad.envelope.errorCode === 'invalid_parameter' && (bad.envelope.details as Data)?.fields !== undefined, bad.envelope);
  }
  const noRelation = await postWish({ wish_text: WISH_TEXT });
  check('缺必填 relation → 400', noRelation.status === 400, noRelation.envelope);
  const defaults = await postWish({ relation: '室友', wish_text: '室友考研压力大，希望能顺利上岸。' });
  const defaultWish = data(defaults).wish as Data;
  check('nickname/pronoun 缺省 = 关系本身 / they', defaultWish?.nickname === '室友' && defaultWish?.pronoun === 'they', defaultWish);
  check('考研命中 study 类', defaultWish?.wish_type === 'study', defaultWish?.wish_type);
}

// 10b 五问答案（部分提交 + 字段级加密）
{
  const foreign = await putAnswers(wishId, { q1: '不是我的' }, strangerToken);
  check('非作者改五问 → 403 wish_forbidden', foreign.status === 403 && foreign.envelope.errorCode === 'wish_forbidden', foreign.envelope);
  const missing = await putAnswers(crypto.randomUUID(), { q1: 'x' });
  check('不存在的愿签 → 404 wish_not_found', missing.status === 404 && missing.envelope.errorCode === 'wish_not_found', missing.envelope);
  const badId = await putAnswers('not-a-uuid', { q1: 'x' });
  check('id 非 UUID → 400 invalid_parameter', badId.status === 400 && badId.envelope.errorCode === 'invalid_parameter', badId.envelope);
  const empty = await putAnswers(wishId, {});
  check('空提交 → 422 no_op', empty.status === 422 && empty.envelope.errorCode === 'no_op', empty.envelope);
  const tooLong = await putAnswers(wishId, { q1: '答'.repeat(201) });
  check('单问超 200 字 → 400', tooLong.status === 400, tooLong.envelope);

  const partial = await putAnswers(wishId, { q1: '最怕她腿疼加重', q2: '基本一个人待着' });
  check('部分提交 → 200 + answered 只含本次字段', partial.status === 200 && JSON.stringify(data(partial).answered) === '["q1","q2"]', partial.envelope);
  check('未答完 → five_questions_done false + completed_at null', data(partial).five_questions_done === false && data(partial).completed_at === null, data(partial));
  check('响应不回显答案明文', !partial.raw.includes('最怕她腿疼加重'), partial.raw.slice(0, 200));
  const stored = deps.db.rowsOf('wish_answers').find((row) => row.wish_id === wishId);
  check('落库是 v1 密文而不是明文', String(stored?.q1_worry_enc ?? '').startsWith('v1:') && !JSON.stringify(stored).includes('最怕她腿疼加重'), stored?.q1_worry_enc);
  check('未提交的问保持空串', stored?.q3_home_enc === '', stored?.q3_home_enc);

  const rest = await putAnswers(wishId, { q3: '半年没回家', q4: '每月能省两百', q5: '想要一副护膝' });
  check('答完五问 → five_questions_done true + completed_at', data(rest).five_questions_done === true && typeof data(rest).completed_at === 'string', rest.envelope);
  const overwrite = await putAnswers(wishId, { q1: '改一次答案' });
  check('再改一问不影响完成态', data(overwrite).five_questions_done === true && JSON.stringify(data(overwrite).answered) === '["q1"]', overwrite.envelope);
  const after = deps.db.rowsOf('wish_answers').find((row) => row.wish_id === wishId);
  check('部分提交不覆盖其他问的密文', String(after?.q5_gift_enc ?? '').startsWith('v1:'), after?.q5_gift_enc);
  check('一个愿签只有一行答案', deps.db.rowsOf('wish_answers').filter((row) => row.wish_id === wishId).length === 1, deps.db.rowsOf('wish_answers').length);
}

// 10c 签署契约与任务引擎
{
  const incomplete = await postContract(secondWishId, { days: 10 });
  check('五问未答完就签署 → 400 answers_incomplete', incomplete.status === 400 && incomplete.envelope.errorCode === 'answers_incomplete', incomplete.envelope);
  check('answers_incomplete 指出缺哪几问', JSON.stringify((incomplete.envelope.details as Data)?.missing) === '["q1","q2","q3","q4","q5"]', incomplete.envelope.details);
  const badDays = await postContract(wishId, { days: 5 });
  check('days 非 10 → 400 invalid_parameter', badDays.status === 400 && badDays.envelope.errorCode === 'invalid_parameter', badDays.envelope);
  const stringDays = await postContract(wishId, { days: '10' });
  check('days 传字符串 → 400', stringDays.status === 400, stringDays.envelope);
  const foreign = await postContract(wishId, {}, strangerToken);
  check('非作者签署 → 403 wish_forbidden', foreign.status === 403 && foreign.envelope.errorCode === 'wish_forbidden', foreign.envelope);

  const signed = await postContract(wishId, { days: 10 });
  const signedWish = data(signed).wish as Data;
  const tasks = data(signed).tasks as Data[];
  const startDate = String(signedWish?.start_date ?? '');
  const endDate = String(signedWish?.end_date ?? '');
  const money = weekendCount(startDate, 10);
  check('签署 → 200 + active + first_sign true', signed.status === 200 && signedWish?.status === 'active' && data(signed).first_sign === true, signed.envelope);
  check('start_date = 产品日（04:00 日界）', startDate === '2026-05-20', startDate);
  check('end_date = start + days - 1', endDate === isoAddDays(startDate, 9), endDate);
  check('settle_open_at = 截止日次日 04:00+08（即当日 20:00Z）', signedWish?.settle_open_at === `${endDate}T20:00:00.000Z`, signedWish?.settle_open_at);
  check('任务总数 = 每天 2 条必做 + 周末各 1 条钱任务', tasks.length === 20 + money, { total: tasks.length, money });

  const byDay = new Map<number, Data[]>();
  for (const task of tasks) {
    const day = Number(task.day_index);
    byDay.set(day, [...(byDay.get(day) ?? []), task]);
  }
  check('day_index 从 0 开始且覆盖 10 天', [...byDay.keys()].sort((a, b) => a - b).join(',') === '0,1,2,3,4,5,6,7,8,9', [...byDay.keys()]);
  const shapeOk = [...byDay.entries()].every(([day, list]) => {
    const types = list.map((task) => String(task.type)).sort().join(',');
    const expected = isWeekend(isoAddDays(startDate, day)) ? 'money,self,ta' : 'self,ta';
    return types === expected && list.every((task) => task.status === 'pending' && task.task_date === isoAddDays(startDate, day));
  });
  check('每天 1 条 ta + 1 条 self，周末多 1 条 money，全部 pending', shapeOk, tasks.slice(0, 3));
  check('task_date 是 TEXT ISO 日期', tasks.every((task) => /^\d{4}-\d{2}-\d{2}$/.test(String(task.task_date))), tasks[0]?.task_date);
  const titles = tasks.map((task) => String(task.title));
  check('同一愿签内任务标题不重复', new Set(titles).size === titles.length, titles.length);
  check('任务都带标签（1~3 个 2~3 字）', tasks.every((task) => Array.isArray(task.tags) && (task.tags as string[]).length > 0), tasks.filter((task) => !Array.isArray(task.tags)).length);
  const summary = data(signed).task_summary as Data;
  check('task_summary 与任务表一致', summary.total === tasks.length && summary.must === 20 && summary.optional === money && summary.ta === 10 && summary.self === 10 && summary.money === money && summary.days === 10, summary);
  check('返回恢复码提示但不重新下发恢复码', typeof data(signed).recovery_code_notice === 'string' && data(signed).recovery_code === undefined, Object.keys(data(signed)));
  check('签署响应不含五问明文', !signed.raw.includes('改一次答案'), signed.raw.slice(0, 160));

  const locked = await putAnswers(wishId, { q1: '签完再改' });
  check('签署后改五问 → 400 answers_locked', locked.status === 400 && locked.envelope.errorCode === 'answers_locked', locked.envelope);

  const repeat = await postContract(wishId, { days: 10 });
  check('重复签署 → 200 + first_sign false', repeat.status === 200 && data(repeat).first_sign === false, repeat.envelope);
  check('重复签署不新增任务、不改开始日', (data(repeat).tasks as Data[]).length === tasks.length && (data(repeat).wish as Data).start_date === startDate, data(repeat).task_summary);
  const bigger = await postContract(wishId, { days: 10 });
  check('重复签署仍按首签 10 天', (data(bigger).wish as Data).days === 10 && (data(bigger).tasks as Data[]).length === tasks.length, data(bigger).task_summary);

  const contractKey = crypto.randomUUID();
  const once = await postContract(wishId, { days: 10 }, authorToken, { 'idempotency-key': contractKey });
  const twice = await postContract(wishId, { days: 10 }, authorToken, { 'idempotency-key': contractKey });
  check('签署同键重放 → 响应逐字节一致', once.status === 200 && twice.raw === once.raw, { once: once.status, twice: twice.status });

  // 崩溃补齐：任务 id 由 (愿签, 天, 序) 派生，重签只补缺的那几条
  const victim = String(tasks[0].id);
  await deps.db.from('tasks').delete().eq('id', victim);
  const repaired = await postContract(wishId, {});
  const repairedTasks = data(repaired).tasks as Data[];
  check('删掉一条任务后重签会补回来', repairedTasks.length === tasks.length && repairedTasks.some((task) => task.id === victim), data(repaired).task_summary);
  check('补齐仍算重复签署（first_sign false）', data(repaired).first_sign === false, data(repaired).first_sign);

  // 长契约：候选池耗尽 → 轮转副本
  const longId = String((data(await postWish(newWish())).wish as Data).id);
  await putAnswers(longId, { q1: 'a', q2: 'b', q3: 'c', q4: 'd', q5: 'e' });
  const longSigned = await postContract(longId, { days: 10 });
  const longTasks = data(longSigned).tasks as Data[];
  const longStart = String((data(longSigned).wish as Data).start_date);
  const longMoney = weekendCount(longStart, 10);
  check('十天契约一次性生成全部任务', longTasks.length === 20 + longMoney, { total: longTasks.length, longMoney });
  check('十天契约标题仍唯一', new Set(longTasks.map((task) => String(task.title))).size === longTasks.length, longTasks.length);
  check('长契约出现轮转副本', longTasks.some((task) => Number(task.rotation) > 0), longTasks.filter((task) => Number(task.rotation) > 0).length);
  const rotated = deps.db.rowsOf('tasks').filter((row) => row.wish_id === longId && Number(row.rotation) > 0);
  check('轮转副本 template_id 置 NULL', rotated.length > 0 && rotated.every((row) => row.template_id === null), rotated.length);
  check('轮转副本标题带「（第N轮）」后缀', rotated.every((row) => /（第\d+轮）$/.test(String(row.text))), String(rotated[0]?.text));
  check('轮转副本 is_must 口径不变', rotated.every((row) => row.is_must === (row.side !== 'money')), rotated[0]);

  // 非法状态流转：settling 之后由第 5 轮写入，本轮只能拒绝
  await deps.db.from('wishes').update({ status: 'settled' }).eq('id', secondWishId);
  const illegal = await postContract(secondWishId, {});
  check('settled 再签署 → 400 wish_not_draft', illegal.status === 400 && illegal.envelope.errorCode === 'wish_not_draft', illegal.envelope);
  const illegalAnswers = await putAnswers(secondWishId, { q1: 'x' });
  check('settled 改五问 → 400 answers_locked', illegalAnswers.status === 400 && illegalAnswers.envelope.errorCode === 'answers_locked', illegalAnswers.envelope);
}

// 10d 查询与分页
{
  const detail = await call({ path: `/api/wishes/${wishId}`, token: authorToken });
  check('GET /api/wishes/:id → 200 + active', detail.status === 200 && (data(detail).wish as Data)?.status === 'active', detail.envelope);
  check('详情不含五问明文或密文', !/q1_worry_enc|改一次答案|v1:/.test(detail.raw), detail.raw.slice(0, 200));
  const foreign = await call({ path: `/api/wishes/${wishId}`, token: strangerToken });
  check('读别人的愿签 → 404 wish_not_found（不泄漏存在性）', foreign.status === 404 && foreign.envelope.errorCode === 'wish_not_found', foreign.envelope);
  const badId = await call({ path: '/api/wishes/abc', token: authorToken });
  check('详情 id 非 UUID → 400', badId.status === 400, badId.envelope);

  const list = await call({ path: '/api/wishes', token: authorToken });
  const items = data(list).items as Data[];
  check('列表只含自己的愿签', list.status === 200 && items.length === 4, { count: items.length });
  const stamps = items.map((item) => String(item.created_at));
  check('列表按创建时间倒序', stamps.every((value, index) => index === 0 || stamps[index - 1] >= value), stamps);
  check('列表项是卡片白名单（不含原文与分类留痕）', items.every((item) => item.wish_text === undefined && item.classifier_confidence_bps === undefined), Object.keys(items[0] ?? {}));
  const strangerList = await call({ path: '/api/wishes', token: strangerToken });
  check('别人的列表为空', (data(strangerList).items as Data[]).length === 0, strangerList.envelope);

  const page1 = await call({ path: '/api/wishes?limit=1', token: authorToken });
  check('limit=1 → has_more true + next_cursor', data(page1).has_more === true && typeof data(page1).next_cursor === 'string', page1.envelope);
  const cursor = encodeURIComponent(String(data(page1).next_cursor));
  const page2 = await call({ path: `/api/wishes?limit=1&cursor=${cursor}`, token: authorToken });
  const firstItem = (data(page1).items as Data[])[0];
  const secondItem = (data(page2).items as Data[])[0];
  check('游标翻页不重复（同一时间戳按 id 兜底）', secondItem?.id !== firstItem?.id && String(secondItem?.created_at) <= String(firstItem?.created_at), { a: firstItem?.id, b: secondItem?.id });
  const lastPage = await call({ path: '/api/wishes?limit=100', token: authorToken });
  check('取满一页 → has_more false + next_cursor null', data(lastPage).has_more === false && data(lastPage).next_cursor === null, lastPage.envelope);
  check('limit=0 → 400', (await call({ path: '/api/wishes?limit=0', token: authorToken })).status === 400);
  check('limit=101 → 400', (await call({ path: '/api/wishes?limit=101', token: authorToken })).status === 400);
  const badCursor = await call({ path: '/api/wishes?cursor=not-a-cursor', token: authorToken });
  check('非法游标 → 400 invalid_cursor', badCursor.status === 400 && badCursor.envelope.errorCode === 'invalid_cursor', badCursor.envelope);
  check('未登录列表 → 401', (await call({ path: '/api/wishes' })).status === 401);
}

// 10e 每日创建上限来自配置（WISH_CREATE_PER_DAY），不是硬编码
{
  const strictDeps = createLocalDeps('2026-05-20T06:00:00.000Z', { wishCreatePerDay: 2 });
  const strictApp = createApp(strictDeps);
  const guest = await invoke(strictApp, { path: '/api/auth/guest', body: {}, ip: '203.0.113.30' });
  const token = String((data(guest).session as Data).access_token);
  const post = () => invoke(strictApp, { path: '/api/wishes', token, body: newWish(), headers: { 'idempotency-key': crypto.randomUUID() } });
  check('阈值=2 时前两次创建成功', (await post()).status === 201 && (await post()).status === 201);
  const third = await post();
  check('第三次 → 429 wish_create_limited', third.status === 429 && third.envelope.errorCode === 'wish_create_limited', third.envelope);
  check('429 带 retryAfterSeconds', Number(third.envelope.details?.retryAfterSeconds ?? 0) > 0, third.envelope.details);
}

// 10f 演示账号：数据隔离 + 默认天数 + 恢复码提示分支
{
  const demo = await call({ path: '/api/auth/guest', body: {}, headers: { 'x-demo-session': crypto.randomUUID() }, ip: '203.0.113.31' });
  const demoToken = String((data(demo).session as Data).access_token);
  const created = await call({ path: '/api/wishes', token: demoToken, body: newWish(), headers: { 'idempotency-key': crypto.randomUUID() } });
  const demoWish = data(created).wish as Data;
  check('演示账号可建愿签且 is_demo true', created.status === 201 && demoWish?.is_demo === true, created.envelope);
  const realList = await call({ path: '/api/wishes', token: authorToken });
  check('演示愿签不出现在真实账号列表里', !(data(realList).items as Data[]).some((item) => item.id === demoWish?.id), realList.envelope);
  check('真实账号读演示愿签 → 404', (await call({ path: `/api/wishes/${demoWish?.id}`, token: authorToken })).status === 404);
  await putAnswers(String(demoWish?.id), { q1: 'a', q2: 'b', q3: 'c', q4: 'd', q5: 'e' }, demoToken);
  const demoSigned = await postContract(String(demoWish?.id), {}, demoToken);
  check('days 缺省 = 10', (data(demoSigned).wish as Data).days === 10, data(demoSigned).task_summary);
  check('演示签署提示说明没有恢复码', String(data(demoSigned).recovery_code_notice).includes('演示账号没有恢复码'), data(demoSigned).recovery_code_notice);
}

// 10g 演示会话上限同样来自配置（DEMO_PER_HOUR），不是硬编码
{
  const strictDeps = createLocalDeps('2026-05-20T06:00:00.000Z', { demoPerHour: 2 });
  const strictApp = createApp(strictDeps);
  const open = () => invoke(strictApp, { path: '/api/auth/guest', body: {}, ip: '203.0.113.32', headers: { 'x-demo-session': crypto.randomUUID() } });
  check('演示阈值=2 时前两次开会话成功', (await open()).status === 200 && (await open()).status === 200);
  const third = await open();
  check('第三个演示会话 → 429 demo_too_many_sessions', third.status === 429 && third.envelope.errorCode === 'demo_too_many_sessions', third.envelope);
}

// ── 11. 第 4 轮：今日任务 / 打卡 / 补卡 ────────────────────────────────────
const nowStamp = deps.clock.now.toISOString();
const makeProofRow = (
  id: string,
  ownerId: string,
  targetWishId: string,
  stamp: string,
  overrides: Data = {},
): Data => ({
  id,
  user_id: ownerId,
  wish_id: targetWishId,
  purpose: 'checkin_proof',
  object_key: `u/${ownerId}/checkin_proof/${id}`,
  status: 'ready',
  mime_type: 'image/jpeg',
  size_bytes: 1024,
  width: 0,
  height: 0,
  sha256: 'a'.repeat(64),
  is_public: false,
  verified_at: stamp,
  expires_at: null,
  deleted_at: null,
  created_at: stamp,
  updated_at: stamp,
  ...overrides,
});
const proofReady = crypto.randomUUID();
const proofReady2 = crypto.randomUUID();
const proofPending = crypto.randomUUID();
const proofForeign = crypto.randomUUID();
const proofAvatar = crypto.randomUUID();
const proofOtherWish = crypto.randomUUID();
deps.db.seed('files', [
  makeProofRow(proofReady, authorUserId, wishId, nowStamp),
  makeProofRow(proofReady2, authorUserId, wishId, nowStamp, { sha256: 'b'.repeat(64) }),
  makeProofRow(proofPending, authorUserId, wishId, nowStamp, { status: 'pending', verified_at: null }),
  makeProofRow(proofForeign, strangerUserId, wishId, nowStamp),
  makeProofRow(proofAvatar, authorUserId, wishId, nowStamp, { purpose: 'avatar' }),
  makeProofRow(proofOtherWish, authorUserId, crypto.randomUUID(), nowStamp),
]);

const todayPath = `/api/wishes/${wishId}/tasks/today`;
const getToday = (token = authorToken) => call({ path: todayPath, token });
const postCheckin = (taskId: string, body: Data, token = authorToken, headers: Record<string, string> = {}) =>
  call({ path: `/api/tasks/${taskId}/checkin`, token, body, headers });
const postMakeup = (taskId: string, body: Data, token = authorToken, headers: Record<string, string> = {}) =>
  call({ path: `/api/tasks/${taskId}/makeup`, token, body, headers });

let may20Tasks: Data[] = [];
let may21Tasks: Data[] = [];

// 11a 今日任务（只回当天、04:00 日界、惰性发本周补卡券）
{
  check('今日任务未登录 → 401', (await call({ path: todayPath })).status === 401);
  const foreign = await getToday(strangerToken);
  check('非作者读今日任务 → 403 wish_forbidden', foreign.status === 403 && foreign.envelope.errorCode === 'wish_forbidden', foreign.envelope);
  const badId = await call({ path: '/api/wishes/not-a-uuid/tasks/today', token: authorToken });
  check('今日任务 id 非 UUID → 400', badId.status === 400, badId.envelope);

  const draft = await postWish(newWish());
  const draftId = String((data(draft).wish as Data).id);
  const notActive = await call({ path: `/api/wishes/${draftId}/tasks/today`, token: authorToken });
  check('草稿读今日任务 → 400 wish_not_active', notActive.status === 400 && notActive.envelope.errorCode === 'wish_not_active', notActive.envelope);

  const today = await getToday();
  may20Tasks = (data(today).tasks as Data[]) ?? [];
  check('今日任务 → 200 + 当天 2 条', today.status === 200 && data(today).date === '2026-05-20' && may20Tasks.length === 2, today.envelope);
  check('今日页不返回总天数/剩余天数', data(today).days === undefined && data(today).total_days === undefined && data(today).remaining_days === undefined, Object.keys(data(today)));
  check(
    '任务字段含 id/type/title/status/is_optional',
    may20Tasks.every((task) => typeof task.id === 'string'
      && ['ta', 'self', 'money'].includes(String(task.type))
      && typeof task.title === 'string'
      && task.status === 'pending'
      && task.is_optional === false),
    may20Tasks[0],
  );
  check('当天类型是 ta + self（周三无钱任务）', may20Tasks.map((task) => task.type).sort().join(',') === 'self,ta', may20Tasks.map((task) => task.type));
  const ticket = data(today).makeup_ticket as Data;
  check('今日页给出本周补卡券', ticket?.week_start === '2026-05-18' && ticket?.week_index === 1 && ticket?.status === 'available', ticket);
  await getToday();
  check(
    '补卡券按自然周只发一张（重复访问不叠加）',
    deps.db.rowsOf('makeup_tickets').filter((row) => row.wish_id === wishId && row.week_start === '2026-05-18').length === 1,
    deps.db.rowsOf('makeup_tickets').length,
  );
}

// 11b 打卡：参数、权限、重复提交与幂等
let may20TaId = '';
let may20SelfId = '';
{
  const ta = may20Tasks.find((task) => task.type === 'ta') as Data;
  const selfTask = may20Tasks.find((task) => task.type === 'self') as Data;
  may20TaId = String(ta.id);
  may20SelfId = String(selfTask.id);

  const noProof = await postCheckin(may20TaId, { note: 'x' });
  check('打卡缺 proof_id → 400 + details.fields', noProof.status === 400 && noProof.envelope.errorCode === 'invalid_parameter' && (noProof.envelope.details as Data)?.fields !== undefined, noProof.envelope);
  const longNote = await postCheckin(may20TaId, { proof_id: proofReady, note: '字'.repeat(31) });
  check('打卡备注超 30 字 → 400', longNote.status === 400, longNote.envelope);
  const badProof = await postCheckin(may20TaId, { proof_id: 'nope' });
  check('proof_id 非 UUID → 400', badProof.status === 400, badProof.envelope);
  const foreignProof = await postCheckin(may20TaId, { proof_id: proofForeign });
  check('用别人的图片打卡 → 403 proof_forbidden', foreignProof.status === 403 && foreignProof.envelope.errorCode === 'proof_forbidden', foreignProof.envelope);
  const pendingProof = await postCheckin(may20TaId, { proof_id: proofPending });
  check('图片未 ready → 400 proof_not_ready', pendingProof.status === 400 && pendingProof.envelope.errorCode === 'proof_not_ready', pendingProof.envelope);
  const avatarProof = await postCheckin(may20TaId, { proof_id: proofAvatar });
  check('非打卡用途图片 → 400 proof_purpose_mismatch', avatarProof.status === 400 && avatarProof.envelope.errorCode === 'proof_purpose_mismatch', avatarProof.envelope);
  const otherWishProof = await postCheckin(may20TaId, { proof_id: proofOtherWish });
  check('图片绑定别的愿签 → 400 proof_wish_mismatch', otherWishProof.status === 400 && otherWishProof.envelope.errorCode === 'proof_wish_mismatch', otherWishProof.envelope);
  const missingTask = await postCheckin(crypto.randomUUID(), { proof_id: proofReady });
  check('不存在的任务 → 404 task_not_found', missingTask.status === 404 && missingTask.envelope.errorCode === 'task_not_found', missingTask.envelope);
  const foreignTask = await postCheckin(may20TaId, { proof_id: proofReady }, strangerToken);
  check('非作者打卡 → 403 wish_forbidden', foreignTask.status === 403 && foreignTask.envelope.errorCode === 'wish_forbidden', foreignTask.envelope);

  const done = await postCheckin(may20TaId, { proof_id: proofReady, note: '陪她走了两圈' });
  const doneTask = data(done).task as Data;
  const doneCheckin = data(done).checkin as Data;
  check('打卡成功 → 200 + task done', done.status === 200 && doneTask.status === 'done' && doneTask.id === may20TaId, done.envelope);
  check(
    '打卡记录证明/备注/服务端时间是权威值',
    doneCheckin.proof_id === proofReady && doneCheckin.note === '陪她走了两圈'
      && doneCheckin.is_makeup === false && typeof doneCheckin.server_ts === 'string',
    doneCheckin,
  );
  check('checkin_date 是产品日', doneCheckin.checkin_date === '2026-05-20', doneCheckin.checkin_date);
  const checkinRows = deps.db.rowsOf('checkins').filter((row) => row.task_id === may20TaId);
  check(
    'checkins 落库一行并关联愿签/用户/图片摘要',
    checkinRows.length === 1 && checkinRows[0].wish_id === wishId && checkinRows[0].user_id === authorUserId
      && checkinRows[0].proof_sha256 === 'a'.repeat(64),
    checkinRows[0],
  );

  const repeat = await postCheckin(may20TaId, { proof_id: proofReady2, note: '换成更好的照片' });
  const repeatCheckin = data(repeat).checkin as Data;
  check('重复打卡 → 200 + already_done 提示', repeat.status === 200 && data(repeat).already_done === true && String(data(repeat).notice).includes('覆盖'), repeat.envelope);
  check('重复打卡原地覆盖证明与备注', repeatCheckin.id === doneCheckin.id && repeatCheckin.proof_id === proofReady2 && repeatCheckin.note === '换成更好的照片', repeatCheckin);
  check('重复打卡不新增第二行', deps.db.rowsOf('checkins').filter((row) => row.task_id === may20TaId).length === 1, deps.db.rowsOf('checkins').length);

  const key = crypto.randomUUID();
  const once = await postCheckin(may20TaId, { proof_id: proofReady, note: '幂等' }, authorToken, { 'idempotency-key': key });
  const twice = await postCheckin(may20TaId, { proof_id: proofReady, note: '幂等' }, authorToken, { 'idempotency-key': key });
  check('打卡同键重放 → 字节级一致', once.status === 200 && twice.raw === once.raw, { once: once.status, twice: twice.status });
  const reuse = await postCheckin(may20TaId, { proof_id: proofReady, note: '换个' }, authorToken, { 'idempotency-key': key });
  check('打卡同键不同内容 → 409 idempotency_key_reuse', reuse.status === 409 && reuse.envelope.errorCode === 'idempotency_key_reuse', reuse.envelope);
}

// 11c 跨过 04:00：pending → missed；打卡只能补卡
{
  deps.clock.advance(86_400_000); // 2026-05-21 06:00Z
  const today = await getToday();
  may21Tasks = (data(today).tasks as Data[]) ?? [];
  check(
    '次日今日任务 → 2 条 pending',
    today.status === 200 && data(today).date === '2026-05-21' && may21Tasks.length === 2
      && may21Tasks.every((task) => task.status === 'pending'),
    today.envelope,
  );
  check('今日页不混入昨天及以前的任务', may21Tasks.every((task) => task.task_date === '2026-05-21'), may21Tasks.map((task) => task.task_date));

  const doneRow = deps.db.rowsOf('tasks').find((row) => row.id === may20TaId);
  const missedRow = deps.db.rowsOf('tasks').find((row) => row.id === may20SelfId);
  check('昨天已打卡的任务保持 done', doneRow?.status === 'done' && typeof doneRow?.done_at === 'string', doneRow?.status);
  check('昨天未完成的 pending 被惰性标成 missed', missedRow?.status === 'missed' && typeof missedRow?.missed_at === 'string', missedRow?.status);

  const late = await postCheckin(may20SelfId, { proof_id: proofReady });
  check('给昨天的任务打卡 → 400 task_not_today', late.status === 400 && late.envelope.errorCode === 'task_not_today', late.envelope);

  const noProof = await postMakeup(may20SelfId, {});
  check('补卡缺 proof_id → 400', noProof.status === 400 && noProof.envelope.errorCode === 'invalid_parameter', noProof.envelope);
  const onDone = await postMakeup(may20TaId, { proof_id: proofReady });
  check('给 done 任务补卡 → 400 task_not_missed', onDone.status === 400 && onDone.envelope.errorCode === 'task_not_missed', onDone.envelope);
  const onToday = await postMakeup(String(may21Tasks[0].id), { proof_id: proofReady });
  check('给今天的 pending 任务补卡 → 400 task_not_missed', onToday.status === 400 && onToday.envelope.errorCode === 'task_not_missed', onToday.envelope);
  const pendingProof = await postMakeup(may20SelfId, { proof_id: proofPending });
  check('补卡图片未 ready → 400 proof_not_ready', pendingProof.status === 400 && pendingProof.envelope.errorCode === 'proof_not_ready', pendingProof.envelope);
  const foreign = await postMakeup(may20SelfId, { proof_id: proofReady }, strangerToken);
  check('非作者补卡 → 403 wish_forbidden', foreign.status === 403 && foreign.envelope.errorCode === 'wish_forbidden', foreign.envelope);
  const missing = await postMakeup(crypto.randomUUID(), { proof_id: proofReady });
  check('补卡任务不存在 → 404 task_not_found', missing.status === 404 && missing.envelope.errorCode === 'task_not_found', missing.envelope);

  const makeupKey = crypto.randomUUID();
  const madeUp = await postMakeup(may20SelfId, { proof_id: proofReady, note: '昨天补上' }, authorToken, { 'idempotency-key': makeupKey });
  const madeUpTask = data(madeUp).task as Data;
  const madeUpCheckin = data(madeUp).checkin as Data;
  const ticket = data(madeUp).ticket as Data;
  check('补卡成功 → task made_up + no_penalty', madeUp.status === 200 && madeUpTask.status === 'made_up' && data(madeUp).no_penalty === true, madeUp.envelope);
  check(
    '补卡写 is_makeup=true 的打卡',
    madeUpCheckin.is_makeup === true && madeUpCheckin.checkin_date === '2026-05-21' && madeUpCheckin.proof_id === proofReady,
    madeUpCheckin,
  );
  check('补卡券被消费且指向该任务', ticket.status === 'used' && ticket.week_start === '2026-05-18' && ticket.task_id === may20SelfId, ticket);
  const replay = await postMakeup(may20SelfId, { proof_id: proofReady, note: '昨天补上' }, authorToken, { 'idempotency-key': makeupKey });
  check('补卡同键重放 → 字节级一致', replay.status === 200 && replay.raw === madeUp.raw, { once: madeUp.status, twice: replay.status });
  const again = await postMakeup(may20SelfId, { proof_id: proofReady });
  check('同一任务再补卡 → 400 already_made_up', again.status === 400 && again.envelope.errorCode === 'already_made_up', again.envelope);
}

// 11d 同一自然周只有一张券
{
  deps.clock.advance(86_400_000); // 2026-05-22 06:00Z，仍是 05-18 那一周
  const today = await getToday();
  const may21Rows = deps.db.rowsOf('tasks').filter((row) => row.wish_id === wishId && row.task_date === '2026-05-21');
  check('5/21 未完成任务次日变 missed', may21Rows.length === 2 && may21Rows.every((row) => row.status === 'missed'), may21Rows.map((row) => row.status));
  const exhausted = await postMakeup(String(may21Rows[0]?.id), { proof_id: proofReady });
  check('本周券已用 → 400 makeup_ticket_unavailable', exhausted.status === 400 && exhausted.envelope.errorCode === 'makeup_ticket_unavailable', exhausted.envelope);
  check('券用完后今日页显示 used', (data(today).makeup_ticket as Data)?.status === 'used', data(today).makeup_ticket);
}

// 11e 自然周滚动：新周自动发券，旧周漏卡不再可补
{
  deps.clock.advance(3 * 86_400_000); // 2026-05-25 06:00Z（周一）
  const today = await getToday();
  const ticket = data(today).makeup_ticket as Data;
  check('新的一周自动发新券', ticket?.week_start === '2026-05-25' && ticket?.week_index === 2 && ticket?.status === 'available', ticket);
  const may21Row = deps.db.rowsOf('tasks').find((row) => row.wish_id === wishId && row.task_date === '2026-05-21');
  const closed = await postMakeup(String(may21Row?.id), { proof_id: proofReady });
  check('补上周的漏卡 → 400 makeup_window_closed', closed.status === 400 && closed.envelope.errorCode === 'makeup_window_closed', closed.envelope);
  check(
    '旧周券保持已用，不被新周覆盖',
    deps.db.rowsOf('makeup_tickets').find((row) => row.wish_id === wishId && row.week_start === '2026-05-18')?.status === 'used',
    deps.db.rowsOf('makeup_tickets').map((row) => [row.wish_id === wishId ? 'self' : 'other', row.week_start, row.status]),
  );
  check('5/25 今日任务 2 条', ((data(today).tasks as Data[]) ?? []).length === 2, data(today).tasks);
}

// 11f 补卡券过期（惰性判定）
{
  deps.clock.advance(86_400_000); // 2026-05-26 06:00Z（周二）
  await getToday(); // 触发日界：5/25 的两条任务变 missed
  const may25Rows = deps.db.rowsOf('tasks').filter((row) => row.wish_id === wishId && row.task_date === '2026-05-25');
  check('5/25 未完成任务变 missed', may25Rows.length === 2 && may25Rows.every((row) => row.status === 'missed'), may25Rows.map((row) => row.status));
  const weekTicket = deps.db.rowsOf('makeup_tickets').find((row) => row.wish_id === wishId && row.week_start === '2026-05-25');
  await deps.db.from('makeup_tickets').update({ expires_at: '2026-05-24T20:00:00.000Z' }).eq('id', String(weekTicket?.id));
  const expired = await postMakeup(String(may25Rows[0]?.id), { proof_id: proofReady });
  check('券过期 → 400 makeup_ticket_expired', expired.status === 400 && expired.envelope.errorCode === 'makeup_ticket_expired', expired.envelope);
  check(
    '过期券被惰性标成 expired',
    deps.db.rowsOf('makeup_tickets').find((row) => row.id === weekTicket?.id)?.status === 'expired',
    deps.db.rowsOf('makeup_tickets').map((row) => [row.week_start, row.status]),
  );
}

// 11g 打卡限频来自配置（CHECKIN_PER_MINUTE），不是硬编码
// 注意：同一任务重复提交只覆盖同一行 checkins，不会把窗口计数顶上去；
// 计数口径是「窗口内落库的打卡行数」，这里用两张不同任务把阈值 1 顶满。
{
  const strictDeps = createLocalDeps('2026-05-20T06:00:00.000Z', { checkinPerMinute: 1 });
  const strictApp = createApp(strictDeps);
  const guest = await invoke(strictApp, { path: '/api/auth/guest', body: {}, ip: '203.0.113.40' });
  const token = String((data(guest).session as Data).access_token);
  const strictUserId = String((data(guest).user as Data).id);
  const created = await invoke(strictApp, { path: '/api/wishes', token, body: newWish(), headers: { 'idempotency-key': crypto.randomUUID() } });
  const strictWishId = String((data(created).wish as Data).id);
  await invoke(strictApp, { method: 'PUT', path: `/api/wishes/${strictWishId}/answers`, token, body: { q1: 'a', q2: 'b', q3: 'c', q4: 'd', q5: 'e' } });
  await invoke(strictApp, { path: `/api/wishes/${strictWishId}/contract`, token, body: {} });
  const strictToday = await invoke(strictApp, { path: `/api/wishes/${strictWishId}/tasks/today`, token });
  const strictTasks = (data(strictToday).tasks as Data[]) ?? [];
  const strictProof = crypto.randomUUID();
  strictDeps.db.seed('files', [
    makeProofRow(strictProof, strictUserId, strictWishId, strictDeps.clock.now.toISOString()),
  ]);
  check('阈值=1 的今日页仍有两条可打卡任务', strictTasks.length === 2, strictTasks.length);
  const firstCheckin = await invoke(strictApp, { path: `/api/tasks/${strictTasks[0].id}/checkin`, token, body: { proof_id: strictProof } });
  const secondCheckin = await invoke(strictApp, { path: `/api/tasks/${strictTasks[1].id}/checkin`, token, body: { proof_id: strictProof } });
  check('第一次打卡成功', firstCheckin.status === 200, firstCheckin.envelope);
  check('窗口内第二次 → 429 checkin_rate_limited', secondCheckin.status === 429 && secondCheckin.envelope.errorCode === 'checkin_rate_limited', secondCheckin.envelope);
  check('429 带 retryAfterSeconds', Number(secondCheckin.envelope.details?.retryAfterSeconds ?? 0) > 0, secondCheckin.envelope.details);
}

// ── 12. 账本：预算 / 流水 / 实时聚合 / 权限 / 幂等 ─────────────────────────
// 第 11 节已把主时钟推到 5/26；账本用独立 deps，才能断言首周、跨周与历史锁的边界。
{
  const ledgerDeps = createLocalDeps('2026-05-20T06:00:00.000Z');
  const ledgerApp = createApp(ledgerDeps);
  const ledgerCall = (options: CallOptions) => invoke(ledgerApp, options);
  const ledgerNewWish = (body: Data, token: string) =>
    ledgerCall({ path: '/api/wishes', token, body, headers: { 'idempotency-key': crypto.randomUUID() } });

  const lgAuthor = await ledgerCall({ path: '/api/auth/guest', body: { nickname: '账本作者' }, ip: '203.0.113.50' });
  const lgToken = String((data(lgAuthor).session as Data).access_token);
  const lgUserId = String((data(lgAuthor).user as Data).id);
  const lgStranger = await ledgerCall({ path: '/api/auth/guest', body: {}, ip: '203.0.113.51' });
  const lgStrangerToken = String((data(lgStranger).session as Data).access_token);

  const draft = await ledgerNewWish(newWish(), lgToken);
  const draftId = String((data(draft).wish as Data).id);
  const draftLedger = await ledgerCall({ path: `/api/wishes/${draftId}/ledger`, token: lgToken });
  check('草稿读账本 → 400 wish_not_active', draftLedger.status === 400 && draftLedger.envelope.errorCode === 'wish_not_active', draftLedger.envelope);

  const created = await ledgerNewWish(newWish(), lgToken);
  const wishId = String((data(created).wish as Data).id);
  await ledgerCall({
    method: 'PUT', path: `/api/wishes/${wishId}/answers`, token: lgToken,
    body: { q1: '腿疼', q2: '一个人', q3: '老房子', q4: '每个月能省下八百块', q5: '一双软底鞋' },
  });
  const signed = await ledgerCall({ path: `/api/wishes/${wishId}/contract`, token: lgToken, body: { days: 30 } });
  check('30 天账本愿签签署成功', signed.status === 200 && (data(signed).wish as Data).status === 'active', signed.envelope);

  const wishRow = ledgerDeps.db.rowsOf('wishes').find((row) => row.id === wishId);
  const answersRow = ledgerDeps.db.rowsOf('wish_answers').find((row) => row.wish_id === wishId);
  check('q4 落库为粗粒度档位', answersRow?.q4_disposable_band === '600_999', answersRow?.q4_disposable_band);
  check('签约写入默认周预算 0（不再按 q4 预填）', Number(wishRow?.weekly_budget_cents) === 0, wishRow?.weekly_budget_cents);
  const firstWeek = ledgerDeps.db.rowsOf('ledger_weeks').find((row) => row.wish_id === wishId && row.week_start === '2026-05-18');
  check('签约即建首周账本行（预算 0）', Number(firstWeek?.budget_cents) === 0 && Number(firstWeek?.week_index) === 1, firstWeek);

  // 第二份愿签：账本同样默认 0，并提供「别人的钱任务」用于越权校验
  const otherCreated = await ledgerNewWish(newWish({ nickname: '姥爷' }), lgToken);
  const otherWishId = String((data(otherCreated).wish as Data).id);
  await ledgerCall({
    method: 'PUT', path: `/api/wishes/${otherWishId}/answers`, token: lgToken,
    body: { q1: 'a', q2: 'b', q3: 'c', q4: '每月能攒三百块', q5: 'e' },
  });
  await ledgerCall({ path: `/api/wishes/${otherWishId}/contract`, token: lgToken, body: { days: 7 } });
  const otherLedger = await ledgerCall({ path: `/api/wishes/${otherWishId}/ledger`, token: lgToken });
  check(
    '另一档 q4（300_599）默认预算同样为 0',
    otherLedger.status === 200 && (data(otherLedger).week as Data).budget_cents === 0,
    (data(otherLedger).week as Data),
  );

  const nowStamp = ledgerDeps.clock.now.toISOString();
  const checkinProof = crypto.randomUUID();
  const ledgerProof = crypto.randomUUID();
  const ledgerProofPending = crypto.randomUUID();
  const ledgerProofForeign = crypto.randomUUID();
  const ledgerProofOtherWish = crypto.randomUUID();
  ledgerDeps.db.seed('files', [
    makeProofRow(checkinProof, lgUserId, wishId, nowStamp),
    makeProofRow(ledgerProof, lgUserId, wishId, nowStamp, { purpose: 'ledger_proof' }),
    makeProofRow(ledgerProofPending, lgUserId, wishId, nowStamp, { purpose: 'ledger_proof', status: 'pending', verified_at: null }),
    makeProofRow(ledgerProofForeign, String((data(lgStranger).user as Data).id), wishId, nowStamp, { purpose: 'ledger_proof' }),
    makeProofRow(ledgerProofOtherWish, lgUserId, otherWishId, nowStamp, { purpose: 'ledger_proof' }),
  ]);

  const ledgerPath = `/api/wishes/${wishId}/ledger`;
  const getLedger = (query = '', token = lgToken) => ledgerCall({ path: `${ledgerPath}${query}`, token });
  const setBudget = (week: string, body: Data, token = lgToken, headers: Record<string, string> = {}) =>
    ledgerCall({ method: 'PUT', path: `/api/ledger/weeks/${week}`, token, body, headers });
  const addEntry = (body: Data, token = lgToken, headers: Record<string, string> = {}) =>
    ledgerCall({ path: '/api/ledger/entries', token, body, headers });
  const getToday = (token = lgToken) => ledgerCall({ path: `/api/wishes/${wishId}/tasks/today`, token });

  // 12a 读取与权限
  {
    const anonymous = await ledgerCall({ path: ledgerPath });
    check('账本未登录 → 401', anonymous.status === 401, anonymous.envelope);
    const foreign = await getLedger('', lgStrangerToken);
    check('非作者读账本 → 403 wish_forbidden', foreign.status === 403 && foreign.envelope.errorCode === 'wish_forbidden', foreign.envelope);
    const missing = await ledgerCall({ path: `/api/wishes/${crypto.randomUUID()}/ledger`, token: lgToken });
    check('不存在的愿签 → 404 wish_not_found', missing.status === 404 && missing.envelope.errorCode === 'wish_not_found', missing.envelope);
    const notMonday = await getLedger('?week_start=2026-05-19');
    check('week_start 非周一 → 400 invalid_parameter', notMonday.status === 400 && notMonday.envelope.errorCode === 'invalid_parameter', notMonday.envelope);
    const outOfContract = await getLedger('?week_start=2026-06-22');
    check('week_start 超出契约 → 400 week_not_in_contract', outOfContract.status === 400 && outOfContract.envelope.errorCode === 'week_not_in_contract', outOfContract.envelope);

    const current = await getLedger();
    const week = data(current).week as Data;
    const totals = data(current).totals as Data;
    check(
      '默认返回当前周：预算 0 / 支出 0 / 结余 0',
      current.status === 200 && week.week_start === '2026-05-18' && week.budget_cents === 0
        && week.spent_cents === 0 && week.income_cents === 0 && week.balance_cents === 0
        && week.counted === false && week.is_current === true,
      week,
    );
    check(
      '账本总览含 5 个契约周与累计兑现 0',
      Array.isArray(data(current).weeks) && (data(current).weeks as Data[]).length === 5
        && totals.contract_weeks === 5 && totals.counted_weeks === 0 && totals.realized_cents === 0,
      totals,
    );
    check('结算前不返回礼物名称/价格/匹配结果', !/(gift|reward|price|match)/i.test(current.raw), current.raw);
    const futureRead = await getLedger('?week_start=2026-05-25');
    check('可查询契约内未来周', futureRead.status === 200 && (data(futureRead).week as Data).is_future === true, (data(futureRead).week as Data));
  }

  // 12b 预算：当前/未来可改、历史锁、CAS 幂等、参数边界
  {
    const budgetKey = crypto.randomUUID();
    const future = await setBudget('2026-05-25', { wish_id: wishId, budget_cents: 20_000 }, lgToken, { 'idempotency-key': budgetKey });
    check(
      '设置未来周预算 → 200 + 当周生效',
      future.status === 200 && (data(future).week as Data).week_start === '2026-05-25' && (data(future).week as Data).budget_cents === 20_000,
      future.envelope,
    );
    const replay = await setBudget('2026-05-25', { wish_id: wishId, budget_cents: 20_000 }, lgToken, { 'idempotency-key': budgetKey });
    check('预算同键重放 → 字节级一致', replay.status === 200 && replay.raw === future.raw, { once: future.status, twice: replay.status });
    const reuse = await setBudget('2026-05-25', { wish_id: wishId, budget_cents: 20_001 }, lgToken, { 'idempotency-key': budgetKey });
    check('预算同键不同内容 → 409 idempotency_key_reuse', reuse.status === 409 && reuse.envelope.errorCode === 'idempotency_key_reuse', reuse.envelope);

    const current = await setBudget('2026-05-18', { wish_id: wishId, budget_cents: 15_000 });
    check('修改当前周预算 → 15000', current.status === 200 && (data(current).week as Data).budget_cents === 15_000, (data(current).week as Data));
    const negative = await setBudget('2026-05-18', { wish_id: wishId, budget_cents: -1 });
    check('预算负数 → 400', negative.status === 400 && negative.envelope.errorCode === 'invalid_parameter', negative.envelope);
    const fraction = await setBudget('2026-05-18', { wish_id: wishId, budget_cents: 150.5 });
    check('预算非整数 → 400', fraction.status === 400, fraction.envelope);
    const tooLarge = await setBudget('2026-05-18', { wish_id: wishId, budget_cents: 200_001 });
    check('预算超上限 → 400', tooLarge.status === 400, tooLarge.envelope);
    const notMonday = await setBudget('2026-05-19', { wish_id: wishId, budget_cents: 1 });
    check('预算周起点非周一 → 400', notMonday.status === 400, notMonday.envelope);
    const outside = await setBudget('2026-06-22', { wish_id: wishId, budget_cents: 1 });
    check('预算周不在契约内 → 400 week_not_in_contract', outside.status === 400 && outside.envelope.errorCode === 'week_not_in_contract', outside.envelope);
    const foreign = await setBudget('2026-05-18', { wish_id: wishId, budget_cents: 1 }, lgStrangerToken);
    check('非作者改预算 → 403 wish_forbidden', foreign.status === 403 && foreign.envelope.errorCode === 'wish_forbidden', foreign.envelope);
    const noWish = await setBudget('2026-05-18', { budget_cents: 1 });
    check('预算缺 wish_id → 400', noWish.status === 400 && noWish.envelope.errorCode === 'invalid_parameter', noWish.envelope);
  }

  // 12c 支出：整数精度、超预算边界、不可改流水、幂等与越权
  {
    const expenseKey = crypto.randomUUID();
    const firstExpense = await addEntry({
      wish_id: wishId, week_start: '2026-05-18', type: 'expense', amount_cents: 1234, note: '给姥姥买护膝',
    }, lgToken, { 'idempotency-key': expenseKey });
    const entry = data(firstExpense).entry as Data;
    check(
      '支出登记 → 200 + 金额整数分',
      firstExpense.status === 200 && entry.type === 'expense' && entry.amount_cents === 1234
        && entry.amount_yuan === 12 && entry.proof_id === null && entry.task_id === null,
      entry,
    );
    const replay = await addEntry({
      wish_id: wishId, week_start: '2026-05-18', type: 'expense', amount_cents: 1234, note: '给姥姥买护膝',
    }, lgToken, { 'idempotency-key': expenseKey });
    check('支出同键重放 → 字节级一致', replay.status === 200 && replay.raw === firstExpense.raw, { once: firstExpense.status, twice: replay.status });
    const reuse = await addEntry({
      wish_id: wishId, week_start: '2026-05-18', type: 'expense', amount_cents: 1235, note: '给姥姥买护膝',
    }, lgToken, { 'idempotency-key': expenseKey });
    check('支出同键不同内容 → 409 idempotency_key_reuse', reuse.status === 409 && reuse.envelope.errorCode === 'idempotency_key_reuse', reuse.envelope);
    check('支出不读周汇总列，余额实时算', (data(firstExpense).week as Data).balance_cents === 13_766, data(firstExpense).week);

    await addEntry({ wish_id: wishId, week_start: '2026-05-18', type: 'expense', amount_cents: 1, note: '一分钱' });
    const exact = await addEntry({ wish_id: wishId, week_start: '2026-05-18', type: 'expense', amount_cents: 13_765, note: '正好花完' });
    const exactWeek = data(exact).week as Data;
    check(
      '支出正好等于预算 → 结余 0 但不算超预算',
      exactWeek.spent_cents === 15_000 && exactWeek.balance_cents === 0 && exactWeek.over_budget === false && exactWeek.progress_bps === 10_000,
      exactWeek,
    );
    const over = await addEntry({ wish_id: wishId, week_start: '2026-05-18', type: 'expense', amount_cents: 1, note: '超一分' });
    const overWeek = data(over).week as Data;
    check(
      '超预算 1 分 → 结余仍为 0 且给出提示',
      over.status === 200 && overWeek.spent_cents === 15_001 && overWeek.balance_cents === 0
        && overWeek.over_budget === true && String(overWeek.notice).includes('超预算'),
      overWeek,
    );
    check('超预算不拦截提交，流水已落库', ledgerDeps.db.rowsOf('ledger_entries').filter((row) => row.wish_id === wishId).length === 4,
      ledgerDeps.db.rowsOf('ledger_entries').length);
    const beforeCounted = await getLedger();
    check('未完成任务的周不计入累计兑现', (data(beforeCounted).totals as Data).saved_cents === 0 && (data(beforeCounted).totals as Data).realized_cents === 0, data(beforeCounted).totals);

    const negative = await addEntry({ wish_id: wishId, week_start: '2026-05-18', type: 'expense', amount_cents: -1 });
    check('支出负数 → 400', negative.status === 400 && negative.envelope.errorCode === 'invalid_parameter', negative.envelope);
    const fraction = await addEntry({ wish_id: wishId, week_start: '2026-05-18', type: 'expense', amount_cents: 1.5 });
    check('支出非整数 → 400', fraction.status === 400, fraction.envelope);
    const badType = await addEntry({ wish_id: wishId, week_start: '2026-05-18', type: 'deposit', amount_cents: 1 });
    check('非法类型 → 400', badType.status === 400 && badType.envelope.errorCode === 'invalid_parameter', badType.envelope);
    const notMonday = await addEntry({ wish_id: wishId, week_start: '2026-05-19', type: 'expense', amount_cents: 1 });
    check('记账周起点非周一 → 400', notMonday.status === 400, notMonday.envelope);
    const future = await addEntry({ wish_id: wishId, week_start: '2026-05-25', type: 'expense', amount_cents: 1 });
    check('未来周记账 → 400 week_not_started', future.status === 400 && future.envelope.errorCode === 'week_not_started', future.envelope);
    const wrongPurpose = await addEntry({ wish_id: wishId, week_start: '2026-05-18', type: 'expense', amount_cents: 1, proof_id: checkinProof });
    check('支出用打卡证明 → 400 proof_purpose_mismatch', wrongPurpose.status === 400 && wrongPurpose.envelope.errorCode === 'proof_purpose_mismatch', wrongPurpose.envelope);
    const withTask = await addEntry({ wish_id: wishId, week_start: '2026-05-18', type: 'expense', amount_cents: 1, task_id: crypto.randomUUID() });
    check('支出关联任务 → 400', withTask.status === 400 && withTask.envelope.errorCode === 'invalid_parameter', withTask.envelope);
    const foreign = await addEntry({ wish_id: wishId, week_start: '2026-05-18', type: 'expense', amount_cents: 1 }, lgStrangerToken);
    check('非作者记账 → 403 wish_forbidden', foreign.status === 403 && foreign.envelope.errorCode === 'wish_forbidden', foreign.envelope);
    const otherWish = await addEntry({ wish_id: otherWishId, week_start: '2026-05-18', type: 'expense', amount_cents: 1 }, lgStrangerToken);
    check('拿别人的 wish_id 记账 → 403', otherWish.status === 403, otherWish.envelope);
  }

  // 12d 完成任务后该周才计入；兼职收入必须关联已完成的钱任务
  let may20TaId = '';
  let may23MoneyId = '';
  let may24MoneyId = '';
  let otherMoneyId = '';
  {
    const today = await getToday();
    const tasks = (data(today).tasks as Data[]) ?? [];
    may20TaId = String(tasks.find((task) => task.type === 'ta')?.id ?? '');
    const done = await ledgerCall({ path: `/api/tasks/${may20TaId}/checkin`, token: lgToken, body: { proof_id: checkinProof } });
    check('首周完成任务 → done', done.status === 200 && (data(done).task as Data).status === 'done', done.envelope);
    const counted = await getLedger();
    check('完成任务后该周计入累计（本周超预算故结余 0）', (data(counted).week as Data).counted === true && (data(counted).totals as Data).counted_weeks === 1
      && (data(counted).totals as Data).saved_cents === 0, data(counted).totals);

    ledgerDeps.clock.advance(3 * 86_400_000); // 2026-05-23 06:00Z（周六）
    const weekend = await getToday();
    const weekendTasks = (data(weekend).tasks as Data[]) ?? [];
    may23MoneyId = String(weekendTasks.find((task) => task.type === 'money')?.id ?? '');
    const moneyDone = await ledgerCall({ path: `/api/tasks/${may23MoneyId}/checkin`, token: lgToken, body: { proof_id: checkinProof, note: '接了个小活', amount_cents: 6_000 } });
    check('周六钱任务打卡 → done', moneyDone.status === 200 && (data(moneyDone).task as Data).status === 'done', moneyDone.envelope);
    const may24Row = ledgerDeps.db.rowsOf('tasks').find((row) => row.wish_id === wishId && row.side === 'money' && row.task_date === '2026-05-24');
    may24MoneyId = String(may24Row?.id ?? '');
    const otherMoneyRow = ledgerDeps.db.rowsOf('tasks').find((row) => row.wish_id === otherWishId && row.side === 'money');
    otherMoneyId = String(otherMoneyRow?.id ?? '');

    const base = { wish_id: wishId, week_start: '2026-05-18', type: 'earning', amount_cents: 8_000, note: '周末兼职' };
    const noTask = await addEntry({ ...base, proof_id: ledgerProof });
    check('收入无关联任务 → 400 earning_task_required', noTask.status === 400 && noTask.envelope.errorCode === 'earning_task_required', noTask.envelope);
    const nonMoney = await addEntry({ ...base, proof_id: ledgerProof, task_id: may20TaId });
    check('收入关联非钱任务 → 400 earning_task_required', nonMoney.status === 400 && nonMoney.envelope.errorCode === 'earning_task_required', nonMoney.envelope);
    const notDone = await addEntry({ ...base, proof_id: ledgerProof, task_id: may24MoneyId });
    check('收入关联未完成任务 → 400 earning_task_not_done', notDone.status === 400 && notDone.envelope.errorCode === 'earning_task_not_done', notDone.envelope);
    const foreignTask = await addEntry({ ...base, proof_id: ledgerProof, task_id: otherMoneyId });
    check('收入关联别的愿签任务 → 403 task_forbidden', foreignTask.status === 403 && foreignTask.envelope.errorCode === 'task_forbidden', foreignTask.envelope);
    const pendingProof = await addEntry({ ...base, proof_id: ledgerProofPending, task_id: may23MoneyId });
    check('收入证明未 ready → 400 proof_not_ready', pendingProof.status === 400 && pendingProof.envelope.errorCode === 'proof_not_ready', pendingProof.envelope);
    const foreignProof = await addEntry({ ...base, proof_id: ledgerProofForeign, task_id: may23MoneyId });
    check('收入用别人的证明 → 403 proof_forbidden', foreignProof.status === 403 && foreignProof.envelope.errorCode === 'proof_forbidden', foreignProof.envelope);
    const otherProof = await addEntry({ ...base, proof_id: ledgerProofOtherWish, task_id: may23MoneyId });
    check('收入证明绑定别的愿签 → 400 proof_wish_mismatch', otherProof.status === 400 && otherProof.envelope.errorCode === 'proof_wish_mismatch', otherProof.envelope);
    const checkinAsProof = await addEntry({ ...base, proof_id: checkinProof, task_id: may23MoneyId });
    check('收入用打卡证明 → 400 proof_purpose_mismatch', checkinAsProof.status === 400 && checkinAsProof.envelope.errorCode === 'proof_purpose_mismatch', checkinAsProof.envelope);
    const zero = await addEntry({ ...base, amount_cents: 0, proof_id: ledgerProof, task_id: may23MoneyId });
    check('收入金额 0 → 400', zero.status === 400 && zero.envelope.errorCode === 'invalid_parameter', zero.envelope);

    const success = await addEntry({ ...base, task_id: may23MoneyId }, lgToken, { 'idempotency-key': crypto.randomUUID() });
    check(
      '收入登记成功且 proof_id 可选（未传时为 null）',
      success.status === 200 && (data(success).entry as Data).type === 'earning' && (data(success).entry as Data).amount_cents === 8_000
        && (data(success).entry as Data).task_id === may23MoneyId && (data(success).entry as Data).proof_id === null,
      data(success).entry,
    );
    const duplicate = await addEntry({ ...base, task_id: may23MoneyId });
    check('同一钱任务重复确认 → 400 duplicate_earning_link', duplicate.status === 400 && duplicate.envelope.errorCode === 'duplicate_earning_link', duplicate.envelope);

    ledgerDeps.clock.advance(86_400_000); // 2026-05-24 06:00Z（周日）
    const sunday = await getToday();
    const sundayMoney = (((data(sunday).tasks as Data[]) ?? []).find((task) => task.type === 'money')) as Data;
    check('周日钱任务可取到', String(sundayMoney.id) === may24MoneyId, { expected: may24MoneyId, got: sundayMoney.id });
    const sundayDone = await ledgerCall({ path: `/api/tasks/${may24MoneyId}/checkin`, token: lgToken, body: { proof_id: checkinProof, amount_cents: 1_500 } });
    check('周日钱任务打卡 → done', sundayDone.status === 200 && (data(sundayDone).task as Data).status === 'done', sundayDone.envelope);
    const withProof = await addEntry({ ...base, amount_cents: 1_000, proof_id: ledgerProof, task_id: may24MoneyId });
    check(
      '收入可附 ledger_proof 收款截图',
      withProof.status === 200 && (data(withProof).entry as Data).proof_id === ledgerProof
        && (data(withProof).week as Data).income_cents === 9_000,
      data(withProof).entry,
    );
  }

  // 12e 跨周：历史锁、周聚合、累计兑现 = 任务省下 + 兼职收入
  {
    ledgerDeps.clock.advance(2 * 86_400_000); // 2026-05-26 06:00Z（周二，周起点 05-25）
    const current = await getLedger();
    check('跨周后默认返回新一周', (data(current).week as Data).week_start === '2026-05-25' && (data(current).week as Data).is_current === true, data(current).week);
    const locked = await setBudget('2026-05-18', { wish_id: wishId, budget_cents: 9_000 });
    check('历史周预算锁定 → 400 week_not_editable', locked.status === 400 && locked.envelope.errorCode === 'week_not_editable', locked.envelope);

    const budget = await setBudget('2026-05-25', { wish_id: wishId, budget_cents: 10_000 });
    check('修改新周预算 → 10000', budget.status === 200 && (data(budget).week as Data).budget_cents === 10_000, budget.envelope);
    await addEntry({ wish_id: wishId, week_start: '2026-05-25', type: 'expense', amount_cents: 2_500, note: '打车' });

    const today = await getToday();
    const task = ((data(today).tasks as Data[]) ?? [])[0];
    const checkin = await ledgerCall({ path: `/api/tasks/${task.id}/checkin`, token: lgToken, body: { proof_id: checkinProof } });
    check('第二周完成任务 → done', checkin.status === 200, checkin.envelope);

    const first = await getLedger('?week_start=2026-05-18');
    const firstWeekData = data(first).week as Data;
    check(
      '历史周：支出 15001 / 预算 15000 / 结余 0 / 收入 9000 / 已计入',
      firstWeekData.week_start === '2026-05-18' && firstWeekData.budget_cents === 15_000 && firstWeekData.spent_cents === 15_001
        && firstWeekData.balance_cents === 0 && firstWeekData.income_cents === 9_000 && firstWeekData.counted === true,
      firstWeekData,
    );
    const second = await getLedger('?week_start=2026-05-25');
    const secondWeekData = data(second).week as Data;
    check(
      '当前周：预算 10000 / 支出 2500 / 结余 7500 / 已计入',
      secondWeekData.week_start === '2026-05-25' && secondWeekData.budget_cents === 10_000 && secondWeekData.spent_cents === 2_500
        && secondWeekData.balance_cents === 7_500 && secondWeekData.balance_yuan === 75 && secondWeekData.counted === true,
      secondWeekData,
    );

    const totals = data(second).totals as Data;
    check(
      '累计兑现 = 任务省下 7500 + 兼职收入 9000 = 16500',
      totals.saved_cents === 7_500 && totals.income_cents === 9_000 && totals.realized_cents === 16_500
        && totals.spent_cents === 17_501 && totals.counted_weeks === 2,
      totals,
    );
    check(
      '未计入周只显示预算，不虚增累计兑现',
      ((data(second).weeks as Data[]).find((row) => row.week_start === '2026-06-01') as Data)?.counted === false,
      (data(second).weeks as Data[]).map((row) => [row.week_start, row.counted, row.balance_cents]),
    );

    const weekMismatch = await addEntry({
      wish_id: wishId, week_start: '2026-05-25', type: 'earning', amount_cents: 1,
      proof_id: ledgerProof, task_id: may23MoneyId,
    });
    check('收入记到别的周 → 400 earning_week_mismatch', weekMismatch.status === 400 && weekMismatch.envelope.errorCode === 'earning_week_mismatch', weekMismatch.envelope);
    const futureEntry = await addEntry({ wish_id: wishId, week_start: '2026-06-01', type: 'expense', amount_cents: 1 });
    check('未来周记账 → 400 week_not_started', futureEntry.status === 400 && futureEntry.envelope.errorCode === 'week_not_started', futureEntry.envelope);

    const ledgerRows = ledgerDeps.db.rowsOf('ledger_entries').filter((row) => row.wish_id === wishId);
    const manualRows = ledgerRows.filter((row) => row.source === 'manual');
    check(
      '流水只追加且用户/愿签一致',
      manualRows.length === 7 && ledgerRows.length === 9
        && ledgerRows.every((row) => row.user_id === lgUserId && row.revoked_at === null)
        && manualRows.every((row) => row.source === 'manual'),
      ledgerRows.map((row) => [row.entry_kind, row.amount_cents, row.source]),
    );
    const weekRows = ledgerDeps.db.rowsOf('ledger_weeks').filter((row) => row.wish_id === wishId);
    check(
      'ledger_weeks 只维护预算，不依赖历史派生列',
      weekRows.length >= 2 && weekRows.every((row) => row.spent_cents === 0 && row.saved_cents === 0 && row.earned_cents === 0 && row.counted === false),
      weekRows.map((row) => [row.week_start, row.budget_cents, row.spent_cents, row.counted]),
    );
    const refreshedWish = ledgerDeps.db.rowsOf('wishes').find((row) => row.id === wishId);
    check('账本写操作推进 wishes.version', Number(refreshedWish?.version ?? 0) > Number(wishRow?.version ?? 0), [wishRow?.version, refreshedWish?.version]);
  }
}

// ── 13. 第 6 轮：结算 / 彩蛋 / 续期 ──────────────────────────────────────
// 统一从周三 2026-05-20 签约 7 天（截止 05-26），结算开放时刻是 05-26T20:00:00Z（上海 05-27 04:00）。
{
  const SETTLE_START_ISO = '2026-05-20T06:00:00.000Z';
  const SETTLE_OPEN_ISO = '2026-05-26T20:00:00.000Z';
  const START_MS = Date.parse(SETTLE_START_ISO);
  const OPEN_MS = Date.parse(SETTLE_OPEN_ISO);
  const toOpen = OPEN_MS - START_MS;

  const boot = async (nickname: string) => {
    const deps = createLocalDeps(SETTLE_START_ISO);
    const timeApp = createApp(deps);
    const timeCall = (options: CallOptions) => invoke(timeApp, options);
    const ownerRes = await timeCall({ path: '/api/auth/guest', body: { nickname }, ip: '203.0.113.70' });
    const ownerToken = String((data(ownerRes).session as Data).access_token);
    const strangerRes = await timeCall({ path: '/api/auth/guest', body: {}, ip: '203.0.113.71' });
    const strangerToken = String((data(strangerRes).session as Data).access_token);
    return { deps, call: timeCall, token: ownerToken, strangerToken };
  };

  type Court = Awaited<ReturnType<typeof boot>>;

  const createSignedWish = async (
    court: Court,
    options: { wish?: Data; q5: string; q4?: string; budgets?: Array<[string, number]> },
  ): Promise<string> => {
    const created = await court.call({
      path: '/api/wishes',
      token: court.token,
      body: newWish(options.wish ?? {}),
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    if (created.status !== 201) throw new Error(`[case] create wish failed: ${created.raw}`);
    const id = String((data(created).wish as Data).id);
    const answered = await court.call({
      method: 'PUT',
      path: `/api/wishes/${id}/answers`,
      token: court.token,
      body: { q1: '腿疼', q2: '一个人', q3: '老房子', q4: options.q4 ?? '每个月能省下八百块', q5: options.q5 },
    });
    if (answered.status !== 200) throw new Error(`[case] answers failed: ${answered.raw}`);
    const signed = await court.call({ path: `/api/wishes/${id}/contract`, token: court.token, body: { days: 7 } });
    if (signed.status !== 200) throw new Error(`[case] contract failed: ${signed.raw}`);
    for (const [week, cents] of options.budgets ?? []) {
      const budget = await court.call({
        method: 'PUT',
        path: `/api/ledger/weeks/${week}`,
        token: court.token,
        body: { wish_id: id, budget_cents: cents },
      });
      if (budget.status !== 200) throw new Error(`[case] budget ${week} failed: ${budget.raw}`);
    }
    return id;
  };

  const tasksOf = (court: Court, id: string): Data[] =>
    court.deps.db.rowsOf('tasks')
      .filter((row) => row.wish_id === id)
      .sort((a, b) => String(a.task_date).localeCompare(String(b.task_date))
        || Number(a.day_index ?? 0) - Number(b.day_index ?? 0));

  const setTaskStatus = async (court: Court, rows: Data[], status: string): Promise<number> => {
    for (const row of rows) {
      await court.deps.db.from('tasks').update({ status }).eq('id', row.id).select('id');
    }
    return rows.length;
  };

  const settle = (court: Court, id: string, key?: string) =>
    court.call({
      path: `/api/wishes/${id}/settle`,
      token: court.token,
      body: {},
      headers: key ? { 'idempotency-key': key } : {},
    });
  const readSettlementResult = (court: Court, id: string, token = court.token) =>
    court.call({ path: `/api/wishes/${id}/settlement`, token });
  const extendWishCall = (court: Court, id: string, token = court.token) =>
    court.call({ path: `/api/wishes/${id}/extend`, token, body: { days: 5 } });
  /** 新的账本口径：只有用户确认的省下/收入才计入兑现，测试里显式补记任务省下 */
  const addSaved = (court: Court, wishId: string, cents: number, week = '2026-05-18') =>
    court.call({
      path: '/api/ledger/entries',
      token: court.token,
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: { wish_id: wishId, week_start: week, type: 'saved', amount_cents: cents, note: '本周任务省下' },
    });

  // 13a 时间闸门 / 双重兑现 / 168 元护膝仪 / 重复结算 / 权限
  {
    const court = await boot('结算作者');
    const draft = await court.call({
      path: '/api/wishes', token: court.token, body: newWish(), headers: { 'idempotency-key': crypto.randomUUID() },
    });
    const draftId = String((data(draft).wish as Data).id);
    const draftSettle = await settle(court, draftId);
    check('草稿结算 → 400 wish_not_active', draftSettle.status === 400 && draftSettle.envelope.errorCode === 'wish_not_active', draftSettle.envelope);

    const wishId = await createSignedWish(court, {
      q5: '想要一副护膝',
      budgets: [['2026-05-18', 10_000], ['2026-05-25', 6_800]],
    });
    const allTasks = tasksOf(court, wishId);
    check('7 天契约生成 14 条必做 + 2 条钱任务', allTasks.length === 16 && allTasks.filter((row) => row.side === 'money').length === 2, allTasks.length);

    const beforeRead = await readSettlementResult(court, wishId);
    check(
      '未结算读结算 → 400 wish_not_settled 且零礼物泄露',
      beforeRead.status === 400 && beforeRead.envelope.errorCode === 'wish_not_settled'
        && !/护膝|gift|reward|gap_cents|price_median/i.test(beforeRead.raw),
      beforeRead.raw,
    );
    const strangerExtra = await court.call({ method: 'GET', path: `/api/wishes/${wishId}/settlement`, token: court.strangerToken });
    check('非作者读结算 → 403 wish_forbidden', strangerExtra.status === 403 && strangerExtra.envelope.errorCode === 'wish_forbidden', strangerExtra.envelope);
    const foreignSettle = await court.call({
      path: `/api/wishes/${wishId}/settle`, token: court.strangerToken, body: {},
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    check('非作者触发结算 → 403 wish_forbidden', foreignSettle.status === 403 && foreignSettle.envelope.errorCode === 'wish_forbidden', foreignSettle.envelope);
    const anonymous = await court.call({ path: `/api/wishes/${wishId}/settle`, body: {} });
    check('未登录触发结算 → 401', anonymous.status === 401, anonymous.envelope);

    await setTaskStatus(court, allTasks, 'done');
    const madeUpRow = allTasks.find((row) => row.side !== 'money' && row.is_must === true) as Data;
    await setTaskStatus(court, [madeUpRow], 'made_up');
    const seededSaved = await addSaved(court, wishId, 16_800);
    check('补记本周任务省下 168 元 → 200', seededSaved.status === 200, seededSaved.envelope);

    court.deps.clock.advance(toOpen - 1);
    const tooEarly = await settle(court, wishId);
    const earlyDetails = tooEarly.envelope.details as Data;
    check(
      '截止日次日 04:00 前 1ms → 400 settle_too_early + 剩余秒数',
      tooEarly.status === 400 && tooEarly.envelope.errorCode === 'settle_too_early'
        && earlyDetails.settle_open_at === SETTLE_OPEN_ISO && earlyDetails.seconds_remaining === 1,
      tooEarly.envelope,
    );
    check('未到期响应不泄露礼物', !/护膝|gift|reward|gap_cents/i.test(tooEarly.raw), tooEarly.raw);

    court.deps.clock.advance(1);
    const firstKey = crypto.randomUUID();
    const first = await settle(court, wishId, firstKey);
    const view = data(first).settlement as Data;
    const firstAct = (view.first_act ?? {}) as Data;
    const secondAct = (view.second_act ?? {}) as Data;
    const stats = (firstAct.tasks ?? {}) as Data;
    const gift = (secondAct.gift ?? {}) as Data;
    check('刚好到点结算 → 200 且非重放', first.status === 200 && data(first).already_settled === false && view.settlement_version === 1, first.envelope);
    check(
      '双重兑现 → 盖章 + 结局文案',
      firstAct.outcome === 'double_realized' && firstAct.outcome_label === '双重兑现' && firstAct.stamped === true,
      firstAct,
    );
    check(
      '经典用例：累计 168 元 → 护膝热敷仪 / 差额 0 / 刚好够',
      secondAct.realized_cents === 16_800 && secondAct.realized_yuan === 168
        && gift.title === '护膝热敷仪' && secondAct.gap_cents === 0
        && secondAct.gap_band === 'exact' && secondAct.gap_band_label === '刚好够',
      secondAct,
    );
    check(
      '金额拆分：累计节省 16800 + 兼职收入 0',
      secondAct.saved_cents === 16_800 && secondAct.earned_cents === 0,
      secondAct,
    );
    check(
      '任务统计：必做 14/14、钱任务 2/2、打卡 15 + 补卡 1',
      stats.must_total === 14 && stats.must_done === 14 && stats.money_total === 2 && stats.money_done === 2
        && stats.checkin_count === 15 && stats.makeup_count === 1 && stats.must_bps === 10_000 && stats.money_bps === 10_000,
      stats,
    );
    check(
      '任务明细逐条返回且类型可读',
      Array.isArray(firstAct.task_details) && (firstAct.task_details as Data[]).length === 16
        && (firstAct.task_details as Data[]).some((row) => row.type === 'money')
        && (firstAct.task_details as Data[]).some((row) => row.type === 'self'),
      (firstAct.task_details as Data[]).slice(0, 2),
    );
    check('信件模板落库并返回', typeof secondAct.letter_text === 'string' && (secondAct.letter_text as string).includes('姥姥'), secondAct.letter_text);

    const settledRows = court.deps.db.rowsOf('settlements').filter((row) => row.wish_id === wishId);
    check(
      '结算快照唯一且字段完整',
      settledRows.length === 1 && Number(settledRows[0].version) === 1 && settledRows[0].outcome === 'double_realized'
        && Number(settledRows[0].total_cents) === 16_800 && settledRows[0].sealed === false,
      settledRows,
    );
    const wishAfterFirst = court.deps.db.rowsOf('wishes').find((row) => row.id === wishId);
    check('愿签收口为 settled 并记录结局', wishAfterFirst?.status === 'settled' && wishAfterFirst?.outcome === 'double_realized', wishAfterFirst);

    const replay = await settle(court, wishId, firstKey);
    check('同 Idempotency-Key 重放 → 字节级一致', replay.status === 200 && replay.raw === first.raw, { once: first.status, twice: replay.status });
    const repeat = await settle(court, wishId);
    check(
      '换键重复结算 → 200 already_settled，不新增快照',
      repeat.status === 200 && data(repeat).already_settled === true
        && (data(repeat).settlement as Data).settlement_version === 1,
      repeat.envelope,
    );
    check('重复结算不重复计算（仍只有一条快照）', court.deps.db.rowsOf('settlements').filter((row) => row.wish_id === wishId).length === 1);
    const versionAfter = Number(court.deps.db.rowsOf('wishes').find((row) => row.id === wishId)?.version);
    check('重复结算不推进愿望版本', versionAfter === Number(wishAfterFirst?.version), [wishAfterFirst?.version, versionAfter]);

    const ownRead = await readSettlementResult(court, wishId);
    const ownView = data(ownRead);
    check(
      'GET 结算结果 → 两幕齐全',
      ownRead.status === 200 && ownView.settlement_version === 1
        && ((ownView.first_act as Data)?.stamped === true)
        && (((ownView.second_act as Data)?.gift as Data)?.title === '护膝热敷仪'),
      ownRead.envelope,
    );
    const doubleExtend = await extendWishCall(court, wishId);
    check('双重兑现续期 → 400 extend_not_allowed', doubleExtend.status === 400 && doubleExtend.envelope.errorCode === 'extend_not_allowed', doubleExtend.envelope);
    const foreignExtend = await extendWishCall(court, wishId, court.strangerToken);
    check('非作者续期 → 403 wish_forbidden', foreignExtend.status === 403 && foreignExtend.envelope.errorCode === 'wish_forbidden', foreignExtend.envelope);
    const anonExtend = await court.call({ path: `/api/wishes/${wishId}/extend`, body: {} });
    check('未登录续期 → 401', anonExtend.status === 401, anonExtend.envelope);
  }

  // 13b 赛博实现 → 续期 → 重新结算
  {
    const court = await boot('续期作者');
    const wishId = await createSignedWish(court, {
      q5: '希望TA好起来',
      budgets: [['2026-05-18', 10_000], ['2026-05-25', 6_800]],
    });
    const allTasks = tasksOf(court, wishId);
    const moneyRows = allTasks.filter((row) => row.side === 'money');
    await setTaskStatus(court, allTasks.filter((row) => row.side !== 'money'), 'done');
    await setTaskStatus(court, [moneyRows[0]], 'done');
    // 第二条钱任务保持 pending：结算时会被日界扫成 missed → 赛博实现
    await addSaved(court, wishId, 16_800);

    court.deps.clock.advance(toOpen);
    const settled = await settle(court, wishId);
    const view = data(settled).settlement as Data;
    const firstAct = (view.first_act ?? {}) as Data;
    const stats = (firstAct.tasks ?? {}) as Data;
    const extension = (view.extension ?? {}) as Data;
    check(
      '必做全完成、有钱任务未完成 → cyber_only + 盖章',
      settled.status === 200 && firstAct.outcome === 'cyber_only' && firstAct.outcome_label === '赛博实现' && firstAct.stamped === true,
      firstAct,
    );
    check(
      '赛博实现：钱任务 1/2、差额档位「差一点」',
      stats.money_total === 2 && stats.money_done === 1
        && ((view.second_act as Data)?.gap_band === 'near')
        && ((view.second_act as Data)?.gap_band_label === '差一点'),
      { stats, second: view.second_act },
    );
    check('赛博实现可续期', extension.can_extend === true && extension.renew_count === 0 && extension.reason === '', extension);

    const extended = await extendWishCall(court, wishId);
    const extendedWish = (data(extended).wish ?? {}) as Data;
    check(
      '续期成功 → active / 截止日 +5 天 / 补生成 12 条任务',
      extended.status === 200 && extendedWish.status === 'active'
        && data(extended).new_end_date === '2026-05-31' && data(extended).added_tasks === 12,
      extended.envelope,
    );
    check(
      '续期补发对应周补卡券（05-25）',
      data(extended).makeup_tickets === 1
        && court.deps.db.rowsOf('makeup_tickets').some((row) => row.wish_id === wishId && row.week_start === '2026-05-25' && row.status === 'available'),
      court.deps.db.rowsOf('makeup_tickets').filter((row) => row.wish_id === wishId).map((row) => [row.week_start, row.status]),
    );
    check('续期后的新结算开放时刻', data(extended).settle_open_at === '2026-05-31T20:00:00.000Z', data(extended).settle_open_at);

    const afterExtendRead = await readSettlementResult(court, wishId);
    check(
      '续期后旧结算不再可读 → 400 wish_not_settled 且不泄露礼物',
      afterExtendRead.status === 400 && afterExtendRead.envelope.errorCode === 'wish_not_settled'
        && !/按摩|gift|reward|gap_cents/i.test(afterExtendRead.raw),
      afterExtendRead.raw,
    );
    const secondExtend = await extendWishCall(court, wishId);
    check('第二次续期 → 400 extend_limit_reached', secondExtend.status === 400 && secondExtend.envelope.errorCode === 'extend_limit_reached', secondExtend.envelope);

    await setTaskStatus(court, tasksOf(court, wishId), 'done');
    court.deps.clock.advance(7 * 86_400_000);
    const resettled = await settle(court, wishId, crypto.randomUUID());
    const newView = data(resettled).settlement as Data;
    const newFirst = (newView.first_act ?? {}) as Data;
    check(
      '续期后重新结算 → 版本 2 且按最新任务重判为双重兑现',
      resettled.status === 200 && data(resettled).already_settled === false
        && newView.settlement_version === 2 && newFirst.outcome === 'double_realized' && newFirst.stamped === true,
      newView,
    );
    const versions = court.deps.db.rowsOf('settlements').filter((row) => row.wish_id === wishId).map((row) => Number(row.version)).sort();
    check('同一愿签保留两份结算快照（v1/v2）', versions.length === 2 && versions[0] === 1 && versions[1] === 2, versions);
    const finalRead = await readSettlementResult(court, wishId);
    check(
      '续期后结算结果以最新版本为准且不可再续期',
      finalRead.status === 200 && data(finalRead).settlement_version === 2
        && ((data(finalRead).extension as Data)?.can_extend === false),
      data(finalRead).extension,
    );
  }

  // 13c 未实现 + 并发结算 CAS + 续期
  {
    const court = await boot('未实现作者');
    const wishId = await createSignedWish(court, {
      q5: '希望TA好起来',
      budgets: [['2026-05-18', 10_000], ['2026-05-25', 6_800]],
    });
    const allTasks = tasksOf(court, wishId);
    const mustRows = allTasks.filter((row) => row.side !== 'money');
    await setTaskStatus(court, allTasks, 'done');
    await setTaskStatus(court, [mustRows[mustRows.length - 1]], 'pending');

    const preExtend = await extendWishCall(court, wishId);
    check('未结算续期 → 400 wish_not_settled', preExtend.status === 400 && preExtend.envelope.errorCode === 'wish_not_settled', preExtend.envelope);

    court.deps.clock.advance(toOpen);
    const [left, right] = await Promise.all([
      settle(court, wishId, crypto.randomUUID()),
      settle(court, wishId, crypto.randomUUID()),
    ]);
    check(
      '并发结算只有一次生效（200 + 409 / 双 200）',
      [left, right].some((response) => response.status === 200)
        && [left, right].every((response) => response.status === 200 || response.status === 409),
      [left.envelope, right.envelope],
    );
    const snapshotRows = court.deps.db.rowsOf('settlements').filter((row) => row.wish_id === wishId);
    const wishRow = court.deps.db.rowsOf('wishes').find((row) => row.id === wishId);
    check('并发后只有一条结算快照且状态收口', snapshotRows.length === 1 && wishRow?.status === 'settled', { rows: snapshotRows.length, status: wishRow?.status });

    const read = await readSettlementResult(court, wishId);
    const view = data(read);
    const firstAct = (view.first_act ?? {}) as Data;
    check(
      '必做任务有 missed → unrealized + 不盖章',
      read.status === 200 && firstAct.outcome === 'unrealized' && firstAct.outcome_label === '未实现' && firstAct.stamped === false,
      firstAct,
    );
    check('未实现可续期且有明确理由字段', ((view.extension as Data)?.can_extend === true), view.extension);

    const extended = await extendWishCall(court, wishId);
    const rowsAfterExtend = court.deps.db.rowsOf('settlements').filter((row) => row.wish_id === wishId);
    check(
      '未实现续期 → 回到 active 且保留历史快照',
      extended.status === 200 && (data(extended).wish as Data)?.status === 'active'
        && data(extended).new_end_date === '2026-05-31' && rowsAfterExtend.length === 1,
      extended.envelope,
    );
    const secondExtend = await extendWishCall(court, wishId);
    check('未实现续期后再次续期 → 400 extend_limit_reached', secondExtend.status === 400 && secondExtend.envelope.errorCode === 'extend_limit_reached', secondExtend.envelope);
  }

  // 13d 差额档位：差一点（20%）与未拆的信（>30% 回落最低价）
  {
    const nearCourt = await boot('差一点作者');
    const nearWish = await createSignedWish(nearCourt, {
      wish: { relation: '室友', nickname: '小周', wish_text: '希望TA这次考试顺顺利利。' },
      q5: '希望开心一点',
      budgets: [['2026-05-18', 6_000], ['2026-05-25', 6_000]],
    });
    await setTaskStatus(nearCourt, tasksOf(nearCourt, nearWish), 'done');
    await addSaved(nearCourt, nearWish, 12_000);
    nearCourt.deps.clock.advance(toOpen);
    const nearSettled = await settle(nearCourt, nearWish);
    const nearSecond = (((data(nearSettled).settlement as Data)?.second_act) ?? {}) as Data;
    const nearGift = (nearSecond.gift ?? {}) as Data;
    check(
      '差额 20% → 一顿火锅 / 差一点 / 文案含攒钱建议',
      nearSettled.status === 200 && nearSecond.realized_cents === 12_000
        && nearGift.title === '一顿火锅' && nearSecond.gap_cents === 3_000
        && nearSecond.gap_band === 'near' && nearSecond.gap_band_label === '差一点'
        && /再|攒|周/.test(String(nearSecond.copy_text)),
      nearSecond,
    );

    const farCourt = await boot('差很多作者');
    const farWish = await createSignedWish(farCourt, {
      wish: { relation: '室友', nickname: '小周', wish_text: '希望TA这次考试顺顺利利。' },
      q5: '希望开心一点',
      budgets: [['2026-05-18', 2_500], ['2026-05-25', 2_000]],
    });
    await setTaskStatus(farCourt, tasksOf(farCourt, farWish), 'done');
    await addSaved(farCourt, farWish, 4_500);
    farCourt.deps.clock.advance(toOpen);
    const farSettled = await settle(farCourt, farWish);
    const farSecond = (((data(farSettled).settlement as Data)?.second_act) ?? {}) as Data;
    const farGift = (farSecond.gift ?? {}) as Data;
    check(
      '差额 >30% → 未拆的信 + 回落类别最低价礼物',
      farSettled.status === 200 && farSecond.realized_cents === 4_500
        && farGift.title === '一张合影的放大打印'
        && farSecond.gap_band === 'far' && farSecond.gap_band_label === '未拆的信'
        && String(farSecond.copy_text).includes('未拆的信'),
      farSecond,
    );
  }
}

// ── 14. 第 7 轮：上传 / 分享 / 公开池 / 回信 ──────────────────────────────
{
  const SETTLE_START_ISO = '2026-05-20T06:00:00.000Z';
  const SETTLE_OPEN_ISO = '2026-05-26T20:00:00.000Z';
  const toOpen = Date.parse(SETTLE_OPEN_ISO) - Date.parse(SETTLE_START_ISO);

  const boot = async (nickname: string, overrides: Parameters<typeof createLocalDeps>[1] = {}) => {
    const deps = createLocalDeps(SETTLE_START_ISO, overrides);
    const timeApp = createApp(deps);
    const timeCall = (options: CallOptions) => invoke(timeApp, options);
    const guest = async (name: string, ip: string) => {
      const res = await timeCall({ path: '/api/auth/guest', body: name === '' ? {} : { nickname: name }, ip });
      return {
        token: String((data(res).session as Data).access_token),
        userId: String((data(res).user as Data).id),
      };
    };
    const owner = await guest(nickname, '203.0.113.80');
    const stranger = await guest('', '203.0.113.81');
    const third = await guest('', '203.0.113.82');
    return {
      deps,
      call: timeCall,
      token: owner.token,
      userId: owner.userId,
      strangerToken: stranger.token,
      thirdToken: third.token,
    };
  };

  type Court = Awaited<ReturnType<typeof boot>>;

  const createSignedWish = async (court: Court, q5: string): Promise<string> => {
    const created = await court.call({
      path: '/api/wishes', token: court.token, body: newWish(), headers: { 'idempotency-key': crypto.randomUUID() },
    });
    if (created.status !== 201) throw new Error(`[case] create wish failed: ${created.raw}`);
    const id = String((data(created).wish as Data).id);
    const answered = await court.call({
      method: 'PUT',
      path: `/api/wishes/${id}/answers`,
      token: court.token,
      body: { q1: '腿疼', q2: '一个人', q3: '老房子', q4: '每个月能省下八百块', q5 },
    });
    if (answered.status !== 200) throw new Error(`[case] answers failed: ${answered.raw}`);
    const signed = await court.call({ path: `/api/wishes/${id}/contract`, token: court.token, body: { days: 7 } });
    if (signed.status !== 200) throw new Error(`[case] contract failed: ${signed.raw}`);
    return id;
  };

  const completeAll = async (court: Court, id: string): Promise<number> => {
    const rows = court.deps.db.rowsOf('tasks').filter((row) => row.wish_id === id);
    for (const row of rows) {
      await court.deps.db.from('tasks').update({ status: 'done' }).eq('id', row.id).select('id');
    }
    return rows.length;
  };

  const settle = (court: Court, id: string) =>
    court.call({ path: `/api/wishes/${id}/settle`, token: court.token, body: {} });

  const presign = (court: Court, token: string, body: Data) =>
    court.call({ path: '/api/uploads/presign', token, body });
  const complete = (court: Court, token: string, fileId: string) =>
    court.call({ path: '/api/uploads/complete', token, body: { file_id: fileId } });
  const fileUrl = (court: Court, token: string, fileId: string) =>
    court.call({ path: `/api/uploads/${fileId}/url`, token, body: {} });
  const fileIdOf = (response: { envelope: Envelope<never> }) => String(data(response).file_id ?? '');
  const objectKeyOf = (uploadUrl: string) => decodeURIComponent(uploadUrl.split('/upload/')[1] ?? '');

  const shareWish = (court: Court, token: string, id: string) =>
    court.call({ path: `/api/wishes/${id}/share`, token, body: {} });
  const revokeShare = (court: Court, token: string, id: string) =>
    court.call({ method: 'DELETE', path: `/api/wishes/${id}/share`, token });
  const readShare = (court: Court, token: string) => court.call({ path: `/api/s/${token}` });

  const publish = (court: Court, token: string, body: Data) =>
    court.call({ path: '/api/pool/publish', token, body });
  const listPool = (court: Court, query = '') => court.call({ path: `/api/pool${query}` });
  const poolDetail = (court: Court, postId: string) => court.call({ path: `/api/pool/${postId}` });
  const reportPost = (court: Court, token: string, postId: string, reason = 'spam') =>
    court.call({ path: `/api/pool/${postId}/report`, token, body: { reason_code: reason } });
  const unpublishPost = (court: Court, token: string, postId: string) =>
    court.call({ path: `/api/pool/${postId}/unpublish`, token, body: {} });
  const createReply = (court: Court, token: string, postId: string, content: string, headers: Record<string, string> = {}) =>
    court.call({ path: `/api/pool/${postId}/replies`, token, body: { content }, headers });
  const listReplies = (court: Court, postId: string, query = '') =>
    court.call({ path: `/api/pool/${postId}/replies${query}` });
  const deleteReply = (court: Court, token: string, replyId: string) =>
    court.call({ method: 'DELETE', path: `/api/replies/${replyId}`, token });

  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
  const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const FORBIDDEN_PUBLIC = /q1_worry_enc|q5_gift_enc|ledger|proof|object_key|file_id|user_id|author_id|nickname|gift|reward|gap_cents|_cents|price/i;

  const court = await boot('上传作者');
  const draftRes = await court.call({
    path: '/api/wishes', token: court.token, body: newWish(), headers: { 'idempotency-key': crypto.randomUUID() },
  });
  const draftId = String((data(draftRes).wish as Data).id);
  const wishA = await createSignedWish(court, '希望TA好起来');
  const wishB = await createSignedWish(court, '希望TA好起来');
  const wishActive = await createSignedWish(court, '希望TA好起来');
  await completeAll(court, wishA);
  await completeAll(court, wishB);
  court.deps.clock.advance(toOpen);
  const settledA = await settle(court, wishA);
  const settledB = await settle(court, wishB);
  check(
    '准备：两条愿签已结算、一条仍在进行中',
    settledA.status === 200 && settledB.status === 200
      && court.deps.db.rowsOf('wishes').find((row) => row.id === wishActive)?.status === 'active',
    [settledA.envelope, settledB.envelope],
  );

  // 14a 两段式上传：presign → 模拟直传 → complete 实测字节
  {
    const anonymous = await presign(court, '', { filename: 'a.png', mime_type: 'image/png', purpose: 'checkin_proof' });
    check('未登录申请上传 → 401', anonymous.status === 401, anonymous.envelope);
    const badPurpose = await presign(court, court.token, { filename: 'a.png', mime_type: 'image/png', purpose: 'avatar' });
    check('非法用途 → 400 purpose_unsupported', badPurpose.status === 400 && badPurpose.envelope.errorCode === 'purpose_unsupported', badPurpose.envelope);
    const badMime = await presign(court, court.token, { filename: 'a.gif', mime_type: 'image/gif', purpose: 'checkin_proof' });
    check('非法图片格式 → 400 mime_type_unsupported', badMime.status === 400 && badMime.envelope.errorCode === 'mime_type_unsupported', badMime.envelope);
    const tooLarge = await presign(court, court.token, { filename: 'a.png', mime_type: 'image/png', purpose: 'checkin_proof', size_bytes: 200 * 1024 + 1 });
    check('声明大小超 200KB → 400 file_too_large', tooLarge.status === 400 && tooLarge.envelope.errorCode === 'file_too_large', tooLarge.envelope);
    const foreignWish = await presign(court, court.strangerToken, { filename: 'a.png', mime_type: 'image/png', purpose: 'checkin_proof', wish_id: wishA });
    check('给别人的愿签上传 → 403 wish_forbidden', foreignWish.status === 403 && foreignWish.envelope.errorCode === 'wish_forbidden', foreignWish.envelope);

    const accepted = await presign(court, court.token, {
      filename: 'checkin.png', mime_type: 'image/png', purpose: 'checkin_proof', wish_id: wishA,
    });
    const acceptedFile = data(accepted).file as Data;
    const fileId = fileIdOf(accepted);
    const uploadUrl = String(data(accepted).upload_url ?? '');
    const objectKey = objectKeyOf(uploadUrl);
    check(
      '申请上传 → 201 pending + 服务端派生 object_key',
      accepted.status === 201 && acceptedFile?.status === 'pending' && acceptedFile?.size_bytes === 0
        && objectKey.startsWith(`u/${court.userId}/checkin_proof/${fileId}.png`),
      { file: acceptedFile, objectKey },
    );
    check(
      '上传凭证 2 小时过期且声明必须带 content-type',
      Date.parse(String(data(accepted).expires_at)) - court.deps.clock.now.getTime() === 7_200_000
        && (data(accepted).required_headers as Data)?.['content-type'] === 'image/png'
        && data(accepted).max_bytes === 200 * 1024,
      accepted.envelope,
    );

    const notUploaded = await complete(court, court.token, fileId);
    check('还没直传就 complete → 400 upload_pending', notUploaded.status === 400 && notUploaded.envelope.errorCode === 'upload_pending', notUploaded.envelope);
    const anonymousComplete = await complete(court, '', fileId);
    check('未登录 complete → 401', anonymousComplete.status === 401, anonymousComplete.envelope);
    const foreignComplete = await complete(court, court.strangerToken, fileId);
    check('跨用户 complete → 403 file_forbidden', foreignComplete.status === 403 && foreignComplete.envelope.errorCode === 'file_forbidden', foreignComplete.envelope);
    const missing = await complete(court, court.token, crypto.randomUUID());
    check('不存在的文件 → 404 file_not_found', missing.status === 404 && missing.envelope.errorCode === 'file_not_found', missing.envelope);
    const pendingUrl = await fileUrl(court, court.token, fileId);
    check('pending 文件取 URL → 400 file_not_ready', pendingUrl.status === 400 && pendingUrl.envelope.errorCode === 'file_not_ready', pendingUrl.envelope);

    court.deps.storage.put(objectKey, PNG_BYTES, 'image/png');
    const verified = await complete(court, court.token, fileId);
    const verifiedFile = data(verified).file as Data;
    const verifiedRow = court.deps.db.rowsOf('files').find((row) => row.id === fileId);
    check(
      'complete 实测字节 → ready + 真实大小与 sha256',
      verified.status === 200 && verifiedFile?.status === 'ready' && verifiedFile?.size_bytes === PNG_BYTES.byteLength
        && /^[0-9a-f]{64}$/.test(String(verifiedRow?.sha256 ?? '')) && verifiedFile?.verified_at !== null,
      verifiedFile,
    );
    const replayComplete = await complete(court, court.token, fileId);
    check('重复 complete 幂等 → 同一文件同一摘要', replayComplete.status === 200
      && String((data(replayComplete).file as Data)?.verified_at) === String(verifiedFile?.verified_at)
      && String((data(replayComplete).file as Data)?.id) === String(verifiedFile?.id), replayComplete.envelope);

    const anonymousUrl = await fileUrl(court, '', fileId);
    check('未登录取文件 URL → 401', anonymousUrl.status === 401, anonymousUrl.envelope);
    const foreignUrl = await fileUrl(court, court.strangerToken, fileId);
    check('跨用户取文件 URL → 403 file_forbidden', foreignUrl.status === 403 && foreignUrl.envelope.errorCode === 'file_forbidden', foreignUrl.envelope);
    const signed = await fileUrl(court, court.token, fileId);
    const signedUrl = String(data(signed).url ?? '');
    check(
      '本人取 URL → 600 秒签名链接',
      signed.status === 200 && data(signed).expires_in === 600 && signedUrl.startsWith('https://storage.local/get/'),
      data(signed),
    );

    const disguised = await presign(court, court.token, { filename: 'fake.png', mime_type: 'image/png', purpose: 'ledger_proof' });
    const disguisedId = fileIdOf(disguised);
    court.deps.storage.put(objectKeyOf(String(data(disguised).upload_url ?? '')), JPEG_BYTES, 'image/jpeg');
    const mismatch = await complete(court, court.token, disguisedId);
    check('文件头与声明不一致 → 400 verification_failed', mismatch.status === 400 && mismatch.envelope.errorCode === 'verification_failed', mismatch.envelope);
    const mismatchAgain = await complete(court, court.token, disguisedId);
    check('校验失败的文件不能再次 complete → 400 file_not_ready', mismatchAgain.status === 400 && mismatchAgain.envelope.errorCode === 'file_not_ready', mismatchAgain.envelope);

    // 14a-2 pending 超时：预签名 2 小时后未确认即失效
    const stale = await presign(court, court.token, { filename: 'stale.png', mime_type: 'image/png', purpose: 'ledger_proof' });
    const staleId = fileIdOf(stale);
    court.deps.clock.advance(2 * 60 * 60 * 1000 + 1000);
    const staleComplete = await complete(court, court.token, staleId);
    const staleRow = court.deps.db.rowsOf('files').find((row) => row.id === staleId);
    check(
      'pending 超 2 小时 complete → 400 upload_expired 并标记 expired',
      staleComplete.status === 400 && staleComplete.envelope.errorCode === 'upload_expired'
        && staleRow?.status === 'expired',
      { envelope: staleComplete.envelope, staleStatus: staleRow?.status },
    );
    const abandoned = await presign(court, court.token, { filename: 'abandoned.png', mime_type: 'image/png', purpose: 'ledger_proof' });
    const abandonedId = fileIdOf(abandoned);
    court.deps.clock.advance(2 * 60 * 60 * 1000 + 1000);
    const fresh = await presign(court, court.token, { filename: 'fresh.png', mime_type: 'image/png', purpose: 'ledger_proof' });
    const abandonedRow = court.deps.db.rowsOf('files').find((row) => row.id === abandonedId);
    check(
      '放弃的 pending 文件 → 下一次申请时惰性标记 expired',
      fresh.status === 201 && abandonedRow?.status === 'expired',
      { fresh: fresh.status, abandonedStatus: abandonedRow?.status },
    );
  }

  // 14b 分享：作者生成/轮换/撤销，匿名只读白名单
  {
    const foreign = await shareWish(court, court.strangerToken, wishA);
    check('非作者生成分享 → 403 wish_forbidden', foreign.status === 403 && foreign.envelope.errorCode === 'wish_forbidden', foreign.envelope);
    const beforeSign = await shareWish(court, court.token, draftId);
    check('草稿分享 → 400 share_not_before_sign', beforeSign.status === 400 && beforeSign.envelope.errorCode === 'share_not_before_sign', beforeSign.envelope);

    const first = await shareWish(court, court.token, wishA);
    const share1 = data(first).share as Data;
    const token1 = String(share1?.token ?? '');
    check(
      '生成分享 → 201 + 短 token + 站点地址',
      first.status === 201 && /^[A-Za-z0-9_-]{16,32}$/.test(token1) && share1?.status === 'active'
        && String(share1?.url).endsWith(`/s/${token1}`) && share1?.api_path === `/api/s/${token1}`,
      share1,
    );

    const view = await readShare(court, token1);
    const viewWish = data(view).wish as Data;
    const viewShare = data(view).share as Data;
    check(
      '匿名打开分享 → 200 只读白名单（结局/关系/日期）',
      view.status === 200 && viewWish?.status === 'settled' && viewWish?.outcome === 'double_realized'
        && viewWish?.outcome_label === '双重兑现' && viewWish?.relation === '姥姥'
        && viewWish?.start_date === '2026-05-20' && viewWish?.end_date === '2026-05-26' && viewWish?.day_index === 7,
      viewWish,
    );
    check('分享页不泄露五问/账本/礼物/文件/身份', !FORBIDDEN_PUBLIC.test(view.raw), view.raw.slice(0, 240));
    check('分享页访问计数递增', viewShare?.visits === 1, viewShare);
    const secondView = await readShare(court, token1);
    check('再次访问 → visits=2', (data(secondView).share as Data)?.visits === 2, data(secondView).share);

    const malformed = await readShare(court, 'short');
    check('短 token → 404 share_not_found', malformed.status === 404 && malformed.envelope.errorCode === 'share_not_found', malformed.envelope);
    const randomToken = await readShare(court, 'A'.repeat(16));
    check('不存在的 token → 404 share_not_found', randomToken.status === 404 && randomToken.envelope.errorCode === 'share_not_found', randomToken.envelope);

    const rotated = await shareWish(court, court.token, wishA);
    const token2 = String((data(rotated).share as Data)?.token ?? '');
    check('再次生成 → 轮换 token', rotated.status === 201 && token2 !== token1, { token1, token2 });
    const oldGone = await readShare(court, token1);
    check('旧链接立即失效 → 404', oldGone.status === 404, oldGone.envelope);
    const stillWorks = await readShare(court, token2);
    check('新链接可访问', stillWorks.status === 200, stillWorks.envelope);

    const revoked = await revokeShare(court, court.token, wishA);
    check('撤销分享 → 200 revoked', revoked.status === 200 && (data(revoked).share as Data)?.status === 'revoked', revoked.envelope);
    const afterRevoke = await readShare(court, token2);
    check('撤销后访问 → 404 share_revoked', afterRevoke.status === 404 && afterRevoke.envelope.errorCode === 'share_revoked', afterRevoke.envelope);
    const revokeAgain = await revokeShare(court, court.token, wishA);
    check('重复撤销幂等 → 200 revoked', revokeAgain.status === 200 && (data(revokeAgain).share as Data)?.status === 'revoked', revokeAgain.envelope);

    const regenerated = await shareWish(court, court.token, wishA);
    const token3 = String((data(regenerated).share as Data)?.token ?? '');
    check('撤销后可重新生成 → 新 token active', regenerated.status === 201 && token3 !== token2 && (data(regenerated).share as Data)?.status === 'active', data(regenerated).share);

    const activeShare = await shareWish(court, court.token, wishActive);
    const activeToken = String((data(activeShare).share as Data)?.token ?? '');
    const activeView = await readShare(court, activeToken);
    const activeWish = data(activeView).wish as Data;
    check(
      '进行中的愿签分享 → 不返回结局，只给进行天数',
      activeShare.status === 201 && activeView.status === 200 && activeWish?.status === 'active'
        && activeWish?.outcome === '' && activeWish?.outcome_label === ''
        && Number(activeWish?.day_index) >= 1 && Number(activeWish?.day_index) <= 7,
      activeWish,
    );
  }

  // 14c 公开池：发布 / 列表 / 详情 / 举报隐藏 / 下架
  let postA = '';
  let postB = '';
  {
    const unsettled = await publish(court, court.token, { wish_id: wishActive, category: 'body' });
    check('未结算愿签发布 → 400 wish_not_settled', unsettled.status === 400 && unsettled.envelope.errorCode === 'wish_not_settled', unsettled.envelope);
    const foreign = await publish(court, court.strangerToken, { wish_id: wishA, category: 'body' });
    check('非作者发布 → 403 wish_forbidden', foreign.status === 403 && foreign.envelope.errorCode === 'wish_forbidden', foreign.envelope);
    const badCategory = await publish(court, court.token, { wish_id: wishA, category: 'unknown' });
    check('非法分类 → 400 invalid_parameter', badCategory.status === 400 && badCategory.envelope.errorCode === 'invalid_parameter', badCategory.envelope);

    const publishedA = await publish(court, court.token, { wish_id: wishA, category: 'body' });
    postA = String((data(publishedA).post as Data)?.id ?? '');
    check(
      '发布已结算愿签 → 201 即时公开、默认匿名',
      publishedA.status === 201 && (data(publishedA).post as Data)?.status === 'published'
        && (data(publishedA).post as Data)?.display_label === '匿名搭子'
        && (data(publishedA).post as Data)?.is_anonymous === true,
      data(publishedA).post,
    );
    check('公开帖子不含 author_id / wish_id', !/author_id|wish_id|user_id/.test(publishedA.raw), publishedA.raw.slice(0, 200));

    const repeated = await publish(court, court.token, { wish_id: wishA, category: 'body' });
    check(
      '同一愿签重复发布 → 200 返回原帖且不新增',
      repeated.status === 200 && String((data(repeated).post as Data)?.id) === postA
        && court.deps.db.rowsOf('pool_posts').filter((row) => row.wish_id === wishA).length === 1,
      data(repeated).post,
    );

    const publishedB = await publish(court, court.token, {
      wish_id: wishB, category: 'study', is_anonymous: false, excerpt: '室友考试加油，有事打 13800138000',
    });
    postB = String((data(publishedB).post as Data)?.id ?? '');
    const excerpt = String((data(publishedB).post as Data)?.excerpt ?? '');
    check(
      '显式摘要脱敏联系方式后落库',
      publishedB.status === 201 && excerpt.includes('***') && !excerpt.includes('13800138000')
        && excerpt.length <= 120 && (data(publishedB).post as Data)?.display_label === '许愿人',
      data(publishedB).post,
    );

    const list = await listPool(court);
    const listIds = ((data(list).items as Data[]) ?? []).map((row) => String(row.id));
    check(
      '匿名列表 → 两条帖子（最新优先）',
      list.status === 200 && listIds.length === 2 && listIds.includes(postA) && listIds.includes(postB),
      data(list),
    );
    check('列表不泄露身份/愿签 id/隐私字段', !FORBIDDEN_PUBLIC.test(list.raw), list.raw.slice(0, 240));
    const studyOnly = await listPool(court, '?category=study');
    check('分类过滤 → 只返回 study', ((data(studyOnly).items as Data[]) ?? []).length === 1
      && String((data(studyOnly).items as Data[])[0]?.id) === postB, data(studyOnly));
    const emptyCategory = await listPool(court, '?category=love');
    check('分类无内容 → 空列表', ((data(emptyCategory).items as Data[]) ?? []).length === 0, data(emptyCategory));
    const badQuery = await listPool(court, '?category=unknown');
    check('非法分类查询 → 400', badQuery.status === 400 && badQuery.envelope.errorCode === 'invalid_parameter', badQuery.envelope);
    const badSort = await listPool(court, '?sort=hot');
    check('不支持的排序 → 400', badSort.status === 400 && badSort.envelope.errorCode === 'invalid_parameter', badSort.envelope);

    const page1 = await listPool(court, '?limit=1');
    const page1Items = (data(page1).items as Data[]) ?? [];
    const cursor = String(data(page1).next_cursor ?? '');
    check('列表游标第一页 → 1 条 + has_more', page1.status === 200 && page1Items.length === 1 && data(page1).has_more === true && cursor !== '', data(page1));
    const page2 = await listPool(court, `?limit=1&cursor=${cursor}`);
    const page2Items = (data(page2).items as Data[]) ?? [];
    check('列表游标第二页 → 不重复且结束', page2.status === 200 && page2Items.length === 1
      && String(page2Items[0]?.id) !== String(page1Items[0]?.id) && data(page2).has_more === false, data(page2));

    const detail = await poolDetail(court, postA);
    check(
      '帖子详情 → 公开字段 + 实时回信数',
      detail.status === 200 && (data(detail).post as Data)?.id === postA
        && (data(detail).post as Data)?.reply_count === 0,
      data(detail).post,
    );
    check('详情不泄露身份/愿签 id', !FORBIDDEN_PUBLIC.test(detail.raw), detail.raw.slice(0, 240));
    const missing = await poolDetail(court, crypto.randomUUID());
    check('不存在的帖子 → 404 pool_hidden', missing.status === 404 && missing.envelope.errorCode === 'pool_hidden', missing.envelope);
    const badId = await poolDetail(court, 'not-a-uuid');
    check('帖子 id 非 UUID → 400 invalid_parameter', badId.status === 400 && badId.envelope.errorCode === 'invalid_parameter', badId.envelope);
  }

  // 14d 回信：发布 / 敏感拦截 / 同帖日限 / 分页 / 删除权限
  {
    const anonymous = await createReply(court, '', postB, '加油');
    check('未登录回信 → 401', anonymous.status === 401, anonymous.envelope);
    const tooLong = await createReply(court, court.strangerToken, postB, '好'.repeat(81));
    check('回信超 80 字 → 400 content_too_long', tooLong.status === 400 && tooLong.envelope.errorCode === 'content_too_long', tooLong.envelope);
    const sensitive = await createReply(court, court.strangerToken, postB, '有事打 13800138000');
    check('回信含联系方式 → 400 sensitive_content', sensitive.status === 400 && sensitive.envelope.errorCode === 'sensitive_content', sensitive.envelope);

    const reply1 = await createReply(court, court.strangerToken, postB, '愿一切顺利，慢慢来。');
    const reply1Id = String((data(reply1).reply as Data)?.id ?? '');
    check(
      '回信即时发布 → 201 + 计数与剩余额度',
      reply1.status === 201 && reply1Id !== '' && (data(reply1).post as Data)?.reply_count === 1
        && (data(reply1).quota as Data)?.daily_remaining === 19,
      data(reply1),
    );
    check('回信 DTO 不含 author_id', !/author_id|user_id/.test(reply1.raw), reply1.raw.slice(0, 200));
    const reply2 = await createReply(court, court.thirdToken, postB, '替TA开心，会好起来的。');
    const reply2Id = String((data(reply2).reply as Data)?.id ?? '');
    check('第二位用户回信 → 计数 2', reply2.status === 201 && (data(reply2).post as Data)?.reply_count === 2, data(reply2));
    const duplicate = await createReply(court, court.strangerToken, postB, '再来一条');
    check('同贴同人同日 → 409 reply_daily_limit', duplicate.status === 409 && duplicate.envelope.errorCode === 'reply_daily_limit', duplicate.envelope);

    const listed = await listReplies(court, postB);
    check(
      '匿名回信列表 → 时间倒序两条',
      listed.status === 200 && ((data(listed).items as Data[]) ?? []).length === 2
        && (data(listed).items as Data[]).every((item) => item.display_label === '打气搭子'),
      data(listed),
    );
    check('回信列表不泄露作者', !/author_id|user_id/.test(listed.raw), listed.raw.slice(0, 200));

    const replyPage1 = await listReplies(court, postB, '?limit=1');
    const replyPage1Items = (data(replyPage1).items as Data[]) ?? [];
    const replyCursor = String(data(replyPage1).next_cursor ?? '');
    const replyPage2 = await listReplies(court, postB, `?limit=1&cursor=${replyCursor}`);
    const replyPage2Items = (data(replyPage2).items as Data[]) ?? [];
    check(
      '回信游标分页 → 两页不重复',
      replyPage1Items.length === 1 && data(replyPage1).has_more === true && replyPage2Items.length === 1
        && String(replyPage2Items[0]?.id) !== String(replyPage1Items[0]?.id) && data(replyPage2).has_more === false,
      { page1: replyPage1Items.map((row) => row.id), page2: replyPage2Items.map((row) => row.id) },
    );

    const detail = await poolDetail(court, postB);
    check('帖子详情实时回信数 = 2', (data(detail).post as Data)?.reply_count === 2, data(detail).post);

    const notOwner = await deleteReply(court, court.thirdToken, reply1Id);
    check('非回信作者也非帖主 → 403 not_reply_owner', notOwner.status === 403 && notOwner.envelope.errorCode === 'not_reply_owner', notOwner.envelope);
    const ownDelete = await deleteReply(court, court.strangerToken, reply1Id);
    check('回信作者删除自己的回信 → 200', ownDelete.status === 200 && data(ownDelete).status === 'deleted', ownDelete.envelope);
    const afterOwnDelete = await listReplies(court, postB);
    check('删除后列表只剩 1 条', ((data(afterOwnDelete).items as Data[]) ?? []).length === 1, data(afterOwnDelete));
    const postAuthorDelete = await deleteReply(court, court.token, reply2Id);
    check('帖主删除他人回信 → 200', postAuthorDelete.status === 200 && data(postAuthorDelete).status === 'deleted', postAuthorDelete.envelope);
    const emptyList = await listReplies(court, postB);
    check('全部删除后列表为空且详情计数归零', ((data(emptyList).items as Data[]) ?? []).length === 0
      && (data(await poolDetail(court, postB)).post as Data)?.reply_count === 0, data(emptyList));
    const deleteAgain = await deleteReply(court, court.strangerToken, reply1Id);
    check('重复删除幂等 → 200 deleted', deleteAgain.status === 200 && data(deleteAgain).status === 'deleted', deleteAgain.envelope);
    const missingReply = await deleteReply(court, court.token, crypto.randomUUID());
    check('不存在的回信 → 404 reply_not_found', missingReply.status === 404 && missingReply.envelope.errorCode === 'reply_not_found', missingReply.envelope);
    const badReplyId = await deleteReply(court, court.token, 'not-a-uuid');
    check('回信 id 非 UUID → 400 invalid_parameter', badReplyId.status === 400 && badReplyId.envelope.errorCode === 'invalid_parameter', badReplyId.envelope);

    await court.deps.db.from('wishes').update({ replies_enabled: false }).eq('id', wishB).select('id');
    const disabled = await createReply(court, court.thirdToken, postB, '还能回吗');
    check('作者关闭回信 → 400 replies_disabled', disabled.status === 400 && disabled.envelope.errorCode === 'replies_disabled', disabled.envelope);
    await court.deps.db.from('wishes').update({ replies_enabled: true }).eq('id', wishB).select('id');
  }

  // 14e 举报满阈值自动隐藏 / 作者下架
  {
    const anonymous = await reportPost(court, '', postA);
    check('未登录举报 → 401', anonymous.status === 401, anonymous.envelope);
    const badReason = await reportPost(court, court.token, postA, 'because');
    check('非法举报理由 → 400 invalid_parameter', badReason.status === 400, badReason.envelope);

    const first = await reportPost(court, court.token, postA);
    check(
      '第 1 次举报 → 201 计数 1 不隐藏',
      first.status === 201 && (data(first).target as Data)?.report_count === 1 && (data(first).target as Data)?.hidden === false,
      first.envelope,
    );
    const duplicate = await reportPost(court, court.token, postA);
    check('同一人重复举报 → 409 report_duplicate', duplicate.status === 409 && duplicate.envelope.errorCode === 'report_duplicate', duplicate.envelope);
    const second = await reportPost(court, court.strangerToken, postA, 'privacy');
    check('第 2 次举报 → 计数 2 不隐藏', second.status === 201 && (data(second).target as Data)?.report_count === 2 && (data(second).target as Data)?.hidden === false, second.envelope);
    const third = await reportPost(court, court.thirdToken, postA, 'harassment');
    check(
      '第 3 次举报 → 满阈值自动隐藏',
      third.status === 201 && (data(third).target as Data)?.report_count === 3
        && (data(third).target as Data)?.hidden === true && (data(third).report as Data)?.status === 'acted',
      third.envelope,
    );
    const hiddenDetail = await poolDetail(court, postA);
    check('隐藏后详情 → 404 pool_hidden', hiddenDetail.status === 404 && hiddenDetail.envelope.errorCode === 'pool_hidden', hiddenDetail.envelope);
    const listAfterHide = await listPool(court);
    check(
      '隐藏后列表只剩 1 条',
      ((data(listAfterHide).items as Data[]) ?? []).length === 1
        && String((data(listAfterHide).items as Data[])[0]?.id) === postB,
      data(listAfterHide),
    );
    const reportHidden = await reportPost(court, court.token, postA);
    check('举报已隐藏帖子 → 404 pool_hidden', reportHidden.status === 404 && reportHidden.envelope.errorCode === 'pool_hidden', reportHidden.envelope);
    const hiddenReply = await createReply(court, court.thirdToken, postA, '现在还能回吗');
    check('已隐藏帖子回信 → 404 pool_hidden', hiddenReply.status === 404 && hiddenReply.envelope.errorCode === 'pool_hidden', hiddenReply.envelope);
    check('举报记录全部标记 acted', court.deps.db.rowsOf('reports')
      .filter((row) => row.target_id === postA && row.status === 'acted').length === 3);

    const unpublishForeign = await unpublishPost(court, court.strangerToken, postB);
    check('非作者下架 → 403 not_post_author', unpublishForeign.status === 403 && unpublishForeign.envelope.errorCode === 'not_post_author', unpublishForeign.envelope);
    const unpublished = await unpublishPost(court, court.token, postB);
    check('作者下架 → 200 deleted', unpublished.status === 200 && (data(unpublished).post as Data)?.status === 'deleted', unpublished.envelope);
    const detailAfter = await poolDetail(court, postB);
    check('下架后详情 → 404 pool_hidden', detailAfter.status === 404 && detailAfter.envelope.errorCode === 'pool_hidden', detailAfter.envelope);
    const listAfterUnpublish = await listPool(court);
    check('下架后列表为空', ((data(listAfterUnpublish).items as Data[]) ?? []).length === 0, data(listAfterUnpublish));
    const unpublishAgain = await unpublishPost(court, court.token, postB);
    check('重复下架幂等 → 200 deleted', unpublishAgain.status === 200 && (data(unpublishAgain).post as Data)?.status === 'deleted', unpublishAgain.envelope);

    const republish = await publish(court, court.token, { wish_id: wishB, category: 'study', is_anonymous: false });
    check('下架后可重新发布 → 原帖回到 published', republish.status === 200
      && String((data(republish).post as Data)?.id) === postB
      && (data(republish).post as Data)?.status === 'published', data(republish).post);
    const listAfterRepublish = await listPool(court);
    check('重新发布后列表恢复 1 条', ((data(listAfterRepublish).items as Data[]) ?? []).length === 1, data(listAfterRepublish));
    const republishHidden = await publish(court, court.token, { wish_id: wishA, category: 'body' });
    check('被举报隐藏的帖子不能重新发布 → 400 pool_hidden', republishHidden.status === 400 && republishHidden.envelope.errorCode === 'pool_hidden', republishHidden.envelope);
  }

  // 14f 环境变量限流：上传 / 发布 / 回信 / 举报
  {
    const limited = await boot('限额作者', {
      uploadPerHour: 1,
      poolPublishPerDay: 1,
      poolReportPerHour: 1,
      replyPerDay: 1,
    });
    const limA = await createSignedWish(limited, '希望TA好起来');
    const limB = await createSignedWish(limited, '希望TA好起来');
    await completeAll(limited, limA);
    await completeAll(limited, limB);
    limited.deps.clock.advance(toOpen);
    await settle(limited, limA);
    await settle(limited, limB);

    const up1 = await presign(limited, limited.token, { filename: 'a.png', mime_type: 'image/png', purpose: 'checkin_proof' });
    const up2 = await presign(limited, limited.token, { filename: 'b.png', mime_type: 'image/png', purpose: 'checkin_proof' });
    check(
      'UPLOAD_PER_HOUR=1 → 第二次 429 upload_rate_limited',
      up1.status === 201 && up2.status === 429 && up2.envelope.errorCode === 'upload_rate_limited'
        && Number(up2.envelope.details?.retryAfterSeconds ?? 0) > 0,
      up2.envelope,
    );

    const pub1 = await publish(limited, limited.token, { wish_id: limA, category: 'body' });
    const pub2 = await publish(limited, limited.token, { wish_id: limB, category: 'body' });
    check(
      'POOL_PUBLISH_PER_DAY=1 → 第二条 429 publish_quota_exceeded',
      pub1.status === 201 && pub2.status === 429 && pub2.envelope.errorCode === 'publish_quota_exceeded',
      pub2.envelope,
    );
    const limPostId = String((data(pub1).post as Data)?.id ?? '');

    const reply1 = await createReply(limited, limited.token, limPostId, '第一条');
    const reply2 = await createReply(limited, limited.token, limPostId, '第二条');
    const replyOther = await createReply(limited, limited.strangerToken, limPostId, '换个人');
    check(
      'REPLY_PER_DAY=1 → 同人第二条 429，换人仍可发',
      reply1.status === 201 && reply2.status === 429 && reply2.envelope.errorCode === 'reply_rate_limited'
        && replyOther.status === 201 && (data(replyOther).post as Data)?.reply_count === 2,
      { reply2: reply2.envelope, replyOther: replyOther.envelope },
    );

    const report1 = await reportPost(limited, limited.token, limPostId);
    const report2 = await reportPost(limited, limited.token, limPostId);
    check(
      'POOL_REPORT_PER_HOUR=1 → 同一人第二次 429 report_rate_limited',
      report1.status === 201 && report2.status === 429 && report2.envelope.errorCode === 'report_rate_limited',
      report2.envelope,
    );
  }
}

// ── 15. 第 8 轮：AI 润色 / 演示模式 ───────────────────────────────────────
{
  const AI_TEXT = [
    '希望妈妈的膝盖能轻一点，走路不再一瘸一拐。',
    '想给她买一副护膝，下楼时膝盖能暖一点。',
    '这周陪她走两段路，问问腿还疼不疼。',
  ];
  const isDoneStatus = (value: unknown): boolean => value === 'done' || value === 'made_up';
  const taskStats = (rows: Array<Record<string, unknown>>) => {
    let mustTotal = 0;
    let mustDone = 0;
    let moneyTotal = 0;
    let moneyDone = 0;
    for (const row of rows) {
      const must = row.is_must === true;
      const money = String(row.side ?? '') === 'money';
      const done = isDoneStatus(row.status);
      if (must) mustTotal += 1;
      if (money) moneyTotal += 1;
      if (must && done) mustDone += 1;
      if (money && done) moneyDone += 1;
    }
    return { mustTotal, mustDone, moneyTotal, moneyDone };
  };

  const aiBoot = (overrides: Parameters<typeof createLocalDeps>[1] = {}, adapter?: AiAdapter) => {
    const deps = createLocalDeps('2026-05-20T06:00:00.000Z', overrides);
    if (adapter) deps.ai = adapter;
    const aiApp = createApp(deps);
    const aiCall = (options: CallOptions) => invoke(aiApp, options);
    return { deps, call: aiCall };
  };
  const aiGuest = async (booted: ReturnType<typeof aiBoot>, ip: string) => {
    const res = await booted.call({ path: '/api/auth/guest', body: {}, ip });
    return String((data(res).session as Data).access_token);
  };
  const polish = (booted: ReturnType<typeof aiBoot>, token: string, body: Data, key?: string) =>
    booted.call({
      path: '/api/ai/polish-wish', token, body,
      headers: key ? { 'idempotency-key': key } : {},
    });
  const suggestionsOf = (response: { envelope: Envelope<never> }) =>
    ((data(response).suggestions ?? []) as Data[]);

  // 15a 模板兜底：默认不依赖外部服务，仍返回 3 条并带标签
  {
    const booted = aiBoot();
    const token = await aiGuest(booted, '198.51.100.1');
    const res = await polish(booted, token, { wish_text: '希望姥姥的腿疼能轻一点。', relation: '姥姥', wish_type: 'body' });
    const payload = data(res);
    const list = suggestionsOf(res);
    check(
      'AI 模板：返回 3 条、单条 ≤60 字、每条带「AI辅助」',
      res.status === 200 && list.length === 3
        && list.every((item) => item.label === 'AI辅助' && String(item.text).length <= 60),
      payload,
    );
    check(
      'AI 模板：顶层标签/口径完整且不虚报额度',
      payload.ai_assisted === true && payload.ai_label === 'AI辅助' && payload.label_required === true
        && payload.source === 'template' && payload.fallback === false
        && (payload.quota as Data)?.used === 0 && (payload.quota as Data)?.daily_limit === 20,
      payload,
    );
    check('AI 只读：调用后没有写入任何愿签', booted.deps.db.rowsOf('wishes').length === 0);

    const anonymous = await booted.call({ path: '/api/ai/polish-wish', body: { wish_text: '希望TA好起来' } });
    check('AI 未登录 → 401', anonymous.status === 401, anonymous.envelope);
    const missing = await polish(booted, token, { relation: '姥姥' });
    check('AI 缺 wish_text → 400', missing.status === 400, missing.envelope);
    const tooLong = await polish(booted, token, { wish_text: 'x'.repeat(121), relation: '姥姥', wish_type: 'body' });
    check('AI 文本超过 120 字 → 400', tooLong.status === 400, tooLong.envelope);
    const badRelation = await polish(booted, token, { wish_text: '希望TA好起来', relation: '同学', wish_type: 'body' });
    check('AI 关系不在白名单 → 400', badRelation.status === 400, badRelation.envelope);
  }

  // 15b 输入脱敏：电话在进模型前就被抹掉
  {
    let seen = '';
    const capture: AiAdapter = {
      name: 'capture-agent',
      async generate(input) {
        seen = input.text;
        return AI_TEXT;
      },
    };
    const booted = aiBoot({}, capture);
    const token = await aiGuest(booted, '198.51.100.2');
    const res = await polish(booted, token, {
      wish_text: '帮妈妈预约检查，她的手机 13800138000', relation: '妈妈', wish_type: 'body',
    });
    check(
      'AI 输入脱敏：模型看不到手机号，响应标记 input_redacted',
      res.status === 200 && data(res).input_redacted === true
        && seen.includes('***') && !seen.includes('13800138000') && !res.raw.includes('13800138000'),
      { seen, payload: data(res) },
    );
  }

  // 15c agent 正常 / 缓存 / 额度（默认只让 agent 来源计数）
  {
    const counter = { count: 0 };
    const agent: AiAdapter = {
      name: 'fake-agent',
      async generate() {
        counter.count += 1;
        return AI_TEXT;
      },
    };
    const booted = aiBoot({ aiPolishPerDay: 1, aiTimeoutMs: 1000 }, agent);
    const token = await aiGuest(booted, '198.51.100.3');
    const body = { wish_text: '希望奶奶的腰疼能缓一缓。', relation: '奶奶', wish_type: 'body' };
    const first = await polish(booted, token, body);
    check(
      'AI agent：source=agent、额度 -1、模型名回传',
      first.status === 200 && data(first).source === 'agent' && data(first).fallback === false
        && (data(first).quota as Data)?.used === 1 && (data(first).quota as Data)?.remaining === 0
        && data(first).model === 'fake-agent' && data(first).cached === false,
      data(first),
    );

    const repeat = await polish(booted, token, body);
    check(
      'AI 缓存：相同输入直接回放、不再调用模型、不重复计费',
      repeat.status === 200 && data(repeat).cached === true && data(repeat).source === 'agent'
        && counter.count === 1 && (data(repeat).quota as Data)?.used === 1,
      { payload: data(repeat), calls: counter.count },
    );

    const secondBody = { wish_text: '希望爸爸少熬一点夜。', relation: '爸爸', wish_type: 'sleep' };
    const overQuota = await polish(booted, token, secondBody);
    check(
      'AI 额度：默认每日 20，配置为 1 后第 2 条回退模板 quota_exceeded（不阻塞主流程）',
      overQuota.status === 200 && data(overQuota).source === 'template' && data(overQuota).fallback === true
        && data(overQuota).fallback_reason === 'quota_exceeded'
        && (data(overQuota).quota as Data)?.used === 1 && suggestionsOf(overQuota).length === 3,
      data(overQuota),
    );
    const overQuotaCached = await polish(booted, token, secondBody);
    check(
      'AI 额度兜底结果也按输入缓存，且仍带标签',
      overQuotaCached.status === 200 && data(overQuotaCached).cached === true
        && data(overQuotaCached).fallback_reason === 'quota_exceeded'
        && suggestionsOf(overQuotaCached).every((item) => item.label === 'AI辅助'),
      data(overQuotaCached),
    );
  }

  // 15d 幂等键：同一请求重放原响应，不落入普通缓存路径
  {
    const counter = { count: 0 };
    const agent: AiAdapter = {
      name: 'idem-agent',
      async generate() {
        counter.count += 1;
        return AI_TEXT;
      },
    };
    const booted = aiBoot({}, agent);
    const token = await aiGuest(booted, '198.51.100.4');
    const body = { wish_text: '希望室友早点睡。', relation: '室友', wish_type: 'sleep' };
    const key = crypto.randomUUID();
    const first = await polish(booted, token, body, key);
    const replay = await polish(booted, token, body, key);
    check(
      'AI 幂等键：重放命中中间件，不重复调用模型',
      first.status === 200 && replay.status === 200 && counter.count === 1
        && data(replay).cached === false
        && JSON.stringify(data(replay).suggestions) === JSON.stringify(data(first).suggestions),
      { first: data(first), replay: data(replay), calls: counter.count },
    );
  }

  // 15e 超时 / 异常 / 坏输出：一律回退模板并给出原因
  {
    const slow: AiAdapter = {
      name: 'slow-agent',
      async generate() {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return AI_TEXT;
      },
    };
    const timed = aiBoot({ aiTimeoutMs: 10 }, slow);
    const timedToken = await aiGuest(timed, '198.51.100.5');
    const timeoutRes = await polish(timed, timedToken, { wish_text: '希望姥姥腿好。', relation: '姥姥', wish_type: 'body' });
    check(
      'AI 超时 → 200 + 模板兜底 + fallback_reason=timeout',
      timeoutRes.status === 200 && data(timeoutRes).source === 'template' && data(timeoutRes).fallback === true
        && data(timeoutRes).fallback_reason === 'timeout' && suggestionsOf(timeoutRes).length === 3,
      data(timeoutRes),
    );

    const broken: AiAdapter = {
      name: 'broken-agent',
      async generate() {
        throw new Error('boom');
      },
    };
    const failed = aiBoot({}, broken);
    const failedToken = await aiGuest(failed, '198.51.100.6');
    const errorRes = await polish(failed, failedToken, { wish_text: '希望奶奶腰好。', relation: '奶奶', wish_type: 'body' });
    check(
      'AI 调用失败 → 200 + 模板兜底 + fallback_reason=agent_error',
      errorRes.status === 200 && data(errorRes).source === 'template'
        && data(errorRes).fallback_reason === 'agent_error',
      data(errorRes),
    );

    const malformed: AiAdapter = {
      name: 'bad-output-agent',
      async generate() {
        return ['只有一条'];
      },
    };
    const invalid = aiBoot({}, malformed);
    const invalidToken = await aiGuest(invalid, '198.51.100.7');
    const invalidRes = await polish(invalid, invalidToken, { wish_text: '希望爷爷腿好。', relation: '爷爷', wish_type: 'body' });
    check(
      'AI 输出条数不合格 → 丢弃 + 模板兜底 + fallback_reason=invalid_output',
      invalidRes.status === 200 && data(invalidRes).source === 'template'
        && data(invalidRes).fallback_reason === 'invalid_output' && suggestionsOf(invalidRes).length === 3,
      data(invalidRes),
    );
  }

  // 15f 演示会话：预置人设 + 真实引擎基线
  const demoBoot = (overrides: Parameters<typeof createLocalDeps>[1] = {}) => {
    const deps = createLocalDeps('2026-05-20T06:00:00.000Z', overrides);
    const demoApp = createApp(deps);
    return { deps, call: (options: CallOptions) => invoke(demoApp, options) };
  };

  const boot = demoBoot();
  const opened = await boot.call({ path: '/api/demo/session', body: {}, ip: '198.51.100.30' });
  const grant = data(opened);
  const grantSession = grant.session as Data;
  const persona = grant.persona as Data;
  const initialState = grant.state as Data;
  const demoToken = String(grantSession?.access_token ?? '');
  const demoWishId = String((initialState?.wish as Data)?.id ?? '');
  const demoUserId = String((grant.user as Data)?.id ?? '');
  check(
    '演示会话：201、独立 token、24h TTL、is_demo 账号',
    opened.status === 201 && demoToken.split('.').length === 3
      && grantSession?.token_type === 'Bearer' && grantSession?.expires_in_seconds === 86_400
      && (grant.user as Data)?.is_demo === true,
    grant,
  );
  check(
    '演示人设：替妈妈许愿、第 3 天进度、2 条打卡、账本 168 元',
    persona?.relation === '妈妈' && String(persona?.preset).includes('168')
      && Number((initialState.progress as Data)?.current_day) === 3
      && Number((initialState.progress as Data)?.checkin_count) === 2
      && Number(((initialState.ledger as Data)?.totals as Data)?.saved_cents) === 16_800
      && Number(((initialState.ledger as Data)?.totals as Data)?.spent_cents) === 3_200,
    initialState,
  );
  check(
    '演示基线：愿签 active、结算未开始、今日任务可读',
    (initialState.wish as Data)?.status === 'active' && initialState.settlement === null
      && Array.isArray(initialState.today_tasks) && (initialState.today_tasks as Data[]).length > 0,
    { wish: initialState.wish, settlement: initialState.settlement },
  );
  const demoWishRow = boot.deps.db.rowsOf('wishes').find((row) => String(row.id) === demoWishId);
  const demoUserRow = boot.deps.db.rowsOf('users').find((row) => String(row.id) === demoUserId);
  check(
    '演示隔离：愿签与账号都带 is_demo 标记',
    demoWishRow?.is_demo === true && demoUserRow?.is_demo === true,
    { wish: demoWishRow?.is_demo, user: demoUserRow?.is_demo },
  );

  const stateRead = await boot.call({ path: '/api/demo/state', token: demoToken });
  check('演示状态：凭演示 token 直接读取', stateRead.status === 200 && (data(stateRead).wish as Data)?.id === demoWishId, stateRead.envelope);

  {
    const realGuest = await boot.call({ path: '/api/auth/guest', body: { nickname: '真实观众' }, ip: '198.51.100.31' });
    const realToken = String((data(realGuest).session as Data).access_token);
    const wrongSide = await boot.call({ path: '/api/demo/state', token: realToken });
    check('演示状态：真实 token → 403 demo_required', wrongSide.status === 403 && wrongSide.envelope.errorCode === 'demo_required', wrongSide.envelope);
    const realList = await boot.call({ path: '/api/wishes', token: realToken });
    check(
      '演示隔离：真实账号列表看不到演示愿签',
      !((data(realList).items ?? []) as Data[]).some((item) => item.id === demoWishId),
      data(realList).items,
    );
    const demoShare = await boot.call({ path: `/api/wishes/${demoWishId}/share`, token: demoToken, body: {} });
    check('演示 token 生成分享链 → 403 demo_forbidden', demoShare.status === 403 && demoShare.envelope.errorCode === 'demo_forbidden', demoShare.envelope);
    const demoPublish = await boot.call({ path: '/api/pool/publish', token: demoToken, body: { wish_id: demoWishId, category: 'body' } });
    check('演示 token 发布公开池 → 403 demo_forbidden', demoPublish.status === 403 && demoPublish.envelope.errorCode === 'demo_forbidden', demoPublish.envelope);
    const demoAi = await boot.call({
      path: '/api/ai/polish-wish', token: demoToken,
      body: { wish_text: '希望妈妈腿好', relation: '妈妈', wish_type: 'body' },
    });
    check('演示 token 调用真实 AI → 403 demo_forbidden（不产生真实计费）', demoAi.status === 403 && demoAi.envelope.errorCode === 'demo_forbidden', demoAi.envelope);
  }

  // 15g 快进：真实任务/账本/结算引擎，结局 double_realized
  {
    const ff = await boot.call({ path: '/api/demo/fast-forward', token: demoToken, body: {} });
    const ffData = data(ff);
    const settlement = ffData.settlement as Data;
    const firstAct = settlement?.first_act as Data;
    const ffState = ffData.state as Data;
    const ffFirstTasks = ffTasksOf();
    const arrived = taskStats(ffFirstTasks);
    check(
      '快进：自动结算为 double_realized，愿签转 settled',
      ff.status === 200 && firstAct?.outcome === 'double_realized' && (ffState.wish as Data)?.status === 'settled',
      { settlement, wish: ffState.wish },
    );
    check(
      '快进：结算统计与任务行完全一致（复用真实引擎）',
      Number((firstAct?.tasks as Data)?.must_total) === arrived.mustTotal
        && Number((firstAct?.tasks as Data)?.must_done) === arrived.mustDone
        && Number((firstAct?.tasks as Data)?.money_total) === arrived.moneyTotal
        && Number((firstAct?.tasks as Data)?.money_done) === arrived.moneyDone
        && arrived.mustDone === arrived.mustTotal && arrived.moneyDone === arrived.moneyTotal,
      { stored: firstAct?.tasks, arrived },
    );
    const ffLedger = (ffState.ledger as Data)?.totals as Data;
    check(
      '快进：账本累计 = 兑现（saved + income），结算金额取真实账本',
      Number((settlement?.second_act as Data)?.realized_cents)
        === Number(ffLedger?.saved_cents) + Number(ffLedger?.income_cents),
      { second: settlement?.second_act, totals: ffLedger },
    );
    check(
      '快进：7 天任务全部有记录，钱任务也已完成',
      ffFirstTasks.length > 0 && arrived.moneyTotal > 0,
      { tasks: ffFirstTasks.length, moneyTotal: arrived.moneyTotal },
    );

    function ffTasksOf(): Array<Record<string, unknown>> {
      return boot.deps.db.rowsOf('tasks').filter((row) => String(row.wish_id) === demoWishId);
    }
  }

  // 15h 三档结局切换：每次都从真实引擎重建并重新结算
  {
    const setScenario = (outcome: string) =>
      boot.call({ path: '/api/demo/scenario', token: demoToken, body: { outcome } });
    const outcomeOf = (response: { envelope: Envelope<never> }) =>
      String(((data(response).settlement as Data)?.first_act as Data)?.outcome ?? '');

    const cyber = await setScenario('cyber_only');
    const cyberStats = ((data(cyber).settlement as Data)?.first_act as Data)?.tasks as Data;
    check(
      '结局 cyber_only：必做全勤、钱任务 0 完成',
      cyber.status === 200 && outcomeOf(cyber) === 'cyber_only'
        && Number(cyberStats?.must_done) === Number(cyberStats?.must_total)
        && Number(cyberStats?.money_total) > 0 && Number(cyberStats?.money_done) === 0,
      { outcome: outcomeOf(cyber), tasks: cyberStats },
    );
    const cyberTaskCount = boot.deps.db.rowsOf('tasks').filter((row) => String(row.wish_id) === demoWishId).length;

    const failed = await setScenario('failed');
    const failedStats = ((data(failed).settlement as Data)?.first_act as Data)?.tasks as Data;
    check(
      '结局 failed：必做未完成 → unrealized',
      failed.status === 200 && outcomeOf(failed) === 'unrealized'
        && Number(failedStats?.must_done) < Number(failedStats?.must_total),
      { outcome: outcomeOf(failed), tasks: failedStats },
    );

    const double = await setScenario('double_realized');
    const doubleStats = ((data(double).settlement as Data)?.first_act as Data)?.tasks as Data;
    check(
      '结局 double_realized：必做与钱任务全部完成',
      double.status === 200 && outcomeOf(double) === 'double_realized'
        && Number(doubleStats?.must_done) === Number(doubleStats?.must_total)
        && Number(doubleStats?.money_done) === Number(doubleStats?.money_total),
      { outcome: outcomeOf(double), tasks: doubleStats },
    );
    check(
      '结局重播：重建不累积重复任务',
      boot.deps.db.rowsOf('tasks').filter((row) => String(row.wish_id) === demoWishId).length === cyberTaskCount,
      { before: cyberTaskCount, after: boot.deps.db.rowsOf('tasks').filter((row) => String(row.wish_id) === demoWishId).length },
    );
    const replay = await setScenario('cyber_only');
    check('结局可反复切换：double → cyber 再次生效', replay.status === 200 && outcomeOf(replay) === 'cyber_only', data(replay).settlement);
    const badScenario = await setScenario('happy');
    check('结局类型不在三档内 → 400 invalid_parameter', badScenario.status === 400 && badScenario.envelope.errorCode === 'invalid_parameter', badScenario.envelope);
  }

  // 15i 重置：回到第 3 天 / 2 条打卡 / 168 元，结算快照清空
  {
    const reset = await boot.call({ path: '/api/demo/reset', token: demoToken, body: {} });
    const resetState = data(reset);
    check(
      '重置：回到预置基线且结算状态清空',
      reset.status === 200 && (resetState.wish as Data)?.status === 'active'
        && Number((resetState.progress as Data)?.current_day) === 3
        && Number((resetState.progress as Data)?.checkin_count) === 2
        && Number(((resetState.ledger as Data)?.totals as Data)?.saved_cents) === 16_800
        && resetState.settlement === null,
      resetState,
    );
    check(
      '重置：旧结算行已清理，不残留上一轮结局',
      boot.deps.db.rowsOf('settlements').filter((row) => String(row.wish_id) === demoWishId).length === 0,
    );
  }

  // 15j TTL 过期 + 惰性清理 + 单 IP 限流
  {
    boot.deps.clock.advance(25 * 3_600_000);
    const expired = await boot.call({ path: '/api/demo/state', token: demoToken });
    check(
      '演示过期：25h 后 token 失效（token_expired 或 demo_session_expired）',
      expired.status === 401 && ['token_expired', 'demo_session_expired'].includes(String(expired.envelope.errorCode)),
      expired.envelope,
    );
    const renewed = await boot.call({ path: '/api/demo/session', body: {}, ip: '198.51.100.30' });
    const sessionsAfter = boot.deps.db.rowsOf('demo_sessions');
    check(
      '过期会话惰性清理：新建会话顺手删掉旧行，不依赖定时任务',
      renewed.status === 201 && !sessionsAfter.some((row) => String(row.id) === String(grantSession?.demo_session_id)),
      { status: renewed.status, sessions: sessionsAfter.map((row) => row.id) },
    );

    // 15j-2 同 IP 只清最早 3 条过期会话：更晚到期的留到下一次创建
    {
      const staggered: string[] = [];
      for (let hour = 0; hour < 4; hour++) {
        const res = await boot.call({ path: '/api/demo/session', body: {}, ip: '198.51.100.60' });
        staggered.push(String((data(res).session as Data)?.demo_session_id ?? ''));
        boot.deps.clock.advance(3_600_000);
      }
      boot.deps.clock.advance(25 * 3_600_000);
      const swept = await boot.call({ path: '/api/demo/session', body: {}, ip: '198.51.100.60' });
      const sweptId = String((data(swept).session as Data)?.demo_session_id ?? '');
      const alive = boot.deps.db.rowsOf('demo_sessions').map((row) => String(row.id));
      check(
        '同一 IP 只清理最早 3 条过期会话，其余留待下一次',
        swept.status === 201 && staggered.length === 4
          && staggered.slice(0, 3).every((id) => !alive.includes(id))
          && alive.includes(staggered[3]) && alive.includes(sweptId),
        { alive, staggered },
      );
    }

    const limited = demoBoot({ demoPerHour: 1 });
    const firstIp = await limited.call({ path: '/api/demo/session', body: {}, ip: '198.51.100.40' });
    const secondIp = await limited.call({ path: '/api/demo/session', body: {}, ip: '198.51.100.40' });
    check(
      'DEMO_PER_HOUR=1 → 同 IP 第二次 429 demo_too_many_sessions',
      firstIp.status === 201 && secondIp.status === 429 && secondIp.envelope.errorCode === 'demo_too_many_sessions',
      secondIp.envelope,
    );
  }
}

// ── 16. 第 9 轮：API_PER_MINUTE 兜底限流 ──────────────────────────────────
{
  const limitedDeps = createLocalDeps('2026-05-20T06:00:00.000Z', { apiPerMinute: 2 });
  const limitedApp = createApp(limitedDeps);
  const reg = await invoke(limitedApp, { path: '/api/auth/guest', body: {}, ip: '203.0.113.99' });
  const token = String((data(reg).session as Data)?.access_token ?? '');
  const probes = await Promise.all([1, 2, 3].map(() => invoke(limitedApp, { path: '/api/health' })));
  check(
    '健康探针不参与兜底限流',
    reg.status === 200 && probes.every((probe) => probe.status === 200),
    probes.map((probe) => probe.status),
  );
  const meCalls = [];
  for (let index = 0; index < 3; index++) {
    meCalls.push(await invoke(limitedApp, { path: '/api/me', token, ip: '203.0.113.99' }));
  }
  const blocked = meCalls[2];
  check(
    'API_PER_MINUTE=2 → 同主体第 3 次 429 api_rate_limited + retry-after',
    meCalls[0].status === 200 && meCalls[1].status === 200
      && blocked.status === 429 && blocked.envelope.errorCode === 'api_rate_limited'
      && Number(blocked.headers.get('retry-after') ?? 0) >= 1,
    { statuses: meCalls.map((item) => item.status), retryAfter: blocked.headers.get('retry-after') },
  );
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log(failures.map((name) => ` - ${name}`).join('\n'));
  process.exitCode = 1;
}

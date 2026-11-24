# 12 · 前端对接手册

> 对应后端：第 9 轮最终版 + 联调补充（42 条路由，`{origin}/functions/v1/app`）。字段级契约以 [04-api-contract.md](../docs/04-api-contract.md) 为准；本文给前端「怎么接、按什么顺序、哪些坑不能踩」。

## 1. 基础配置

```ts
export const API_ORIGIN = 'https://yuan-ta-0ykrktz6t0e.qoder.zone';
export const API_BASE = `${API_ORIGIN}/functions/v1/app`;
```

- 只拼一次基地址；**不要**请求 `/api/...` 裸路径、其他 Function 前缀或带尾斜杠的变体，都会 404。
- 所有请求 `content-type: application/json`；只有浏览器直传对象存储时用上传接口返回的 `required_headers`。
- 不依赖 Cookie：Token 放 `Authorization: Bearer <access_token>`。WebView / 小程序 WebView 都存 `localStorage` 即可。
- 可选头：`Idempotency-Key`（写接口）、`x-client`（来源端，如 `web`/`miniapp`）、`x-demo-session`（仅游客建号复用演示会话）。

## 2. 统一响应与请求封装

成功和失败共用一个信封：

```jsonc
{ "code": 0, "data": { }, "message": "ok", "requestId": "..." }
{ "code": 400, "data": null, "message": "参数不合法。", "requestId": "...",
  "errorCode": "invalid_parameter", "details": { "fields": { "days": "must be one of 7|14|30" } } }
```

前端分支只看 `errorCode`，展示优先 `message`，排障记录 `requestId`（响应头 `x-request-id` 同值）。

```ts
type Envelope<T> = {
  code: number;
  data: T | null;
  message: string;
  requestId: string;
  errorCode?: string;
  details?: Record<string, unknown>;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly envelope: Envelope<unknown>,
  ) {
    super(envelope.message);
  }
  get errorCode() { return this.envelope.errorCode ?? 'unknown'; }
  get requestId() { return this.envelope.requestId; }
}

export async function api<T>(
  path: string,
  init: RequestInit & { token?: string; idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  if (init.idempotencyKey) headers.set('idempotency-key', init.idempotencyKey);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const envelope = (await res.json()) as Envelope<T>;
  if (!res.ok || envelope.code !== 0) throw new ApiError(res.status, envelope);
  return envelope.data as T;
}
```

约定：

- 201 只表示「本次真正创建了资源」；幂等重放仍是 200，但重放响应体与首次一致（额外头 `x-idempotent-replay: true`）。前端不要用 201 判断成功，用 `code === 0`。
- 405 会带 `Allow` 头；属于前端方法写错，按头修正，不要加重试逻辑。
- 429 带 `Retry-After`（秒）；按该值退避，不要立刻重试。
- 500 文案固定「服务器开小差了」之类，不含堆栈；只能靠 `requestId` 找后端。

## 3. 鉴权与会话

### 3.1 游客建号（本项目唯一的注册入口）

```ts
const data = await api<GuestSession>('/api/auth/guest', {
  method: 'POST',
  body: JSON.stringify({ nickname: '阿甘', channel: 'wechat' }),
});
// data.session.access_token / data.session.expires_at
// data.recovery_code 只出现这一次，必须让用户抄下或存进安全存储
```

- `channel` 只能是 `xiaohongshu | douyin | wechat | bilibili | friend | other`；`avatar` 只能是 `default_01..12`。
- 真实账号响应含 `recovery_code`（26 位 Crockford Base32，展示时可按 5 位分组）；**服务端不存明文，丢失只能走登录态内换码（本轮无此接口）**。
- 带 `x-demo-session` 建号返回演示会话，**没有恢复码**，不要按真实账号流程提示用户抄码。

### 3.2 携带与过期

- 每次请求带 `Authorization: Bearer <token>`；默认 30 天绝对有效期。
- 401 分三种：`invalid_token`（无/畸形/签名错）、`token_expired`、`token_revoked`。三种都清本地 token，引导用户输入恢复码。
- 没有 refresh token，也没有 Cookie 自动续期；不要实现静默刷新。

### 3.3 恢复登录

```ts
const data = await api<RecoverResult>('/api/auth/recover', {
  method: 'POST',
  body: JSON.stringify({ recovery_code: input }),
});
// 换到新 token + 新恢复码；旧 token 与旧恢复码立即失效
```

- 格式错与码不存在都返回 401 `invalid_credentials`，前端不要提示「格式错误」以泄露差异。
- 成功响应含 `revoked_tokens`（被撤销的旧设备数），可用于提示「其他设备已退出」。

### 3.4 退出

`POST /api/auth/logout`，body `{ all_devices?: boolean }`，带上当前 token；`all_devices:true` 撤销全部会话。返回 `{ revoked_tokens }`。

## 4. 幂等键

| 接口 | 要求 | 前端做法 |
| --- | --- | --- |
| `POST /api/wishes` | **required** | 打开表单时生成一个 UUID，提交期间复用；成功后作废 |
| 其余写接口（打卡/补卡/账本/立契/结算/续期/上传 complete/分享/公开池/回信/AI/演示写） | optional | 用户点按钮时生成 UUID；重试沿用同一个；成功作废 |
| 读接口、`auth/*`、`uploads/presign`、`uploads/:id/url`、`demo/session`、删除分享/回信 | none | 不要带；带了也无害但无重放保证 |

```ts
const key = crypto.randomUUID(); // 页面级保存，直到请求成功
```

- 同键同内容 → 返回首次结果；同键不同内容 → 409 `idempotency_key_reuse`，说明代码复用了旧键，重新生成。
- 首次请求还在处理 → 409 `idempotency_in_progress`，等 2 秒再用**同键**重试；60 秒后可接管。
- 5xx 不写成功存档，同键重试会重新执行。

## 5. 核心业务调用顺序

### 5.1 愿签创建 → 五问 → 立契

```ts
// 1) 草稿（201）
const created = await api<{ wish: WishDetail }>('/api/wishes', {
  method: 'POST', token, idempotencyKey: key,
  body: JSON.stringify({ relation: '妈妈', nickname: '妈妈', pronoun: 'she', wish_text: '...' }),
});

// 2) 五问可部分提交；未提交字段保持原值，不回显答案
await api(`/api/wishes/${wish.id}/answers`, {
  method: 'PUT', token,
  body: JSON.stringify({ q1: '...', q2: '...', q3: '...', q4: '...', q5: '...' }),
});

// 3) 立契；days 只接受整数 7/14/30，默认 7
const signed = await api<ContractResult>(`/api/wishes/${wish.id}/contract`, {
  method: 'POST', token, body: JSON.stringify({ days: 7 }),
});
```

- 五问每项 1..200 字；全空提交 422 `no_op`；非 draft 再提交 400 `answers_locked`。
- 立契前必须五问齐全，否则 400 `answers_incomplete`，`details.missing` 列出缺哪几项。
- `days` 传字符串 `"7"` 也判 400；不要从输入框直接透传。
- 重复立契：`first_sign:false`，天数与开始日以首签为准，只补缺失任务；不要在前端重复生成任务。
- 任务 `day_index` 从 0 起，展示「第 N 天」时 +1。`type` 是 `ta|self|money`，`is_must` 与 `is_optional` 同时给出。

### 5.2 每日任务与打卡

```ts
const today = await api<TodayView>(`/api/wishes/${wishId}/tasks/today`, { token });
// today.tasks[].checkin 为 null 或打卡记录；today.makeup_ticket 为当前周券

// 账本、结算、历史记录需要整份任务表时（今日接口只回当天）：
const all = await api<TaskListView>(`/api/wishes/${wishId}/tasks`, { token });
// all.tasks[].checkin 同样是 null 或打卡记录；可按 ?date=YYYY-MM-DD 过滤
```

- 今日页只回当天任务；**漏卡不会实时变红**，下次打开今日页时服务端才把过期 `pending` 标 `missed`。
- 打卡必须带 `proof_id`（先走 §6 上传，`purpose=checkin_proof`）；`note` 0..30 字。
- 同一任务重复打卡是覆盖：200 + `already_done:true`，不新增记录。
- 已 `missed` 的任务不能直接打卡（400 `makeup_required`），必须走补卡：
  - 只能补**当前自然周**、每周一张券、任务必须是 `missed`；
  - 券不存在/过期分别 `makeup_ticket_unavailable` / `makeup_ticket_expired`；
  - 补卡成功 `no_penalty:true`，`is_makeup:true`。
- 打卡 429 `checkin_rate_limited` 带 `retryAfterSeconds`；按值等待。

### 5.3 账本

```ts
const ledger = await api<LedgerView>(`/api/wishes/${wishId}/ledger?week_start=2026-05-18`, { token });
// ledger.weeks 是周汇总，ledger.entries 是契约期内的流水明细（按创建时间升序）
await api(`/api/ledger/weeks/${weekStart}`, {
  method: 'PUT', token,
  body: JSON.stringify({ wish_id: wishId, budget_cents: 6000 }),
});
await api('/api/ledger/entries', {
  method: 'POST', token,
  body: JSON.stringify({ wish_id: wishId, week_start: weekStart, type: 'expense',
    amount_cents: 1234, note: '给TA买了花', proof_id }),
});
```

- **`wish_id` 必须放 body**：这两条路径不在愿签路径下，服务端不猜当前愿签。
- `week_start` 必须是周一 `YYYY-MM-DD`；只能改当前/未来周，历史周 400 `week_not_editable`。
- 金额一律整数分（`_cents`），没有浮点、没有「元」；展示用响应里的 `*_yuan`。
- 支出 0..200000，超预算仍 200 但 `over_budget:true`、结余按 0 计；收入 1..100000，必须带同周已完成钱任务的 `task_id`。
- 同一钱任务只能确认一笔收入；并发边界见 §9。
- 账本接口**绝不返回礼物名称/价格**，结算前前端也不要展示目录。

### 5.4 结算与续期

```ts
const settled = await api<{ settlement: SettlementView; already_settled: boolean }>(
  `/api/wishes/${wishId}/settle`, { method: 'POST', token, body: '{}' },
);
const view = await api<SettlementView>(`/api/wishes/${wishId}/settlement`, { token });
const extended = await api(`/api/wishes/${wishId}/extend`, { method: 'POST', token, body: '{}' });
```

- 结算开放点是 `end_date + 1 天 04:00`（北京时间）的 UTC ISO；早于则 400 `settle_too_early`，`details.seconds_remaining` 可直接做倒计时。
- 结算并发 409 `settlement_in_progress`，按 `retryAfterSeconds`（默认 2）重试同一请求。
- 已结算再调用返回 `already_settled:true`，前端直接展示，不要重复动画。
- 续期**无入参**，固定 +7 天、每愿签一次；`double_realized` 不允许续期（400 `extend_not_allowed`）；已续过 400 `extend_limit_reached`。
- 两幕结果在 `GET .../settlement` 一次返回；未结算时 400 `wish_not_settled`。

### 5.5 分享

```ts
const share = await api<{ share: ShareInfo }>(`/api/wishes/${wishId}/share`, {
  method: 'POST', token, body: '{}',
});
// share.url 形如 https://<origin>/s/<token>；分享页调用 GET /api/s/:token
```

- 重复生成 = 轮换 token，**旧链接立即失效**；前端提示「重新生成后旧链接不可用」。
- 撤销：`DELETE /api/wishes/:id/share`，重复撤销幂等；从未生成过返回 404 `share_not_found`。
- 分享页匿名可读，只含 `title/wish_text/summary/relation/relation_group/wish_type/status/outcome/outcome_label/start_date/end_date/day_index/settled_at` 与 `share.visits`。**没有五问、账本、金额、礼物、文件、昵称、user_id**。
- `outcome` 只在已结算后非空；`day_index` 夹在 `1..days`。

### 5.6 公开池与回信

```ts
// 发布：仅 settled 愿签；category 六类；excerpt ≤120 字（缺省服务端脱敏生成）
const post = await api('/api/pool/publish', {
  method: 'POST', token,
  body: JSON.stringify({ wish_id: wishId, category: wishType, is_anonymous: true }),
});

// 匿名列表/详情（无 token）
const list = await api('/api/pool?category=life&limit=10');
const detail = await api(`/api/pool/${postId}`);

// 举报：每人每帖一次；达到阈值自动隐藏
await api(`/api/pool/${postId}/report`, {
  method: 'POST', token, body: JSON.stringify({ reason_code: 'spam', detail: '广告' }),
});

// 回信：1..80 字，命中联系方式/引流词 400 sensitive_content
await api(`/api/pool/${postId}/replies`, {
  method: 'POST', token, body: JSON.stringify({ content: '你已经做得很好了，慢慢来。' }),
});
const replies = await api(`/api/pool/${postId}/replies?limit=20`);
await api(`/api/replies/${replyId}`, { method: 'DELETE', token });
```

- 发布即公开，没有人工审核；同一愿签重复发布返回 200 + 原帖，不重复计数。
- 被举报隐藏/已下架后，列表、详情、回信统一 404 `pool_hidden`；前端展示「内容不可见」即可，不要暴露原因。
- 回信两道日限：每人每天总量 429 `reply_rate_limited`；同一帖每人每天一条 409 `reply_daily_limit`。
- 删除权限：回信作者或帖主；其他 403 `not_reply_owner`。
- 公开 DTO 永不含 `author_id`、`wish_id`、昵称；展示名固定「匿名搭子 / 许愿人 / 打气搭子」。

### 5.7 AI 润色（只建议，不代写）

```ts
const ai = await api<AiResult>('/api/ai/polish-wish', {
  method: 'POST', token,
  body: JSON.stringify({ wish_text: draft, relation: '妈妈' }),
});
```

- 响应恰好 3 条建议，每条 ≤60 字；顶层 `ai_label:"AI辅助"`、`label_required:true`，每条 `suggestions[].label:"AI辅助"`。
- **前端必须原样展示「AI辅助」标签**，不能隐藏、改写或合并成普通文案。
- `source:"template"` 表示兜底；`fallback:true` + `fallback_reason` 为 `timeout|agent_error|invalid_output|quota_exceeded`。这些情况仍是 200，不要当失败。
- `cached:true` 表示命中缓存；`quota.used/remaining` 展示当日额度，但不要因额度耗尽禁用整个愿签流程——模板仍可用。
- AI 不会写入愿签；用户点选后由前端调用愿签编辑/创建接口（本轮只有创建，编辑未实现），**不要假设服务端已保存**。
- 演示 token 调 AI 一律 403 `demo_forbidden`。

### 5.8 演示模式

```ts
const demo = await api('/api/demo/session', { method: 'POST', body: '{}' });
// demo.session.access_token 是演示 token，24h
const state = await api('/api/demo/state', { token: demo.session.access_token });
await api('/api/demo/fast-forward', { method: 'POST', token: demo.session.access_token, body: '{}' });
await api('/api/demo/scenario', {
  method: 'POST', token: demo.session.access_token,
  body: JSON.stringify({ outcome: 'cyber_only' }),
});
await api('/api/demo/reset', { method: 'POST', token: demo.session.access_token, body: '{}' });
```

- 演示 token 只能调演示接口；真实 token 调演示接口 403 `demo_required`。
- 演示 token 不能发分享、进公开池、调 AI（403 `demo_forbidden`）。
- 会话 24h 过期；过期后 401 `demo_session_expired`，重新建会话即可。
- 演示数据与真实数据物理隔离（`is_demo`），真实账号列表看不到。

## 6. 两段式上传（打卡/账本证明、分享图）

```ts
// 1) 申请凭证（201）
const pre = await api<PresignResult>('/api/uploads/presign', {
  method: 'POST', token,
  body: JSON.stringify({ purpose: 'checkin_proof', mime_type: file.type, filename: file.name,
    size_bytes: file.size, wish_id: wishId }),
});

// 2) 浏览器直传（不走 Function）
await fetch(pre.upload_url, {
  method: pre.upload_method, // PUT
  headers: pre.required_headers, // 必须包含 content-type
  body: file,
});

// 3) 通知服务端校验实测字节
const done = await api<{ file: FileDto; file_id: string }>('/api/uploads/complete', {
  method: 'POST', token,
  body: JSON.stringify({ file_id: pre.file_id }),
});

// 4) 展示时换 600 秒签名 GET URL
const shown = await api<{ url: string; expires_in: 600 }>(`/api/uploads/${pre.file_id}/url`, {
  method: 'POST', token,
});
```

硬性要求：

- 只接受 `image/jpeg | image/png | image/webp`，单文件 ≤204800 字节（200KB）。前端先压缩再上传。
- `purpose` 只能是 `checkin_proof | ledger_proof | share_image`；打卡只能引用 `checkin_proof`，账本只能引用 `ledger_proof`。
- PUT 必须带 `required_headers` 里的 `content-type`；缺了或与文件头不符，`complete` 会 400 `verification_failed` 并把行标 `rejected`。
- **presign 后 2 小时内必须 complete**；超时 400 `upload_expired`。用户取消上传就丢弃 `file_id`，不要复用。
- `complete` 成功才是 `ready`；业务接口只认 `ready`，`pending/rejected/expired` 都会被拒。
- 签名 URL 600 秒过期，不要缓存到本地存储；每次展示重新签发。
- `upload_url` 与 `url` 不要打日志、不要上报、不要写进分享内容。

## 7. 错误处理建议

| HTTP / errorCode | 前端行为 |
| --- | --- |
| 400 `invalid_parameter` | 按 `details.fields` 标红对应输入；不要弹全局错误 |
| 400 业务状态（`wish_not_draft`、`answers_locked`、`task_not_today`、`week_not_editable`…） | 提示当前状态并刷新页面数据，不要重试 |
| 401 `invalid_token` / `token_expired` / `token_revoked` | 清 token，引导恢复码登录 |
| 403 `wish_forbidden` / `proof_forbidden` / `not_post_author` / `demo_forbidden` | 提示无权限；不要重试 |
| 404 `wish_not_found` / `pool_hidden` / `share_not_found` | 展示「内容不存在或不可见」，不区分原因 |
| 405 | 前端方法写错，按 `Allow` 修正 |
| 409 `idempotency_key_reuse` | 重新生成幂等键再提交 |
| 409 `idempotency_in_progress` | 等 2 秒用同键重试 |
| 409 `checkin_conflict` / `task_state_conflict` / `settlement_conflict` / `pool_conflict` | 刷新后重试一次；仍失败提示稍后再试 |
| 409 `reply_daily_limit` / `report_duplicate` | 明确提示规则，不重试 |
| 413 / 415 | 请求体过大 / 非 JSON；检查封装 |
| 422 `no_op` | 提示「没有可保存的修改」 |
| 429 | 读 `Retry-After` 或 `retryAfterSeconds`，倒计时后再试 |
| 500 `internal_error` | 展示通用文案 + `requestId`；提供「复制排障编号」 |
| 503 `service_not_configured` / `database_unavailable` / `storage_unavailable` / `task_pool_empty` / `reward_pool_empty` | 展示服务暂不可用；部署期问题，不要在前端兜底造假数据 |

未登记的 `errorCode` 一律展示 `message`，不要显示原始 JSON。

## 8. 时间、金额与展示

- 产品日固定 Asia/Shanghai，**04:00 为日界**；`product_today`、`task_date`、`week_start` 都是 `YYYY-MM-DD`，不要用浏览器时区自行推算日界。
- 其他时间字段是 UTC ISO（如 `2026-05-20T06:00:00.000Z`），展示时转本地时区。
- `day_index` 从 0 起；「第 N 天」= `day_index + 1`。
- 金额字段以 `_cents` 结尾，整数分；`*_yuan` 是向下取整的展示值，计算与提交一律用分。
- 布尔是 `true/false`，不要提交 `0/1/"yes"`。
- 枚举严格白名单：关系 12 种中文原值、愿望六类、契约 `7/14/30`、任务 `ta/self/money`、状态 `pending/done/missed/made_up`、结局 `double_realized/cyber_only/failed`、举报原因 `privacy/harassment/illegal/spam/sexual/other`。

## 9. 安全与隐私红线

1. **五问答案**只在请求体里出现，服务端不回显；前端不要缓存明文到 `localStorage` 或日志。
2. **恢复码**只在注册/找回成功时展示一次；不要上报埋点、不要写日志、不要放 URL。
3. **Token** 只放 `Authorization` 头；不要放 query、不要打日志、不要拼进分享链接。
4. **签名 URL** 短时有效；不要持久化、不要转发到第三方。
5. 公开/分享页只渲染白名单字段；不要尝试从其他接口「补全」作者信息。
6. 用户输入按纯文本渲染（React 默认转义）；不要对昵称、愿望、回信使用 `dangerouslySetInnerHTML`。服务端会清洗控制字符并以 JSON 返回，XSS 串按文本存储。
7. 不做「前端审核通过即发布」：公开池是发布即公开 + 举报隐藏，前端不要伪造审核状态。
8. 「AI辅助」标签必须保留；不要把 AI 建议直接当作已保存的愿望。

## 10. 联调验收清单

- [ ] 基地址只有一处常量；错误路径能得到 404 而不是 HTML。
- [ ] 注册 → 抄恢复码 → 刷新页面仍能用 token 调 `/api/me`。
- [ ] 愿签创建带幂等键；断网重试不产生两条草稿。
- [ ] 五问部分提交后刷新，已提交项不回显但 `five_questions_done` 正确。
- [ ] 立契后今日页有 2 条必做（周末多 1 条钱任务）；重复立契不重复任务。
- [ ] 上传：正确 content-type 成功；错误类型/超大/超 2h 分别得到对应 400。
- [ ] 打卡后证明图能通过 600s URL 展示；刷新后仍只有一条打卡。
- [ ] 账本超预算仍能提交，提示结余为 0；历史周预算不可改。
- [ ] 结算倒计时到点后可结算；并发点击只展示一次结果；续期后旧结果被新版本替代。
- [ ] 分享链接在轮换后旧链 404；分享页无隐私字段。
- [ ] 公开池三人举报后列表消失；回信同帖第二次 409。
- [ ] AI 建议带标签、可点选回填，但未点保存前不落库；额度耗尽仍显示模板。
- [ ] 演示五接口全通；演示数据不出现在真实列表。
- [ ] 429 按 `Retry-After` 退避；500 展示 `requestId` 且可复制。
- [ ] 移动端安全区、键盘遮挡、长文本（120 字愿望 / 80 字回信 / 200 字五问）不溢出。
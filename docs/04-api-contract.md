# 04 接口契约 · 愿TA 后端（最终版）

逻辑路径 `/api/...`，实际请求 `{origin}/functions/v1/app` + 逻辑路径（前缀白名单见 [02-conventions.md](../docs/02-conventions.md) §1）。鉴权一律 `Authorization: Bearer <token>`（02 §5），没有 Cookie、没有 refresh token。
通用错误不逐条重复，各接口只列**特有**错误码；错误码总表在 02 §4，信封与状态码在 02 §2/§3，本文 §0.3 另给全局速查。

> **阅读顺序**：§0.1 是第 2–9 轮**已实现并跑过 470 项冒烟断言**的 42 条接口，字段名与错误码就是线上行为；§0.3 是全局约定速查；§0.4 是按模块的 curl 示例。§1–§16 保留第 1 轮设计稿作对照，其中已被取代的部分见 §0.2，**不要照抄**。

## 0. 总览

| 模块 | 设计接口数 | 已实现 | 鉴权 | 覆盖的 PRD 需求 |
| --- | --- | --- | --- | --- |
| A 系统与元数据 | 4 | 2 | 匿名 | B-01~B-04、非功能 |
| B 认证 | 6 | 3 | 匿名/Token | A-01~A-03、US-06 |
| C 我的与设置 | 5 | 2 | Token | A-04、H-04 |
| D 愿签与契约 | 8 | 6 | Token | B-01~B-08、US-01/04/08 |
| E 任务与打卡 | 8 | 3 | Token | C-01~C-07、US-02、E2E-02 |
| F 文件与上传 | 4 | 3 | Token | C-03、C-07 |
| G 账本 | 4 | 3 | Token | D-01~D-05、E2E-03 |
| H 结算 | 6 | 3 | Token | D-06~D-09、E2E-04/05/06 |
| I 分享 | 5 | 3 | Token + 匿名读 | E-03~E-05、US-03 |
| J 公开池 | 7 | 5 | 匿名读 / Token 写 | E-06、E-07、US-07 |
| K 回信 | 5 | 3 | Token | F-01~F-03、US-07 |
| L 通知与设置 | 5 | 0 | Token | F-04 |
| M AI 辅助 | 5 | 1 | Token | G-01~G-04、US-08 |
| N 演示模式 | 7 | 5 | 匿名/演示 Token | I-01~I-07、E2E-08/09 |
| O 埋点 | 1 | 0 | Token/匿名 | H-03、8.2 |
| **合计** | **80** | **42** | | |

### 0.1 第 2–9 轮已实现（42 条，470 项冒烟断言与四个校验器全绿）

出入参、状态码与错误码以这一节为准；`route` 声明字段与 curl 调用示例的唯一真源是每个路由文件的头注释。

#### 0.1.1 系统与账号（第 2 轮，7 条）

| 方法 · 路径 | 鉴权 | `operation` / `idempotent` / `maxBodyBytes` | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/health` | 否 | `health.ping` / none / 0 | — | `{ status:"ok", version:"v1", time }` | — |
| `GET /api/health/deep` | 否 | `health.deep` / none / 0 | — | `{ status:"ok", database:"up", version:"v1" }`（真打一次库） | `database_unavailable`(503) |
| `POST /api/auth/guest` | 否 | `auth.guest` / **none** / 2048 | `{ nickname?≤32, avatar?∈default_01..12, channel?∈xiaohongshu\|douyin\|wechat\|bilibili\|friend\|other }`；请求头 `x-client`、`x-demo-session`（UUID，可选） | 真实号：`{ user, session:{ access_token, token_type:"Bearer", expires_at }, recovery_code, recovery_code_notice }`；演示号（带 `x-demo-session`）：`{ user, session, is_new }`，**不含恢复码** | `guest_too_many_registrations` `demo_too_many_sessions` `recovery_code_collision`(409) `demo_session_unavailable`(409) `user_create_failed`(409) |
| `POST /api/auth/recover` | 否 | `auth.recover` / **none** / 1024 | `{ recovery_code }`（26 位 Crockford base32；连字符、小写、多余空格会被归一） | `{ user, session, recovery_code:<新码>, recovery_code_notice, revoked_tokens:int }` | `invalid_credentials`(401，不区分"码不存在"与"格式错") `auth_too_many_attempts`(429) |
| `POST /api/auth/logout` | Bearer | `auth.logout` / none / 256 | `{ all_devices?:bool }` | `{ revoked_tokens:int }` | `invalid_token` `token_revoked` `token_expired` |
| `GET /api/me` | Bearer | `me.read` / none / 0 | — | `{ user:{ id, nickname, avatar, client, is_demo, profile_text, wish_style_tags, share_default_public, settings, created_at }, session:{ token_id, expires_at, product_today:"YYYY-MM-DD", device_count } }` | 同上三条 401 |
| `PATCH /api/me` | Bearer | `me.update` / **optional** / 4096 | `{ nickname?1..32, avatar?, profile_text?≤100, wish_style_tags?≤3 项×12 字, share_default_public?bool }`（只改提交的字段） | `{ user, updated_fields:[...] }` | `no_op`(422，空 body 或与当前值完全一致) `invalid_parameter`(400 + `details.fields`) `idempotency_key_reuse`(409) |

`user` 出参由 `domain/users.ts#toUserDto` 单点产出：永不含 `recovery_code_hash`、`reg_ip_hash`、`status`、`last_active_at`、`deleted_at`；`device_count` 最多统计 20 行活动会话。

#### 0.1.2 愿签与契约（第 3 轮，5 条）

| 方法 · 路径 | 鉴权 | `operation` / `idempotent` / `maxBodyBytes` | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/wishes` | Bearer | `wish.create` / **required** / 4096 | `{ relation(必填，12 种中文原值), nickname?1..8, pronoun?∈she\|he\|they, wish_text(必填)1..120 }`；缺省 `nickname = relation`、`pronoun = "they"` | **201** `{ wish: WishDetail(status:"draft") }`；`wish_type` 由关键词规则判定，`classifier_confidence_bps` 为整数万分比 | `invalid_parameter`(400 + `details.fields`) `idempotency_key_required`(400，缺 `Idempotency-Key`) `idempotency_key_reuse`(409) `wish_create_failed`(409) `wish_create_limited`(429 + `retry-after`，`WISH_CREATE_PER_DAY` 默认 20/日) |
| `GET /api/wishes` | Bearer | `wish.list` / none / 0 | query `limit?`1..100（默认 20）、`cursor?`（上一页的 `next_cursor`，≤128 字符） | `{ items:[WishSummary], next_cursor:string\|null, has_more:bool, limit:int }`；**创建时间倒序**，同刻按 `id` 升序兜底；只回当前账号（含演示隔离） | `invalid_parameter`(400，limit 越界) `invalid_cursor`(400) |
| `GET /api/wishes/:id` | Bearer | `wish.read` / none / 0 | path `id` = 愿签 uuid | `{ wish: WishDetail }`；**不含五问明文，也不含密文列** | `invalid_parameter`(400，id 非 UUID) `wish_not_found`(404，**别人的愿签也回 404**) |
| `PUT /api/wishes/:id/answers` | Bearer | `wish.answers` / **optional** / 4096 | `{ q1?, q2?, q3?, q4?, q5? }`，每项 text 1..200；**部分提交**：提交的字段整体替换，未提交的保持原值 | `{ answered:["q1","q2"], five_questions_done:bool, completed_at:string\|null, updated_at, encrypted_stored:true }`；**不回显答案**（明文只在请求内存里存在，落库 AES-256-GCM，AAD = `wish_id`） | `no_op`(422，一个字段都没提交) `invalid_parameter`(400 + `details.fields`) `answers_locked`(400，非 draft) `wish_forbidden`(403) `wish_not_found`(404) `idempotency_key_reuse`(409) |
| `POST /api/wishes/:id/contract` | Bearer | `wish.contract` / **optional** / 1024 | `{ days? }`，只接受整数 `7 / 14 / 30`，默认 `7`（字符串 `"7"` 也判 400） | `{ wish: WishDetail(status:"active"), tasks:[Task × 全量], task_summary, first_sign:bool, recovery_code_notice:string, makeup_ticket:MakeupTicket\|null }`；**同一请求内一次性生成全部天数任务**；首周补卡券随签署发放 | `invalid_parameter`(400 + `details.fields.days`) `wish_not_draft`(400 + `details.status`) `answers_incomplete`(400 + `details.missing:["q1"…]`) `wish_forbidden`(403) `wish_not_found`(404) `wish_state_conflict`(409，CAS 撞车) `task_pool_empty`(503，种子未导入) |

**出参 DTO（唯一投影点，禁止整行转 JSON）**

```jsonc
// WishDetail —— domain/wish.ts#toWishDto；永不含 user_id、*_enc、version、outcome
{ "id","status","relation","relation_group","nickname","pronoun","title","wish_text",
  "wish_type","classifier_type","classifier_confidence_bps","five_questions_done",
  "days","start_date","end_date","settle_open_at","signed_at","is_public","is_demo",
  "created_at","updated_at" }

// WishSummary —— domain/wish.ts#toWishSummary；卡片白名单，比 Detail 少
//   relation_group / wish_text / classifier_* / settle_open_at / is_public / updated_at
{ "id","status","relation","nickname","pronoun","title","wish_type","five_questions_done",
  "days","start_date","end_date","signed_at","is_demo","created_at" }

// Task —— domain/task.ts#toTaskDto；type/title 是接口词表，库内列是 side/text
{ "id","day_index","task_date","type":"ta|self|money","title","status":"pending|done|missed|made_up",
  "is_must","is_optional","seq","proof_kind","time_slot","min_budget_cents","rotation" }

// task_summary —— domain/task.ts#summarizeTasks
{ "days","total","must","optional","ta","self","money" }

// Checkin —— domain/checkin.ts#toCheckinDto；proof_id ← proof_file_id
{ "id","task_id","proof_id","note","is_makeup","channel","checkin_date",
  "server_ts","client_ts","created_at","updated_at" }

// MakeupTicket —— domain/checkin.ts#toMakeupTicketDto
{ "id","week_start","week_index","status":"available|used|expired","expires_at","task_id","used_at" }
```

接口词表 ↔ 库内列的映射只发生在 DTO 函数里：`nickname ← target_name`、`wish_text ← raw_input`、`type ← side`（`for_ta→ta`、`for_self→self`、`money→money`）、`title ← text`。布尔一律 `true/false`，不是 `1/0`。

**分类与标题（确定性，不调用 AI）**：`domain/rules.ts#classifyWish` 按六类关键词命中数取最多者，同分按 `WISH_TYPES` 顺序（`body/sleep/lonely/study/emotion/life`），零命中归 `life` 且 `classifier_confidence_bps = 0`；否则 `round(命中最多类 / 总命中 × 10000)`。`classifier_type` 与 `wish_type` 同值，留作审计。`title` 由 `deriveTitle` 清洗空白与尾随标点后截断到 ≤30 字（超长补 `…`），原文完整保存在 `wish_text`。

**任务生成引擎（签署时一次性生成，之后不动态变更）**

- 每天 2 条必做：1 条 `ta` + 1 条 `self`；`task_date` 落在周六/周日时额外追加 1 条可选 `money`（`is_must:false`）。因此 `total = 2 × days + 周末天数`。
- `day_index` **从 0 起**（展示「第 N 天」时前端 +1）；`task_date` 为 TEXT `YYYY-MM-DD`，由 `start_date` 逐日 `addDays` 推出，时区固定 Asia/Shanghai、产品日以 04:00 为界（`lib/time.ts`）。
- `start_date = productDate(now)`，`end_date = start_date + days − 1`，`settle_open_at = (end_date + 1)T04:00+08:00` 的 UTC ISO。
- 抽取按「`wish_type` × `relation`」组合：候选池 = `is_active=true` 且 `wish_type ∈ {本愿签类型, 'any'}`，再按关系过滤（`relation` 为空 = 通用池）。关系专属模板优先，其次通用池，各自按 `(专属优先, sort_order, id)` 排序后用 `mulberry32(sha256("yuan-ta-task-v1:" + wishId))` 洗牌 ⇒ **同一愿签重放得到同一批任务**，不同愿签互不相同。不调用 AI。
- 同一愿签内标题不重复：生成器先去重，`tasks (wish_id, template_id)` 与 `tasks (wish_id, text)` 两个表级 `UNIQUE` 再各兜一次。
- 池子抽干时生成**轮转副本**：`template_id = NULL`、`rotation = r ≥ 1`、标题追加 `（第 r+1 轮）`，`is_must` 与档位不变。7 天契约通用池 ≥7 条 `for_ta` + 8 条 `for_self` + 2 条 `money`（≥周末天数），`rotation` 恒为 0；14 天起 `money` 侧轮转，30 天契约 `for_ta` 侧也轮转。
- 必做两档任一为空 → 503 `task_pool_empty`；钱任务池为空只跳过可选任务，不连带必做失败。
- 一致性：先算完整计划（`planTasks` 是纯函数），再对 `wishes` 做单行 CAS（`status='draft'` → `active`），最后 `insertIfAbsent` 批量落任务（id = `derivedUuid("yuan-ta-task-v1:<wishId>:<day_index>:<seq>")`）。**顺序不可换**：池空时在 CAS 之前抛 503，绝不会留下「active 但零任务」的愿签；进程崩在批量写中间时，重签会补齐缺失行而不重复插入。
- 返回的 `tasks` 按 `day_index` 升序、同日按 `seq`（为 TA → 为自己 → 钱任务）排列，次级排序在代码里做，不依赖数据库返回顺序。
- 重复签署：`first_sign:false`，天数与 `start_date` 以首签为准（再传 `days:30` 也不会改），只补缺失任务；带同一把 `Idempotency-Key` 重放则字节级返回首次响应（含 200 状态码）。

**状态机**：`draft → active → settling → settled → archived`（另有 `deleted` 软删）。第 3 轮只实现 `draft → active`；`settling/settled` 与 `settled → active`（续期）由第 6 轮写入（§0.1.5）。非法流转一律 **400**（`wish_not_draft`、`answers_locked`、`wish_not_settled`、`settle_too_early`），**409 只留给并发**（`wish_state_conflict`、`settlement_in_progress`、`idempotency_key_reuse`）。归属校验：写操作非作者 → **403 `wish_forbidden`**，读操作查不到（含非作者）→ **404 `wish_not_found`**；结算读与账本读一样是"需求要求非作者 403"的读路径例外（见 02 §3）。

**恢复码**：愿签不单独生成恢复码，复用账号全局那一个；本接口只回 `recovery_code_notice` 文案，**响应里不存在 `recovery_code` 字段**。演示账号的文案说明演示数据只在当前会话内有效。

#### 0.1.3 每日任务与补卡（第 4 轮，3 条）

| 方法 · 路径 | 鉴权 | `operation` / `idempotent` / `maxBodyBytes` | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/wishes/:id/tasks` | Bearer | `wish.tasks` / none / 0 | path `id` = 愿签 uuid；query `date?` = `YYYY-MM-DD` | `{ wish_id, date:string\|null, tasks:[Task(+checkin:Checkin\|null)] }`；按 `day_index`、`seq` 升序；前端账本/结算读取整份任务表 | `invalid_parameter`(400，id/date 非法) `wish_forbidden`(403，非作者) `wish_not_found`(404) |
| `GET /api/wishes/:id/tasks/today` | Bearer | `wish.today_tasks` / none / 0 | path `id` = 愿签 uuid | `{ wish_id, date:"YYYY-MM-DD", tasks:[Task(+checkin:Checkin\|null)], makeup_ticket:MakeupTicket\|null }`；**只含当天**，不返回总天数/剩余天数；每日首次访问惰性把此前 `pending` 标成 `missed` | `invalid_parameter`(400，id 非 UUID) `wish_forbidden`(403，非作者) `wish_not_found`(404，含演示隔离) `wish_not_active`(400 + `details.status`) |
| `POST /api/tasks/:id/checkin` | Bearer | `task.checkin` / **optional** / 1024 | `{ proof_id(uuid，必填), note?`text 0..30` }` | `{ task:Task(status:"done"), checkin:Checkin, already_done:bool, notice:string }`；重复提交 `already_done:true` 并**原地覆盖**同一行打卡（证明与备注可改） | `task_not_found`(404) `wish_not_found`(404) `wish_forbidden`(403，非作者) `wish_not_active`(400) `task_not_today`(400 + `details.task_date/today`) `makeup_required`(400，已 missed) `invalid_task_state`(400 + `details.status`) `invalid_parameter`(400 + `details.fields`) `proof_not_found`(400) `proof_not_ready`(400) `proof_forbidden`(403) `proof_purpose_mismatch`(400) `proof_wish_mismatch`(400) `checkin_rate_limited`(429 + `retryAfterSeconds`，`CHECKIN_PER_MINUTE` 默认 10/分钟) `checkin_conflict`(409) `idempotency_key_reuse`(409) |
| `POST /api/tasks/:id/makeup` | Bearer | `task.makeup` / **optional** / 1024 | `{ proof_id(uuid，必填), note?`text 0..30` }` | `{ task:Task(status:"made_up"), checkin:Checkin(is_makeup:true), ticket:MakeupTicket(status:"used"), no_penalty:true }` | 上述任务/图片/权限类错误，另加 `already_made_up`(400) `task_not_missed`(400 + `details.status`) `makeup_window_closed`(400 + `details.task_week_start/current_week_start`) `makeup_ticket_unavailable`(400 + `details.week_start`) `makeup_ticket_expired`(400) `task_state_conflict`(409，补偿后重试) |

**日界与惰性处理**：时区固定 Asia/Shanghai，产品日以 **04:00** 为界（`lib/time.ts#productDate`）。平台没有 cron，也没有原生事务：
- 读今日任务的请求先执行一次条件批量更新：`wish_id = ? AND status = 'pending' AND task_date < today` → `missed` + `missed_at`。重复执行无副作用。
- 打卡/补卡入口也各扫一次，避免用户跳过今日页直接提交时拿到过期状态。
- 自然周按周一 04:00 换周（`weekStartOf`）；`makeup_tickets` 以 `(wish_id, week_start)` 唯一。

**打卡口径（本轮明确简化）**：提交即完成，服务端**不审核图片内容、不做 AI 验收**。`proof_id` 必须是当前账号上传、`status='ready'`、`purpose='checkin_proof'`、且绑定愿签一致（或未绑愿签）的 `files` 行；`server_ts` 为服务器时间权威值，`client_ts` 恒为 `null`。同一任务只有一条打卡（表级 `UNIQUE(task_id)`），重复提交覆盖证明/备注，不新增行。提交成功给 `wishes.version + 1`（读-改-CAS），供结算轮判定。

**补卡口径**：只有 `missed` 的任务可补，且必须属于**当前自然周**（上周漏卡 `makeup_window_closed`）；每周一张券，签约时首周发放，之后在今日任务页/补卡请求里惰性补发。券状态 `available → used` 用单行 CAS，过期由读路径按 `expires_at` 惰性改 `expired`。顺序是「先烧券、再改任务」：任务 CAS 失败会把券放回（`task_id` 仍指向该任务时）并回 409。补卡不扣分（`no_penalty:true`），`checkins.is_makeup = true`。

**幂等**：两个写接口均为 `idempotent: optional`。带 `Idempotency-Key` 时同键重放字节级返回首次响应（含 200）；同键不同 body → 409 `idempotency_key_reuse`。不带键时靠 `UNIQUE(task_id)` + 覆盖更新保证「最多一行打卡」。

#### 0.1.4 账本（第 5 轮，3 条）

| 方法 · 路径 | 鉴权 | `operation` / `idempotent` / `maxBodyBytes` | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/wishes/:id/ledger` | Bearer | `wish.ledger` / none / 0 | path `id` = 愿签 uuid；query `week_start?` = 契约内某个周一 `YYYY-MM-DD`（缺省当前周） | `{ wish_id, week:LedgerWeek, weeks:[LedgerWeek], entries:[LedgerEntry], totals:LedgerTotals, progress:LedgerProgress }`；只含金额、流水与进度，**绝不返回礼物名称、价格、匹配结果** | `invalid_parameter`(400，id / week_start 非法或非周一) `wish_not_active`(400，未立契/已结束) `week_not_in_contract`(400) `wish_forbidden`(403，非作者) `wish_not_found`(404) |
| `PUT /api/ledger/weeks/:weekStart` | Bearer | `ledger.set_week_budget` / **optional** / 1024 | path `weekStart` = 周一；body `{ wish_id(uuid，必填), budget_cents(整数分，0..200000，必填) }`；只改当前及未来周 | `{ week:LedgerWeek, totals:LedgerTotals, progress:LedgerProgress, notice }`；修改当周立即生效 | `invalid_parameter`(400) `wish_not_active`(400) `week_not_in_contract`(400) `week_not_editable`(400，历史周) `wish_forbidden`(403) `wish_not_found`(404) `ledger_week_conflict`(409，CAS 冲突) `idempotency_key_reuse`(409) |
| `POST /api/ledger/entries` | Bearer | `ledger.add_entry` / **optional** / 2048 | body `{ wish_id(uuid，必填), week_start(周一), type:"expense"\|"earning", amount_cents(整数分), note?≤60, proof_id?uuid, task_id?uuid }`；支出 0..200000，收入 1..100000 且 task_id 必填 | `{ entry:LedgerEntry, week:LedgerWeek, totals:LedgerTotals, progress:LedgerProgress, notice }`；流水只追加，不提供修改/删除 | `invalid_parameter`(400) `wish_not_active`(400) `week_not_in_contract`(400) `week_not_started`(400，未来周) `earning_task_required`(400) `earning_task_not_done`(400) `earning_week_mismatch`(400) `duplicate_earning_link`(400) `proof_not_found`/`proof_not_ready`/`proof_purpose_mismatch`/`proof_wish_mismatch`(400) `wish_forbidden`/`proof_forbidden`/`task_forbidden`(403) `wish_not_found`/`task_not_found`(404) `idempotency_key_reuse`(409) `ledger_entry_failed`(409) |

**必要补充：`wish_id` 放在 body**。本轮给定的 `PUT /api/ledger/weeks/:weekStart` 与 `POST /api/ledger/entries` 路径里没有愿签标识；服务端不按账号「猜」当前愿签（同一账号可同时有多个进行中的愿签），因此这两条写接口都要求 body 里带 `wish_id`。这是对路径设计的补充，不是新增业务语义。

**金额与自然周（确定性，全整数分）**

- 自然周 = 周一 04:00 至下周一 03:59（Asia/Shanghai）；`week_start` 必须是该周周一，复用 `lib/time.ts#weekStartOf`。签约首周从 `start_date` 所在周起算，`week_index` 从 1 开始。
- 首周默认预算由 q4 档位推算（签约时写入 `wishes.weekly_budget_cents` 并建 `ledger_weeks` 首周行）：
  `under_100 → 2000`、`100_299 → 4000`、`300_599 → 8000`、`600_999 → 12000`、`1000_plus → 20000`（分）；无法识别时兜底 5000 分。用户可随时覆盖；修改只影响该周，不回溯历史。
- 周结余 = `max(0, 当周预算 − 当周非必要支出)`；支出正好等于预算时结余 0 且 `over_budget:false`，超过 1 分即 `over_budget:true`，但仍返回 200 并落库（**超预算不拦截提交**）。
- 周计入 = 该周至少一条任务 `status ∈ {done, made_up}`。未计入的周只显示预算，不把预算算进累计兑现。
- 累计兑现 `realized_cents` = Σ 已计入周的结余 + Σ 已确认兼职收入（`entry_kind='earned'` 且未撤销）。
- 所有统计均**读时实时计算**：`ledger_weeks` 只存 `budget_cents`，`spent_cents/saved_cents/earned_cents/counted/over_budget` 不参与读取；因此不存在「流水写了、周汇总忘了更新」的漂移。
- 兼职收入必须关联本愿签内 `side='money'`、状态 `done|made_up` 的任务，且任务与流水在同一自然周；同一钱任务只能确认一次收入（先读校验，无表级唯一索引，见 07 §3.2）。
- 证明文件：`proof_id` 可选；传入时必须是当前账号上传、`status='ready'`、`purpose='ledger_proof'` 且绑定愿签一致的 `files` 行。两段式上传未落地前不强制收入附证明。
- 结算前本模块只输出金额/进度；礼物名称与价格只在结算接口（§0.1.5）`settled` 后出现，账本接口没有这些字段。

**出参 DTO（唯一投影点，禁止整行转 JSON）**

```jsonc
// LedgerWeek —— domain/ledger.ts#toLedgerWeekDto
{ "week_start","week_index","is_current","is_future","counted",
  "budget_cents","budget_yuan","spent_cents","spent_yuan","income_cents","income_yuan",
  "balance_cents","balance_yuan","over_budget","progress_bps","notice" }

// LedgerTotals
{ "contract_weeks","counted_weeks","budget_cents","spent_cents","saved_cents",
  "income_cents","realized_cents","current_week_start" }

// LedgerProgress
{ "over_budget","budget_used_bps","counted_weeks","contract_weeks","message" }

// LedgerEntry —— domain/ledger.ts#toLedgerEntryDto；type 是接口词表，库内列是 entry_kind
{ "id","wish_id","week_start","type":"expense|earning","amount_cents","amount_yuan",
  "note","proof_id","task_id","server_ts","created_at" }
```

`amount_yuan = floor(amount_cents / 100)`，仅展示用，所有计算仍以整数分为准。`progress_bps` 为支出/预算的万分比，封顶 10000；预算为 0 且有支出时记 10000。`notice` 在超预算时给出「结余按 0 计」的提示。

**一致性与幂等**：预算修改用 `updated_at` 作单行 CAS 令牌，命中 0 行重读重试；同一预算值的并发重放视为成功，其余冲突 409 `ledger_week_conflict`。流水追加与预算修改都支持 `Idempotency-Key`；同键同内容字节级重放，同键不同内容 409。所有写操作成功都推进 `wishes.version`。

#### 0.1.5 结算、两幕结果与续期（第 6 轮，3 条）

| 方法 · 路径 | 鉴权 | `operation` / `idempotent` / `maxBodyBytes` | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/wishes/:id/settle` | Bearer | `wish.settle` / **optional** / 512 | path `id` = 愿签 uuid；请求体 `{}`（不读取业务字段，需 `content-type: application/json`） | `{ settlement: SettlementView, already_settled:bool }`；已 `settled` 时直接回最新快照 + `already_settled:true`，不重算 | `invalid_parameter`(400，id 非 UUID) `wish_not_active`(400 + `details.status`) `settle_too_early`(400 + `end_date/settle_open_at/seconds_remaining`) `wish_forbidden`(403) `wish_not_found`(404) `settlement_in_progress`(409 + `retryAfterSeconds:2`) `wish_state_conflict`(409) `settlement_missing`(409) `settlement_conflict`(409) `reward_pool_empty`(503) `idempotency_key_reuse`(409) |
| `GET /api/wishes/:id/settlement` | Bearer | `wish.settlement` / none / 0 | path `id` = 愿签 uuid | `SettlementView`（**直接是 data 顶层，不再包一层**）；第一幕与第二幕同时返回；未结算时不返回任何礼物字段 | `invalid_parameter`(400) `wish_forbidden`(403) `wish_not_found`(404) `wish_not_settled`(400 + `details.status`) `settlement_missing`(409) |
| `POST /api/wishes/:id/extend` | Bearer | `wish.extend` / **optional** / 512 | path `id` = 愿签 uuid；请求体 `{}`（**不接受时长/模式入参**，固定 +7 天） | `{ wish:WishDetail(status:"active"), new_end_date, added_tasks:int, makeup_tickets:int, settle_open_at }`；`added_tasks` 只数新增天数，`makeup_tickets` 是本次补发的自然周券数 | `invalid_parameter`(400) `wish_not_settled`(400 + `details.status`) `extend_not_allowed`(400 + `details.outcome`，double_realized) `extend_limit_reached`(400 + `details.renew_count`) `wish_forbidden`(403) `wish_not_found`(404) `wish_state_conflict`(409) `idempotency_key_reuse`(409) |

**触发结算（`domain/settlement.ts#settleWish`）**

1. `requireAuthor` → 非作者 403；URL id 非 UUID 400。
2. 状态：`settled` 直接返回最新快照（`already_settled:true`）；`settling` 已有快照则补收尾并返回，无快照且租约未过（60 秒）→ 409 `settlement_in_progress`；`draft/archived` → 400 `wish_not_active`。
3. 时间门禁：`now < settleOpenAt(end_date)` → 400 `settle_too_early`，`details.settle_open_at` 是 `<end_date>T20:00:00.000Z`，`seconds_remaining` 向上取整；恰好到点（`>=`）即放行。
4. 先扫 `pending AND task_date < today → missed`，再统计必做/钱任务；`readLedger` 取累计兑现；解密 q5 定类别；读 `rewards` 匹配。
5. `active→settling` 用 `status + version` 单行 CAS（并发只有一个命中）；快照 `insertIfAbsent(wish_id, version)` 先落库，再 `settling→settled`。同一愿签首次结算写 `version = 1`，续期后重结算写 `version = 2`。

**三档结局（全部确定性代码，不调用 AI）**

- `double_realized` 双重兑现：所有必做任务 `done/made_up`，且所有钱任务 `done/made_up` → `stamped:true`，完整礼物彩蛋。
- `cyber_only` 赛博实现：必做全完成，但存在钱任务未完成 → `stamped:true`，第二幕仍按实际累计兑现匹配；文案走「未拆的信」，并开放续期。
- `unrealized` 未实现：存在必做任务 `missed` → `stamped:false`，提供续期/降档提示；同样按实际累计兑现匹配。

**金额（全部整数分，复用第 5 轮账本）**

- 累计节省 `saved_cents` = Σ 已计入周的 `max(0, budget_cents − spent_cents)`。
- 累计收入 `earned_cents` = Σ 已确认兼职收入。
- 累计兑现 `realized_cents = saved_cents + earned_cents`，直接取 `readLedger(...).totals`，结算不另写加总；快照后金额不再随新流水变化。

**礼物匹配与差额档位**

- 类别由 `wish_type` + q5 解密文本共同确定（健康/陪伴/生活/心意）；q5 关键词零命中或解密失败时退回愿望类型映射。
- 候选 = 该类别 `is_active` 且 `min_cents ≤ realized_cents` 的礼物；q5 点名的礼物在候选内优先，否则取 `max_cents` 最大的一件（同价取 `min_cents` 更大者）。
- 差额以**价格中位数** `median = floor((min_cents + max_cents) / 2)` 为基准：`gap_cents = max(0, median − realized_cents)`，`gap_bps = floor(gap × 10000 / median)`。
- 档位：`gap_bps ≤ 1000` → `exact`「刚好够」；`≤ 3000` → `near`「差一点」＋具体差额与攒钱建议；`> 3000` → `far`「未拆的信」，并**强制改用类别内最低价礼物**重新计算差额。
- 类别内无任何 `is_active` 礼物 → 503 `reward_pool_empty`（种子未导入）。

**`SettlementView`（出参唯一投影，禁止整行转 JSON）**

```jsonc
{
  "wish_id", "settlement_version", "status":"settled",
  "first_act": {
    "outcome":"double_realized|cyber_only|unrealized", "outcome_label":"双重兑现|赛博实现|未实现",
    "stamped": true, "settled_at", "progress_ratio_bps",
    "tasks": { "must_total","must_done","money_total","money_done","checkin_count","makeup_count",
               "must_bps","money_bps","total","done" },
    "task_details": [ { "id","day_index","task_date","type":"ta|self|money","title","status","is_must" } ]
  },
  "second_act": {
    "realized_cents","realized_yuan","saved_cents","earned_cents",
    "gift": { "id","category","title","note","min_cents","max_cents","min_yuan","max_yuan",
              "price_median_cents","price_median_yuan" } | null,
    "gap_cents","gap_yuan","gap_band":"exact|near|far","gap_band_label",
    "copy_text","letter_text"
  },
  "extension": { "can_extend":bool, "renew_count":int, "extend_days":7, "reason":string }
}
```

`first_act.tasks` 的计数来自结算快照（冻结）；`task_details` 读取时从 `tasks` 现取，只作展示。`extension.can_extend = outcome !== "double_realized" && renew_count < 1`。

**续期（`domain/settlement.ts#extendWish`）**

- 仅 `settled` 且结局为 `cyber_only/unrealized`；`double_realized` → 400 `extend_not_allowed`；**先判 `renew_count`**，已续过一次 → 400 `extend_limit_reached`（续期后状态回 active，第二次调用也能得到准确提示）。
- `.eq('status','settled').eq('renew_count',0)` 单行 CAS，并发只有一个成功；成功后 `end_date +7 天`、`days` 重算、`renew_count=1`、`extend_mode='extend_7d'`、清空旧 `outcome/settled_at`、`version+1`。
- 新增任务按原 `start_date` 重算计划，派生 id 自动跳过已有天数，`insertIfAbsent` 只补新增行；补发从旧截止日次日到新截止日之间每个自然周一张补卡券（`insertIfAbsent` 幂等）。
- 再次结算从 `version = max+1` 写新快照；`GET .../settlement` 始终返回最新版本。

**边界与红线**

- 结算前 `GET .../settlement` → 400 `wish_not_settled`，响应体不含 `gift/reward/gap_cents/价格` 等任何礼物字段；账本与详情接口同样不读 `rewards`。
- 重复结算不是错误：200 + `already_settled:true`，快照不变；只有并发窗口才可能 409 `settlement_in_progress`。
- 设计稿的 `POST /api/settlements/:id/ack`（第一幕盖章/第二幕展开）、`PATCH .../letter`、`PUT .../assets` **未实现**；`sealed/sealed_at/revealed_at` 三列恒 `false/null/null`，两幕在 `settled` 后由同一 GET 一起返回（见 §0.2）。

#### 0.1.6 文件上传（第 7 轮，3 条）

| 方法 · 路径 | 鉴权 | `operation` / `idempotent` / `maxBodyBytes` | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/uploads/presign` | Bearer | `upload.presign` / **none** / 1024 | `{ purpose:"checkin_proof"\|"ledger_proof"\|"share_image", mime_type:"image/jpeg"\|"image/png"\|"image/webp", filename(1..128), size_bytes?≥1, wish_id?uuid }` | **201** `{ file:File, file_id, upload_url, upload_method:"PUT", required_headers:{"content-type":mime}, expires_at（now + 2h）, max_bytes:204800, allowed_mime_types:[...] }`；`upload_url` 是对象存储的短时 PUT 能力，服务端**不保存** | `invalid_parameter`(400 + `details.fields`) `purpose_unsupported`(400 + `details.allowed`) `mime_type_unsupported`(400 + `details.allowed`) `file_too_large`(400 + `details.max_bytes`) `wish_forbidden`(403) `upload_rate_limited`(429 + `retry-after`，`UPLOAD_PER_HOUR` 默认 30) `storage_unavailable`(503) |
| `POST /api/uploads/complete` | Bearer | `upload.complete` / **optional** / 512 | `{ file_id:uuid }` | `{ file:File, file_id }`；`status` 由 `pending` CAS 为 `ready`；已 ready 重放返回同一行 | `file_not_found`(404) `file_forbidden`(403) `file_not_ready`(400 + `details.status`，行已是 rejected/deleted/expired) `upload_expired`(400 + `details.expires_at`，超过 2h 时顺手标 `expired`) `upload_pending`(400，对象不存在或 CAS 刚被改) `verification_failed`(400，空文件/文件头与声明 MIME 不符) `file_too_large`(400，实测超 200KB) `storage_unavailable`(503) `idempotency_key_reuse`(409) |
| `POST /api/uploads/:id/url` | Bearer | `upload.url` / **none** / 256 | path `id` = 文件 uuid | `{ file_id, url, expires_in:600 }`；只对本人、`status='ready'` 的文件签发 600s GET URL；重复调用只是重新签发 | `invalid_parameter`(400，id 非 UUID) `file_forbidden`(403，含越权) `file_not_found`(404) `file_not_ready`(400 + `details.status`) `storage_unavailable`(503) |

**两段式直传**：`presign` 先在 `files` 插 `pending` 行（`object_key = u/<userId>/<purpose>/<fileId>.<ext>`，服务端派生），再向对象存储要 PUT URL；浏览器按 `required_headers.content-type` 直传；`complete` 用 `storage.download` 读回对象，**边读边数真实字节**（声明大小只用于 presign 早退）、校验 magic bytes 与声明 MIME 一致、15 秒超时，通过后 `sha256` 落库并 CAS `pending→ready`；格式不符写 `rejected`。业务接口（打卡/账本）只认 `ready` + 正确 `purpose` + 归属一致的文件。

**pending 失效（第 9 轮补齐）**：`files.expires_at = presign 时刻 + 2 小时`。`complete` 发现已过期时先把 `pending` 行标 `expired` 再返回 400 `upload_expired`；每次新 `presign` 也会在限流计数前把**本人**已超时的 `pending` 行批量标 `expired`，避免用户放弃直传后永久占位。平台没有 cron，这是链路上的惰性清扫，不做后台批处理。

**签名 URL 纪律**：`upload_url` 与 `url` 都是短时能力，**不入库、不进日志**；因此 `presign` 与 `url` 两条接口是 `idempotent:'none'`（重试生成新的 pending 行或重新签发，不追求字节级重放）。私有桶 + 600s GET URL，没有公开读路径。

```jsonc
// File —— domain/upload.ts#toFileDto；sha256 与 object_key 只在库内
{ "id","purpose","status":"pending|ready|rejected|expired|deleted","mime_type","size_bytes",
  "wish_id","created_at","verified_at" }
```

#### 0.1.7 分享（第 7 轮，3 条）

| 方法 · 路径 | 鉴权 | `operation` / `idempotent` / `maxBodyBytes` | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/wishes/:id/share` | Bearer | `wish.share` / **optional** / 256 | path `id` = 愿签 uuid；body `{}` | **201** `{ share:{ token, url:"<origin>/s/<token>", api_path:"/api/s/<token>", status:"active", visits, created_at, revoked_at } }`；**同一愿签重复调用轮换 token，旧链接立即失效** | `invalid_parameter`(400) `share_not_before_sign`(400 + `details.status`，draft 不可分享) `wish_forbidden`(403) `wish_not_found`(404) `share_conflict`(409) `idempotency_key_reuse`(409) |
| `DELETE /api/wishes/:id/share` | Bearer | `share.revoke` / none / 0 | path `id` = 愿签 uuid | `{ share:{ status:"revoked", revoked_at, token } }`；重复撤销幂等返回当前行 | `invalid_parameter`(400) `wish_forbidden`(403) `wish_not_found`(404) `share_not_found`(404，从未生成) `share_conflict`(409) |
| `GET /api/s/:token` | 否 | `share.view` / none / 0 | path `token`（`[A-Za-z0-9_-]{16,32}`，`shortToken(16)` = 26 字符） | `{ wish:{ title, wish_text, summary, relation, relation_group, wish_type, status, outcome, outcome_label, start_date, end_date, day_index, settled_at }, share:{ status:"active", visits } }`；每次成功打开 `visits+1` | `share_not_found`(404，不存在/token 形状不对/已轮换/愿签状态不可分享) `share_revoked`(404，已撤销) |

**分享红线**：白名单投影只含上列字段——**没有五问答案、账本明细、礼物/金额、文件或签名 URL、昵称、`user_id`/`author_id`**。`outcome` 只在 `settled` 后出现，其余状态回空串；`day_index` 按产品日现算并夹在 `1..days`。`summary` 是标题经 `toExcerpt` 脱敏后的摘要。

#### 0.1.8 公开池（第 7 轮，5 条）

| 方法 · 路径 | 鉴权 | `operation` / `idempotent` / `maxBodyBytes` | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/pool` | 否 | `pool.list` / none / 0 | query `category?`（六类）、`sort?`（只接受 `latest`）、`limit?`1..50（默认 20）、`cursor?` | `{ items:[PoolPost], next_cursor, has_more, limit }`；只含 `published` 且 `is_demo=false`，`published_at` 倒序 | `invalid_parameter`(400 + `details.fields`，category/sort 不支持) `invalid_cursor`(400) |
| `POST /api/pool/publish` | Bearer | `pool.publish` / **optional** / 1024 | `{ wish_id:uuid, category(六类), is_anonymous?=true, excerpt?≤120 }` | **201** 首次 `{ post:PoolPost }`；同一愿签重复发布返回 **200** + 原帖（不重复计数） | `invalid_parameter`(400) `wish_not_settled`(400 + `details.status`) `pool_hidden`(400，已隐藏不可重发) `wish_forbidden`(403) `wish_not_found`(404) `publish_quota_exceeded`(429 + `retry-after`，`POOL_PUBLISH_PER_DAY` 默认 5) `pool_conflict`(409) `idempotency_key_reuse`(409) |
| `GET /api/pool/:id` | 否 | `pool.detail` / none / 0 | path `id` = 帖子 uuid | `{ post: PoolPost(+实时 reply_count) }` | `invalid_parameter`(400) `pool_hidden`(404，hidden/deleted/不存在) |
| `POST /api/pool/:id/report` | Bearer | `pool.report` / **optional** / 1024 | `{ reason_code:"privacy"\|"harassment"\|"illegal"\|"spam"\|"sexual"\|"other", detail?1..200 }` | **201** `{ report:{ id, status:"open"\|"acted", reason_code, created_at }, target:{ hidden, report_count } }` | `invalid_parameter`(400) `pool_hidden`(404) `report_duplicate`(409) `report_rate_limited`(429 + `retry-after`，`POOL_REPORT_PER_HOUR` 默认 20) `idempotency_key_reuse`(409) |
| `POST /api/pool/:id/unpublish` | Bearer | `pool.unpublish` / **optional** / 256 | path `id` = 帖子 uuid；body `{}` | `{ post:{ id, status:"deleted", deleted_at } }`；重复下架幂等 | `invalid_parameter`(400) `not_post_author`(403) `pool_not_found`(404) `idempotency_key_reuse`(409) |

**发布即公开，无人工审核**：`publish` 要求愿签 `settled`，`UNIQUE(wish_id)` 保证一愿签一帖；`excerpt` 缺省时从标题/原文经 `toExcerpt` 脱敏到 ≤120 字，空结果兜底「一个没有说出口的愿望」；`display_label` 固定为 `匿名搭子` / `许愿人`，真名永不出现。**举报阈值**：同一用户对同一目标只算一次（`UNIQUE(target_type,target_id,reporter_id)`），计数达到 `POOL_REPORT_HIDE_THRESHOLD`（默认 3）时用 `status='published'` CAS 自动 `hidden`，同批把 open 报告标 `acted/auto_hidden`；隐藏后列表/详情/回信一律 404 `pool_hidden`。

```jsonc
// PoolPost —— domain/pool.ts#toPoolPostDto；永不含 author_id / wish_id / 五问 / 账本 / 文件
{ "id","status":"published|hidden|deleted","category","wish_type","relation","excerpt",
  "display_label","is_anonymous","reply_count","published_at" }
```

#### 0.1.9 回信（第 7 轮，3 条）

| 方法 · 路径 | 鉴权 | `operation` / `idempotent` / `maxBodyBytes` | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/pool/:id/replies` | Bearer | `reply.create` / **optional** / 512 | `{ content(必填，1..80 字) }` | **201** `{ reply:{ id, content, display_label:"打气搭子", created_at }, post:{ reply_count }, quota:{ daily_remaining } }`；即时发布 | `invalid_parameter`(400) `content_too_long`(400 + `details.max_length:80`) `sensitive_content`(400) `replies_disabled`(400) `pool_hidden`(404) `reply_daily_limit`(409，同帖每天一条) `reply_rate_limited`(429 + `retry-after`，`REPLY_PER_DAY` 默认 20) `reply_conflict`(409) `idempotency_key_reuse`(409) |
| `GET /api/pool/:id/replies` | 否 | `reply.list` / none / 0 | path `id` = 帖子 uuid；query `limit?`1..50（默认 20）、`cursor?` | `{ items:[{ id, content, display_label:"打气搭子", created_at }], next_cursor, has_more, limit }`；只含 `published`，`created_at` 倒序 | `invalid_parameter`(400) `invalid_cursor`(400) `pool_hidden`(404) |
| `DELETE /api/replies/:id` | Bearer | `reply.delete` / none / 0 | path `id` = 回信 uuid | `{ reply_id, status:"deleted", deleted_at }`；**回信作者或帖主**可删，重复删除幂等 | `invalid_parameter`(400) `not_reply_owner`(403) `reply_not_found`(404) |

**回信口径**：内容先过 `lib/sensitive.ts#containsSensitive`（手机号/证件号/外链/微信 QQ/引流词），命中 400；愿签作者关了回信（`wishes.replies_enabled=false`）→ 400 `replies_disabled`；两道日限：全站每人每天 `REPLY_PER_DAY`，同帖每人每天一条（**时间窗查询实现，无唯一约束**，并发下可能多一条，见 02 §11 / 03 §9）。回信数 `post.reply_count` 写后尽力刷新，详情读取时实时统计 `published` 回信，不把派生列当真值。

#### 0.1.10 AI 辅助（第 8 轮，1 条）

| 方法 · 路径 | 鉴权 | `operation` / `idempotent` / `maxBodyBytes` | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/ai/polish-wish` | Bearer（**仅真实账号**） | `ai.polish` / **optional** / 2048 | `{ wish_text(必填 1..120 字), relation?∈12 种关系（默认「一个陌生人」）, wish_type?∈六类（缺省由关键词分类） }` | `{ ai_assisted:true, ai_label:"AI辅助", label_required:true, capability:"polish_wish", suggestions:[{ id:"s1".."s3", text≤60, label:"AI辅助" }×3], source:"agent"\|"template", fallback:bool, fallback_reason:""\|"timeout"\|"agent_error"\|"invalid_output"\|"quota_exceeded", model, cached:bool, input_redacted:bool, quota:{ daily_limit, used, remaining }, notice }` | `invalid_parameter`(400 + `details.fields`) `invalid_token`/`token_expired`/`token_revoked`(401) `demo_forbidden`(403，演示 token 不触发真实 AI) `idempotency_key_reuse`(409) `ai_template_invalid`(503，仅兜底模板被改坏时) |

**AI 口径（第 8 轮已落地）**：
- **只建议、不代写**：本接口不写 `wishes` / `wish_answers`；用户点选后仍由愿签编辑接口写入。响应顶层 `ai_label` 与每条 `suggestions[].label` 都是 `"AI辅助"`，`label_required:true` 要求前端展示时保留标签。
- **适配器**：`domain/ai.ts#resolveAiAdapter` 优先测试注入 → `AI_AGENT_ENDPOINT`（Qoder Cloud Agents 兼容端点）→ 模板。未配置端点时永远走模板，不发起外部请求；本地与比赛演示无需外部服务。
- **输入脱敏**：`wish_text` 先过 `redactSensitive`（手机号/证件/外链/邮箱/微信 QQ/门牌地址→`***`，并抹掉 ≥6 位连续数字），模型只看到脱敏文本；`input_redacted` 表示本次确实发生了替换。
- **输出校验**：恰好 3 条、每条 1..60 字、无联系方式/链接、互不重复；不合格整批丢弃并回退模板（`fallback_reason:"invalid_output"`）。
- **兜底不阻塞**：超时（`AI_TIMEOUT_MS`，默认 8s）、调用失败、额度耗尽都返回 **200** + 模板 3 条，`fallback:true` + `fallback_reason`；不返回 5xx。额度耗尽不是 429，主流程继续可走。
- **配额与缓存**：`quota.used` 只统计当日 `source='agent'` 的缓存行，模板兜底不消耗额度；默认 `AI_POLISH_PER_DAY=20`。相同用户 + 相同能力 + 相同脱敏输入 + 关系 + 类型命中 `ai_suggestions` 缓存，`cached:true` 且不重复调用/计费；缓存 TTL `AI_CACHE_TTL_HOURS`（默认 72h），过期行惰性删除。
- **扩展位**：`suggestTaskCandidates` / `draftReply` / `draftLetter` 已在 `domain/ai.ts` 留统一入口，当前抛 503 `ai_capability_not_implemented`，本轮没有对应路由。

#### 0.1.11 演示模式（第 8 轮，5 条）

| 方法 · 路径 | 鉴权 | `operation` / `idempotent` / `maxBodyBytes` | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/demo/session` | 否 | `demo.session` / **none** / 512 | 无（可传空 body） | **201** `{ session:{ demo_session_id, access_token, token_type:"Bearer", expires_at, expires_in_seconds:86400 }, user:{ is_demo:true, … }, persona:{ relation:"妈妈", pronoun:"she", wish_text, preset:"第 3 天进度 · 2 条打卡记录 · 账本累计 168 元", label }, state:DemoState }` | `demo_too_many_sessions`(429 + `retry-after`，`DEMO_PER_HOUR` 默认 30) `demo_session_unavailable`(409) `demo_seed_incomplete`(409) `task_pool_empty`/`reward_pool_empty`(503，种子未导入) |
| `GET /api/demo/state` | Bearer（**演示 token**） | `demo.state` / none / 0 | — | `DemoState`：`{ demo:{ session_id, scenario, mode, step, ttl_hours, expires_at, is_completed, server_now }, persona, wish:WishDto, progress:{ current_day, days, total_tasks, done_tasks, must_total, must_done, missed_tasks, checkin_count, progress_bps }, today_tasks:[TaskDto], tasks:[TaskDto], ledger:LedgerView\|null, settlement:SettlementView\|null, settle_open_at }` | `invalid_token`/`token_expired`(401) `demo_session_expired`(401) `demo_required`(403，真实 token) `demo_session_missing`(404) `demo_wish_missing`(404) |
| `POST /api/demo/fast-forward` | 演示 token | `demo.fast_forward` / **optional** / 512 | 无（可传空 body） | `{ state:DemoState, settlement:SettlementView }`；补齐 7 天任务与账本后调用真实 `settleWish`，满勤 → `double_realized` | `demo_required`(403) `demo_session_expired`(401) `demo_session_busy`(409，CAS 抢不到) `task_pool_empty`/`reward_pool_empty`(503) |
| `POST /api/demo/scenario` | 演示 token | `demo.scenario` / **optional** / 512 | `{ outcome:"double_realized"\|"cyber_only"\|"failed" }` | `{ state:DemoState, settlement:SettlementView }`；三档每次都清演示子表后用真实任务/账本/结算引擎重放 | `invalid_parameter`(400) `demo_required`(403) `demo_session_expired`(401) `demo_session_busy`(409) |
| `POST /api/demo/reset` | 演示 token | `demo.reset` / **optional** / 512 | 无（可传空 body） | `DemoState`；回到第 3 天 / 2 条打卡 / 168 元基线，旧结算快照清空 | `demo_required`(403) `demo_session_expired`(401) `demo_session_busy`(409) |

**演示隔离与复用口径（第 8 轮已落地）**：
- **物理隔离**：演示数据全部挂在 `users.is_demo=true` 的账号上，`demo_sessions` 一行一账号（`UNIQUE(user_id)`）；真实账号靠 `principal.userId` 过滤，天然读不到演示愿签。演示 token 由 `auth_tokens.demo=true` 标记，只用于演示命名空间。
- **功能隔离**：AI、分享生成、公开池发布/回信/举报等真实写接口统一 `requireRealUser`，演示 token 一律 403 `demo_forbidden`；演示接口统一 `requireDemoUser`，真实 token 一律 403 `demo_required`。普通用户路径没有演示入口。
- **逻辑 100% 复用**：预置数据、快进与三档结局都调用真实 `signContract` / `checkinTask` / `addLedgerEntry` / `settleWish`；演示编排只负责把契约时钟前移（基线 `now−2d`，快进/切结局 `now−8d`）与清理演示子表，不改任务抽取、金额、礼物匹配或结局判定。冒烟直接比对结算统计与 `tasks` 行统计一致。
- **一致性**：会话重建/切换用 `demo_sessions.updated_at` 单行 CAS，抢不到 409 `demo_session_busy`；TTL 走 `DEMO_TTL_HOURS`（默认 24h，同时控制演示 JWT）；过期会话在下次创建时惰性清理：只清**本 IP、最早到期的 3 条**，逐条确认 `is_demo` 后才删子表/愿签/文件/token/会话行/账号，无定时任务与触发器。
- **三档映射**：`double_realized` = 7 天全勤 + 钱任务完成 + 收入入账；`cyber_only` = 必做全勤、钱任务留空；`failed` = 只完成前 5 天，后 2 天必做缺失 → 真实引擎判 `unrealized`。

#### 0.1.12 第 9 轮安全加固（无新增路由，契约向后兼容）

| 项 | 行为 | 影响面 |
| --- | --- | --- |
| 统一安全响应头 | 所有 JSON 响应固定带 `x-content-type-options: nosniff`、`x-frame-options: DENY`、`content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`、`referrer-policy: no-referrer`、`permissions-policy`、`strict-transport-security`、`cache-control: no-store` | 全部接口 |
| 405 `Allow` | 方法不支持时 `Allow` 头列出该路径允许的方法（与 `details.allowed` 同源） | 全部接口 |
| 服务层兜底限流 | `API_PER_MINUTE`（默认 1200/分钟）按主体（用户 / IP 摘要 / anon）在实例内存计数，超限 429 `api_rate_limited` + `Retry-After`；`/api/health*` 不参与，避免监控被挡 | 全部业务接口；与既有业务阈值叠加 |
| 输入清洗 | `validate.ts` 去掉 C0/C1 控制字符（保留 `\t \n \r`）后再做长度与枚举校验；未声明字段一律忽略 | 所有写接口 |
| 上传 pending 失效 | presign 后 2 小时未 complete → `expired`（惰性清扫 + `complete` 兜底），400 `upload_expired` | 上传 |
| 演示会话清理 | 每次创建演示会话时只清本 IP 最早 3 条过期会话 | 演示 |
| 异常兜底 | 未预期异常统一 500 `internal_error` + requestId；堆栈与数据库错误只进日志，响应不含内部路径/SQL/约束名 | 全部接口 |
| 加密与签名 URL | 五问 AES-256-GCM（AAD=`wish_id`）、恢复码只存 HMAC；签名 URL 600s、不入库不进日志；公开/分享 DTO 白名单不变 | 全部接口 |

**并发边界（重复收入）**：`ledger_entries` 的「一条钱任务最多一笔收入」目前是**先查后插**。同一 `task_id` 的并发双请求可能都通过检查，各写一行；客户端 `Idempotency-Key` 能挡住重试，但挡不住两个不同 key 的并发。根治方案：后续迁移新增「收入占用」表（`wish_id + task_id` 表级 `UNIQUE`，插入成功才写流水）或给 `ledger_entries` 补列级唯一键，再配合单行 CAS。当前读取按 `task_id` 去重统计的口径**未启用**，因此并发重复会重复计入——这是已知边界，不是静默兜底。

### 0.2 第 1 轮设计稿中已被取代的接口

| 设计稿 | 取代方式 |
| --- | --- |
| `POST /api/auth/refresh` | 不做 refresh token、不做滑动续期。30 天到期 → 用恢复码走 `POST /api/auth/recover`，换发新 `jti` 并轮换恢复码（02 §5） |
| `POST /api/auth/signout` | 改名 `POST /api/auth/logout`，并用 `all_devices` 覆盖"退出所有设备" |
| `GET /api/auth/tokens` / `DELETE /api/auth/tokens/:tokenId` | 本轮只回 `device_count`（不暴露 token 行）；设备级撤销改由 `logout + all_devices` 或恢复码找回完成，设备列表后续轮再补 |
| `GET /api/health` 的 `dbConfigured/storageConfigured/aiConfigured` | 拆成 `GET /api/health`（不碰依赖）+ `GET /api/health/deep`（真查库）；密钥缺失统一在装载期抛 `ConfigError` → 503 `service_not_configured` |
| `POST /api/auth/guest` 的 `token:"vt1_..."` / `isFirstAccount` | 令牌是自签 HS256 JWT（三段式），字段名 `access_token`；复用标记改叫 `is_new`，且只在演示分支出现 |
| `GET /api/meta`、`GET /api/meta/wish-templates`、`POST /api/meta/wish-templates/next` | 未实现；词表目前只存在于迁移注释与 seed JSON（03 §6），实现时 `relations` 直接给中文原值 |
| `GET /api/me` 的 `activeWish/today/unreadCount/pool/features` | 本轮只回 `user + session`，其余分片随愿签/打卡/通知接口在后续轮补 |
| 出参 DTO 的 camelCase（`displayName`、`relationCode`、`taskType`…） | 全量改为 snake_case 且与列同名（02 §1）：`displayName`→`nickname`、`relationCode`→`relation`、`taskType`→`type`（库内列仍叫 `side`，映射只在 `toTaskDto`）、`proofHint`→`proof_kind`、帖子的 `category`→`wish_type` |
| §5 `POST /api/wishes` 的 `targetName/wishText/wishTemplateId/days` 与 `already_active_wish` | 入参改 `nickname/wish_text`，**创建时不接收 `days`**（天数在立契时才定），模板选择接口未实现；本轮**允许同时存在多个草稿与多个进行中愿签**，不做「只能有一个 active」限制 |
| §5 `POST /api/wishes` 的 `wish_text_required` / `relation_unsupported` / `classification:{matched,fallback}` | 参数错误统一 400 `invalid_parameter` + `details.fields`（02 §4）；分类结果只出 `wish_type` + `classifier_type` + `classifier_confidence_bps`，不回命中词表 |
| §5 `PATCH /api/wishes/:id`、`DELETE /api/wishes/:id` | 未实现。草稿修改目前只有五问走 `PUT .../answers`；关系/称呼/原文的改写与草稿软删后续轮再补 |
| §5 `GET /api/wishes/:wishId/answers` | 未实现（**唯一解密出口**，与打卡/结算同轮做）；本轮 `PUT` 不回显答案，`GET /api/wishes/:id` 也不含密文 |
| §5 `PUT .../answers` 的嵌套 `answers:{q1:{value\|skip}}` + `healthConsent` + `answersMeta.derived` | 改为**扁平** `{q1?…q5?}`（text 1..200），不支持 skip（不提交即保持原值）；出参是 `{answered, five_questions_done, completed_at, updated_at, encrypted_stored}`。q4 明文在保存时确定性归一为 `q4_disposable_band`（仅档位，不含原文），第 5 轮据此推算首周预算 |
| §5 `POST .../contract` 的 `signMethod/signatureFileId/contractVersion/confirm` 与 `makeupTickets` | 入参只有 `{days?}`；立契方式与签名图属后续轮（列已就位）。补卡券已在第 4 轮接入：首周券随签署发放并以 `makeup_ticket` 返回（不叫 `makeupTickets`） |
| §5 `POST .../contract` 的 `already_signed`(409) / `recoveryCode?` | 重复签署**幂等返回 200** + `first_sign:false`（不是错误）；恢复码复用账号全局那一个，只回 `recovery_code_notice` 文案 |
| §5 `GET /api/wishes` 的 `status?` 过滤与 `limit≤50` | 本轮不支持 `status` 过滤；`limit` 上限 100、默认 20，游标字段名 `next_cursor`/`has_more` |
| §5 `GET /api/wishes/:wishId` 的 `tasksPreview/makeup/ledger/settlement/share/pool` 分片 | 本轮只回 `{wish}`；今日任务与补卡券改由 `GET /api/wishes/:id/tasks/today` 提供（§0.1.3），账本改由 `GET /api/wishes/:id/ledger` 提供（§0.1.4），结算改由 `GET /api/wishes/:id/settlement` 提供（§0.1.5），其余分片随对应模块在后续轮补 |
| §6 的 `GET .../tasks/today`、`POST /api/tasks/:taskId/checkin`、`POST /api/tasks/:taskId/makeup` | 已在第 4 轮实现，真实契约见 §0.1.3（路径参数统一 `:id`）；§6 其余 5 条（任务列表、任务详情、撤销打卡、离线同步、券列表）仍未实现 |
| §8 的 `GET/PUT/POST` 三条账本接口 | 已在第 5 轮实现，真实契约见 §0.1.4：读接口改为 `GET /api/wishes/:id/ledger` + query `week_start`；两条写接口路径不含愿签，body 必填 `wish_id`；`PUT` 只改预算，不再接收 `spentCents/proofFileId/note`；`POST` 用 `type:"expense|earning"`，收入 `proof_id` 可选、`task_id` 必填 |
| §8 的 `DELETE /api/ledger/entries/:entryId` | 未实现。第 5 轮明确「流水只追加、不可修改」，撤销接口留到后续轮（表内已有 `revoked_at` 列，读路径已按未撤销过滤） |
| §9 的 6 条结算接口 | 第 6 轮实现其中 3 条，真实契约见 §0.1.5：`POST .../settle`、`GET .../settlement`、`POST .../extend`。`POST /api/settlements/:id/ack`、`PATCH .../letter`、`PUT .../assets` 未实现；`forceRecalc`、`version?`、`mode/days/confirm` 入参均不再使用 |
| §9 的 `settled` 后分幕展开 | 改为单一 `GET .../settlement` 一次返回两幕，不做 ACK 与 72 小时封印；`sealed` 相关字段保留在表中但恒为 `false/null` |
| §7 的 4 条文件接口 | 第 7 轮实现其中 3 条，真实契约见 §0.1.6：上传改为两段式 `POST /api/uploads/presign` + `POST /api/uploads/complete`（不再是单次 multipart），取址为 `POST /api/uploads/:id/url`（600s 签名 GET）；**`DELETE /api/uploads/:id` 未实现**。`presign`/`url` 为 `idempotent:'none'`（响应含短时签名 URL） |
| §10 的 5 条分享接口 | 第 7 轮实现 3 条，真实契约见 §0.1.7：`POST /api/wishes/:id/share`（生成/轮换）、`DELETE /api/wishes/:id/share`（撤销）、`GET /api/s/:token`（匿名白名单）。分享图生成与访问口令未实现；`visibility` 固定 `link_only`，不支持 `public` 索引 |
| §11 的 7 条公开池接口 | 第 7 轮实现 5 条，真实契约见 §0.1.8：发布/下架路径改为 `POST /api/pool/publish` 与 `POST /api/pool/:id/unpublish`（不是 `/api/wishes/:id/publish`）；`sort` 只接受 `latest`；fork、我的发布列表未实现；举报原因码固定六项 |
| §12 的 5 条回信接口 | 第 7 轮实现 3 条，真实契约见 §0.1.9：发布/列表在 `/api/pool/:id/replies`，删除在 `/api/replies/:id`；无先审后发、无回信举报、无我的回信列表；同帖每天一条靠窗口查询而非唯一约束 |
| §14 的 5 条 AI 接口 | 第 8 轮 P0 只实现 1 条，真实契约见 §0.1.10：`POST /api/ai/polish-wish`。`task-candidates` / `reply-draft` / `letter-draft` 仅在 `domain/ai.ts` 留函数占位（503 `ai_capability_not_implemented`），`GET /api/ai/quota` 未做（额度随润色响应返回）；入参 snake_case，出参全部 snake_case + `ai_label:"AI辅助"`；额度耗尽回退模板而不是 429 |
| §15 的 7 条演示接口 | 第 8 轮实现 5 条，真实契约见 §0.1.11：`POST /api/demo/session`、`GET /api/demo/state`、`POST /api/demo/fast-forward`、`POST /api/demo/scenario`（结局 `failed` 对外、库内 `unrealized`）、`POST /api/demo/reset`。六步引导 `/api/demo/step`、静态场景 `/api/demo/scenario`（与切换结局重名，未采用）未实现；不放 `demoToken:"vt1_"`，直接复用 Bearer JWT（`auth_tokens.demo=true`） |

### 0.3 全局约定速查

#### 0.3.1 基础地址与鉴权

- 物理地址：`{origin}/functions/v1/app` + 逻辑路径，例如 `https://yuan-ta-0ykrktz6t0e.qoder.zone/functions/v1/app/api/health`。
- 只接受真实前缀 `/functions/v1/app`；`/api/...` 直连、其他 Function 前缀、带斜杠变体都会 404。部署后前端只拼一次常量 `API_BASE`。
- 鉴权：`Authorization: Bearer <access_token>`。令牌是自签 HS256 JWT，默认 30 天（`TOKEN_TTL_DAYS`），`auth_tokens.jti` 可即时撤销；**没有 Cookie、没有 refresh token**。到期或撤销后用恢复码 `POST /api/auth/recover` 换新令牌。
- 演示身份用演示 token（24h，`DEMO_TTL_HOURS`）；演示 token 调真实写接口（分享、公开池、AI）统一 403 `demo_forbidden`，真实 token 调演示接口统一 403 `demo_required`。
- 可选请求头：`Idempotency-Key`（UUID，按接口声明 required/optional）、`x-client`（来源端）、`x-demo-session`（仅游客建号复用演示会话）。

#### 0.3.2 响应信封与状态码

成功与失败共用一个信封：

```jsonc
{ "code": 0, "data": { }, "message": "ok", "requestId": "..." }
{ "code": 400, "data": null, "message": "参数不合法。", "requestId": "...",
  "errorCode": "invalid_parameter", "details": { "fields": { "days": "must be one of 7|14|30" } } }
```

`code` 数值等于 HTTP 状态码（成功为 0）；机器分支用 `errorCode`，展示用 `message`，排障用 `requestId`（同时回在 `x-request-id` 头）。201 只用于首次创建资源，幂等重放仍为 200。

| 类别 | 语义 |
| --- | --- |
| 400 | 参数/结构非法，或状态机不允许（`wish_not_draft`、`answers_locked`、`task_not_today` 等） |
| 401 | 未登录、token 无效/过期/撤销、恢复码不符 |
| 403 | 有身份但无权（非作者、演示身份越界、引用别人的任务/图片/帖子/回信） |
| 404 | 路径未登记，或读路径查不到/不可见（不泄露存在性） |
| 405 | 路径存在、方法不支持，带 `Allow` 头 |
| 409 | 并发或重复：幂等键冲突、CAS 撞车、唯一键冲突、重复举报/回信 |
| 413 / 415 | 超过 `maxBodyBytes` / Content-Type 非 JSON |
| 422 | 空改动（`no_op`）或 DB 规则拒绝 |
| 429 | 限流，带 `Retry-After` |
| 500 | 未预期异常，固定文案 + requestId，原始错误只进日志 |
| 503 | 依赖不可用、密钥缺失、内容库/对象存储未就绪 |

#### 0.3.3 errorCode 总表（仅列已实现，按模块分组）

| 模块 | errorCode |
| --- | --- |
| 通用 | `invalid_parameter` `invalid_json` `invalid_body` `invalid_cursor` `invalid_idempotency_key` `payload_too_large` `unsupported_media_type` `route_not_found` `method_not_allowed` `internal_error` `database_unavailable` `service_not_configured` `api_rate_limited` |
| 账号 | `invalid_token` `token_expired` `token_revoked` `invalid_credentials` `account_not_found` `account_unavailable` `demo_forbidden` `demo_required` `guest_too_many_registrations` `auth_too_many_attempts` `demo_too_many_sessions` |
| 幂等/写入 | `idempotency_key_required` `idempotency_key_reuse` `idempotency_in_progress` `idempotency_state_invalid` `duplicate_record` `reference_missing` `validation_failed` `recovery_code_collision` `user_create_failed` `no_op` `not_found` |
| 愿签/契约 | `wish_forbidden` `wish_not_found` `wish_not_draft` `wish_not_active` `answers_locked` `answers_incomplete` `wish_state_conflict` `wish_create_failed` `wish_create_limited` `task_pool_empty` |
| 任务/打卡 | `task_not_found` `task_forbidden` `task_not_today` `task_not_missed` `makeup_required` `already_made_up` `makeup_window_closed` `makeup_ticket_unavailable` `makeup_ticket_expired` `invalid_task_state` `checkin_conflict` `checkin_rate_limited` `task_state_conflict` `proof_not_found` `proof_not_ready` `proof_forbidden` `proof_purpose_mismatch` `proof_wish_mismatch` |
| 账本 | `week_not_in_contract` `week_not_editable` `week_not_started` `earning_task_required` `earning_task_not_done` `earning_week_mismatch` `duplicate_earning_link` `ledger_week_conflict` `ledger_entry_failed` |
| 结算/续期 | `wish_not_settled` `settle_too_early` `settlement_in_progress` `settlement_conflict` `settlement_missing` `extend_not_allowed` `extend_limit_reached` `reward_pool_empty` |
| 上传 | `file_too_large` `mime_type_unsupported` `purpose_unsupported` `upload_pending` `upload_expired` `verification_failed` `file_not_ready` `file_not_found` `file_forbidden` `upload_rate_limited` `storage_unavailable` |
| 分享 | `share_not_before_sign` `share_not_found` `share_revoked` `share_conflict` |
| 公开池 | `pool_not_found` `pool_hidden` `not_post_author` `report_duplicate` `report_rate_limited` `publish_quota_exceeded` `pool_conflict` |
| 回信 | `content_too_long` `sensitive_content` `replies_disabled` `reply_daily_limit` `reply_conflict` `reply_rate_limited` `reply_not_found` `not_reply_owner` |
| AI | `ai_capability_not_implemented` `ai_template_invalid` |
| 演示 | `demo_session_expired` `demo_session_missing` `demo_session_unavailable` `demo_wish_missing` `demo_session_busy` `demo_seed_incomplete` |

含义、HTTP 状态与客户端处理建议以 02 §4 为准；未登记的 `errorCode` 一律展示 `message`。

#### 0.3.4 幂等规则

| 声明 | 接口 |
| --- | --- |
| **required**（不带键 400 `idempotency_key_required`） | `POST /api/wishes` |
| **optional**（带键则重放/冲突检测，不带也执行） | `PATCH /api/me`、`PUT /api/wishes/:id/answers`、`POST /api/wishes/:id/contract`、`POST /api/tasks/:id/checkin`、`POST /api/tasks/:id/makeup`、`PUT /api/ledger/weeks/:weekStart`、`POST /api/ledger/entries`、`POST /api/wishes/:id/settle`、`POST /api/wishes/:id/extend`、`POST /api/uploads/complete`、`POST /api/wishes/:id/share`、`POST /api/pool/publish`、`POST /api/pool/:id/report`、`POST /api/pool/:id/unpublish`、`POST /api/pool/:id/replies`、`POST /api/ai/polish-wish`、`POST /api/demo/fast-forward`、`POST /api/demo/scenario`、`POST /api/demo/reset` |
| **none** | 所有读接口、`POST /api/auth/*`（含签发 token）、`DELETE /api/wishes/:id/share`、`DELETE /api/replies/:id`、`POST /api/uploads/presign`、`POST /api/uploads/:id/url`、`POST /api/demo/session` |

规则：同主体 + 同 operation + 同 key + **同指纹**（method/path/body 的 HMAC）→ 重放首次响应并带 `x-idempotent-replay: true`；同键不同指纹 → 409 `idempotency_key_reuse`；首次请求尚未落定 → 409 `idempotency_in_progress`（60 秒后可接管）。5xx 不写成功存档，同键重试会重新执行。存档保留 7 天，实例冷启动惰性清理。

#### 0.3.5 时间、金额、布尔与枚举

- 产品日固定 Asia/Shanghai，**04:00 为日界**；`product_today`、`task_date`、`checkin_date`、`week_start` 都是 TEXT `YYYY-MM-DD`；其他时间是 UTC ISO（`2026-05-20T06:00:00.000Z`）。
- 自然周从周一开始；`week_start` 必须是周一，否则 400。
- 金额一律**整数分**，字段名以 `_cents` 结尾；没有浮点、没有「元」。周预算默认按五问 q4 档位 2000–20000 分，输入上限 200000 分；单笔支出上限 200000 分，兼职收入 1–100000 分。
- 布尔一律 `true/false`，不接收 `0/1/"yes"`；数组字段（如 `wish_style_tags`）只约束条数与单项长度。
- 枚举白名单：关系 12 种（`妈妈/爸爸/奶奶/爷爷/姥姥/姥爷/室友/闺蜜/兄弟/恋人/老师/一个陌生人`）、愿望六类（`body/sleep/lonely/study/emotion/life`）、契约天数 `7/14/30`、任务类型 `ta/self/money`、任务状态 `pending/done/missed/made_up`、结局 `double_realized/cyber_only/failed`、举报原因 `privacy/harassment/illegal/spam/sexual/other`、上传用途 `checkin_proof/ledger_proof/share_image`。非法值一律 400 `invalid_parameter` + `details.fields`。

#### 0.3.6 限流（全部走环境变量）

| 变量 | 默认 | 维度 | 超限错误码 |
| --- | --- | --- | --- |
| `API_PER_MINUTE` | 1200 | 实例内存，按用户/IP 摘要/anon 每分钟 | `api_rate_limited` |
| `GUEST_PER_HOUR` | 10 | 同 IP / 小时 | `guest_too_many_registrations` |
| `RECOVER_PER_HOUR` | 12 | 同 IP / 小时 | `auth_too_many_attempts` |
| `WISH_CREATE_PER_DAY` | 20 | 同账号 / 产品日 | `wish_create_limited` |
| `CHECKIN_PER_MINUTE` | 10 | 同账号 / 分钟 | `checkin_rate_limited` |
| `UPLOAD_PER_HOUR` | 30 | 同账号 / 小时 | `upload_rate_limited` |
| `DEMO_PER_HOUR` | 30 | 同 IP / 小时 | `demo_too_many_sessions` |
| `POOL_PUBLISH_PER_DAY` | 5 | 同账号 / 产品日 | `publish_quota_exceeded` |
| `POOL_REPORT_PER_HOUR` | 20 | 同账号 / 小时 | `report_rate_limited` |
| `REPLY_PER_DAY` | 20 | 同账号 / 产品日 | `reply_rate_limited` |
| `AI_POLISH_PER_DAY` | 20 | 同账号 / 产品日（只数真实模型调用） | 回模板 `quota_exceeded`（不 429） |

`API_PER_MINUTE` 是服务层兜底，`/api/health*` 不计；多实例部署时实际总阈值 ≈ 单实例阈值 × 实例数。业务阈值依赖数据库窗口计数，单实例扫描上限 50 行，**不要把窗口阈值配到 50 以上**（`AI_POLISH_PER_DAY` 例外）。

#### 0.3.7 安全与隐私

- 五问答案落库为 AES-256-GCM 密文（AAD = `wish_id`），恢复码只存 HMAC；日志与错误响应不打印明文、token、恢复码、签名 URL。
- 对象存储为私有桶；读取一律 600 秒签名 URL，`upload_url` / `url` 不入库、不进日志；presign 后 2 小时未确认的 `pending` 文件惰性标 `expired`。
- 公开出口（`GET /api/s/:token`、`GET /api/pool*`）只做字段白名单投影：无五问、无账本、无礼物/金额、无文件、无 `user_id`/`author_id`/昵称。
- 所有 JSON 响应带 `nosniff` / `frame-ancestors 'none'` / CSP / `no-store` / HSTS；输入统一去控制字符；未知字段忽略；数据库错误映射为安全文案（不回 SQL、约束名、内部路径）。
- 「AI辅助」由服务端强制返回（`ai_label`、`label_required:true`、每条建议 `label`），前端必须原样展示。

### 0.4 分模块 curl 示例

以下用变量简化：`BASE=https://<site>/functions/v1/app`、`TOKEN=<access_token>`、`WISH_ID=<uuid>`、`TASK_ID=<uuid>`、`FILE_ID=<uuid>`、`POST_ID=<uuid>`、`REPLY_ID=<uuid>`。写接口的 `Idempotency-Key` 用 `$(uuidgen)` 或任意 UUID。

**系统与账号**

```bash
curl -s "$BASE/api/health"
curl -s "$BASE/api/health/deep"

curl -s -X POST "$BASE/api/auth/guest" -H 'content-type: application/json' \
  -H 'x-client: h5' -d '{"nickname":"小满","channel":"other"}'

curl -s -X POST "$BASE/api/auth/recover" -H 'content-type: application/json' \
  -d '{"recovery_code":"XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXXX"}'

curl -s -X POST "$BASE/api/auth/logout" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"all_devices":false}'

curl -s "$BASE/api/me" -H "authorization: Bearer $TOKEN"
curl -s -X PATCH "$BASE/api/me" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"nickname":"阿满","wish_style_tags":["低预算","出门"]}'
```

**愿签与契约**

```bash
curl -s -X POST "$BASE/api/wishes" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" \
  -d '{"relation":"姥姥","wish_text":"姥姥的腿疼能轻一些，别再一个人在家扛着。"}'

curl -s "$BASE/api/wishes?limit=20" -H "authorization: Bearer $TOKEN"
curl -s "$BASE/api/wishes/$WISH_ID" -H "authorization: Bearer $TOKEN"

curl -s -X PUT "$BASE/api/wishes/$WISH_ID/answers" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"q1":"最怕她腿疼加重","q2":"基本一个人待着","q3":"三个月没回家","q4":"每月能挤出两百","q5":"想要一副护膝"}'

curl -s -X POST "$BASE/api/wishes/$WISH_ID/contract" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"days":7}'
```

**每日任务、打卡与补卡**

```bash
curl -s "$BASE/api/wishes/$WISH_ID/tasks/today" -H "authorization: Bearer $TOKEN"

curl -s -X POST "$BASE/api/tasks/$TASK_ID/checkin" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"proof_id":"'"$FILE_ID"'","note":"陪她走了两圈"}'

curl -s -X POST "$BASE/api/tasks/$TASK_ID/makeup" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"proof_id":"'"$FILE_ID"'","note":"补上昨天的散步"}'
```

**账本**

```bash
curl -s "$BASE/api/wishes/$WISH_ID/ledger?week_start=2026-05-18" -H "authorization: Bearer $TOKEN"

curl -s -X PUT "$BASE/api/ledger/weeks/2026-05-18" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"wish_id":"'"$WISH_ID"'","budget_cents":6000}'

curl -s -X POST "$BASE/api/ledger/entries" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"wish_id":"'"$WISH_ID"'","week_start":"2026-05-18","type":"expense","amount_cents":1234,"note":"给TA买了花"}'
```

**结算与续期**

```bash
curl -s -X POST "$BASE/api/wishes/$WISH_ID/settle" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{}'

curl -s "$BASE/api/wishes/$WISH_ID/settlement" -H "authorization: Bearer $TOKEN"

curl -s -X POST "$BASE/api/wishes/$WISH_ID/extend" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{}'
```

**两段式上传**

```bash
# 1) 申请凭证：拿到 file_id / upload_url / required_headers / expires_at（2 小时）
curl -s -X POST "$BASE/api/uploads/presign" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"filename":"checkin.png","mime_type":"image/png","purpose":"checkin_proof","size_bytes":53210,"wish_id":"'"$WISH_ID"'"}'

# 2) 浏览器按 required_headers 直传到 upload_url（PUT，不在 Function 里转发）
curl -s -X PUT '<upload_url>' -H 'content-type: image/png' --data-binary @checkin.png

# 3) 通知服务端校验实测字节
curl -s -X POST "$BASE/api/uploads/complete" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"file_id":"'"$FILE_ID"'"}'

# 4) 需要展示时再换 600s 签名 GET URL
curl -s -X POST "$BASE/api/uploads/$FILE_ID/url" -H "authorization: Bearer $TOKEN"
```

**分享**

```bash
curl -s -X POST "$BASE/api/wishes/$WISH_ID/share" -H "authorization: Bearer $TOKEN"
curl -s "$BASE/api/s/<share_token>"            # 匿名可读，白名单字段
curl -s -X DELETE "$BASE/api/wishes/$WISH_ID/share" -H "authorization: Bearer $TOKEN"
```

**公开池**

```bash
curl -s "$BASE/api/pool?category=body&limit=20"
curl -s -X POST "$BASE/api/pool/publish" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"wish_id":"'"$WISH_ID"'","category":"body"}'
curl -s "$BASE/api/pool/$POST_ID"
curl -s -X POST "$BASE/api/pool/$POST_ID/report" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"reason_code":"spam"}'
curl -s -X POST "$BASE/api/pool/$POST_ID/unpublish" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{}'
```

**回信**

```bash
curl -s -X POST "$BASE/api/pool/$POST_ID/replies" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"content":"愿你今天也能好好吃饭。"}'
curl -s "$BASE/api/pool/$POST_ID/replies?limit=20"
curl -s -X DELETE "$BASE/api/replies/$REPLY_ID" -H "authorization: Bearer $TOKEN"
```

**AI 辅助**

```bash
curl -s -X POST "$BASE/api/ai/polish-wish" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"wish_text":"希望妈妈腿不那么疼，晚上能睡好一点。","relation":"妈妈"}'
```

**演示模式**

```bash
curl -s -X POST "$BASE/api/demo/session" -H 'content-type: application/json' -d '{}'
curl -s "$BASE/api/demo/state" -H "authorization: Bearer $DEMO_TOKEN"
curl -s -X POST "$BASE/api/demo/fast-forward" -H "authorization: Bearer $DEMO_TOKEN" \
  -H 'content-type: application/json' -d '{}'
curl -s -X POST "$BASE/api/demo/scenario" -H "authorization: Bearer $DEMO_TOKEN" \
  -H 'content-type: application/json' -d '{"outcome":"cyber_only"}'
curl -s -X POST "$BASE/api/demo/reset" -H "authorization: Bearer $DEMO_TOKEN" \
  -H 'content-type: application/json' -d '{}'
```

## 1. 共享数据结构（出参 DTO）

> ⚠️ 本节是第 1 轮设计稿：字段名仍写作 camelCase，实际出参一律 snake_case 且与列同名（02 §1），词表以 03 §6 为准；`User` 的真实形状见 §0.1.1，`WishDetail`/`WishSummary`/`Task` 的真实形状见 §0.1.2。

```jsonc
// User
{ "id","displayName","pronoun","status","isDemo","createdAt","hasRecoveryCode","activeWishId","closeRequestedAt" }

// WishSummary（列表/今日页用，永不含 answers*、ledger*、proof*）
{ "id","relationCode","relationLabel","targetName","pronoun","wishType","wishTypeLabel","wishText",
  "days","startDate","endDate","status","dayIndex","isPublic","signedAt","updatedAt",
  "progress": { "mustTotal","mustDone","moneyTotal","moneyDone" } }

// Task
{ "id","wishId","dayIndex","taskDate","weekStart","type":"ta|self|money","typeLabel","seq",
  "title","proofHint","status","doneAt","canCheckin","needMakeup","checkin": Checkin|null }

// Checkin（仅本人可见；公开接口无此结构）
{ "id","taskId","note","proofFileId","proofUrl","serverTs","clientTs","isMakeup","duplicateHint","revokedAt" }

// File
{ "id","purpose","status","mimeType","sizeBytes","width","height","sha256"(截断8位),"createdAt" }

// Ledger
{ "wishId","serverWeekStart","weeks":[
    { "weekStart","weekIndex","budgetCents","budgetYuan","spentCents","savedCents","earnedCents",
      "counted","overBudget","proofFileId","entries":[
        { "id","entryKind","amountCents","amountYuan","note","proofFileId","taskId","serverTs","revokedAt" } ] } ],
  "totals": { "savedCents","earnedCents","totalCents","progressBps","progressYuanRemaining" },
  "rewardHint": null }   // 结算前恒为 null：不透露礼物名（PRD D-06）

// Settlement（第二幕展开后才出现 reward 字段）
{ "id","wishId","version","outcome","outcomeLabel","sealed","sealText","openAt","computedAt","sealedAt","revealedAt",
  "act1": { "days":[ { "dayIndex","taskDate","tasks":[ {"id","type","title","status"} ] } ], "allMustDone" },
  "act2": { "ledger": Ledger.totals, "weeks":[...],
            "reward": { "id","name","category","categoryLabel","priceMinCents","priceMaxCents","priceRangeLabel","searchKeyword","addOnHint" }|null,
            "gap": { "cents","yuan","band","copy" },
            "selfSummary": { "lines":[String], "counts": { "sleep","meals","steps","water","callTa" } },
            "letter": { "text","updatedAt" },
            "assets": { "cardFileId","letterFileId" } },
  "canExtend","extendUsed","extendMode" }

// PoolPost（公开，字段白名单，永不含 answers/ledger/proof）
{ "id","wishId"(仅作者视角返回),"category","categoryLabel","relationLabel","excerpt","displayLabel",
  "publishedAt","replyCount","forkCount","status","isMine","replies":[ Reply ] }

// Reply
{ "id","postId","content","createdAt","isMine","authorLabel","status" }

// Notification
{ "id","type","title","body","payload","status","createdAt","readAt" }
```

---

## 2. A 系统与元数据

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/health` | 否 | — | — | `{ ok:true, service, apiVersion, dbConfigured, storageConfigured, aiConfigured }`（不查库，供冒烟） | `service_not_configured` |
| `GET /api/meta` | 否 | — | — | `{ relations:[{code,label,pronounDefault,group,tone}], wishTypes:[{code,label,keywordsSample}], giftCategories:["health","company","life","heart"]（**仅类别标签，不含任何物品名**）, durations:[7,14,30], limits:{ wishText:120, targetName:8, note:30, reply:80, letter:500, proofMaxBytes:204800 }, copy:{ homePage:"有些话说不出口，就替 TA 许个愿。", contract:"这不是打卡，是一张你签了字的愿签。" }, serverTs }` | — |
| `GET /api/meta/wish-templates` | Token | — | `relation`(必填枚举), `batch?`(默认1) | `{ items:[{id,content,wishType,batch}], batch, nextBatch }`；同关系 ≥6 条（B-04） | `relation_unsupported` |
| `POST /api/meta/wish-templates/next` | Token | 否 | `{ relation, excludeIds?:[uuid] }` | 同上，`batch` 递增；服务端记住用户已展示批次，**换批不与本账号历史批次重复** | `batch_exhausted` |

## 3. B 认证与账号会话

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/auth/guest` | 否 | 建议(`auth.guest`, principal=ip) | `{ client:"web\|wechat", deviceId? }` | `{ user:User, token:"vt1_...", tokenExpiresAt, recoveryCode:"<32 字符，仅此一次>", isFirstAccount:true }` | `guest_quota_exceeded` `account_closed` |
| `POST /api/auth/recover` | 否 | 否 | `{ recoveryCode }` | `{ user:User, token, tokenExpiresAt, recovered:true, wishCount }`（US-06/A-03） | `recovery_code_invalid` `account_closed` |
| `POST /api/auth/refresh` | Token | 否 | `{ client? }` | `{ token, tokenExpiresAt, previousRevoked:true }`（旧 token 立即失效） | `token_expired` |
| `POST /api/auth/signout` | Token | 否 | — | `{ revoked:true }`（仅撤销当前 token） | — |
| `GET /api/auth/tokens` | Token | — | — | `{ items:[{id,client,label,createdAt,lastSeenAt,expiresAt,current}] }` | — |
| `DELETE /api/auth/tokens/:tokenId` | Token | 否 | path `tokenId` = token 行 uuid | `{ revokedId, revoked:true }` | `token_not_found` |

## 4. C 我的（首页/设置/导出/注销）

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/me` | Token | — | — | `{ user:User, activeWish:WishSummary|null, today:TodayView|null, settlementAvailable:bool, unreadCount, recentSettled:[SettlementLite], pool:{ myPosts, myReplies }, features:{ demoVisible:false } }`（A-05：有进行中则前端显示"继续"） | `account_closed` |
| `PATCH /api/me` | Token | 否 | `{ displayName?, pronoun?, allowReplyFromStranger? }` | `{ user:User }` | `content_too_long` |
| `GET /api/me/export` | Token | — | — | `{ format:"yuan-ta.export.v1", exportedAt, user, wishes:[WishSummary + answersMeta + tasks + ledger + settlementLite], files:[File 元数据，无字节无 URL], notice:"不含五问原文与照片内容" }`（H-04/A-04，恢复码不含在导出内） | `export_unavailable` |
| `POST /api/me/close` | Token | 是(`me.close`) | `{ reason?, confirm:true }` | `{ status:"being_closed", scheduledDeletionAt, graceDays:15 }` | `close_already_requested` |
| `POST /api/me/close/cancel` | Token | 是(`me.close.cancel`) | `{ confirm:true }` | `{ user:User }` | `close_window_passed` |
| `GET /api/s/:token` 之外的公开入口由 `users.status` 决定 | | | | 注销完成后：公开池该用户内容 `status=hidden`、愿签不可读（A-04） | |

## 5. D 愿签与契约（创建流 6 步）

> ⚠️ 本节是第 1 轮设计稿。其中 `POST /api/wishes`、`GET /api/wishes`、`GET /api/wishes/:id`、`PUT .../answers`、`POST .../contract` **已在第 3 轮实现，真实契约见 §0.1.2**，本表对应行仅作历史对照；`PATCH`/`DELETE`/`GET .../answers` 仍未实现。

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/wishes` | Token | 是(`wish.create`) | `{ relation, targetName?, pronoun?, wishText?, wishTemplateId?, days? }`（B-01~B-05；模板与自定义二选一） | `{ wish:WishDetail(draft), wishType:"health", classification:{ matched:[kw], fallback:false }, answers:{ completed:false } }` | `wish_text_required` `relation_unsupported` `already_active_wish` |
| `GET /api/wishes` | Token | — | `status?`, `limit?≤50`, `cursor?` | `{ items:[WishSummary], nextCursor, hasMore }`（我的页：进行中/已还愿） | — |
| `GET /api/wishes/:wishId` | Token | — | — | `{ wish:WishDetail, tasksPreview:[Task], makeup:{available,weekStart,expiresAt}, ledger:Ledger|null, settlement:SettlementLite|null, share:{token,url,shareUrl}|null, pool:{postId,status}|null, settleOpenAt, recoveryShown:bool }`；**不含 answers 明文** | `wish_not_found` |
| `PATCH /api/wishes/:wishId` | Token | 否 | `{ relation?, targetName?, pronoun?, wishText?, wishTemplateId?, days?, aiAssisted? }` | `{ wish:WishDetail, wishType, classification }`；非 draft 返回 409（B-08 草稿自动保存也走此接口） | `already_signed` `wish_not_editable` |
| `DELETE /api/wishes/:wishId` | Token | 否 | — | `{ id, deleted:true }`（仅 draft 可删；软删） | `draft_only` |
| `GET /api/wishes/:wishId/answers` | Token | — | — | `{ answers:{ q1:{raw,label},q2:{raw,label},q3:{raw,lastHome,travelBand,costBand},q4:{raw,disposableBand},q5:{raw,rewardId|null} }, skipped:[int], completedAt, privacyNotice }`（**唯一解密出口，仅本人**；分享/公开池/导出结构无这些字段） | `answers_not_found` |
| `PUT /api/wishes/:wishId/answers` | Token | 是(`wish.answers`) | `{ wishId, answers:{ q1?:{value\|skip}, q2?:…, q3?:…, q4?:…, q5?:… }, healthConsent?:bool }`（一屏一问，可跳；B-07） | `{ answersMeta:{ completed, skipped:[..], derived:{ giftCategory, aloneLevel, costBand, disposableBand, weeklyBudgetCents, rewardHintCategory }, encryptedStored:true } }`；答案字段级 AES-256-GCM 入库；命中 `q5` 目录物品时写 `q5_reward_id` | `answers_locked_after_sign` `content_too_long` `health_consent_required` |
| `POST /api/wishes/:wishId/contract` | Token | 是(`wish.contract`) | `{ days, signMethod:"draw\|press3s", signatureFileId?, contractVersion:"v1", confirm:true }` | `{ wish:WishDetail(status:"active", startDate, endDate, settleOpenAt), tasks:[Task(2×days + money)], makeupTickets:[…], recoveryCode?（首签提示）, notice }`（B-08：签字后同请求生成任务、提示恢复码） | `answers_incomplete` `signature_required` `already_signed` `date_boundary_invalid` |

## 6. E 任务与打卡

> ⚠️ 本节是第 1 轮设计稿。`GET .../tasks/today`、`POST /api/tasks/:taskId/checkin`、`POST /api/tasks/:taskId/makeup` **已在第 4 轮实现，真实契约见 §0.1.3**；本表对应行仅作历史对照（字段名、`proofFileId`、`duplicateHint` 等均以 §0.1.3 为准）。

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/wishes/:wishId/tasks/today` | Token | — | — | `{ productDate, dayIndex, mustTasks:[Task×2], moneyTask:Task|null, makeup:{available,expiresAt}, streak:{doneToday,totalDone}, notice }`（C-01/C-02：只显示今天，不显示剩余天数；`missed` 在此路径惰性标记） | `contract_not_signed` `wish_not_active` |
| `GET /api/wishes/:wishId/tasks` | Token | — | `date?` \| `dayIndex?` \| `from&to?` \| `status?` | `{ items:[Task], productDate, dayWindow:[start,end] }`（结算亮灯、回看用） | `date_range_invalid` |
| `GET /api/tasks/:taskId` | Token | — | — | `{ task:Task(+wishId,dayIndex), checkin:Checkin\|null, canCheckin, needMakeup }` | `task_not_found` |
| `POST /api/tasks/:taskId/checkin` | Token | **是**(`task.checkin`) | `{ proofFileId(必填，须 ready), note?≤30, clientTs?, channel?:"offline" }`（本轮：完成即落库，服务端不审核图片内容、不做 AI 验收） | `{ task:Task(status:"done",doneAt), checkin:Checkin, duplicateHint:bool, dayProgress:{done,total}, makeupTicket?（周末发券时） }` | `proof_required` `upload_pending` `already_checked_in` `task_not_today` `wish_not_active` `rate_limited`（10/分钟） |
| `POST /api/tasks/:taskId/makeup` | Token | **是**(`task.makeup`) | `{ ticketId?, proofFileId?, note? }` | `{ ticket:{status:"used",usedAt}, task:Task(status:"made_up"), checkin:Checkin\|null, noPenalty:true }`（C-05：补卡不扣分，不弹红字） | `makeup_ticket_unavailable` `task_date_mismatch` `already_checked_in` |
| `DELETE /api/checkins/:checkinId` | Token | 否 | — | `{ checkinId, revoked:true, task:Task(status 回 "pending" 或 "missed") }`（E2E-02 删除后重传；软撤销，幂等重放返回原结果） | `checkin_not_revocable` |
| `POST /api/checkins/sync` | Token | 是(`checkin.sync`) | `{ items:[{ clientCheckinId, taskId, proofFileId, note?, clientTs?, idempotencyKey(uuid) }], limit≤50 }`（C-06 离线队列） | `{ results:[{ clientCheckinId, status:"created\|duplicated\|rejected\|pending_upload", code?, task?, checkin? }], counts:{created,duplicated,rejected}, serverTs }`；逐项独立幂等，绝不重复创建 | `sync_batch_too_large` `sync_payload_invalid` |
| `GET /api/wishes/:wishId/makeup-tickets` | Token | — | — | `{ items:[{ id,weekStart,weekIndex,status,taskId,usedAt,expiresAt }] }` | `contract_not_signed` |

## 7. F 文件与上传（对象存储）

> ⚠️ 本节是第 1 轮设计稿，**已被第 7 轮实现取代**。真实路径、入参、出参与错误码见 §0.1.6。主要差异：完成校验路径是 `POST /api/uploads/complete`（body 带 `file_id`），不是 `/:fileId/complete`；取址用 `POST /api/uploads/:id/url`；`purpose` 只收三种；`DELETE` 未实现；`presign` 不启用幂等。

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/uploads/presign` | Token | 是(`upload.presign`) | `{ purpose:"proof\|signature\|share_image\|reveal_card\|letter_image\|ledger_proof", mimeType, sizeBytes, sha256?, wishId?, width?, height? }` | `{ file:File(status:"pending"), uploadUrl:"/…签名 PUT", uploadMethod:"PUT", requiredHeaders:{"Content-Type"}, expiresAt, maxSizeBytes, allowedMimeTypes, objectKeyLocked:true }`；路径由服务端生成，客户端不可指定 | `file_too_large` `mime_type_unsupported` `purpose_unsupported` `quota_exceeded` |
| `POST /api/uploads/:fileId/complete` | Token | 是(`upload.complete`) | `{ fileId }` | `{ file:File(status:"ready", sizeBytes, mimeType, width, height, sha256) }`；服务端 `download` 实测字节后才 `ready`，失败标 `rejected` 且不计入打卡 | `upload_pending` `verification_failed` `storage_unavailable` |
| `POST /api/uploads/:fileId/url` | Token | 否 | `{ purpose?:"view" }` | `{ url:"/…签名 GET", expiresIn:600, status }`（仅归属者；600s；URL 不入库不入日志） | `file_not_ready` |
| `DELETE /api/uploads/:fileId` | Token | 否 | — | `{ fileId, status:"deleted" }`（仍被有效打卡引用时拒绝） | `file_in_use` |

## 8. G 账本

> ⚠️ 本节是第 1 轮设计稿，**已被第 5 轮实现取代**。真实路径、入参、出参与错误码见 §0.1.4。主要差异：写接口 body 必填 `wish_id`；`PUT` 只改 `budget_cents`；`POST` 用 `type:"expense|earning"`，收入 `proof_id` 可选；`DELETE` 未实现。

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/wishes/:wishId/ledger` | Token | — | `weeks?` | `Ledger`（D-01/D-02：自然周分组、本周省下/挣到/合计、结余 = 预算 − 支出、超预算记 0 并 `overBudget:true`、进度条 `progressBps` 与"还差多少"，**不含礼物名**） | `contract_not_signed` |
| `PUT /api/wishes/:wishId/ledger/weeks/:weekStart` | Token | 是(`ledger.week`) | `{ budgetCents?, spentCents?, proofFileId?, note? }`（`weekStart` = 该周周一，D-04/D-05） | `{ week:LedgerWeek, totals, recomputed:true, overBudget:bool }`；修改当周即生效并重算派生列 | `week_not_in_contract` `amount_range_invalid` `negative_amount` |
| `POST /api/wishes/:wishId/ledger/entries` | Token | 是(`ledger.entry`) | `{ weekStart?, entryKind:"earning", amountCents, taskId(money 且 done), proofFileId(必填), note? }` | `{ entry:LedgerEntry, week:LedgerWeek, totals }`（D-03 兼职收入必须关联一次完成的赚钱类任务 + 佐证） | `earning_task_required` `task_not_money` `task_not_done` `proof_required` `duplicate_earning_link` |
| `DELETE /api/ledger/entries/:entryId` | Token | 否 | — | `{ entryId, revoked:true, week, totals }`（软撤销并即时重算；不倒扣已完成周） | `entry_not_revocable` |

## 9. H 结算与续期

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/wishes/:wishId/settle` | Token | **是**(`wish.settle`) | `{ forceRecalc?:false }` | `{ settlement:Settlement(version, act1 完整亮灯 + sealed/sealText + rewardVisible:false), openedAt }`；确定性重算账本/结局并落库；已到 `settleOpenAt` 才可调用（D-07/D-08） | `settlement_locked` `already_settled` `extend_required` |
| `GET /api/wishes/:wishId/settlement` | Token | — | `version?` | `Settlement`（未结算时返回 `settlement:null` + `openAt`/`progressBps`；`act2.reward` 仅在 `revealedAt` 非空后出现） | `settlement_not_found` |
| `POST /api/settlements/:settlementId/ack` | Token | 否 | `{ phase:"cyber\|reveal" }` | `{ settlement:Partial<Settlement>, sealedAt?, revealedAt?, reward:{...,priceRangeLabel,searchKeyword}, gap:{cents,yuan,band,copy}, selfSummary }`（第一幕盖章时间 / 第二幕展开时间分别落库） | `phase_order_invalid` `settlement_locked` |
| `PATCH /api/settlements/:settlementId/letter` | Token | 否 | `{ letterText≤500 }` | `{ settlement:{letter:{text,updatedAt}} }`（E-03 信可编辑；无 AI 也必须有默认模板文） | `letter_too_long` |
| `PUT /api/settlements/:settlementId/assets` | Token | 是(`settlement.assets`) | `{ cardFileId?, letterFileId? }`（先走 presign/complete，前端出图） | `{ settlement:{assets}, files:[File] }` | `file_purpose_mismatch` `upload_pending` |
| `POST /api/wishes/:wishId/extend` | Token | **是**(`wish.extend`) | `{ mode:"money\|must", days:7, confirm:true }` | `{ wish:WishDetail(days,endDate,renew_count:1), newTasks:[Task], tickets:[…], settleOpenAt, settlementReopen:true }`（D-09 三档结局后续期一次；第二幕后按钮消失） | `extend_not_allowed` `extend_once_only` `outcome_not_extendable` |

## 10. I 分享

> ⚠️ 本节是第 1 轮设计稿，**已被第 7 轮实现取代**。真实契约见 §0.1.7。主要差异：生成接口不接受 `visibility/includeFlags`（固定 `link_only` + 白名单投影）；`GET /api/wishes/:id/share`（查看当前链接）与分享图接口未实现；公开页字段名与白名单以 §0.1.7 为准，且不含 `invitational/visibility/shareId`。

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/wishes/:wishId/share` | Token | 是(`wish.share`) | `{ visibility:"link_only\|with_outcome", includeFlags:{ relation:true, wishText:true, outcome:false, days:true } }`（默认仅链接，E-05） | `{ share:{ token, url:"https://<site>/s/<token>", apiPath:"/api/s/<token>", includeFlags, status:"active" } }` | `share_not_before_sign` |
| `DELETE /api/wishes/:wishId/share` | Token | 否 | — | `{ share:{ status:"revoked", revokedAt } }` | `share_not_found` |
| `GET /api/wishes/:wishId/share` | Token | — | — | `{ share:{ token,url,visits,includeFlags,status }, shareFile:File\|null }` | `share_not_found` |
| `POST /api/wishes/:wishId/share-image` | Token | 是(`wish.share.image`) | `{ layout:"water_wish", fileFormat:"png", text?≤20 }` | `{ shareFile:File, width:1080, height:1440, renderUrl(600s) }`（服务端出模板，前端绘制后回传文件 ID；白名单字段渲染） | `file_purpose_mismatch` |
| `GET /api/s/:token` | 否 | — | `token`（路径） | `{ wish: 白名单子集{ relationLabel, targetName?, wishText, wishTypeLabel, status, outcome?, startDate, endDate, dayIndex, sealText? }, invitational:{ copy:"我也替 TA 许一个", startPath:"/start" }, visibility, shareId }`（US-03 首屏 3 秒、微信内可开；**响应结构中不存在 `answers`、`ledger`、`reward`、`proof`、`photo` 字段**，E-05/US-04） | `share_revoked` `share_not_found` |

## 11. J 公开池

> ⚠️ 本节是第 1 轮设计稿，**已被第 7 轮实现取代**。真实契约见 §0.1.8。主要差异：发布是 `POST /api/pool/publish`（body 带 `wish_id`），不是 `/api/wishes/:wishId/publish`；`sort` 只接受 `latest`；详情不内嵌回信/相关推荐；举报原因码是 `privacy/harassment/illegal/spam/sexual/other`；fork 与 `replies-enabled` 开关未实现。

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/wishes/:wishId/publish` | Token | 是(`pool.publish`) | `{ excerpt?:≤120, allowIdentity?:false, confirm:true }`（E-06；本轮"发布即公开"，无人工审核队列；服务端仍跑确定性敏感词/个人信息规则拦截） | `{ post:PoolPost(status:"published"), sanitization:{ removed:["数字","地名"], fallbackUsed:bool }, publishLimit:{ remaining, limit:5 } }` | `sensitive_content` `already_published` `excerpt_too_long` `publish_quota_exceeded` `contract_not_signed` |
| `GET /api/pool` | 否 | — | `sort:"latest\|hot"?`, `category?`(六类), `limit≤50`, `cursor?` | `{ items:[PoolPost], nextCursor, hasMore, categories:[{code,label,count}] }`（只返回 `published` 且 `is_demo=false`） | — |
| `GET /api/pool/:postId` | 否 | — | — | `{ post:PoolPost(+replies 前 20 条), related:[PoolPost×3], canReply:bool, repliesDisabled:bool }` | `pool_hidden` |
| `POST /api/pool/:postId/report` | Token | 否 | `{ reasonCode:"privacy\|harassment\|ad\|health_advice\|other", detail?≤200 }` | `{ report:{ id,status:"open" }, target:{ hidden:bool, reportCount } }`（第 3 次举报自动 `hidden`，PRD E-07 的计数部分） | `report_duplicate` |
| `POST /api/pool/:postId/fork` | Token | 是(`pool.fork`) | `{ targetName?, pronoun?, confirm:true }` | `{ wish:WishDetail(relation=来源关系, wishType=来源类别, wishText:"", status:"draft"), forkedFromPostId }`（F-03 带入关系与愿望类型，**原文由新用户重填**） | `fork_target_hidden` `already_active_wish` |
| `POST /api/pool/:postId/unpublish` | Token | 否 | `{ reason? }` | `{ post:{ status:"deleted", deletedAt } }`（作者下架，即时生效；已发签名 URL 到期自然失效） | `not_post_author` |
| `PUT /api/wishes/:wishId/replies-enabled` | Token | 否 | `{ enabled:bool }` | `{ wish:{ repliesEnabled } }`（F-02 作者可关闭回信） | `contract_not_signed` |

## 12. K 回信

> ⚠️ 本节是第 1 轮设计稿，**已被第 7 轮实现取代**。真实契约见 §0.1.9。主要差异：错误码 `reply_per_post_limit` → `reply_daily_limit`（409）；`GET /api/pool/:id/replies` 出参含 `limit`；`GET /api/replies/mine` 与回信举报未实现；删除权限是「回信作者或帖主」。

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/pool/:postId/replies` | Token | 是(`reply.create`) | `{ content≤80 }`（US-07：80 字上限 + 敏感词拦截） | `{ reply:Reply, post:{ replyCount }, quota:{ dailyRemaining:19 } }`；本轮即时发布（简化，去掉先审后发），异步敏感词命中即拒 | `content_too_long` `sensitive_content` `reply_daily_limit`（20/天） `reply_per_post_limit`（同愿签 1/天） `replies_disabled` `pool_hidden` |
| `GET /api/pool/:postId/replies` | 否 | — | `limit≤50`, `cursor?` | `{ items:[Reply], nextCursor, hasMore }`（只 `published`） | — |
| `DELETE /api/replies/:replyId` | Token | 否 | — | `{ replyId, status:"deleted" }`（回信作者或愿签作者可删；前者删自己、后者删自己愿签下的） | `not_reply_owner` |
| `GET /api/replies/mine` | Token | — | `limit?, cursor?` | `{ items:[Reply+postExcerpt], nextCursor, hasMore }` | — |
| `POST /api/replies/:replyId/report` | Token | 否 | `{ reasonCode, detail? }` | `{ report:{ id }, target:{ hidden:bool, reportCount } }` | `report_duplicate` |

## 13. L 通知与通知设置

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `GET /api/notifications` | Token | — | `status:"unread\|all"?`, `limit≤50`, `cursor?` | `{ items:[Notification], unreadCount, nextCursor, hasMore }` | — |
| `POST /api/notifications/read` | Token | 否 | `{ ids?:[uuid], all?:true }` | `{ updatedCount, unreadCount }`（角标清零，F-02） | — |
| `GET /api/notifications/unread-count` | Token | — | — | `{ unreadCount, byType:{ reply, settlement, system } }` | — |
| `GET /api/settings/notifications` | Token | — | — | `{ notifyTypes, quietStart:"23:00", quietEnd:"08:00", dailyTypeLimit:3, checkinRemindTime }`（F-04） | — |
| `PUT /api/settings/notifications` | Token | 否 | 同上字段子集 | `{ settings }` | `quiet_window_invalid` |

> 站内信生成时机（全部服务端在同一请求内写入，无 cron）：新回信 → `reply`；结算窗口开放 → `settlement_ready`；连续 2 日未打卡 → `checkin_remind`（免打扰时段内只落站内信，`channel:"in_app"`；同类每日 ≤3 条由 `dedupe_key` + 计数保证）。

## 14. M AI 辅助（只做建议，点选才写入）

> **实现状态**：本节是第 1 轮设计稿。第 8 轮 P0 只落地 `POST /api/ai/polish-wish`，真实字段与错误码见 §0.1.10；其余 4 条仍是设计，未注册路由。

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/ai/polish-wish` | Token | 否 | `{ wishText, relation, wishType? }`（输入脱敏后送 Cloud Agents） | `{ suggestions:[{ id, text≤60, tone }×3], aiAssisted:true, fallbackUsed:bool, quota:{ used, limit:20 }, applyHint:"点选后由 PATCH /api/wishes/:id 写入" }`（G-01/US-08） | `ai_quota_exceeded` `ai_input_redacted_empty` |
| `POST /api/ai/task-candidates` | Token | 否 | `{ wishId, dayIndex?, types?:["ta","self","money"] }`（P1） | `{ candidates:[{ type,title,proofHint,templateId:null, aiAssisted:true }], mustUseTemplatePool:false, fallbackUsed }`；仅候选，**用户确认后走独立写入接口**，不进 §6.1 生成器 | `ai_quota_exceeded` |
| `POST /api/ai/reply-draft` | Token | 否 | `{ postId }`（只读该帖脱敏摘要，P1） | `{ drafts:[≤80 字 ×3], tone, aiAssisted:true, fallbackUsed }` | `ai_quota_exceeded` `pool_hidden` |
| `POST /api/ai/letter-draft` | Token | 否 | `{ settlementId, tone? }`（P1） | `{ drafts:[{ text≤500, aiAssisted:true }] , fallbackUsed }` | `settlement_not_revealed` |
| `GET /api/ai/quota` | Token | — | — | `{ usedToday, limit:20, resetAt, degraded:bool }` | — |

约束：AI 失败/超时/校验不过 → 返回 `200` + `fallbackUsed:true` + 模板内容（PRD G-03 断网仍可完成主流程），不返回 5xx；AI 输出**不自动落库**；进入 AI 前输入脱敏（去掉五问原文与个人信息样式）。
**`ai_jobs` 表不建**（第 1 轮设计稿里有，实现时取消）：`GET /api/ai/quota` 的 `usedToday` 改由既有业务表的 `created_at` 窗口计数得出（复用 `lib/quota.ts#enforceWindow`，阈值走环境变量），调用留痕只进结构化日志。兜底文案取自 `database/seed/*.ts`。详见 docs/01 §9。

## 15. N 演示模式

> **实现状态**：本节是第 1 轮设计稿。第 8 轮落地 5 条（创建/状态/快进/切结局/重置），真实字段、结局映射与隔离规则见 §0.1.11；六步引导与静态场景未实现。

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/demo/session` | 否 | 是(`demo.session`) | `{ scenario:"mom_knee", entryPath:"/demo\|?demo=1\|longpress" }` | `{ demoToken:"vt1_...", expiresAt(24h), state:DemoState, isolation:{ isDemo:true, namespace:"demo_", poolReadOnly:true, bindable:false } }` | `demo_quota_exceeded` `demo_expired` |
| `GET /api/demo/state` | 演示 Token | — | — | `{ scenario, step(1..6), wish:WishSummary, today:TodayView, ledger:Ledger, settlement:SettlementLite, canFastForward:true, ttlSeconds }`（I-02 进入即看到完整愿签） | `demo_expired` |
| `POST /api/demo/step` | 演示 Token | 否 | `{ step:1..6, action?:"next\|skip\|exit" }` | `{ step, view:{ home\|wish\|today\|ledger\|settle\|reveal }, navCopy }`（六步引导：首页→愿签→今日→账本→结算→彩蛋） | `step_out_of_range` |
| `POST /api/demo/fast-forward` | 演示 Token | 是(`demo.fast_forward`) | `{ toDayIndex?:7 }` | `{ wish, tasks:[Task(全部 done/made_up)], ledger:Ledger(168 元示例口径), settlement:Settlement(act1+act2 可展开) }`（I-04，全程 ≤3 分钟；与真实结算同一代码路径） | `demo_expired` |
| `POST /api/demo/outcome` | 演示 Token | 是(`demo.outcome`) | `{ scenario:"double_realized\|cyber_only\|unrealized" }` | `{ settlement:Settlement(新 version), recomputed:true, affectsRealData:false }`（I-05 三结局随时重算重播） | `outcome_scenario_unknown` |
| `POST /api/demo/reset` | 演示 Token | 是(`demo.reset`) | `{ confirm:true }` | `{ cleared:{ wishes,tasks,checkins,ledger,files }, session:DemoState }`（只清演示命名空间） | `demo_expired` |
| `GET /api/demo/scenario` | 否 | — | `static?:true` | `static=false`：DB 快照；`static=true`：`content/` 常量渲染数据（8 画面 + 视频元数据），**不查库、不调 AI**（I-06 / E2E-09 断网兜底） | `demo_scenario_unavailable` |

## 16. O 埋点

| 方法 · 路径 | 鉴权 | 幂等 | 入参 | 出参 `data` | 特有错误码 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/events` | Token 或匿名 | 否 | `{ events:[{ name, props?, wishId?, occurredAt? }]×≤20, sessionId }`，`name ∈ app_open/wish_created/checkin_submitted/settlement_viewed/share_created/pool_published/reply_created/demo_completed` | `{ accepted:int, rejected:int, rejectedIndexes:[int] }`；服务端补 `is_demo`，演示事件不进业务漏斗（I-07） | `events_batch_too_large` |

---

## 17. PRD 需求 → 接口覆盖对照

| PRD | 落在哪些接口 |
| --- | --- |
| A-01/A-02 匿名账号与 30 天会话 | `POST /api/auth/guest` `POST /api/auth/refresh` + `auth_tokens.expires_at` |
| A-03/US-06 恢复码找回 | `recovery_code_hash` + `POST /api/auth/recover` |
| A-04/H-04 注销与导出（脱敏） | `GET /api/me/export` `POST /api/me/close` `POST /api/me/close/cancel` |
| B-01~B-08 创建流 | `GET /api/meta` `GET/POST /api/meta/wish-templates*` `POST/PATCH /api/wishes` `PUT .../answers` `POST .../contract` |
| C-01~C-07 任务/打卡/补卡/离线 | `GET .../tasks/today` `POST /api/tasks/:id/checkin` `POST /api/tasks/:id/makeup` `POST /api/checkins/sync` `makeup_tickets` `files` |
| D-01~D-05 账本 | 已实现 `GET /api/wishes/:id/ledger` `PUT /api/ledger/weeks/:weekStart` `POST /api/ledger/entries`（§0.1.4）；`DELETE /api/ledger/entries/:id` 留到后续轮 |
| D-06~D-09 结算/续期 | 已实现 `POST /api/wishes/:id/settle` `GET /api/wishes/:id/settlement` `POST /api/wishes/:id/extend`（§0.1.5）；`POST /api/settlements/:id/ack` `PATCH .../letter` `PUT .../assets` 留到后续轮 |
| E-01~E-04 兑现卡与信 | `settlements.act2` + `PATCH letter` + `PUT assets`（礼物目录无读接口，防 D-06 剧透） |
| E-05/US-03 分享 | 已实现 `POST/DELETE /api/wishes/:id/share` `GET /api/s/:token`（§0.1.7）；`GET .../share` 与 `POST .../share-image` 留到后续轮 |
| E-06/E-07/US-04 公开池 | 已实现 `POST /api/pool/publish` `GET /api/pool` `GET /api/pool/:id` `POST /api/pool/:id/report` `POST /api/pool/:id/unpublish`（§0.1.8） |
| F-01~F-03 回信与接力 | 已实现 `POST/GET /api/pool/:id/replies` `DELETE /api/replies/:id`（§0.1.9）；`POST /api/pool/:id/fork` 与 `PUT .../replies-enabled` 留到后续轮 |
| F-04 通知与免打扰 | `GET/POST /api/notifications*` `GET/PUT /api/settings/notifications` |
| G-01~G-04/US-08 AI | 第 8 轮已实现 `POST /api/ai/polish-wish`（§0.1.10）：3 条 ≤60 字建议、`ai_label:"AI辅助"`、只建议不写库、输入脱敏、输出校验、超时/失败/额度回退模板、相同输入缓存；任务候选/回信草稿/信件草稿留函数位，`GET /api/ai/quota` 未做 |
| I-01~I-07 演示 | 第 8 轮已实现 `POST /api/demo/session`、`GET /api/demo/state`、`POST /api/demo/fast-forward`、`POST /api/demo/scenario`、`POST /api/demo/reset`（§0.1.11）：预置人设、快进结算、三档重播、物理隔离；六步引导与 `GET /api/demo/scenario?static=true` 未实现 |
| H-01/H-02 后台/审核 | **本轮范围外**，`pool_posts.status` 是无约束 `text`（加 `pending_review` 取值不动表）、`reports.status/acted_at` 列已就位，接后台时只加接口不改表 |
| 8.2 事件 | `POST /api/events` + `events.is_demo` |

## 18. 实现轮要遵守的接口级硬规则

1. 任何路由文件必须在 `route` 里声明 `path` / `method` / `auth` / `operation` / `idempotent` / `maxBodyBytes` 六个字段，取值合法性、路径与文件位置一致性、`operation` 不重复由 `tools/scripts/check-routes.ts` 兜底，不通过即失败退出。限流阈值不写在 `route` 里：需要限流的接口自己调用 `lib/quota.ts#enforceWindow`（已落地 `auth/guest` 的真实号与演示号两套阈值、`auth/recover`、`domain/wish.ts#createWish`），阈值一律来自环境变量（05）。
2. 幂等表未命中不得直接执行写；`in_progress` 占位必须先落库（`lib/idempotency.ts#claim`）。
3. **读路径**的越权查询必须在同一条 SDK 查询里带 owner 谓词（`findOwnedWish`：`eq('id').eq('user_id')`），查空即 404，禁止"先查后判"。**写路径**是本轮显式要求的例外：`requireAuthor` 先按 id 取行再比 `user_id`，为的是把「不存在」(404) 与「不是你的」(403) 分开；该函数只回愿签行本身，不外泄任何字段。
4. `/api/s/:token`、`/api/pool*`、`/api/pool/:id/replies` 三个公开出口的响应体必须由白名单投影产出（`domain` 里的 `toPoolPostDto` / `toReplyDto` / `readSharedWish`；通用工具 `lib/respond.ts#projectPublic` 可用但本期未走它），禁止把整行数据转 JSON。
5. 结算与账本相关接口不得调用 AI，也不得读取 `rewards` 之外的内容库表做金额判断。
6. 所有时间判定使用服务端 `now`（`Ctx.now`，可注入以便测试）与 `lib/time.ts` 的产品日；客户端时间只作展示，绝不参与 `day_index`、`settleOpenAt`、限流窗口计算。
7. 状态机非法流转返回 **400**（`wish_not_draft`、`answers_locked`），**409 只留给并发**（`wish_state_conflict`、`idempotency_key_reuse`、`duplicate_record`）。归属校验分读写：写操作非作者 → 403 `wish_forbidden`，读操作查不到（含非作者）→ 404 `wish_not_found`。
8. 任务生成、金额计算、结算一律确定性代码：随机源必须由业务主键派生（`seededRandom(sha256(wish_id))`），禁止 `Math.random()`；同一输入重放必须得到同一批行，这是幂等与崩溃修复成立的前提。
9. 批量写只用「派生 id + `insertIfAbsent(values, { onConflict: 'id' })`」；顺序固定为**先纯函数规划 → 再单行 CAS → 后批量落库**，不得先改状态再生成派生数据。
10. 五问明文只允许出现在请求内存与后续轮的 `GET /api/wishes/:id/answers`；其余任何出口（详情、列表、契约、分享、公开池、导出、幂等存档）都不得含答案明文或 `*_enc` 密文列。
11. 签名 URL（上传 PUT / 读取 GET）是短时能力：不写库、不进日志、不进幂等存档；对应路由用 `idempotent:'none'`，响应只回给当次请求。

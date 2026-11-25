# 03 数据库设计 · 愿TA 后端

> 本文描述**已落地**的库结构。DDL 真身在 [database/migrations/](../database/migrations)，本文只写"为什么这样建"、唯一索引承担的业务约束，以及索引与查询的对应关系。
> 第 1 轮设计稿 [db/schema.sql](../db/schema.sql) 保留作对照，与迁移的逐表差异见 §8（`node tools/scripts/diff-schema.ts` 可重跑）。
> 执行与回滚步骤见 [database/migrations/README.md](../database/migrations/README.md)。**迁移脚本已按平台子集定稿为 7 个批次**；云端落地与 seed 导入仍受授权/部署阻塞，实际结构以站点 `get_database_schema` 为准。

## 1. 表清单（7 个迁移、22 张表）

| # | 迁移 | 表 | 本轮状态 | 用途 |
| --- | --- | --- | --- | --- |
| 1 | 0001 | `users` | 读写 | 匿名账号、恢复码摘要、资料、演示标记 |
| 2 | 0001 | `auth_tokens` | 读写 | Bearer Token 归属与即时撤销（`id` = JWT 的 `jti`） |
| 3 | 0001 | `auth_attempts` | 读写 | 恢复码尝试计数（限流唯一真依赖计数的表） |
| 4 | 0001 | `idempotency_keys` | 读写（带 `Idempotency-Key` 时） | 统一幂等表：占位 → 结果存档 → 重放 |
| 5 | 0002 | `wish_templates` | 已 seed，**无读接口** | 愿望模板（按关系/批次），72 条 |
| 6 | 0002 | `task_templates` | **读**（任务引擎候选池）+ 已 seed | 任务库（`wish_type × relation × side`），120 条 |
| 7 | 0002 | `rewards` | 已 seed，**无读接口** | 礼物目录与价格区间（结算前不可被客户端检索），24 件 |
| 8 | 0002 | `files` | **读写**（第 7 轮） | 对象存储元数据（库里不存字节）；两段式上传 presign/complete + 业务证明校验 |
| 9 | 0003 | `wishes` | **读写**（第 3–5 轮） | 愿签/契约主表与状态机 |
| 10 | 0003 | `wish_answers` | **读写**（第 3、5 轮） | 五问答案（**字段级加密**）+ 规则用的粗粒度档位 |
| 11 | 0003 | `makeup_tickets` | **读写**（第 4 轮） | 每契约周一张补卡券 |
| 12 | 0004 | `tasks` | **读写**（第 3–4 轮） | 每日任务（确定性生成）+ 惰性日界；表级 `UNIQUE (wish_id, text)` 兜标题去重 |
| 13 | 0004 | `checkins` | **读写**（第 4 轮） | 打卡记录（服务端时间权威，一任务一行） |
| 14 | 0005 | `ledger_weeks` | **读写**（第 5 轮） | 每自然周一行预算；其余统计读取时现算 |
| 15 | 0005 | `ledger_entries` | **读写**（第 5 轮） | 收支明细流水，只追加不修改 |
| 16 | 0005 | `settlements` | **读写**（第 6 轮） | 结算结果、结局、匹配与信件 |
| 17 | 0006 | `pool_posts` | **读写**（第 7 轮） | 公开池（发布即公开） |
| 18 | 0006 | `replies` | **读写**（第 7 轮） | 回信/打气 |
| 19 | 0006 | `reports` | **读写**（第 7 轮） | 举报计数，达阈值自动隐藏 |
| 20 | 0006 | `share_links` | **读写**（第 7 轮） | 分享 token 与字段白名单 |
| 21 | 0006 | `demo_sessions` | **读写**（第 3、8 轮） | 演示会话（TTL、单行 CAS 状态、与演示账号 1:1） |
| 22 | 0007 | `ai_suggestions` | **读写**（第 8 轮） | AI 建议缓存与每日额度计数（相同输入只调用一次） |

一次建齐目标表而不是"用到才建"：迁移是平台侧唯一能改 DDL 的通道，后续轮再加表要多一次授权与一轮回归；先把列定下来，第 3–7 轮只写 Function 代码，第 8 轮才新增 `ai_suggestions`（缓存与额度计数无法复用既有表，且不含业务内容）。**第 8 轮后 20 张表已接入**，只剩 2 张没有对客户端的读接口（`wish_templates` / `rewards`；`rewards` 只在结算内部读），`check-schema-usage.ts` 因此只报统计、不报未用表。平台不接受 `CREATE UNIQUE INDEX`，所有唯一性都用建表期表级 `UNIQUE (...)` 表达（第 3 轮的增量索引已并入 0004）。

## 2. 全局建表规则（迁移子集，`check-migrations.ts` 逐条校验）

| 规则 | 落地方式 |
| --- | --- |
| 类型 | 只用 `boolean / integer / bigint / text / uuid / timestamptz / jsonb`。**无** `date`（→ `text` + `isValidYmd()`）、**无** `numeric`（→ `integer` 分）、**无** `varchar(n)`（长度在 Function 层校验）、**无**数组类型（→ `jsonb`） |
| 语句 | 只有 `CREATE TABLE app.x` / `ALTER TABLE app.x ADD COLUMN`（可空、无默认）/ 普通 `CREATE INDEX`；**不接受 `CREATE UNIQUE INDEX`**；无 DML、无 `COMMENT ON`、无 `GRANT` |
| 约束 | 列级 `NULL / NOT NULL / PRIMARY KEY` + 字面量默认；**表级 `UNIQUE (...)` 可用**（唯一性的唯一表达方式）。`CHECK`、`REFERENCES`、触发器、自定义函数不可用 ⇒ 跨表约束由唯一约束 + 归属校验承担，见 §5 |
| 默认值 | 只允许字面量、`gen_random_uuid()`、`now()`；`jsonb` 与 `text` 数组类列**没有默认值**，由 Function 必赋值（漏传即 400/500，是好事） |
| 主键 | 一律 `id uuid PRIMARY KEY`。三类例外必须服务端显式给 id：`users.id`（要先进幂等主体）、`auth_tokens.id`（= JWT `jti`，签发时生成）、`idempotency_keys.id`（占位行）；其余表 `DEFAULT gen_random_uuid()` |
| 时间 | `created_at` / `updated_at` 全表 `NOT NULL DEFAULT now()`；业务瞬时另起列（`expires_at`、`revoked_at`、`server_ts`…），日历语义列一律 `text YYYY-MM-DD`（`start_date` / `task_date` / `week_start`） |
| 索引命名 | 普通索引 `<table>_<列序>_idx`，`check-migrations.ts` 拒绝前缀与表名不一致的写法。表级 `UNIQUE` 的约束名由数据库生成，本文用 `<table>_<列序>_uidx` 作为**逻辑代称**（与 FakeDb 的唯一索引表一致），不要拿去当真实约束名查 |
| 排序方向 | 索引只写列组合（平台不接受 `ASC/DESC`、表达式、部分索引），方向在 Function 的 `order()` 里给；二级排序键固定 `id asc` 保证翻页稳定 |

## 3. 已接入的 20 张表

> 3.1–3.5 是第 2 轮（账号与会话），3.6–3.9 是第 3 轮（愿签与任务引擎），3.10–3.11 是第 4 轮（打卡与补卡），3.12–3.13 是第 5 轮（账本），3.14 是第 6 轮（结算），3.15–3.19 是第 7 轮（上传、公开池、回信、举报、分享），3.20 是第 8 轮（AI 建议缓存）。

### 3.1 `app.users`

| 列 | 类型 | 说明 / 代码入口 |
| --- | --- | --- |
| `id` | uuid PK | 服务端 `uuid()` 生成；同时是归属判定唯一依据（`ctx.principal.userId`） |
| `nickname` | text NOT NULL | 1–32 字符，服务端 trim；缺省时由 `defaultNickname(id)` 生成"愿TA 用户 + 4 位码"（[domain/users.ts:59](../backend/domain/users.ts#L59)） |
| `avatar` | text | 只允许 `default_01…default_12`，禁外链（防追踪与 SSRF） |
| `client` | text | 注册入口 `web / mp / app`（`lib/ip.ts#classifyClient` 按 UA 归类） |
| `status` | text | `active / frozen / deleted`；本轮只有 `active`，鉴权层读到其它值 → 403 `account_frozen` |
| `is_demo` | boolean | 演示账号总开关；下游所有表靠 `user_id` 天然隔离 |
| `recovery_code_hash` | text NOT NULL | **【摘要】** `HMAC-SHA256(RECOVERY_PEPPER, 归一化恢复码)`，明文只在响应里出现一次；`users_recovery_code_hash_uidx` 唯一 |
| `reg_channel` | text | 来源渠道，guest 请求体 `channel` 枚举写入 |
| `reg_ip_hash` | text | **【摘要】** 注册 IP 的 HMAC，只用于每 IP 每小时计数，不作安全边界 |
| `profile_text` | text | 简介 ≤100 字符，`PATCH /api/me` |
| `wish_style_tags` | jsonb | 字符串数组 ≤3 项、单项 ≤12 字符；无默认值 ⇒ 不传就不写这一列 |
| `share_default_public` | boolean | 分享默认公开范围 |
| `settings` | jsonb | 目前只存 `{ quiet_hours: { start, end } }`，默认 23:00–08:00；推送通道后续迭代 |
| `last_active_at` | timestamptz | 签发会话时刷新（`issueSession`） |
| `deleted_at` | timestamptz | 合规删除时刻，与 `status='deleted'` 同时写 |

索引：`users_recovery_code_hash_uidx`（找回的唯一入口）、`(status, created_at)`（清理/运营扫描）、`(reg_ip_hash, created_at)`（10/小时窗口计数）、`(created_at)`。

### 3.2 `app.auth_tokens`

`id` 就是 JWT 的 `jti`，因此**每次鉴权都是一次主键点查**：`lib/auth.ts#authenticate` 按 `claims.jti` 取行，要求 `status = 'active'`、`revoked_at IS NULL`、`expires_at` 未过，再查 `users.status`，最后比对 `row.demo` 与 `claims.demo`。`token_hash` 是 `HMAC(TOKEN_PEPPER, header.payload)`，**只用于审计比对，不参与校验**（真实 token 不入库）。多设备并存，互不挤掉。

索引：`(user_id, status)`（`GET /api/me` 的 `device_count`——最多数到 20 个活动会话、`revokeAllTokens`）、`(status, expires_at)`（过期扫描）、`(token_hash)`（按摘要排查）。

### 3.3 `app.auth_attempts`

恢复码限流的实现表：`kind`（本轮只写 `recover`）、`ip_hash`、`user_id`、`succeeded`、`created_at`。成功也记一行，因此总数窗口（`RECOVER_PER_HOUR`，默认 12）与失败窗口（常量 `FAILURES_PER_HOUR = 8`，判 `succeeded = false`）都能靠 `auth_attempts_kind_ip_created_at_idx` 一次扫描搞定。**这张表是第 1 轮设计稿里没有的**：当时打算扫 `auth_tokens`，但失败尝试不产生 token 行，扫不到 ⇒ 新增专用表。

### 3.4 `app.idempotency_keys`

状态机 `in_progress → succeeded | failed`，`principal` 形如 `u:<userId>` / `i:<ipHash>` / `a:anon`，`operation` 与 `RouteDef.operation` 一一对应。列设计要点：

- `request_fingerprint`：`HMAC(IDEM_FINGERPRINT_KEY, "<METHOD> <path> <sha256(规范化 body)>")` 前 64 位；同 key 不同指纹 → 409 `idempotency_key_reuse`。
- `response_code` 单独存：重放必须保持首次状态码（201 不能变 200）。
- `response_body` 存响应 JSON，上限 **64KB**（`MAX_STORED_BODY_BYTES`）：第 3 轮立契响应要装下 30 天契约的全量任务（最多 90 条），16KB 会被截断导致重放丢字段；**一次性凭证类接口一律 `idempotent: 'none'`**，所以本列不会存档 `access_token` 或恢复码；将来要存敏感响应，改为写 `v1:<iv>:<tag>:<ciphertext>` 密文。
- `completed_at` 只作观测；接管判定用 `updated_at`（陈旧窗口 60 秒）。

### 3.5 `app.demo_sessions`

第 3 轮先在登录链路预留"演示身份"，**第 8 轮才由 `POST /api/demo/session` 正式创建会话**：`id = uuid()` 由服务端生成并只在创建响应里返回，后续请求凭演示 Bearer Token 经 `user_id` 反查，不需要客户端再传会话 id。`user_id` 指向同一次请求新建的 `is_demo=true` 账号，`demo_sessions_user_uidx` 保证一个演示账号只属于一个会话。第 8 轮写入：

| 列 | 本轮怎么用 |
| --- | --- |
| `mode` / `scenario` / `step` / `is_completed` | 基线为 `baseline / mom_knee / 3 / false`；快进后 `full / double_realized / 8 / true`；场景切换写 `double_realized / cyber_only / failed`；重置回基线。字段只描述演示进度，不参与真实业务判定 |
| `ip_hash` | 创建时按 `IP_HASH_SALT` 哈希；`enforceWindow` 用它做 **`DEMO_PER_HOUR`（默认 30）** 的每小时限流，窗口内最多扫 50 行 |
| `expires_at` / `last_seen_at` | `expires_at = 创建 + DEMO_TTL_HOURS（默认 24h）`；每次读状态只刷新 `last_seen_at`。过期后 token 仍可能在有效期内，`requireDemoSession` 先判会话过期并返回 401 `demo_session_expired` |
| `updated_at` | **单行 CAS 令牌**：快进/场景/重置先 `claimDemoSession` 抢 `id + updated_at`，抢不到即 409 `demo_session_busy`，把重建串行化 |

`state` 列保留但本轮不写：可变的 `mode/scenario/step/is_completed` 已足够表达演示状态。清理是**惰性**的：`POST /api/demo/session` 在限流通过后按 `expires_at` 升序取**本 IP 最早到期的 3 条**过期会话，逐条校验 `is_demo` 后删除其子表、愿签、文件、token、会话行与演示账号；没有定时任务。会话过期不会自动删数据，残留由下一次创建顺手清掉。

### 3.6 `app.wishes`（第 3 轮读写）

愿签主表，一行 = 一张愿签/一份契约。业务口径：

| 列 | 本轮怎么用 |
| --- | --- |
| `status` | `draft → active → settling → settled → archived`（另有 `deleted` 软删）。**第 3 轮写 `draft`（创建）与 `active`（立契），第 6 轮写 `settling/settled`（结算）并允许 `settled → active`（仅 `cyber_only/unrealized` 续期一次）**。非法流转在 Function 层判 400，库里是无约束 `text` |
| `relation` / `relation_group` | 创建时由 `relationGroupOf(relation)` 同步写入（`parent/peer/intimate/mentor/stranger`），任务引擎只读 `relation`，`relation_group` 供后续文案语气用 |
| `target_name` / `raw_input` / `title` | 接口词表是 `nickname` / `wish_text` / `title`，映射只在 `toWishDto`。`title` 由 `deriveTitle` 清洗 + 截断 ≤30 字，`raw_input` 保留 ≤120 字原文 |
| `wish_type` / `classifier_type` / `classifier_confidence_bps` | 关键词规则判定（`classifyWish`），两列同值：`wish_type` 是业务分类、`classifier_type` 是审计留痕；置信度用整数万分比替代 `numeric` |
| `five_questions_done` | 派生布尔，由 `saveAnswers` 在五问齐全时用 `eq('five_questions_done', false)` 单行 CAS 置真；立契前必须为 `true`，否则 400 `answers_incomplete` |
| `days` / `start_date` / `end_date` | 创建时 `days=7`、两个日期为 `''`；立契时才定：`start_date = productDate(now)`、`end_date = start_date + days − 1`（TEXT `YYYY-MM-DD`）。`settle_open_at` **不入库**，由 `settleOpenAt(end_date)` 现算 |
| `sign_method` / `signed_at` | 本轮固定写 `'typed'` + 服务端时刻；`drawn`/签名图属后续轮（`signature_file_id` 列已就位） |
| `version` | 派生列一致性计数器：立契时 `+1`，第 5 轮预算修改与账本流水写入各 `+1`（`bumpWishVersion`），第 6 轮结算 `active→settling` 与续期各 `+1`。结算的 CAS 用 `status + version` 双谓词，因此账本变化也会让旧 version 的并发结算失败重读 |
| `is_demo` / `demo_session_id` | 冗余账号的演示标记；`demo_session_id` 由 `demoSessionOf` 回查会话行，真实账号恒为 NULL |
| `user_id` | 归属唯一依据。**读路径**查询直接带 `eq('user_id')`（查空即 404）；**写路径**先按 id 取行再比对，为的是把 403 与 404 分开 |

索引：`wishes_user_created_at_idx`（我的列表，创建时间倒序 + 游标）、`wishes_user_status_created_at_idx`（后续按状态过滤）、`wishes_status_end_date_idx`（惰性结算扫描）、`wishes_template_idx` / `wishes_signature_file_idx` / `wishes_source_wish_idx` / `wishes_forked_post_idx`（关联列只建索引不建 FK）。

限流：`createWish` 用 `enforceWindow(db,'wishes',{column:'user_id', since: dailyWindow.since})` 数**当天创建的愿签行数**，阈值 `WISH_CREATE_PER_DAY`（默认 20）。草稿也计数，否则"建 100 个草稿再逐个签署"能绕过上限；产品日 04:00 重置，`retry-after` 给到下一个日界。

### 3.7 `app.wish_answers`（第 3 轮读写）

一契约一份五问，`wish_answers_wish_id_uidx` 是物理保证。

- 五个 `*_enc` 列**全部加密存储**：`q1_worry_enc / q2_alone_enc / q3_home_enc / q4_disposable_enc / q5_gift_enc`，AES-256-GCM，`v1:<iv>:<tag>:<ciphertext>`，**AAD = `wish_id`**（密文搬到别的愿签上解不开）。密钥 `FIELD_ENCRYPTION_KEY`，`key_version='v1'`。
- **部分提交**：只覆盖本次提交的列，未提交的沿用原值；空串视为"未答"。首次提交 `insertIfAbsent(..., {onConflict:'wish_id'})`，撞索引（并发首提交）就改走 `update`，绝不静默丢答案。
- `completed_at` 只在五问齐全那一刻写一次，之后重复提交不刷新；`wishes.five_questions_done` 是它的派生冗余，供立契前一次点查判定。
- 七个粗粒度明文档位（`q1_gift_category / q2_alone_level / q3_last_home / q3_travel_band / q3_cost_band / q4_disposable_band / q5_reward_id`）中，第 5 轮起**只写 `q4_disposable_band`**：`saveAnswers` 用 `disposableBandOf(q4)` 把可支配金额归到 `under_100 / 100_299 / 300_599 / 600_999 / 1000_plus`，立契时据此推算首周预算，存的是档位而非明文金额；第 6 轮结算会**临时解密 `q5_gift_enc`** 做礼物类别细化与点名匹配，但不在这些明文档位列里另写一份（q5 原文仍只有密文一种落库形态）。
- 明文出口只有一个：后续轮的 `GET /api/wishes/:id/answers`。详情、列表、立契响应、幂等存档里都不出现答案明文或密文。

### 3.8 `app.tasks`（第 3 轮读写）

签署那一刻一次性生成全部天数的任务，之后不动态变更（PRD 5.3）。

| 列 | 本轮怎么用 |
| --- | --- |
| `id` | **确定性派生**：`derivedUuid("yuan-ta-task-v1:<wishId>:<day_index>:<seq>")`。重放得到同一批 id ⇒ `insertIfAbsent(...,{onConflict:'id'})` 只补缺的行，不需要事务 |
| `day_index` | **从 0 起**（展示「第 N 天」时 +1），`0 … days−1` |
| `task_date` / `week_start` | TEXT `YYYY-MM-DD`；`task_date = addDays(start_date, day_index)`，`week_start = weekStartOf(task_date)`（周一），后者供补卡券与账本按周分组 |
| `side` / `seq` | 库内词表 `for_ta/for_self/money`，接口词表 `ta/self/money`（`toTaskDto` 单点映射）。`seq` 固定 `SIDE_SEQ`：为 TA → 为自己 → 钱任务，同日排序用它 |
| `text` | 任务标题。轮转副本追加 `（第 N 轮）`，因此**文案在契约内天然唯一** |
| `is_must` / `is_for_self` | `is_must = side !== 'money'`（每天 2 条必做），`is_for_self = side === 'for_self'`；结算亮灯口径靠这两列，不靠 `side` 字符串比较 |
| `template_id` / `rotation` | 首轮 `template_id` = 模板 id、`rotation=0`；池子抽干后的轮转副本 `template_id=NULL`、`rotation=r≥1`。唯一索引含 NULL 不冲突，所以多个副本能共存 |
| `min_budget_cents` | 只有 `money` 侧带模板的预算下限（整数分），必做两档恒 0 |
| `proof_kind` / `time_slot` | 从模板原样带出；第 4 轮只用于任务展示，不强制证明类型 |
| `status` | 第 3 轮一律 `'pending'`；第 4 轮只走 `pending → done`（打卡）与 `pending → missed → made_up`（惰性日界 + 补卡）。`revoked` 留给撤销接口，本轮未实现 |
| `done_at` / `missed_at` / `made_up_at` | 与状态同一次 CAS 写入：打卡写 `done_at`，日界扫描写 `missed_at`，补卡写 `made_up_at` |

索引：`tasks (wish_id, template_id)`（契约内同一模板不重复）、**`tasks (wish_id, text)`（表级 UNIQUE，契约内标题不重复）**、`(wish_id, task_date)`（今日任务）、`(wish_id, day_index)`（回看/结算亮灯）、`(user_id, status)` 等。

生成顺序不可换：**`planTasks` 纯函数规划 → `wishes` 单行 CAS（`eq('status','draft')`）→ `insertPlannedTasks` 批量写**。必做两档候选池为空时在 CAS 之前抛 503 `task_pool_empty`，因此不可能留下"active 但零任务"的愿签；进程崩在批量写中间时，重签（`first_sign:false`）会补齐缺失行。

### 3.9 `app.task_templates`（第 3 轮读）

任务引擎的候选池，只读不写。主查询 `(is_active, wish_type, side)`：

```
select … where is_active = true and wish_type in (<本愿签类型>, 'any') limit 200
```

再在代码里按关系过滤（`relation` 为空 = 通用池，非空则必须等于愿签的 `relation`）。**没有 `relation_group` 列**：第 1 轮设计稿的"按关系组抽"改成了"按具体关系抽 + 通用兜底"，粒度更细且不需要维护第二套映射。

抽牌堆排序键固定 `(关系专属优先, sort_order, id)`，两档各自用 `mulberry32(sha256("yuan-ta-task-v1:"+wishId))` 洗牌后拼接 ⇒ 与数据库返回顺序无关，同一愿签重放得到同一副牌。

`weekend_only` **只标在 `side='money'` 上**：引擎按"周末追加钱任务"调度，必做两条不区分工作日；给必做模板标 `true` 会让工作日抽不到候选。`build-seeds.ts --check` 有对应断言。

种子配比（120 条 = 6 类 × 20 条）：每类 **10 条 `for_ta` + 8 条 `for_self` + 2 条 `money`**。`for_ta` 里关系专属的条数按类型不同：body 3 条（妈妈/姥姥/爷爷）、lonely/study/emotion 各 1 条、sleep/life 全通用 ⇒ **任何关系下通用 `for_ta` 都 ≥7 条**，7 天契约零轮转；`for_self` 8 条全通用，同样够 7 天。`money` 每类 2 条，刚好覆盖 7 天契约最多 2 个周末日；14 天契约（最多 4 个周末日）起 `money` 侧进入轮转，30 天契约的 `for_ta` 侧也会轮转。

### 3.10 `app.checkins`（第 4 轮读写）

一个任务最多一条打卡，`UNIQUE (task_id)` 是物理约束；重复提交**原地覆盖**同一行（证明、备注、`server_ts`），不新增行。

| 列 | 本轮怎么用 |
| --- | --- |
| `task_id` | 打卡的任务；`checkins_task_id_uidx` 保证一任务一行。并发首提交先 `insertIfAbsent(...,{onConflict:'task_id'})`，返回 0 行则改走 `update` |
| `wish_id` / `user_id` | 归属冗余：`user_id` 取愿签作者，`wish_id` 供按契约聚合与结算轮统计；写入前已由 `requireTaskAuthor` 校验 |
| `proof_file_id` / `proof_sha256` | 证明图片只存 `files.id` 与摘要；`proof_sha256` 从 `files.sha256` 复制，供"同图重复"查询期现算，不占状态位 |
| `note` | 可选备注，接口层 `text 0..30`；空串落 `''` |
| `is_makeup` | 打卡 `false`、补卡 `true`；结算轮用它区分「完成」与「补回」 |
| `channel` | 本轮恒 `online`；离线同步接口未实现 |
| `checkin_date` | 实际提交的产品日（补卡时是补卡当天，任务日期看 `tasks.task_date`） |
| `client_ts` / `server_ts` | `client_ts` 恒 `null`；`server_ts` 是服务器时间权威值，重复提交会被刷新 |
| `revoked_at` | 撤销接口未实现，本轮恒 `null` |

索引：`checkins_task_id_uidx`（一任务一行）、`(user_id, created_at)`（`CHECKIN_PER_MINUTE` 分钟窗计数）、`(wish_id, server_ts)`（结算轮按契约取记录）、`proof_file_id` / `proof_sha256`（图片关联与同图检测）。

### 3.11 `app.makeup_tickets`（第 4 轮读写）

按「愿签 × 自然周」发券，`UNIQUE (wish_id, week_start)` 保证一周最多一张；发券走 `insertIfAbsent`，重放不叠加。

| 列 | 本轮怎么用 |
| --- | --- |
| `week_start` | 自然周周一（`weekStartOf(task_date)`），TEXT `YYYY-MM-DD`；补卡只能补**当前周**的漏卡 |
| `week_index` | 从签约周算起，首周 = `1`（基准是 `weekStartOf(start_date)`，不是签约日，所以周三签约也不影响周序号） |
| `status` | `available → used`（单行 CAS 消费）或 `available → expired`（读路径按 `expires_at` 惰性判定）；无定时任务 |
| `task_id` / `used_at` | 消费时指向被补的任务；任务 CAS 失败会把券放回并把这两列清空 |
| `expires_at` | `makeupExpiresAt(week_start)`（`lib/time.ts`）；过了就作废，与是否被使用无关 |

发放时机：签约时发首周券（随 `POST .../contract` 返回）；之后由 `GET .../tasks/today` 与补卡请求惰性补发当前周券。补卡请求先校验任务 `missed` 且属于当前周，再校验证明图片，最后才烧券。

### 3.12 `app.ledger_weeks`（第 5 轮读写）

一张愿签 × 一个自然周一行，`UNIQUE (wish_id, week_start)` 是物理保证。**只把 `budget_cents` 当真值，其余统计列一律不依赖**：

| 列 | 本轮怎么用 |
| --- | --- |
| `week_start` | 自然周周一（`weekStartOf`），TEXT `YYYY-MM-DD`；只接受契约起止区间内、且是周一的日期 |
| `week_index` | 从签约周起算，首周 `1`（`dayIndexOf` 同源计算），供前端按周定位 |
| `budget_cents` | **唯一写入的统计列**。首周由 `q4_disposable_band` 推算（2,000/4,000/8,000/12,000/20,000 分，缺档 5,000），用户可用 `PUT` 改当前/未来周；输入上限 200,000 分 |
| `spent_cents` / `saved_cents` / `earned_cents` / `counted` / `over_budget` | **建而不写**，恒为初始值（0/false），冒烟测试专门断言它们保持 0。统计在 `domain/ledger.ts#readLedger` 里由 `ledger_entries` + `tasks` 实时聚合，避免"写流水后重算周表"这一多 SDK 调用窗口 |
| `proof_file_id` | 预留超额凭证，本轮不写；超额只提示、不拦截提交 |
| `computed_at` | 行创建时刻，只作观测；不承担"是否过期"判定（统计不缓存） |

写入路径只有两条：`ensureWeekBudgetRow`（`insertIfAbsent(...,{onConflict:'wish_id,week_start'})`，撞索引后回读）与 `setWeekBudget` 的 **`updated_at` 单行 CAS**（`eq('id').eq('updated_at')`，最多重试 3 次，仍冲突则 409 `ledger_week_conflict`）。之所以用 `updated_at` 当令牌：这张表没有 `version` 列，而每次 CAS 都写入严格递增的服务端时间，天然满足"值变了就失败"。

### 3.13 `app.ledger_entries`（第 5 轮读写）

流水只追加：本轮没有修改/删除接口，`revoked_at` 恒 `null`。金额**恒为正**，方向由 `entry_kind` 决定。

| 列 | 本轮怎么用 |
| --- | --- |
| `entry_kind` | 库内值域 `expense / saved / earned / self_spend`，**第 5 轮只写 `expense` 与 `earned`**；接口词表 `expense / earning` 由 `toLedgerEntryDto` 单点映射 |
| `amount_cents` | 整数分。支出 `0 < amount ≤ 200,000`，收入 `1 ≤ amount ≤ 100,000`；无浮点 |
| `week_start` | 必须与愿签契约周对齐；收入还必须与关联任务的 `tasks.week_start` 相同（400 `earning_week_mismatch`） |
| `note` | ≤60 字，空串落 `''` |
| `proof_file_id` | 可选；给了就必须是当前用户、当前愿签、`status='ready'` 且 `purpose='ledger_proof'` 的图。**收入也允许不传**（本轮需求书把账本证明列为可选，与打卡证明必填不同） |
| `task_id` | 收入必填：任务须存在、属于当前愿签、`side='money'`、状态 `done/made_up`，且同周；支出恒 `null` |
| `checkin_id` | 预留"打卡带出流水"，本轮恒 `null` |
| `source` | 本轮恒 `manual`；`checkin/settlement` 留给后续轮 |
| `server_ts` / `created_at` | 服务端时刻；读路径按 `week_start` 分组、按 `server_ts` 升序 |
| `revoked_at` | 本轮恒 `null`，软撤销接口未实现 |

索引：`ledger_entries_wish_week_idx`（周聚合主查询：`eq wish_id` + `eq week_start`，本轮再加 `isNull revoked_at`）、`(user_id, server_ts)`、`task_id`（重复收入关联的读检查）、`proof_file_id`、`created_at`。

**重复收入关联没有库级唯一约束**（平台只能在建表期写表级 UNIQUE，而"每个 money 任务最多一条 earning 流水"需要部分索引语义）。本轮用写前读检查 `(wish_id, task_id, entry_kind='earned', revoked_at IS NULL)` 拦 400 `duplicate_earning_link`；并发双写仍可能各插一行，本周流水读取时会重复计入收入——这是已记录的残余风险（见 `docs/07-round5-summary.md`），根治需后续迁移加表级唯一列。

`wish_id` 与 `user_id` 都是归属冗余：写入前由 `requireAuthor` 校验，读路径直接带 `wish_id` 谓词。

### 3.14 `app.settlements`（第 6 轮读写）

一行 = 一个结算版本。第 6 轮**只写一版**（续期后重结算才写 version 2），`UNIQUE (wish_id, version)` 是并发防线。快照语义：金额与统计在写入时实时算出并冻结，后续任务/账本再变也不改这一行；读取时 `task_details` 另从 `tasks` 现取（只用于展示明细），亮灯计数用快照列。

| 列 | 本轮怎么用 |
| --- | --- |
| `version` | 结算版本，从 `max(version)+1` 起；续期后重结算写下一版。`insertIfAbsent(...,{onConflict:'wish_id,version'})`，撞索引后按 `(wish_id, version)` 回读；回读不到才 409 `settlement_conflict` |
| `outcome` | `double_realized`（双重兑现）/ `cyber_only`（赛博实现）/ `unrealized`（未实现）。判定只读 `tasks.is_must` 与 `tasks.side='money'`：必做有 `missed` → unrealized；必做全完成但钱任务未全完成 → cyber_only；全完成 → double_realized |
| `must_total/must_done/money_total/money_done` | 结算时的任务计数快照；`checkin_count` = `status='done'` 数，`makeup_count` = `status='made_up'` 数（两者相加 = 全部完成数，含钱任务） |
| `budget_cents/spent_cents/saved_cents/earned_cents/total_cents` | 直接取第 5 轮 `readLedger` 的 `totals`：`saved = Σ 已计入周结余`、`earned = Σ 已确认兼职收入`、`total = saved + earned`。读取接口不重算金额，避免"结算后又记流水"改写历史结局 |
| `reward_id` / `reward_min_cents` / `reward_max_cents` | 匹配礼物的 id 与**价格区间快照**（礼物改名或下架不影响历史结算）；类别来自 `wish_type + q5`，候选为 `is_active` 且 `min_cents ≤ total_cents`，优先 q5 点名、其次价格上限最高；`>30%` 差额强制落类别最低价 |
| `gap_cents` / `gap_band` | `gap = max(0, 价格中位数 − total_cents)`；`gap_band` 只有 `exact`（≤10%）/ `near`（10%–30%）/ `far`（>30%）三种，**不写设计稿里的 `surplus`**；比例用整数 `gap_bps` 计算，不存浮点 |
| `progress_ratio_bps` | `(must_done + money_done) / (must_total + money_total)` 的万分比，供第一幕进度展示 |
| `self_summary` | jsonb，无迁移期默认值，服务端必写：`copy_text`（差额文案）、`letter_template`（信件模板）、`matched_by`（`gift_hint`/`price_range`）、`gift_category`、`weekly_saved_yuan`/`weeks_needed`（攒钱建议）、`gap_band_label`/`outcome_label`/`gift_title`/`days` |
| `letter_text` | 默认等于 `letter_template`；本轮到 `GET .../settlement` 原样返回，编辑接口未实现（`letter_updated_at` 恒 `null`） |
| `card_file_id` / `letter_file_id` | 预留兑现卡/信件图，上传两段式未实现，恒 `null` |
| `sealed` / `sealed_at` / `revealed_at` | 第 6 轮写 `false` / `null` / `null`：**两幕在 `settled` 后由同一个 GET 一起返回**，设计稿的"第一幕盖章 → 第二幕 72 小时展开"ack 流程未做（无 `POST /api/settlements/:id/ack`） |
| `computed_at` | 结算计算时刻，幂等重放与详情展示都用它；`created_at/updated_at` 由写入显式给服务端时刻 |

写入顺序（无事务）：`active→settling`（`status + version` CAS）→ 实时统计 + 读账本 + 匹配礼物 → `insertIfAbsent` 快照 → `settling→settled`（`eq('status','settling')` 收尾）。进程崩在"快照已写、状态未收尾"时，下一次 `settle` 读到 `settling` + 已有快照会直接补收尾并返回 `already_settled:true`；`settling` 超过 60 秒且无快照时允许 `updated_at` CAS 接管。**快照必须先于收尾**，否则会出现"settled 但没有结算记录"的 409 `settlement_missing`。

索引：`UNIQUE (wish_id, version)` 服务版本读取与并发拦截；`settlements_user_created_at_idx`（作者历史列表预留）、`settlements_sealed_sealed_at_idx`（封印扫描预留）、`settlements_reward_idx`、`settlements_created_at_idx`。

### 3.15 `app.files`（第 7 轮读写）

一行 = 一个对象。第 7 轮补上两段式直传：`presign` 插入 pending 行并签发 PUT URL，`complete` 下载对象实测后 CAS 标 ready。**库里永远不存字节，也不存签名 URL。**

| 列 | 本轮怎么用 |
| --- | --- |
| `object_key` | `u/<userId>/<purpose>/<fileId>.<ext>`，**服务端派生**（[domain/upload.ts:91](../backend/domain/upload.ts#L91)），客户端不可指定；`UNIQUE` 保证同一 key 不会两个 id。`ext` 由 MIME 白名单映射（jpeg/png/webp → jpg/png/webp） |
| `user_id` / `wish_id` | 归属唯一依据；`wish_id` 可选，给了就必须是当前用户自己的愿签（`requireAuthor`），否则 403 |
| `purpose` | 第 7 轮只接受 `checkin_proof / ledger_proof / share_image`；打卡校验要 `checkin_proof`、账本流水要 `ledger_proof`，两者目录天然隔离 |
| `status` | `pending → ready`（complete 的 `eq('status','pending')` 单行 CAS）；格式与声明不一致写 `rejected`；第 9 轮起超过 `expires_at` 仍未确认写 `expired`（pending 2 小时失效）；`deleted` 本期无接口写入 |
| `mime_type` / `size_bytes` / `sha256` | 全部是 `complete` 阶段的**服务端实测值**：大小以边读边数的字节为准（声明值只用于 presign 早退），MIME 用文件头 magic bytes 复核，`sha256` 供同图检测；`sha256` 不出接口 |
| `width` / `height` | 建表预留，本轮不解析，恒 0 |
| `is_public` | 恒 `false`：私有桶 + 600s 签名 URL，没有公开读路径 |
| `verified_at` | CAS 成功时写入；`ready` 重放直接返回该行（幂等） |
| `expires_at` | presign 时 = 现在 + **2 小时**；超过后 `complete` 返回 400 `upload_expired` 并把该行置 `expired`；同账号下一次 `presign` 再按 `expires_at` 惰性批量标记过期 |

索引：`files_object_key_uidx`（对象唯一）、`(user_id, created_at)`（每小时 30 次窗口计数）、`(wish_id)`（证明关联）、`(status, expires_at)`（过期 pending 的惰性批量标记）。**残余风险**：`expired` 只改行状态，对象存储里的残留对象不会被删；平台无 cron，需按 `files (status, expires_at)` 做离线清扫。对象存储真实行为（私有桶、PUT 的 content-type 约束、download 超时）未在云端验证。

### 3.16 `app.pool_posts`（第 7 轮读写）

一行 = 一条公开帖，`UNIQUE (wish_id)` 保证一个愿签最多一条。只存**脱敏摘要**，不存愿签原文以外的隐私字段（不复制五问、账本、文件、作者昵称）。

| 列 | 本轮怎么用 |
| --- | --- |
| `wish_id` / `author_id` | 归属：发布先 `requireAuthor`，结算后（`status='settled'`）才允许；`author_id` 不进任何公开 DTO |
| `wish_type` / `relation` | 分类取 `WISH_TYPES` 白名单，非法值回落到愿签自身的 `wish_type`；`relation` 原样复制，公开返回 |
| `excerpt` | 服务端从 `excerpt ?? title ?? raw_input` 经 `lib/sensitive.ts#toExcerpt` 脱敏到 ≤120 字；空结果兜底「一个没有说出口的愿望」 |
| `display_label` | `is_anonymous ? '匿名搭子' : '许愿人'`，真名永不出现 |
| `status` | `published` 发布即公开；`hidden` 由举报满阈值 CAS 写入（`eq('status','published')`）；`deleted` 由作者 unpublish 写入。`hidden` 不可重发（400 `pool_hidden`），`deleted` 重发复用同一行复位 `published` |
| `report_count` / `reply_count` | 可重算派生列：举报数写时刷新；回信数写后尽力刷新、读详情时实时数 `published` 回信，**不作为业务判定依据** |
| `fork_count` / `forked_from_id` | fork 未实现，恒 0 / NULL |
| `published_at` | 首次发布时刻，公开池排序键（`desc`）；重新发布不刷新（保持原帖位置），列表游标以它为准 |
| `hidden_at` / `deleted_at` | 对应状态写入时刻，供审计与展示 |

索引：`(status, published_at)`（最新列表）、`(wish_type, published_at)`（分类列表）、`(status, reply_count)`（后续热帖排序预留，`sort` 本轮只接受 `latest`）、`(author_id, created_at)`、`(forked_from_id)`。

### 3.17 `app.replies`（第 7 轮读写）

一行 = 一条打气回信，服务端脱敏后立即 `published`。

| 列 | 本轮怎么用 |
| --- | --- |
| `post_id` / `wish_id` / `author_id` | `post_id` 必须指向可见帖（`requireVisiblePost`）；`wish_id` 从帖子冗余带出；`author_id` 只用于归属与删除权限 |
| `content` | ≤80 字（路由正文上限 200 只为给出精确错误，域名再查 80 → 400 `content_too_long`）；命中 `containsSensitive` → 400 `sensitive_content`；帖子作者关了回信 → 400 `replies_disabled` |
| `status` | `published → deleted`（软删写 `deleted_at`）；列表只取 `published`，`hidden` 本期无写入路径 |
| `report_count` | 举报接口本期只支持 `pool_post`，回信举报未开放，恒 0 |
| `read_at` | 角标预留，本轮不读写 |
| `is_demo` | 演示账号回信，列表不按它过滤（公开池帖子才过滤演示） |

限流（两道，均按产品日 04:00 重置）：全站每人每天 `REPLY_PER_DAY`（默认 20）走 `enforceWindow(replies, author_id, created_at)`；**同帖每人每天一条**用「窗口查询 + 插入」实现——`replies` 没有对应唯一约束（时间窗无法建唯一索引），并发下可能多一条，属**已记录的残余竞态**（见 §9）。

索引：`(post_id, created_at)`（按帖翻页）、`(author_id, created_at)`（日限）、`(status, created_at)`、`(wish_id, created_at)`、**(post_id, author_id, created_at)**（同帖日限查询）。

### 3.18 `app.reports`（第 7 轮读写）

第 7 轮只写 `target_type='pool_post'`；`reply/wish` 的举报留给后续。

| 列 | 本轮怎么用 |
| --- | --- |
| `target_type` / `target_id` / `reporter_id` | `UNIQUE (target_type, target_id, reporter_id)`：重复举报走 `insertIfAbsent`，撞索引返回 409 `report_duplicate`，不叠加阈值 |
| `reason_code` | 白名单 `privacy / harassment / illegal / spam / sexual / other`，路由 `BODY` 校验 |
| `detail` | ≤200 字，空串落 `''` |
| `status` / `action_taken` / `acted_at` | 创建即 `open`；帖子达到隐藏阈值时，同一次请求把该目标的 `open` 报告批量改为 `acted` + `action_taken='auto_hidden'`；`dismissed` 无写入路径（无人工工作台） |

索引：`reports_target_reporter_uidx`（去重）、`(target_type, target_id, created_at)`（按目标计数）、`(reporter_id, created_at)`（每小时 20 次限流）、`(status, created_at)`（审计）。

### 3.19 `app.share_links`（第 7 轮读写）

一行 = 一张愿签的分享链接，`UNIQUE (wish_id)` 保证一契约一短链；重新生成**轮换 token** 而不是新增行。

| 列 | 本轮怎么用 |
| --- | --- |
| `wish_id` / `user_id` | 生成/撤销都先 `requireAuthor`；`user_id` 与愿签作者一致 |
| `token` | `lib/id.ts#shortToken(16)` 的 Crockford base32（**26 字符，128bit**），`UNIQUE`；路由形状校验 `/^[A-Za-z0-9_-]{16,32}$/`，形状不对直接 404。**token 不进日志** |
| `visibility` | 固定 `link_only`（需求未要求公开索引）；`public` 值保留但本轮不接受 |
| `include_flags` | 建表预留；本轮固定白名单投影，不读该列 |
| `passphrase_hash` | 访问口令未实现，恒 `''` |
| `status` / `revoked_at` | `active ⇄ revoked`：`DELETE` 写 revoked；再次生成把同一行复位 `active` 并换 token（旧 token 立即失效）。重复撤销幂等返回当前状态 |
| `visits` / `last_visited_at` | 每次成功打开公开页 `visits+1` 并刷新 `last_visited_at`；只做展示，允许丢失，不承载业务判定 |
| `share_file_id` | 分享卡片图未实现，恒 NULL |

索引：`share_links_wish_id_uidx`、`share_links_token_uidx`、`(user_id, created_at)`、`(status)`。读取路径 `readSharedWish` 只按 `token` 点查，且按白名单投影（见 docs/02 §10）。

### 3.20 `app.ai_suggestions`（第 8 轮读写）

一行 = 一个用户在一个能力上的一次输入缓存，同时充当**每日额度计数**。只存脱敏后的输入摘要与建议文本，不存愿签原文、不写业务表。

| 列 | 本轮怎么用 |
| --- | --- |
| `capability` | 本轮只写 `polish_wish`；`task_candidate` / `reply_draft` / `letter_draft` 已在 `domain/ai.ts` 预留同名常量，将来共用本表 |
| `input_hash` | `SHA-256(能力 + 提示词版本 + 脱敏输入 + 关系 + 愿望类型)`；`UNIQUE (user_id, capability, input_hash)` 保证同用户同输入只有一行 |
| `input_redacted` | 脱敏后的输入（手机号、长数字打码），只用于排查，不返回给客户端 |
| `suggestions` | jsonb 字符串数组，落库前已通过"1–3 条、单条 ≤60 字、非空"校验；损坏或形状不对按未命中处理并删除后重算 |
| `source` | `agent` / `template`；**只有 `agent` 行计入 `AI_POLISH_PER_DAY`**，模板兜底不消耗额度也仍写缓存，避免同一失败输入反复打模型 |
| `fallback_reason` | `timeout / agent_error / invalid_output / quota_exceeded`，成功为空串；客户端据此展示"AI 暂时不可用，已给模板建议" |
| `model` | 适配器回报的模型标识，模板兜底写 `template`；便于后续排障 |
| `expires_at` | `创建 + AI_CACHE_TTL_HOURS（默认 72h）`；读缓存时命中过期行就删掉重算，无定时任务 |
| `created_at` | 额度窗口：`dailyWindow(now).since` 起按 `(user_id, source='agent')` 计数，最多扫 1000 行（`QUOTA_SCAN`；配置上限也是 1000） |

索引：`ai_suggestions_user_capability_input_uidx`（唯一缓存键）、`(user_id, source, created_at)`（额度计数）、`(user_id, created_at)`、`(expires_at)`（惰性清理）。并发双写同一输入时 `insertIfAbsent` 只留一行，落败请求回读胜者结果，不重复调用、不重复计费。

## 4. 尚未接入的 2 张表的关键设计

> `wishes` / `wish_answers` / `tasks` / `task_templates` / `checkins` / `makeup_tickets` / `ledger_weeks` / `ledger_entries` / `settlements` / `files` / `pool_posts` / `replies` / `reports` / `share_links` / `demo_sessions` / `ai_suggestions` 已接入，业务说明移到 §3；本节只留没有写 Function 代码的两张目录表。

| 表 | 关键点 |
| --- | --- |
| `wish_templates` | `relation` 存 PRD B-02 的 12 种**中文原值**（见 §6 取舍），`wish_type` 为六类之一或 `''`（不限类型），`batch` + `is_active` 支持"换一批"与整池停用；主查询 `(is_active, relation)` / `(is_active, wish_type)`。**已 seed 72 条（12 关系 × 6 类，每关系每类 1 条），但还没有读接口**——`GET /api/meta/wish-templates` 属后续轮 |
| `rewards` | `title / note` 取代 `name`，`min_cents / max_cents`（分）取代 `price_*`，`recommend_flags jsonb` 取代两个数组列；`stock_left` 为 NULL 表示不限库存，本轮只展示不扣减；**第 6 轮由结算内部读取**（按类别 + `min_cents ≤ realized` 过滤，价格区间只在结算出参里带出），对客户端仍无读接口（PRD D-06） |

## 5. 唯一约束 = 业务约束（无事务、无 CHECK 环境下的第二道防线）

> 下表名称是逻辑代称（真实约束名由数据库生成）；行为与 FakeDb 的唯一索引表一一对应。

| 唯一索引 | 业务含义 | 撞车时的行为 |
| --- | --- | --- |
| `users_recovery_code_hash_uidx` | 恢复码全局唯一 | `createUser` 内换码重试最多 3 次；仍撞则 409 `recovery_code_collision`，绝不覆盖他人摘要（`rotateRecoveryCode` 同理） |
| `idempotency_keys_principal_operation_key_uidx` | 一个主体一个操作只用一把 key | `insertIfAbsent` 返回 0 行 ⇒ 走接管/重放分支 |
| `demo_sessions_user_uidx` | 一个演示账号只绑一个会话 | 回读校验不同源 → 409 `demo_session_unavailable` |
| `wish_answers_wish_id_uidx` | 一个契约一份五问 | 首次提交 `insertIfAbsent(...,{onConflict:'wish_id'})`；返回 0 行（并发首提交）就改走 `update`，不插第二行也不丢答案 |
| `makeup_tickets_wish_week_uidx` | 每契约周最多一张券 | 发券走 `insertIfAbsent(...,{onConflict:'wish_id,week_start'})`，撞索引即视为已发；消费用 `eq('status','available')` 单行 CAS，0 行即券已被用 |
| `tasks_wish_template_uidx` | 契约内同一模板不重复 | 抽牌堆按序取下一张，一轮取完进入轮转副本（`template_id=NULL`，唯一索引含 NULL 不冲突） |
| **`tasks_wish_text_uidx`（0004 表级 `UNIQUE (wish_id, text)`）** | **契约内任务标题不重复**（PRD 5.3 硬要求） | 生成器先去重；轮转副本标题带 `（第 N 轮）` 后缀，因此文案也天然唯一。派生 id + `insertIfAbsent` 让重放只补缺行，撞约束即"已存在" |
| `checkins_task_id_uidx` | 一个任务最多一条打卡 | 首提交 `insertIfAbsent(...,{onConflict:'task_id'})`；返回 0 行（并发首提交）改走 `update`，重复提交原地覆盖证明/备注 |
| `ledger_weeks_wish_week_uidx` | 一周一行预算 | `ensureWeekBudgetRow` 走 `insertIfAbsent(...,{onConflict:'wish_id,week_start'})`，撞索引即回读；预算修改用 `updated_at` 单行 CAS，不插第二行 |
| `settlements_wish_version_uidx` | 结算版本不并存 | 结算先用 `status + version` CAS 抢到 `settling`；快照 `insertIfAbsent` 撞索引后按 `(wish_id, version)` 回读，回读不到 409 `settlement_conflict`；续期后重结算写下一版 |
| `pool_posts_wish_id_uidx` | 一个契约一条公开帖 | 首发布 `insertIfAbsent(...,{onConflict:'wish_id'})`，撞索引回读同一行；已 `published` 直接返回 `created:false` |
| `reports_target_reporter_uidx` | 重复举报不叠加阈值 | `insertIfAbsent` 返回 0 行即 409 `report_duplicate`，不插第二行 |
| `share_links_wish_id_uidx` / `share_links_token_uidx` | 一契约一短链、token 全局唯一 | 再次生成更新同一行的 `token/status`（轮换，不新增行）；`shortToken` 随机 128bit，撞车概率可忽略，未做重试 |
| `files_object_key_uidx` | 同一对象 key 不写两次 | key 由 `fileId` 派生且 id 每次新生成，正常不会撞；并发同 id 重放由 PK 兜底。complete 只更新不插入 |
| `ai_suggestions_user_capability_input_uidx` | 同用户同能力同输入只算一次 | `insertIfAbsent(...,{onConflict:'user_id,capability,input_hash'})`；返回 0 行即并发落败，回读已存在行并 `cached=true`，不重复调用模型、不重复计费 |

归属校验**不依赖外键**：**读路径**在同一条查询里带 `user_id` / `author_id` 谓词（`docs/01` §11.2），跨用户访问按"查不到"处理返回 404。**写路径是第 3–5 轮的显式例外**：`requireAuthor` / `requireTaskAuthor` 先按 id 取行再比 `user_id`，为的是把「不存在」(404 `wish_not_found` / `task_not_found`) 与「不是你的」(403 `wish_forbidden`) 分开——需求要求越权写明确 403，不能被 404 掩盖；账本读与今日页同属这个例外（需求明确非作者 403）。这两个函数只回愿签/任务行本身，不外泄字段。

批量写的**第一道防线是确定性派生 id**（`tasks.id = derivedUuid(wishId:day_index:seq)`）+ `insertIfAbsent`，唯一索引是第二道：平台"多次 SDK 调用不构成事务"，所以重放必须天然收敛到同一批行，而不是靠冲突报错回滚。

## 6. 三处刻意的命名/取值取舍

1. **关系列直接存中文**（`wishes.relation`、`wish_templates.relation`、`pool_posts.relation`），值域是 PRD B-02 的 12 项：妈妈 / 爸爸 / 奶奶 / 爷爷 / 姥姥 / 姥爷 / 室友 / 闺蜜 / 兄弟 / 恋人 / 老师 / 一个陌生人。理由：本项目关系的英文码只用于展示映射，引一套 `mom/dad/...` 就得再维护一张映射表，且 seed 与线上数据容易对不上。需要英文码的场合（`relation_group`）另存一列：`parent / peer / intimate / mentor / stranger`。
2. **`wish_type` 六类以 seed 为准**：`body`（身体）/ `sleep`（睡眠）/ `lonely`（孤单）/ `study`（学业）/ `emotion`（情绪）/ `life`（生活）。第 1 轮设计稿写的 `health/daily` 已弃用；`task_templates.wish_type` 允许 `'any'` 表示通用兜底池。种子数据条数由 `build-seeds.ts --check` 兜底：愿望模板 72 条、任务模板 120 条、礼物 24 件。
3. **种子规模与第 3 轮需求书的偏差（已确认）**：
   - 愿望模板需求写"共 40 条，12 关系每种 4–6 条"——12 × 4~6 = 48~72，**算不出 40**。落地取 **72 条 = 12 关系 × 6 类**（每关系每类恰好 1 条），既满足"每种 4–6 条"的上界，又保证任何关系都能抽到六类愿望。
   - 任务库需求写"共 120 条，覆盖 6 类 × 5 组关系、每组合 ≥12 条"——6 × 5 × 12 = 360，**与 120 条矛盾**。落地保持 **120 条 = 6 类 × 20 条**，关系维度改用"专属模板 + 通用兜底池"覆盖 5 组关系（见 §3.9），配比定为 **10 `for_ta` + 8 `for_self` + 2 `money`**。长契约池子抽干时**不扩库**，改为生成"轮转副本"（`rotation ≥ 1`、`template_id = NULL`、标题追加 `（第 N 轮）`），这是用户确认的口径：内容质量优先于条数，重复靠轮次标记显式告知。
   - `weekend_only` 只标在 `money` 上（理由见 §3.9）；为此删掉了一条 sleep 类"睡前放下手机"的必做模板，并把 lonely/姥姥 的专属任务改写成不含周末语义的文案。
   - 内容真源已从 `tools/scripts/seed-content.ts` 迁到 **`database/seed/*.ts`**（`wish-templates.ts` / `tasks.ts` / `rewards.ts`），`build-seeds.ts` 只负责校验 + 渲染 JSON，不再内嵌文案。

## 7. 索引 ↔ 查询对照（已实现 41 条路由）

| 查询 | 出处 | 用到的索引 |
| --- | --- | --- |
| 按 `jti` 取会话 | `lib/auth.ts#authenticate` | `auth_tokens` PK |
| 按用户取状态 | `lib/auth.ts` | `users` PK |
| 设备数 | `domain/users.ts#countActiveTokens` | `auth_tokens_user_status_idx` |
| 恢复码找回 | `domain/users.ts#findUserByRecoveryCode` | `users_recovery_code_hash_uidx` |
| 同 IP 注册计数 | `api/auth/guest.ts` | `users_reg_ip_created_at_idx` |
| 同 IP 找回计数（总/失败） | `api/auth/recover.ts` | `auth_attempts_kind_ip_created_at_idx` |
| 撤销当前/全部会话 | `api/auth/logout.ts`、`domain/users.ts#revokeAllTokens` | `auth_tokens` PK、`auth_tokens_user_status_idx` |
| 幂等占位与接管 | `lib/idempotency.ts` | `idempotency_keys_principal_operation_key_uidx`、`idempotency_keys` PK |
| 演示会话创建限流 | `domain/demo.ts#createDemoSession` → `lib/quota.ts#enforceWindow` | `demo_sessions_ip_created_at_idx`（`eq ip_hash` + `gte created_at`，窗口内最多扫 50 行） |
| 演示会话按账号反查 / 过期清理 | `domain/demo.ts#requireDemoSession` / `#purgeExpiredDemoSessions` | `demo_sessions_user_uidx`、`demo_sessions_expires_at_idx`（`lt expires_at` 升序，本 IP 最早 3 条） |
| 演示状态 CAS / 重建 | `domain/demo.ts#claimDemoSession` / `#finishDemoSession` | `demo_sessions` PK + `eq('updated_at')` 单行 CAS |
| 健康深检 | `api/health/deep.ts` | `users` PK 点查（`select id limit 1`） |
| 当日创建愿签计数（限流） | `domain/wish.ts#createWish` → `lib/quota.ts#enforceWindow` | `wishes_user_created_at_idx`（`eq user_id` + `gte created_at`，窗口内最多扫 50 行） |
| 我的愿签列表（首页） | `domain/wish.ts#listWishes` | `wishes_user_created_at_idx`；带游标时拆成"同刻 id 更大"与"时间更早"两条查询（客户端无 `or()`），分别走同一索引与 `id` 排序 |
| 愿签详情（读路径） | `domain/wish.ts#findOwnedWish` | `wishes` PK + `user_id` 谓词 |
| 愿签归属（写路径） | `domain/wish.ts#requireAuthor` | `wishes` PK |
| 五问读取 / 完整性判定 | `domain/wish.ts#saveAnswers`、`#missingAnswerFields` | `wish_answers_wish_id_uidx` |
| 五问齐全标记 | `saveAnswers` 的 `eq('five_questions_done', false)` | `wishes` PK（单行 CAS） |
| 立契状态流转 | `domain/wish.ts#signContract` 的 `eq('status','draft')` | `wishes` PK（单行 CAS，`affected()` 判命中行数） |
| 任务候选池 | `domain/task.ts#loadTaskPool` | `task_templates_pool_idx` 的前缀 `(is_active, wish_type)`；`side` 与 `relation` 在代码里过滤 |
| 批量落任务 | `domain/task.ts#insertPlannedTasks` | `tasks` PK（`onConflict:'id'`）+ `tasks_wish_template_uidx` / `tasks_wish_text_uidx` 兜底 |
| 读回整份任务表 | `domain/task.ts#listTasks` | `tasks_wish_day_idx`（`day_index` 升序，`seq` 次级排序在代码里做） |
| 演示愿签关联会话 | `domain/wish.ts#demoSessionOf` | `demo_sessions_user_uidx` |
| 今日任务列表 | `domain/task.ts#listTasksByDate` | `tasks_wish_date_idx`（`eq wish_id` + `eq task_date`） |
| 任务详情 / 状态 CAS | `domain/task.ts#findTask`、`domain/checkin.ts` 的状态更新 | `tasks` PK + `eq('status', …)` 单行 CAS |
| 惰性日界扫描 | `domain/task.ts#sweepMissedTasks` | `tasks_wish_date_idx` / `tasks_status_date_idx`（条件批量 `update`） |
| 今日页批量取打卡 | `api/wishes/_id/tasks/today.ts` | `checkins_task_id_uidx`（`.in('task_id', …)`） |
| 打卡/补卡的证明校验 | `domain/checkin.ts#requireProofFile` | `files` PK |
| 打卡限频 | `domain/checkin.ts#checkinTask` → `lib/quota.ts#enforceWindow` | `checkins_user_created_at_idx`（`eq user_id` + `gte created_at`，窗口内最多扫 50 行） |
| 打卡写入/覆盖 | `domain/checkin.ts#storeCheckin` | `checkins_task_id_uidx`（`insertIfAbsent` 撞索引 → `update`） |
| 补卡券发放/读取/消费 | `domain/checkin.ts#issueMakeupTicket` / `#readMakeupTicket` / `#makeUpTask` | `makeup_tickets_wish_week_uidx`、`makeup_tickets` PK |
| 账本周行读取/惰性建行 | `domain/ledger.ts#readLedger` / `#ensureWeekBudgetRow` | `ledger_weeks_wish_week_uidx`（`eq wish_id`）、`ledger_weeks` PK；建行走 `insertIfAbsent` |
| 周预算修改 CAS | `domain/ledger.ts#setWeekBudget` | `ledger_weeks` PK + `eq('updated_at')` 单行 CAS |
| 账本流水按周聚合 | `domain/ledger.ts#listEntries` / `#readLedger` | `ledger_entries_wish_week_idx`（`eq wish_id` + `eq week_start` + `isNull revoked_at`） |
| 收入关联任务校验 | `domain/ledger.ts#requireEarningTask` | `tasks` PK + 归属/状态在代码里判（任务已在今日页点查缓存） |
| 重复收入关联拦截 | `domain/ledger.ts#addLedgerEntry` 的写前读 | `ledger_entries_task_idx`（`eq wish_id` + `eq task_id` + `eq entry_kind`） |
| 账本证明校验 | `domain/ledger.ts#addLedgerEntry` → `domain/checkin.ts#requireProofFile` | `files` PK（`purpose=ledger_proof`） |
| 结算版本读取 | `domain/settlement.ts#latestSettlement` / `#maxSettlementVersion` | `settlements_wish_version_uidx`（`eq wish_id`，返回后按 `version` 降序取首行） |
| 结算抢锁 / 收尾 / 续期 | `domain/settlement.ts#settleWish` / `#finalizeSettled` / `#extendWish` | `wishes` PK + `status`（+ `version` / `renew_count`）单行 CAS |
| 结算快照写入 | `domain/settlement.ts#settleWish` | `settlements_wish_version_uidx`（`insertIfAbsent`，撞索引回读同版本） |
| 礼物匹配 | `domain/settlement.ts#loadRewards` | `rewards_active_category_idx`（`eq is_active` + `eq category`，本轮最多 100 行）；排序与差额在代码里做 |
| 结算礼物回读 | `domain/settlement.ts#toSettlementView` | `rewards` PK（按快照 `reward_id` 点查标题/区间） |
| 五问 q5 解密 | `domain/settlement.ts#readGiftHint` | `wish_answers_wish_id_uidx`（`eq wish_id` 点查 `q5_gift_enc`） |
| 上传限频 | `domain/upload.ts#presignUpload` → `lib/quota.ts#enforceWindow` | `files_user_created_at_idx`（`eq user_id` + `gte created_at`，窗口内最多扫 50 行） |
| 完成上传取行 / 归属 | `domain/upload.ts#completeUpload` | `files` PK + `user_id` 谓词 |
| pending→ready CAS | `completeUpload` 的 `eq('status','pending')` | `files` PK（单行 CAS） |
| 取签名 URL | `domain/upload.ts#createFileUrl` | `files` PK + `user_id` / `status` 判定 |
| 发布公开帖（结算校验 + 去重） | `domain/pool.ts#publishWish` | `wishes` PK、`pool_posts_wish_id_uidx`（`insertIfAbsent`，撞索引回读） |
| 公开池最新列表（游标两查询） | `domain/pool.ts#listPoolPosts` | `pool_posts_status_published_at_idx`（`eq status` + `order published_at`）；分类页走 `pool_posts_wish_type_published_at_idx` |
| 公开帖详情 / 可见性 | `domain/pool.ts#requireVisiblePost` / `#readPoolPost` | `pool_posts` PK + `status='published'` 判定 |
| 详情回信数实时统计 | `domain/pool.ts#countPublishedReplies` | `replies_post_created_at_idx`（`eq post_id` + `eq status`，最多 50 行） |
| 举报限频 / 去重 | `domain/pool.ts#reportPoolPost` | `reports_reporter_created_at_idx`（20/小时）、`reports_target_reporter_uidx`（`insertIfAbsent`） |
| 举报数 / 自动隐藏 | `reportPoolPost` | `reports_target_created_at_idx`（按目标计数，最多 50 行）、`pool_posts` PK + `eq('status','published')` CAS |
| 作者下架 | `domain/pool.ts#unpublishPoolPost` | `pool_posts` PK + `author_id` 谓词 |
| 发布回信：日限 / 同帖日限 | `domain/reply.ts#createReply` | `replies_author_created_at_idx`（`eq author_id` + `gte created_at`）、`replies_post_author_created_idx`（`eq post_id` + `eq author_id` + `gte created_at`，`limit 1`） |
| 回信列表（游标两查询） | `domain/reply.ts#listReplies` | `replies_post_created_at_idx`（`eq post_id` + `eq status` + `order created_at`） |
| 删除回信 / 帖主权限 | `domain/reply.ts#deleteReply` | `replies` PK、`pool_posts` PK（取 `author_id`） |
| 生成 / 撤销 / 打开分享 | `domain/share.ts#createShareLink` / `#revokeShareLink` / `#readSharedWish` | `share_links_wish_id_uidx`、`share_links_token_uidx`、`share_links` PK、`wishes` PK + 作者判定 |
| AI 建议缓存命中 | `domain/ai.ts#readCache` | `ai_suggestions_user_capability_input_uidx`（`eq user_id/capability/input_hash`） |
| AI 每日额度计数 | `domain/ai.ts#agentUsedToday` | `ai_suggestions_user_source_created_at_idx`（`eq user_id` + `eq source='agent'` + `gte created_at`，最多扫 1000 行） |
| AI 缓存写入 / 并发回读 | `domain/ai.ts#storeCache` | `ai_suggestions_user_capability_input_uidx`（`insertIfAbsent` 撞索引后按键回读） |
| AI 过期缓存惰性删除 | `domain/ai.ts#dropCache` | `ai_suggestions` PK |

后续轮的主查询（公开池 `(status, reply_count)` 热帖排序、`my posts/replies` 列表）的索引都已建好，见 §2 命名规则与迁移文件内注释。

## 8. 与第 1 轮设计稿的差异

表级：设计稿 24 张 → 迁移 22 张。**未建** `user_settings`（并入 `users.settings jsonb`）、`notifications`（推送与站内信按范围约定不做）、`ai_jobs`（**不建**：AI 润色是同步请求，没有排队/重试/后台任务，调用失败就地模板兜底；每日限额改由 `ai_suggestions` 计数）、`events`（埋点不做）；**新增** `auth_attempts`（登录失败审计）与 `ai_suggestions`（建议缓存 + 额度计数，设计稿无对应表）。

列级改名/合并（`diff-schema.ts` 全量输出见上，摘要如下）：

| 表 | 第 1 轮 | 迁移 | 原因 |
| --- | --- | --- | --- |
| `users` | `display_name` / `pronoun` / `recovery_shown_at` / `close_requested_at` / `closed_at` | `nickname` / `avatar` / `client` / `profile_text` / `wish_style_tags` / `share_default_public` / `settings` / `deleted_at` | 代词下沉到 `wishes.pronoun`；注销状态用 `status` + `deleted_at` 两列即可 |
| `idempotency_keys` | `key` / `fingerprint` / `resource_type` / `resource_id` / `result` / `expires_at` / `user_id` | `idempotency_key` / `request_fingerprint` / `response_code` / `response_body` / `principal` | 主体不再只有用户（游客按 IP），TTL 用 `created_at` + 冷启动清理表达 |
| `task_templates` | `relation_group` / `task_type` / `title` / `proof_hint` / `self_focus` / `min_budget_band` | `relation` / `side` / `text` / `proof_kind` / `time_slot` / `min_budget_cents` | `ta/self/money` → `for_ta/for_self/money`；"给自己"标记移到 `tasks.is_for_self`（实例上更准） |
| `tasks` | `task_type` / `title` / `proof_hint` / `self_focus` | `side` / `text` / `proof_kind` / `is_must` / `is_for_self` / `rotation` / `min_budget_cents` | 同上；`rotation` 支持长期契约轮转去重 |
| `checkins` | `is_duplicate_image` / `duplicate_of` | `checkin_date` | 同图提示改为查询期现算 |
| `rewards` | `name` / `price_min_cents` / `price_max_cents` / `wish_types` / `relation_groups` / `search_keyword` / `add_on_hint` | `title` / `note` / `min_cents` / `max_cents` / `recommend_flags` / `stock_left` | 金额列统一 `_cents` 前后缀；搜索词与追加提示合并进 `note` |
| `pool_posts` | `category` / `relation_code` | `wish_type` / `relation` | 与 `wishes` 同域，避免两套枚举 |
| `settlements` | `reward_price_min_cents` / `reward_price_max_cents` | `reward_min_cents` / `reward_max_cents` + `checkin_count` / `makeup_count` | 补打卡次数要单独展示 |
| `share_links` | — | `passphrase_hash` / `last_visited_at` | 访问口令摘要化 |
| `auth_tokens` | `label` / `issued_ip_hash` | `demo` / `status` | 设备名与签发 IP 属后台能力（范围外） |
| `demo_sessions` | `token_hash` | `last_seen_at` | 演示 token 与真实 token 同表（`auth_tokens.demo`），会话表不再存凭据 |
| `wishes` | `relation_code` / `wish_text` | `relation` / `relation_group` / `title` / `raw_input` / `classifier_type` / `classifier_confidence_bps` / `five_questions_done` / `version` / `source_wish_id` / `forked_from_post_id` | 关系存中文原值；**原文（`raw_input`）与展示标题（`title`）分列**，接口词表 `wish_text` 映射到 `raw_input`；分类留痕 + 派生一致性计数器 |
| `wish_templates` | `relation_code` | `relation` | 与 `wishes` 同域，避免两套枚举 |

第 3–7 轮只用**表级约束级**差异：`tasks` 在 0004 建表时就带 `UNIQUE (wish_id, text)`（契约内标题不重复），第 5 轮账本、第 6 轮结算与第 7 轮上传/公开池/回信/举报/分享直接复用 0002 / 0005 / 0006 已建好的表，没有新增表和增量索引。第 8 轮的 `ai_suggestions` 是唯一新增表：缓存键 `(user_id, capability, input_hash)` 必须建表期 `UNIQUE`（平台不接受 `CREATE UNIQUE INDEX`），额度计数又必须排除模板兜底、不能复用 `wishes`/`tasks` 的时间窗，所以单独建表而不是塞进既有表。`diff-schema.ts` 因此会多报一张"设计稿没有"的 `ai_suggestions`，其余列差异与第 2 轮相同。

第 6 轮的**语义**差异（列没变，取值口径变了）：设计稿写 `gap = reward_min_cents − total_cents` 且四档 `surplus/exact/near/far`；落地按需求改为「`gap = max(0, 价格中位数 − total_cents)`」三档 `exact/near/far`，`>30%` 强制落类别内最低价礼物，因此 `surplus` 永不写入。`sealed/sealed_at/revealed_at` 三列保留，但第 6 轮只在 `settled` 后由同一 GET 返回两幕，不进入"盖章 → 72 小时展开"流程，三列恒为 `false/null/null`。

第 7 轮的**语义**差异（列同样没变）：①`share_links.visibility` 固定 `link_only`，`include_flags` / `passphrase_hash` / `share_file_id` 建而未用，白名单投影写在 `domain/share.ts` 而不是按 jsonb 开关动态拼；②`reports.target_type` 只写 `pool_post`，`reply/wish` 举报未开放；③`files.purpose` 只接受 `checkin_proof / ledger_proof / share_image`（迁移注释里的 `signature/avatar/export` 属后续轮）；④`pool_posts.reply_count` 与 `report_count` 只做展示与阈值判定，读详情时实时重算回信数，不把派生列当真值；⑤`replies` 的「同帖每天一条」只能靠窗口查询，没有唯一约束兜底（见 §9）。

**全表统一新增 `updated_at`**（设计稿只有部分表有）：无触发器，由 Function 每次写显式赋值——这也是幂等陈旧判定能用 `updated_at` 的前提。

## 9. 未做的与需人工核对的

| 项 | 现状 |
| --- | --- |
| 迁移执行 | **7 个文件 / 98 条语句 / 22 张表**已通过 `check-migrations.ts`（平台子集 + 索引列存在性）；云端落地状态以站点结构为准（完整迁移 + seed 导入 + 真库验证仍待授权与部署）。0007 尚未在云端执行 |
| seed 导入 | 三个 JSON（72 / 120 / 24 行）已生成并 `--check` 通过，未导入；`insert_database_rows` 分批写。**任务引擎依赖 `task_templates`**：不导入就立契就 503 `task_pool_empty`（本地冒烟直接读同一份 JSON，所以本地能过不代表线上能过） |
| 外键 | 平台允许同 schema `REFERENCES`，本项目**故意不写**：迁移顺序、软删除与"查不到即 404"的归属策略都更简单；完整性 = 唯一索引 + Function 层谓词。这是与第 1 轮 DDL 最大的一致性风险，部署后需抽查引用列是否存在孤儿行 |
| `CHECK` / 枚举约束 | 全部在 Function 层（`lib/validate.ts` + 各路由 `BODY` 常量 + `domain/rules.ts` 词表），因此**改枚举不需要迁移**，但也意味着直连库能写脏数据——`accessPolicies: []` 下无人可直连 |
| 定时清理 | 平台无 cron：`idempotency_keys`（7 天）在实例冷启动时清；`files` pending 超过 2 小时在 `complete` 与下一次 `presign` 时惰性置 `expired`（残留对象需离线清扫）；`makeup_tickets`/`auth_tokens` 过期一律惰性判定；`checkins`/`tasks` 随账号注销删（注销流程本轮不做）；`ai_suggestions` 过期行在**同一输入再次命中时**删除；`demo_sessions` 过期行只在创建新会话时限流通过后按 `expires_at` 升序清**本 IP 最早 3 条** |
| AI 额度与缓存堆积 | 额度只数 `source='agent'` 且最多扫 1000 行，`AI_POLISH_PER_DAY` 的环境上限也是 1000，所以默认 20 不受扫描上限影响；但若一天内真超过 1000 条 agent 缓存，计数会截断在 1000。模板兜底行不占额度但**仍写缓存**，同一失败输入不会反复打模型；不同输入产生的缓存行在无人再次请求时会一直留到 `expires_at` 之后，没有后台清扫，量大时需按 `ai_suggestions_expires_at_idx` 离线清理 |
| 演示数据与统计隔离 | 演示愿签/任务/打卡/账本/结算全部写真实业务表，靠 `users.is_demo` + `wishes.is_demo` 区分；现有接口不提供全站统计，因此不会污染可见业务数字，但将来若加运营报表必须显式排除 `is_demo`。演示会话过期后数据仍在，直到下一次创建会话懒清理（每次只清本 IP 最早 3 条）；若长时间无人创建，会留下已过期演示账号及其子表 |
| 演示重建并发 | 快进/场景/重置都先对 `demo_sessions.updated_at` 做单行 CAS，抢不到即 409 `demo_session_busy`；快进固定造 7 天数据（起始 `now−8d`、结束 `now−2d`）再调真实结算引擎，因此与真实结算同源，但也继承结算的 60 秒陈旧租约风险（见上一行） |
| 限流扫描上限 | `lib/quota.ts#SCAN_LIMIT = 50`：`enforceWindow` 最多扫 50 行，所以**阈值配到 50 以上就形同虚设**。`WISH_CREATE_PER_DAY` 默认 20、`GUEST_PER_HOUR` 默认 10、`RECOVER_PER_HOUR` 默认 12 都在安全区；调高到 >50 前必须先改 `SCAN_LIMIT` |
| 账本并发口径 | 预算修改用 `updated_at` 单行 CAS，可重试；**收入重复关联只有写前读检查**，同一 `task_id` 的并发双写仍可能各插一行（无部分唯一索引可用）。上线后若出现重复收入，需按 `ledger_entries_task_idx` 查重并人工撤销；根治要加一列 `earning_task_key`（仅收入填 `task_id`、支出填 NULL）+ 表级 `UNIQUE (wish_id, earning_task_key)` 的后续迁移 |
| 结算并发与租约 | `active→settling` 是 `status + version` CAS，收尾是 `status='settling'` CAS；快照先于收尾写入。`settling` 超过 60 秒且无快照时允许下一请求用 `updated_at` CAS 接管——真库需要验证 `now()` 精度足以区分首写与接管写；若不足以区分，接管会一直 409，可改为显式的 `settle_lease` 列 |
| 结算读的礼物泄露面 | 只有 `GET /api/wishes/:id/settlement` 在 `settled` 后读 `rewards`；`GET .../ledger`、`GET /api/wishes/:id`、任务接口都不读礼物表。`reward_pool_empty`（503）说明该类别种子为空，属部署问题 |
| q5 解密失败 | `readGiftHint` 捕获解密异常后返回空串，礼物类别退回 `wish_type` 映射（body/sleep→health、lonely→company、study/emotion→heart、life→life）。密钥轮换或密文损坏不会让结算 500，但匹配会退化为纯价格规则 |
| 回信同帖日限竞态 | 「同帖每人每天一条」没有唯一约束（时间窗无法表达），实现是「窗口查询 → 无记录则插入」。同一用户同一帖的并发双请求可能各插一条，导致当天出现两条；全站日限（`REPLY_PER_DAY`）仍是独立兜底。根治需加一列 `daily_slot = productDate(created_at)` 并建 `UNIQUE (post_id, author_id, daily_slot)` 的后续迁移 |
| 计数类派生列扫描上限 | `reply_count` 读详情实时统计、`report_count` 写后统计都带 `limit 50`（`REPLY_SCAN_LIMIT` / `REPORT_SCAN_LIMIT`）。超过 50 条回信时展示值停在 50；举报阈值 3 远低于 50，隐藏判定不受影响。若未来要精确大数，需改为分页累加或平台支持的聚合 |
| 对象存储未验证 | `files` 状态机依赖存储侧三件事：①桶为私有、②`createSignedUploadUrl(...,{upsert:false})` 签发的 PUT 强制 content-type、③`download()` 在 15 秒超时内返回对象字节。本地是内存 FakeStorage，云端行为（含 600s GET URL 到期）尚未实测；`complete` 下载失败一律 503 `storage_unavailable`，不会把未验证文件标 ready |
| pending 文件清扫 | 无 cron：presign 后用户放弃 PUT 会留下 `pending` 行，只在 `complete` 时按 `expires_at` 惰性拒绝，行本身与可能有残留对象都不清理。上线后需按 `files_status_expires_at_idx` 做离线清扫或加平台调度 |
| 人工核对项 | ①`PATCH /api/me` 的 `COLUMNS` 映射值写在字符串里，`check-schema-usage.ts` 不解析；②`files.purpose` / `wishes.status` / `tasks.side` 等取值只存在于注释与文档，改列时必须同步改文档与 seed 校验器；③真实 PostgREST 的 `insertIfAbsent`（`Prefer: resolution=ignore-duplicates`）与 `affected()` 行为未在云端验证，本地是内存实现——**第 3 轮的"崩溃后补齐任务"与第 6 轮的"结算快照幂等写入"完全依赖逐行忽略冲突这一语义**，上线后必须专门验一次；④`check-schema-usage.ts` 按变量名回查载荷，同一文件里多个写载荷不能同名（`wish.ts` 因此用 `values` / `answerValues` 区分），新增写操作时注意；⑤`tasks` 的 `id` 是派生 uuid，云端 `gen_random_uuid()` 默认值不参与，批量写必须显式给 id；⑥`ledger_weeks.updated_at` 作为 CAS 令牌依赖"每次写入取更晚的时刻"，云端同毫秒并发极罕见，但若 `now()` 精度不足需改为显式递增计数器 |

## 第 10 轮增量（迁移 0008）

- `app.task_templates` / `app.tasks` 新增可空列：
  - `tags jsonb`：任务标签数组（1~3 个，2~3 字）；
  - `money_kind text`：`save` / `earn`（非钱任务为空）。
- `app.checkins` 新增可空列：
  - `amount_cents integer`：金额任务打卡时用户自填的金额（分）；
  - `amount_kind text`：`saved` / `earned`。
- `ledger_entries.entry_kind` 新增内部值 `saved`（由金额任务打卡写入，手工记账接口仍只接受 `expense` / `earning`）。
- 彩蛋结果写入 `settlements.self_summary.easter_egg`，不新增表/列。
- 新增列全部可空、无默认值；旧任务/旧打卡由 DTO 与账本读时兜底。

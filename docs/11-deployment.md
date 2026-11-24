# 11 · Qoder Sites 部署手册（开发 / 预发 / 生产）

> 适用版本：第 9 轮最终交付（42 条路由、7 个迁移、470 项冒烟断言；2026-11-24 联调新增任务列表接口）。
> 本文只写「怎么部署、怎么验、怎么退」，接口细节见 [04-api-contract.md](../docs/04-api-contract.md)，密钥与变量清单见 [05-environment.md](../docs/05-environment.md)。

## 0. 当前云端状态（部署前必读）

| 项 | 已知状态 | 部署时怎么处理 |
| --- | --- | --- |
| 站点 | 已创建。`projectId=01a1fd9c-c65f-759f-8881-8e21324d64c9`，`siteId=01a1fd9c-c662-7c4f-8e7f-b83b7f1305d6`，默认域名 `yuan-ta-0ykrktz6t0e.qoder.zone` | 用 `get_site(include:["backend"])` 复核 backend 类型必须是 `function_backend` |
| 静态站 | 已发布过一版引导页（`.愿TA · 替 TA 许个愿.qoder.site` 记录 publication） | 前端产物 `dist/` 可被更新；不要手工改描述文件 |
| 数据库 | 本地 7 个迁移 / 98 条语句 / 22 张表全部通过静态校验；**云端是否建齐未在代码侧确认，0007 `ai_suggestions` 尤其要单独核对** | 先 `get_database_schema` 对照 22 张表，缺什么补什么，不要假定「上次跑过」 |
| seed | 72 / 120 / 24 三份 JSON 已生成并通过形状校验；**平台批量写工具持续 `sites_request_failed`，尚未导入** | 按 §4.3 用 Function 启动播种兜底；`task_templates` 为空则立契 503，`rewards` 为空则结算 503 |
| Function | 源码完整、本地 470 项断言通过；**本轮未执行任何云端写入** | 按 §5 打包与发布，再按 §7 做真库冒烟 |
| 密钥 | 仓库内只有示例名，没有任何真实值 | 在 Sites 设置里逐个写入；不要把值贴进聊天、Issue 或代码 |

> 第 9 轮的硬约束：**只交付文档与本地验证，不执行云端迁移、seed 导入、Function 部署或发布**。以下步骤由获得授权的人在部署窗口执行。

## 1. 三套环境

推荐「开发 / 预发 / 生产」各自一个独立 Site（或至少独立数据库），不要在同一库上用前缀区分环境。

| 维度 | 开发（dev） | 预发（staging） | 生产（prod） |
| --- | --- | --- | --- |
| 运行方式 | 本地 `node tools/local/serve.ts` + FakeDb / FakeStorage | Qoder Site + 真实 Function/DB/Storage | Qoder Site + 真实 Function/DB/Storage |
| 数据 | 内存库 + seed JSON，随进程销毁 | 独立空库 + 正式 seed，允许清库重建 | 正式库，禁止清库 |
| 密钥 | `tools/local/deps.ts` 的本地固定值 | 独立随机值（与生产不同） | 独立随机值，上线前定稿 |
| AI | 默认不配端点（走模板） | 可配 `AI_AGENT_ENDPOINT` 做小流量联调 | 按成本决定；未配则模板兜底 |
| 限流 | 默认值，可调小验证 429 | 接近生产 | 生产值；按监控再收紧 |
| 演示模式 | 开启（默认） | 开启 | 开启（对外演示需要） |
| 公开池 | 可清空 | 可清空 | 保留数据，只软删 |
| 发布 | 不发布 | 每次验收后发布 | 变更窗口发布 |

**环境之间绝不共用**：`FIELD_ENCRYPTION_KEY`、`RECOVERY_PEPPER`、`JWT_SIGNING_KEY`、数据库、对象存储桶、恢复码。跨环境拷贝密文会导致无法解密。

## 2. 上线前检查（本机，全部应绿）

```bash
node --version                          # ≥ 22.18，原生 type-stripping
node tools/local/smoke.ts               # 期望 470 passed, 0 failed
node tools/local/seed-smoke.ts          # 期望 12 passed, 0 failed（启动播种幂等）
node tools/scripts/check-routes.ts      # 期望「manifest.ts 登记 42 条路由」「✓ 路由表自洽」
node tools/scripts/check-migrations.ts  # 期望 7 文件 / 98 语句 / 22 表
node tools/scripts/check-schema-usage.ts# 期望 DAO 引用的表与列都在 DDL 里
node tools/scripts/build-seeds.ts --check # 期望 72 / 120 / 24
node tools/scripts/diff-schema.ts       # 只作对照，不阻断部署
```

若机器装有 Deno，再跑一次 `deno task verify`（含 `deno check backend/index.ts` 严格类型检查）。**本机当前没有 Deno，类型检查未在本轮执行**，部署前应在有 Deno 的环境补跑。

检查清单：

- [ ] 没有把 `backend/_qoder/` 或任何 `_qoder` 目录打进产物；入口依赖由平台注入。
- [ ] `backend/index.ts` 仍是唯一 `Deno.serve` 入口；`backend/manifest.ts` 是唯一路由登记处。
- [ ] 7 个 `.sql` 文件均以换行结尾（`check-migrations.ts` 会报错，但打包前再确认一次）。
- [ ] `database/seed/*.json` 与 `*.ts` 真源一致（`build-seeds.ts --check`）。
- [ ] 工作区没有临时探针目录（`fn-probe*/`、`.tmp-seed-*`）需要随包上传——它们不在 `backend/` 内，但发布前建议清理。

## 3. 创建/确认站点与后端

1. 在 Qoder Sites 里确认站点存在；`get_site({ siteId, include:["backend"] })` 返回 `backend.type === "function_backend"` 且数据库访问模式为私有托管。
2. 若尚未开通后端，调用 `ensure_backend`（database + functions，`databaseAccessModel: "function_backend"`）。这一步会创建云资源，属于写操作，需要明确授权。
3. 读取 `siteId`、`projectId`、`schemaRef`，记录下来供迁移与 Function 发布复用。
4. 确认对象存储可用：本项目使用平台 Storage 客户端（`_qoder/storage.mjs`），桶必须私有；不额外建公开桶。

## 4. 数据库迁移与 seed

### 4.1 迁移顺序

严格 `0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007`。`0002` 与其余批次无依赖，但仍建议按序执行，避免审阅时漏项。

| 批次 | 建表 |
| --- | --- |
| `0001_identity.sql` | users, auth_tokens, auth_attempts, idempotency_keys |
| `0002_catalog.sql` | wish_templates, task_templates, rewards, files |
| `0003_wish.sql` | wishes, wish_answers, makeup_tickets |
| `0004_task_checkin.sql` | tasks, checkins |
| `0005_ledger_settlement.sql` | ledger_entries, ledger_weeks, settlements |
| `0006_social_share.sql` | pool_posts, replies, reports, share_links, demo_sessions |
| `0007_ai.sql` | ai_suggestions |

### 4.2 单批次调用

```js
// 1) 读结构与 schemaRef（空库也要读，用于确认表不存在）
get_database_schema({ siteId })

// 2) 建不可变计划（不应用）
create_database_migration({
  siteId,
  requestId: "<本次写入意图的 UUID>",
  schemaRef: "<上一步返回值>",
  clientMigrationId: "yuan-ta-0001-identity",
  displayName: "0001 身份与会话",
  sql: "<0001_identity.sql 全文>",
  accessPolicies: [],          // function_backend：留空，由平台生成私有策略
})

// 3) 人工核对 normalized_sql / changes，不能省
// 4) 应用审阅过的计划
apply_database_migration({
  migrationId: "<migration.migration_id>",
  requestId: "<新的 apply 专用 UUID>",
  planRef: "<第 2 步的 planRef，原样>",
  confirm: true,
})

// 5) 重新读结构，核对表与索引
get_database_schema({ siteId })
```

参数纪律：

- `requestId` 标识一次写入意图；结果未知（超时/断连）时用**同一 requestId + 完全相同的参数**重试，平台返回同一结果。换 requestId 可能生成两份计划。
- `schemaRef` / `planRef` 原样携带，不能跨批次复用。schema 被别人改过 → 计划冲突 → 重新读 schema 新建计划，**不要重放旧计划**。
- 明确拒绝（`sites_migration_rejected`）可以改内容后用新 requestId 重来；结果未知只能按原 identity 查询。
- `accessPolicies: []` 表示使用 `function_backend` 的固定私有策略；任何时候都不要给这些表加匿名公开读授权。

### 4.3 seed 导入（第 10 轮改为服务端启动播种）

平台 `insert_database_rows` 在本站点持续返回 `sites_request_failed`（24/12/1 行、三张表、带或不带 schemaRef 均失败，读回始终 0 行），因此不再把平台批量写当唯一路径。改为：

1. 发布带 `SEED_ON_START=1` 的 Function（见 §5、§6）。
2. 首个请求进来时，`backend/domain/seed-init.ts` 用 Function 自己的 DB 客户端先查三张表行数：
   - 行数已等于 72/120/24 ⇒ `skipped`，不发起任何写；
   - 部分缺失 ⇒ `insertIfAbsent(onConflict:"id")` 按 40 行一批补缺，稳定 id 保证重复执行/多实例并发都不会产生副本；
   - 行数超过期望 ⇒ 拒绝继续写入并报 `seed_failed`，不覆盖现有数据。
3. 播种状态在 `GET /api/health/deep` 的 `seed` 字段返回（`disabled|idle|running|ok|skipped|error` + 每张表 existing/inserted/final），原始错误只进 Function 日志。
4. 再用 Owner 侧 `query_database_rows` 逐表 `countExact` 核对 72/120/24。

种子数据已随 Function 包放在 `backend/data/seed-rows.ts`（由 `tools/scripts/build-seeds.ts` 从三份 JSON 生成），运行期不读 `database/seed/`。

```js
// 播种完成后核对真实行数（表名用平台表清单里的名字）
query_database_rows({ siteId, tableName: "wish_templates", columns: ["id"], limit: 1, countExact: true }) // 72
query_database_rows({ siteId, tableName: "task_templates", columns: ["id"], limit: 1, countExact: true }) // 120
query_database_rows({ siteId, tableName: "rewards",        columns: ["id"], limit: 1, countExact: true }) // 24
```

若平台批量写工具恢复，仍可按旧路径导入；但**不要与启动播种同时操作**，否则两边都按 id 判重虽不会产生副本，排障时会混淆来源。`task_templates` 为空时立契返回 503 `task_pool_empty`；`rewards` 为空时结算返回 503 `reward_pool_empty`。这两条不是 bug，是内容库未就绪的保护。

**播种顺序变化**：旧文档的「先 seed、再部署」不再适用；现在必须先把代码发布上线，再由启动播种写入。迁移仍然必须先于 Function 发布。

## 5. Function 打包与发布

- 源码根目录：`backend/`；入口：`backend/index.ts`；运行时：edge（Deno）。
- `_qoder/backend.mjs` 与 `_qoder/storage.mjs` 由平台注入，**源码包内不能出现 `_qoder/` 目录**，否则打包器拒绝。
- 数据库访问声明：`read_write`；携带与当前站点一致的 `schemaRef`。
- Secrets 名称列表：至少 6 个必填项（见 §6）；启动播种首次发布时再加上 `SEED_ON_START=1`，播种核对完成后可保留或改回 `0`（改值需重新发布）。
- 调用 `prepare_site({ actionId: "<本次草稿的 UUID>", projectRoot: "<仓库根绝对路径>", webDirectory: "dist", functionDirectory: "backend", databaseAccess: "read_write", schemaRef, secretNames })`。`actionId` 在重试时必须保持不变；`webDirectory` 是构建产物目录，不能填源码根。
- `prepare_site` 只生成不可变草稿、**不发布**；确认 `descriptorStatus` 为 ready 后，再调用 `publish_site`（同一 `actionId` 与完全相同的输入）并核对发布完成状态。Desktop 端还需按平台要求调用 `show_publish_confirmation` 完成交付确认。
- `prepare_site` / `publish_site` 都是写操作，必须获得授权。第 9 轮**没有执行**这一步。

## 6. Secrets 与变量

### 6.1 必填（缺一个整体 503 `service_not_configured`，只保留 `/api/health`）

| 名称 | 生成 |
| --- | --- |
| `JWT_SIGNING_KEY` | `node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))'` |
| `TOKEN_PEPPER` | 同上，独立随机 |
| `RECOVERY_PEPPER` | 同上，独立随机 |
| `IP_HASH_SALT` | 同上，独立随机 |
| `IDEM_FINGERPRINT_KEY` | 同上，独立随机 |
| `FIELD_ENCRYPTION_KEY` | 同上，独立随机；**上线前定稿**，换值等于全量重加密五问 |

写入方式：Sites 设置 → 环境变量 / Secrets，逐项粘贴。**不要把值写进仓库、聊天、Issue、日志或截图**；本文只列名称。

### 6.2 建议显式设置的变量

| 变量 | 生产建议 | 说明 |
| --- | --- | --- |
| `TOKEN_TTL_DAYS` | 30 | 与 PRD 一致；调大等于撤销窗口变长 |
| `API_PER_MINUTE` | 1200 起，按监控调整 | 单实例兜底限流；多实例总量 ≈ 单实例 × 实例数 |
| `CORS_ALLOW_ORIGINS` | 填前端正式域名，逗号分隔 | 禁止 `*` |
| `DEMO_TTL_HOURS` / `DEMO_PER_HOUR` | 24 / 30 | 演示会占用真实表，按演示流量调整 |
| `AI_AGENT_ENDPOINT` / `AI_AGENT_TOKEN` | 需要真实 AI 时配置 | 不配则永远走模板；令牌按 Secret 管理 |
| `AI_POLISH_PER_DAY` / `AI_TIMEOUT_MS` | 20 / 8000 | 控制成本与延迟 |
| `POOL_REPORT_HIDE_THRESHOLD` | 3 | 低于 50，避免触发扫描上限问题 |
| `SEED_ON_START` | 首次 `1`，播种核对后按需改 `0` | 平台批量写失败时的启动播种兜底；`1` 时首个请求幂等补齐 72/120/24，行数已齐则只读不写。改值需要重新发布 Function |

**窗口阈值不要超过 50**：`GUEST_PER_HOUR`、`RECOVER_PER_HOUR`、`WISH_CREATE_PER_DAY`、`CHECKIN_PER_MINUTE`、`UPLOAD_PER_HOUR`、`POOL_PUBLISH_PER_DAY`、`POOL_REPORT_PER_HOUR`、`REPLY_PER_DAY` 都依赖 `SCAN_LIMIT=50`；超过 50 永远判不出超限。`AI_POLISH_PER_DAY` 单独扫描 1000 行，上限 1000。

## 7. 部署后冒烟（真库，必须做）

按顺序执行，前一步失败就停：

1. `GET /functions/v1/app/api/health` → 200 `{status:"ok"}`；同时检查响应头含 `nosniff`、`DENY`、CSP、`no-store`、HSTS。
2. `GET /api/health/deep` → 200 `database:"up"`；若 503 `database_unavailable`，先查 secrets/schemaRef。首次请求若 `SEED_ON_START=1` 会先等启动播种完成，响应里的 `seed` 应为 `{ enabled:true, status:"ok"|"skipped", tables:{...} }`；`status:"error"` 时先按 `failedTable` 查日志，不要继续做业务冒烟。
3. `POST /api/auth/guest` → 保存 `access_token` 与 `recovery_code`；`GET /api/me`、`PATCH /api/me`、`POST /api/auth/recover`、`POST /api/auth/logout` 全通。
4. `POST /api/wishes`（带 `Idempotency-Key`）→ 201 draft；`PUT /answers` → 五问完成；`POST /contract` → active + 全量任务。
5. **重点复验 `insertIfAbsent` 逐行语义**：用 Owner 侧 `delete_database_row` 在**测试站点**删掉一条 `tasks` 行（不要在生产库操作），再 `POST /contract`，应只补回这一条、`first_sign:false`、`inserted_tasks:1`。若整批失败，说明平台语义与本地 fake 不一致，必须改实现。
6. 打卡两次同一任务：`checkins` 始终一行，字段为最后一次；再验补卡券（当前周 `missed → made_up`）。
7. 账本：首周预算已生成；改预算、记支出、记收入；`realized_cents` 与整数复算一致；超预算仍 200 且结余 0。
8. 结算：把时间推到截止日次日 04:00 后（或使用已到期测试愿签），并发两次 settle 只产生一版快照；确认 `settlements` 行先落库、`wishes.status` 后变 `settled`；续期后重结算版本 +1。
9. 上传：presign → 浏览器按 `required_headers` PUT → complete 实测字节 → `POST .../url` 拿 600s GET；确认私有桶直连被拒、过期 GET 403、超 2h 未确认返回 `upload_expired`。
10. 分享/公开池/回信：分享页只含白名单字段；公开池三人举报自动隐藏；隐藏后列表/详情/回信统一 404；回信同帖日限 409。
11. AI：未配端点时 3 条模板 + `source=template` + 每条「AI辅助」；配端点后同输入第二次 `cached:true`；坏输出回退 `invalid_output`。
12. 演示：session → state → fast-forward → 三种 scenario → reset；演示 token 调分享/公开池/AI 均 403；过期 401。
13. 兜底限流：用脚本在同一 IP 快速打业务接口，确认 429 `api_rate_limited` + `Retry-After`，且 `/api/health` 不被挡。

完整 42 条路由的调用顺序见 [01-architecture.md §12](../docs/01-architecture.md) 第 6 步；curl 示例见 [04-api-contract.md §0.4](../docs/04-api-contract.md)。

## 8. 域名、HTTPS 与微信

- 默认域名 `https://yuan-ta-0ykrktz6t0e.qoder.zone` 已带 HTTPS；前端只拼一次 `API_BASE = "{origin}/functions/v1/app"`。
- 绑定自定义域名后同步更新 `CORS_ALLOW_ORIGINS`；不要保留旧域名之外的 `*`。
- 微信小程序 `request` 合法域名要求 HTTPS + 备案域名。若 `*.qoder.zone` 不满足，小程序侧走 WebView 打开 H5；接口无 Cookie 依赖，Bearer Token 存 WebView 的 `localStorage` 即可。
- 分享链接形如 `https://<域名>/s/<token>`，需要前端路由把 `/s/:token` 映射到分享页并调用 `GET /api/s/:token`。

## 9. 上线验收清单

### 功能

- [ ] 账号：注册 / 找回 / 退出 / 当前会话；恢复码只展示一次，服务端不存明文。
- [ ] 愿签：创建 → 五问（可部分提交）→ 立契 → 列表/详情；重复签署只补缺口。
- [ ] 任务：今日页只回当天；漏卡次日变 `missed`；补卡只限当前周且每周一张。
- [ ] 账本：预算修改只影响当前/未来周；流水只追加；收入必须关联同周已完成钱任务。
- [ ] 结算：早于开放点 400；三档结局与礼物匹配确定性；续期仅一次、+7 天。
- [ ] 上传：两段式全链路；`complete` 重放返回同一 `ready` 行；过期 pending 标 `expired`。
- [ ] 分享：轮换旧链立即失效；撤销后 404 `share_revoked`；白名单无隐私字段。
- [ ] 公开池：仅 settled 可发；举报满阈值自动隐藏；作者下架幂等。
- [ ] 回信：内容脱敏/敏感词拦截；同帖日限与总量日限；删除权限正确。
- [ ] AI：始终带「AI辅助」；失败/超时/额度耗尽都 200 + 模板；不写愿签。
- [ ] 演示：五接口全通；演示数据不出现在真实列表/公开池；过期清理每次只清本 IP 最早 3 条。

### 安全

- [ ] 6 个必填 Secrets 均为独立随机值，未出现在任何日志/仓库。
- [ ] 所有响应带安全头；405 带 `Allow`；500 不含堆栈/SQL/内部路径。
- [ ] 五问库内为 `v1:` 密文；`sha256`/`object_key`/恢复码摘要不出接口。
- [ ] 对象存储桶私有；GET URL 600s；上传/签名 URL 不入库、不进日志。
- [ ] 公开出口经 `FORBIDDEN_PUBLIC` 冒烟检查，无五问/账本/金额/文件/用户标识。
- [ ] `PATCH /api/me` 的控制字符被清洗；XSS 串按纯文本存储且响应 `nosniff`。
- [ ] 演示 token 不能写真实数据；真实 token 不能调演示接口。

### 性能与容量

- [ ] 核心接口 P95 ≤500ms；立契（30 天）单独观察，允许一次性重接口。
- [ ] 所有列表分页有上限（愿签 100、公开池 50、回信 50）。
- [ ] `api_rate_limited` 未误伤健康探针与正常用户。
- [ ] 数据库增长：`idempotency_keys` 7 天、`files` 2h、`ai_suggestions` 按 TTL、演示会话 24h；制定离线清扫任务。
- [ ] 结算/续期并发压测：只产生一版快照，无 500。

### 合规与内容

- [ ] 隐私政策/用户协议可访问；注销与数据导出按产品要求另行实现（本轮不做）。
- [ ] 公开池与回信有举报入口、敏感词拦截、自动隐藏；无人工审核队列。
- [ ] AI 建议始终展示「AI辅助」标签，不把建议自动写入用户内容。
- [ ] 演示数据明确标注为演示，不与真实统计混用。

## 10. 回滚

平台**不支持** `DROP TABLE` / `DROP COLUMN` / 改列类型 / 触发器 / 自定义函数，所以没有「一键回滚数据库」。

1. **代码回滚**：重新发布上一版通过验收的 Function 产物（保留上一版包与 commit）。数据库是加性演进，旧代码通常可直接读新结构。
2. **迁移写错**：只能加性修正——新批次 `ADD COLUMN`（可空、无默认值）补正确列；索引错了新建更合适的普通索引；表建错且数据不可信时按站点重建流程处理，不要在同站点复用错表。
3. **数据写错**：本项目没有管理端、没有删除接口。只能由拥有数据库写权限的运维在维护窗口用参数化 SQL 修正，并先备份；涉及五问密文时不要尝试手改，走重新加密流程。
4. **密钥泄露**：按 05 §2 的顺序轮换；`JWT_SIGNING_KEY` 可双密钥过渡，`FIELD_ENCRYPTION_KEY` / `RECOVERY_PEPPER` 换值等于迁移，必须提前规划。
5. **Function 故障**：先看 `/api/health` 与 `/api/health/deep`；配置缺失会稳定 503 且只保留 health，修复 Secrets 后重新部署。依赖故障不要盲目重试写请求，用 `requestId` 关联日志。

## 11. 排障速查

| 现象 | 首要排查 | 处理 |
| --- | --- | --- |
| 所有接口 503 `service_not_configured` | Secrets 是否 6 个齐全、名称拼写 | 补齐后重新部署；health 应显示 `degraded` |
| `/api/health/deep` 503 `database_unavailable` | `schemaRef`、数据库策略、表是否建齐 | 重新读 schema；不要用旧 schemaRef 发布 |
| 立契 503 `task_pool_empty` | `task_templates` 行数 | 导入 120 行 seed |
| 结算 503 `reward_pool_empty` | `rewards` 行数 | 导入 24 行 seed |
| AI 润色 500 且日志提示缺表 | `0007_ai.sql` 是否执行 | 先迁移再部署 AI 版本 |
| 上传 503 `storage_unavailable` | Storage 客户端注入、桶权限 | 确认私有桶与平台注入模块 |
| 上传 400 `verification_failed` | 浏览器是否按 `required_headers` 发送 content-type、文件头是否与声明一致 | 前端修正 PUT 头；服务端不绕过校验 |
| 401 `token_expired` / `token_revoked` | JWT TTL、是否退出/找回 | 用恢复码换新 token；不要延长 token 掩盖问题 |
| 429 频繁 | `API_PER_MINUTE` 或业务阈值 | 先看 `errorCode` 分清兜底/业务限流；再结合 IP 伪造风险调阈值 |
| 405 且 `Allow` 正确 | 前端方法写错 | 按 `Allow` 修正；不要新增兼容路由 |
| CORS 失败 | `CORS_ALLOW_ORIGINS` | 填正式域名，禁止 `*` |
| 分享打开 404 | token 已轮换/撤销、愿签状态 | 重新生成分享链接；旧链永久失效 |
| 公开池 404 `pool_hidden` | 被举报隐藏/已下架 | 按产品规则处理；hidden 不可由作者重发 |
| 演示 401 `demo_session_expired` | 超过 24h | 重新 `POST /api/demo/session` |
| 真库重复收入 | 同一 `task_id` 并发双写 | 按 `ledger_entries (task_id)` 抽查；根治需后续唯一键迁移 |

## 12. 观测与日志

- 单行结构化日志：`level`、`event`、`code`、`path`、耗时、主体哈希；**不含 token、恢复码、五问明文、签名 URL、SQL**。
- 所有响应带 `x-request-id`（同时回在信封 `requestId`），排障时先搜这个 id。
- 建议在平台日志面板建立三个检索：`code=5xx`、`event=config_missing`、`event=db_error`；再对 429 做按 `errorCode` 的分组计数。
- 没有埋点表、没有管理后台、没有人工审核队列；运营报表若后续接入，必须显式排除 `is_demo=true`。
- 离线清扫建议（平台无 cron）：`idempotency_keys` 过期行、`files` 的 `expired` 行与残留对象、`ai_suggestions` 过期缓存、`demo_sessions` 过期账号及其子表。执行前先备份，按 `created_at`/`expires_at` 分批删。
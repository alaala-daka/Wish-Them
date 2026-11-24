# 01 架构设计 · 愿TA 后端

> 运行平台：Qoder Sites（Server Functions + Qoder Database + Object Storage + Cloud Agents）
> 本文是第 1 轮的架构设计，已在第 2–8 轮实现中就地更新：目录结构、路由登记方式、确定性规则位置、密钥清单与一致性手段均以实际代码为准。
> 已实现 42 条路由（系统与账号 7 条 + 愿签与契约 6 条 + 每日任务与补卡 3 条 + 账本 3 条 + 结算与续期 3 条 + 上传 3 条 + 分享 3 条 + 公开池 5 条 + 回信 3 条 + AI 1 条 + 演示 5 条）。未实现的接口（任务详情、离线同步、结算 ACK/信件编辑/兑现卡图、公开池接力、通知、AI 其余三种能力）保留设计，标注见 [04-api-contract.md](../docs/04-api-contract.md) §0.1 与 §0.2。

---

## 1. 运行形态

```
微信小程序 / Web PWA / 游客只读页
        │ HTTPS + Authorization: Bearer <token>（只读接口可匿名）
        ▼
Qoder Sites 边缘网关（站点访问控制、同名 Origin 校验、注入 x-qoder-*）
        ▼
Server Function（逻辑名 app，runtime edge，入口 backend/index.ts，Deno.serve）
  ├─ api/**        路由层：仅做输入校验、鉴权、编排、响应封装
  ├─ domain/**     领域层：全部确定性规则（分类、任务生成、金额、匹配、结局）
  ├─ lib/**        基础设施层：db / http / jwt / crypto / time / idempotency / quota / ip / log
  ▼
Qoder Database（app schema，PostgREST 风格 SDK，无触发器/无自定义函数）
Qoder Object Storage（私有桶，签名 URL，图片字节永不入库）
Qoder Cloud Agents（仅生成"建议"，见 §9）
```

关键点：

- **一个站点只有一个 Function 包**（`runtime/app.zip`，逻辑名 `app`）。因此"文件即路由"在本工程里的落地方式是：`backend/api/**` 下一个文件 = 一条路由声明，由 `backend/api/manifest.ts` 显式汇总，CI 脚本校验文件路径与声明路径一致（§3.3）。
- 浏览器/小程序实际请求的物理路径是 `https://<site>/functions/v1/app/api/...`；本文档与契约一律写**逻辑路径** `/api/...`。Router 同时兼容 `/functions/v1/app`、物理名 `app-d<32hex>` 与 Provider 已剥离 `/functions/v1` 三种形态（平台行为，实现时必须按 `pathname` 正则归一，不能假设路径含逻辑名）。
- 前端静态资源与 `/api` 同源，本地开发由 Vite 代理 `/functions/v1/app` → 本地 Deno。

## 2. 平台约束 → 设计决策对照

| 平台事实（已核对 Sites 规范） | 对本设计的影响 | 决策 |
| --- | --- | --- |
| Function 入口是 ZIP 根 `index.ts` + `Deno.serve`，无框架路由 | 不能靠 Express/Next 的文件路由 | 自研路由表（`lib/http.ts`）+ `manifest.ts` 显式登记 + `_id` 目录表示路径参数（§3.3） |
| 迁移 API 只接受受限 PostgreSQL 子集：`CREATE TABLE app.x` / `ADD COLUMN` / 普通 `CREATE INDEX`；类型仅 `boolean integer bigint text uuid timestamptz jsonb`；不支持 `date` `numeric` `varchar(n)` `CHECK` 表达式索引 | 金额不能用 numeric，日期不能用 date，约束不能靠 CHECK | 金额一律 `integer`（分），日期一律 `text YYYY-MM-DD`，校验全部在 Function 层 |
| 不支持触发器、自定义函数、迁移内 DML/seed | 无法用 DB 触发器维护汇总、自动过期 | 汇总列由 Function 在读取时从明细聚合（账本）或由单次写入负责（任务/打卡）；过期采用**惰性回收**（读写时判定 `expires_at`） |
| SDK 多次调用**不构成事务**；写请求网络结果可能"未知" | 结算、扣补卡券、账本聚合不能靠多步原子性 | 单行 CAS（`update().eq(状态/版本/updated_at)`）+ 全局幂等表 + 读取时聚合（§7） |
| 平台身份来自网关 `x-qoder-user-context`，且 SDK 只校验格式不校验签名 | 小程序拿不到平台身份；伪造上下文风险需部署侧确认 | 应用身份只认自建 Bearer Token；不读平台上下文做归属判定（§5） |
| Storage SDK 为部署期注入的 `./_qoder/storage.mjs`，签名 URL 是短期 bearer 能力 | 不能把桶凭据下发给客户端；签名 URL 不可持久化 | 上传走 presign→complete 两段式，服务端 `download` 校验真实字节后才落库（§8，✓ 第 7 轮） |
| Secret 只写不可读，命名受限（不得以 `QODER_/SUPABASE_/POSTGRES_` 开头） | 加密密钥/HMAC pepper 需按规范命名 | §11.3 密钥清单 |
| `prepare_site` 需声明 `databaseAccess` + `schemaRef` | 发布前必须先跑迁移并读回 schemaRef | §12 发布流程 |

## 3. 工程目录结构

### 3.1 仓库总览（与磁盘一致）

```
yuan-ta/
├─ .站点名称.qoder.site          # 平台生成的描述符，禁止手写
├─ README.md                     # 入口：现状、如何本地跑、文档地图
├─ docs/                         # 01 架构 / 02 约定 / 03 数据库 / 04 接口契约 / 05 环境与密钥 / 06–09 各轮总结
├─ db/
│  └─ schema.sql                 # 第 1 轮设计稿（保留作对照，不再是执行入口，见 docs/03 §差异）
├─ backend/                      # ★ functionDirectory，整目录打包为 app.zip
│  ├─ index.ts server.ts deno.json
│  ├─ api/  domain/  lib/
│  └─ database/{migrations,seed} # 迁移子集 SQL + 内容库 seed（.ts 是真源，.json 是产物）
├─ tools/
│  ├─ local/                     # 内存版 db + 本地 HTTP 入口 + 冒烟脚本（必须在 backend 之外）
│  └─ scripts/                   # 四个静态校验器 + seed 生成器 + 设计稿差异（§3.4）
└─ _src/                         # 原始 PRD/方案，只读
```

> 平台要求：本地测试入口与 fake 依赖**不得放进 functionDirectory**，否则会被打进发布包；`_qoder/` 目录由运行时注入，源码里只能 import、不能创建（`backend/server.ts` 里那一行 import 是全站唯一出现处）。

### 3.2 `backend/` 内部结构

已实现的文件写实，未实现的模块用「…（后续轮）」归拢，避免目录树看起来已经完成：

```
backend/
├─ index.ts                      # 唯一入口：createSiteContext + Deno.serve(handler)
├─ server.ts                     # 组装依赖（db/config/clock）→ application(router)
├─ deno.json                     # 本目录的严格类型/格式化/lint 配置与 tasks
├─ database/
│  ├─ migrations/                # 0001_identity … 0007_ai + README（执行与回滚）
│  └─ seed/                      # wish-templates.ts / tasks.ts / rewards.ts = 内容真源
│                                #   build-seeds.ts 产出同名 .json（线上导入的就是它）+ README
├─ api/
│  ├─ manifest.ts                # 路由注册表（文件即路由的唯一登记处，当前 42 条）
│  ├─ health/index.ts            # GET  /api/health
│  ├─ health/deep.ts             # GET  /api/health/deep（依赖自检）
│  ├─ auth/guest.ts              # POST /api/auth/guest
│  ├─ auth/recover.ts            # POST /api/auth/recover
│  ├─ auth/logout.ts             # POST /api/auth/logout
│  ├─ me/get.ts                  # GET   /api/me
│  ├─ me/update.ts               # PATCH /api/me
│  ├─ wishes/create.ts           # POST /api/wishes（草稿 + 关键词分类，幂等键必填）
│  ├─ wishes/get.ts              # GET  /api/wishes（游标分页，仅自己的数据）
│  ├─ wishes/_id/get.ts          # GET  /api/wishes/:id（不含五问明文/密文）
│  ├─ wishes/_id/answers.ts      # PUT  /api/wishes/:id/answers（部分提交，字段级加密）
│  ├─ wishes/_id/contract.ts     # POST /api/wishes/:id/contract（立契 + 一次性全量任务）
│  ├─ wishes/_id/tasks/today.ts  # GET  /api/wishes/:id/tasks/today（惰性日界 + 当日任务）
│  ├─ tasks/_id/checkin.ts       # POST /api/tasks/:id/checkin
│  ├─ tasks/_id/makeup.ts        # POST /api/tasks/:id/makeup
│  ├─ wishes/_id/ledger/get.ts   # GET  /api/wishes/:id/ledger（实时聚合周视图）
│  ├─ ledger/weeks/_weekStart/update.ts # PUT /api/ledger/weeks/:weekStart（预算 CAS）
│  ├─ ledger/entries/create.ts   # POST /api/ledger/entries（流水追加）
│  ├─ wishes/_id/settle.ts       # POST /api/wishes/:id/settle（到期开启 + CAS + 快照）
│  ├─ wishes/_id/settlement.ts   # GET  /api/wishes/:id/settlement（两幕结果，仅作者）
│  ├─ wishes/_id/extend.ts       # POST /api/wishes/:id/extend（一次续期 7 天）
│  ├─ uploads/presign.ts         # POST /api/uploads/presign（签名上传 URL + pending 行）
│  ├─ uploads/complete.ts        # POST /api/uploads/complete（download 实测字节 → ready）
│  ├─ uploads/_id/url.ts         # POST /api/uploads/:id/url（600 秒签名 GET，仅归属者）
│  ├─ wishes/_id/share/create.ts # POST /api/wishes/:id/share（生成/轮换 token）
│  ├─ wishes/_id/share/index.ts  # DELETE /api/wishes/:id/share（撤销）
│  ├─ s/_token/get.ts            # GET  /api/s/:token（匿名白名单只读页）
│  ├─ pool/get.ts                # GET  /api/pool（匿名列表，latest + 游标）
│  ├─ pool/publish.ts            # POST /api/pool/publish（仅作者、仅 settled）
│  ├─ pool/_id/get.ts            # GET  /api/pool/:id（公开详情 + 实时回信数）
│  ├─ pool/_id/report.ts         # POST /api/pool/:id/report（满阈值自动隐藏）
│  ├─ pool/_id/unpublish.ts      # POST /api/pool/:id/unpublish（作者下架）
│  ├─ pool/_id/replies/create.ts # POST /api/pool/:id/replies
│  ├─ pool/_id/replies/get.ts    # GET  /api/pool/:id/replies
│  ├─ replies/_id.ts             # DELETE /api/replies/:id（回信作者或帖主）
│  ├─ ai/polish-wish.ts          # POST /api/ai/polish-wish（只出建议，标签必带）
│  ├─ demo/session.ts            # POST /api/demo/session（演示账号 + 基线数据）
│  ├─ demo/state.ts              # GET  /api/demo/state
│  ├─ demo/fast-forward.ts       # POST /api/demo/fast-forward（7 天 + 真实结算）
│  ├─ demo/scenario.ts           # POST /api/demo/scenario（三种结局重算）
│  ├─ demo/reset.ts              # POST /api/demo/reset（回基线）
│  └─ …（后续轮）notifications/ · settings/ · meta/ · ai/task-candidate 等
├─ domain/
│  ├─ users.ts                   # 建号、恢复码、签发会话、资料改写（确定性，无 AI）
│  ├─ demo.ts                    # 演示会话创建/状态/快进/场景/重置（真实引擎，单行 CAS）
│  ├─ rules.ts                   # 关键词分类、关系分组、标题派生、契约天数常量（纯函数）
│  ├─ wish.ts                    # 愿签仓储与状态机、五问加密、游标列表、DTO 白名单
│  ├─ task.ts                    # 任务池装载、确定性抽取与排布、派生 id 批量落库、汇总
│  ├─ checkin.ts                 # 打卡/补卡、证明校验、补卡券、惰性日界
│  ├─ ledger.ts                  # 周预算推算、预算 CAS、流水校验、账本实时聚合、DTO
│  ├─ settlement.ts              # 结局判定、礼物匹配、结算快照、续期（确定性，无 AI）
│  ├─ upload.ts                  # presign/complete/url、文件头实测、DTO（无 sha256/object_key）
│  ├─ share.ts                   # token 轮换/撤销、匿名白名单只读页、访问数
│  ├─ pool.ts                    # 发布/列表/详情/举报隐藏/下架、摘要脱敏、公开 DTO
│  ├─ reply.ts                   # 回信日限/敏感词/列表/删除、reply_count 刷新
│  └─ ai.ts                      # 统一适配器、脱敏/校验/模板兜底、额度、建议缓存、能力占位
└─ lib/                          # 基础设施，不出现业务词
   ├─ types.ts                   # RouteDef / RouteModule / Ctx / Principal / AppConfig / DbQueryChain
   ├─ config.ts                  # Sites Secrets 装载 + ConfigError（6 个必填密钥）
   ├─ http.ts                    # 物理前缀归一 + 路由匹配 + CORS
   ├─ respond.ts                 # 统一响应 { code, data, message, errorCode?, requestId, … }
   ├─ errors.ts                  # 错误工厂：400/401/403/404/409/413/422/429/500/503
   ├─ validate.ts                # 入参校验（present/missing + details.fields）、分页与 uuid 解析
   ├─ patterns.ts                # uuid / token / ISO 日期 / 恢复码 等正则
   ├─ jwt.ts                     # HS256 签发与校验（默认 30 天）
   ├─ auth.ts                    # Bearer 中间件：JWT 校验 + auth_tokens 撤销位 + 账号状态判定
   ├─ recovery.ts                # 恢复码生成/归一/HMAC 摘要（Crockford base32，无 i l u o）
   ├─ crypto.ts                  # HMAC-SHA256、SHA-256、常量时间比较、AES-256-GCM 字段加解密
   ├─ id.ts                      # uuid v4、requestId、derivedUuid（可重放的确定性 id）
   ├─ db.ts                      # SDK 封装：写必带 select、affected() 判定、错误映射
   ├─ idempotency.ts             # 幂等表 claim/replay/成功标记（含陈旧接管 CAS）
   ├─ quota.ts                   # 按行计数窗口限流（SCAN_LIMIT = 50）+ 唯一索引并发兜底
   ├─ cursor.ts                  # base64url(JSON([sortKey, id])) 游标编解码
   ├─ ip.ts                      # client IP 取值与 HMAC 摘要、UA 归类
   ├─ time.ts                    # Asia/Shanghai +08:00、04:00 产品日界、自然周、结算开放点
   ├─ log.ts                     # 结构化单行日志（不含 token/恢复码/签名 URL）
   ├─ sensitive.ts               # 联系方式/引流词拦截与公开摘要脱敏（确定性，无 AI）
   └─ …（后续轮）money.ts  # 对象存储/模型适配器分别由平台注入，不落 lib/
```

第 1 轮设计的 `core/<子目录>/` 分组在实现时收敛成 `lib/` 平铺：infra 文件每个只有 60–200 行，再套一层目录只会让 import 变长。分层职责改为靠两条约定保证——`lib/` 不出现业务词、`domain/` 不出现 HTTP 对象；机器兜底是 §3.4 的校验器。`contracts/` 同理取消：校验规则与接口放在一起（每个 api 文件里的 `BODY`/`PARAMS` 常量），改接口时只看一个文件。

### 3.3 "文件即路由"的三条硬规则

1. 每个路由文件必须导出 `route: RouteDef`（`path` / `method` / `auth` / `operation` / `idempotent` / `maxBodyBytes`）与 `export default async function`。字段取值、路径与文件位置的一致性由 `tools/scripts/check-routes.ts` 校验，不一致直接失败退出。
2. 路径参数写在 `route.path` 里（`:id`），由 `lib/http.ts` 自己匹配，解析结果进 `ctx.params`；参数值再用 `lib/validate.ts#parseUuidParam`（内部走 `lib/patterns.ts`）校验，形状不符先于查库返回 400 `invalid_parameter`。**文件位置必须能反推出同一条路径**：以 `_` 开头的目录段表示路径参数（`wishes/_id/answers.ts` → `/api/wishes/:id/answers`），文件名 `index`/`get`/`update`/`create` 归到目录本身（同一目录靠 method 区分）。用 `_id` 而不是第 1 轮设计的 `@id` 或 `[id]`，是因为 Windows 文件名不允许冒号、方括号又会被 glob 误读；这条映射由 `check-routes.ts#fileToPath` 机器校验，写错直接失败退出。
3. `manifest.ts` 是唯一登记路由的地方（edge 运行时没有文件系统扫描），一个文件一次 import；新增接口 = 新增文件 + manifest 加一行 + 契约文档加一条。**没登记的文件在线上就是 404**，`check-routes.ts` 的第 6 项检查专门兜这一条。

### 3.4 本地校验矩阵

| 脚本 | 查什么 | 为什么需要它 |
| --- | --- | --- |
| `tools/scripts/check-routes.ts` | 登记关系、route 字段取值、路径与文件位置一致（含 `_id` → `:id` 映射）、operation 不重复 | 漏登记＝线上 404；operation 重复＝幂等作用域互相覆盖 |
| `tools/scripts/check-migrations.ts` | 迁移语句是否在平台子集内、索引列是否真实存在、索引与列命名纪律 | 平台在 `apply` 阶段才报错，届时已经产生云端资源 |
| `tools/scripts/check-schema-usage.ts` | 代码里出现的表名/列名/写入键是否真在 DDL 里 | 列名写错线上是 400（PGRST204/205），本地内存库是宽容实现，最容易溜过去 |
| `tools/scripts/build-seeds.ts` | 内容库形状（愿望模板 72 / 任务模板 120 / 礼物 24）、id 确定性、内存库不套默认值所以 `is_active`/`min_budget_cents` 必须显式给值；`--check` 只校验不写盘 | 内容库是任务生成与礼物匹配的输入，形状错了后面全错 |
| `tools/scripts/diff-schema.ts` | 第 1 轮设计稿 `db/schema.sql` 与可执行迁移的差异清单 | 防止「照着设计稿写代码」用到已被删掉的表或列 |
| `tools/local/smoke.ts` | 42 条路由的行为（**470 项断言**）：鉴权、恢复码、限流、幂等、演示隔离 + 五问加密、立契、任务引擎、崩溃补齐、游标分页 + 今日任务/惰性日界/打卡覆盖/补卡券/跨周过期 + 账本预算/流水/超预算/收入关联/跨周聚合 + 结算时间门禁/三档结局/礼物三档差额/并发 CAS/续期重算/权限隔离 + 上传实测字节与格式拒绝/pending 2h 失效/分享轮换撤销/公开池脱敏与举报隐藏/回信日限与删除权限 + AI 模板/agent/脱敏/缓存/额度/超时/坏输出 + 演示基线/快进/三结局/重置/过期/最早 3 条会话清理 + 统一安全响应头/控制字符清洗/405 Allow/API_PER_MINUTE 兜底 | 无云端资源条件下唯一能复现的一致性检查 |

跑法两种：`node tools/scripts/<file>.ts`（本机 Node ≥ 22.18 直接执行 `.ts`，无需构建），或装了 Deno 时 `cd backend && deno task verify`（= `deno check index.ts` + 上面四个校验器，任务定义在 `backend/deno.json`）。`tools/local/serve.ts` 起一个本地 HTTP 端口，用内存库驱动同一个 `createApp()`，方便 curl 手工验。

## 4. 分层职责与依赖方向

```
api/*  →  domain/*  →  lib/db.ts, lib/crypto.ts, lib/storage.ts（后续轮）
  ↑            
lib/*  不反向依赖 api，也不写业务分支
```

| 层 | 允许做 | 禁止做 |
| --- | --- | --- |
| `api/**` | 鉴权、参数校验、幂等声明、编排、状态码与响应封装 | 直接拼 SQL/查询链、金额四舍五入、分类判断、结局判断 |
| `lib/http.ts · lib/auth.ts · …` | 通用能力，无业务语义 | 出现 wish/task/ledger 等业务词 |
| `domain/**`（已含 `rules.ts` / `wish.ts` / `task.ts` / `checkin.ts` / `ledger.ts` / `settlement.ts` / `upload.ts` / `share.ts` / `pool.ts` / `reply.ts` / `ai.ts` / `demo.ts`） | 全部确定性业务规则（§6）、仓储查询、DTO 白名单；`ai.ts` 是唯一的模型出口（只接收注入的 `AiAdapter`），`demo.ts` 只复用真实引擎造数据 | 直接读密钥以外的外部服务、出现 `Request`/`Response`（`upload.ts` 只接收注入的 `StorageClient`，`ai.ts` 只接收注入的 `AiAdapter`） |
| `lib/ai.ts`（后续轮） | 调用 Cloud Agents、脱敏、JSON 校验、超时回退模板 | 参与金额/结局/结算判定 |

## 5. 身份与鉴权架构

**唯一应用身份来源：`Authorization: Bearer <app token>`**（Web 存 localStorage/IndexedDB，小程序存 `wx.setStorageSync`）。不使用 Cookie 会话，因此不需要 CSRF 令牌（同时全站仍校验同源 `Origin`，防止站点级访问控制被绕过）。

| 主体 | 判定方式 | 可用接口 |
| --- | --- | --- |
| 游客 | 无 token | `GET /api/health`、`GET /api/health/deep`、`POST /api/auth/guest`、`POST /api/auth/recover`；`GET /api/s/:token`、`GET /api/pool`、`GET /api/pool/:id`、`GET /api/pool/:id/replies`（第 7 轮起匿名可读，只出白名单投影） |
| 匿名账号 | Bearer JWT → `claims.jti` 反查 `app.auth_tokens.id` → `user_id` | 其余全部业务接口 |
| 演示态 | 同上且 `auth_tokens.demo = true`（与 `claims.demo` 双向校验） | 仅演示数据；写真实数据一律 403 `demo_forbidden` |
| 后台角色 | **本轮不做**（范围外） | — |

Token 规格、有效期、恢复码、多设备与撤销规则见 [02-conventions.md](../docs/02-conventions.md) §5。

签发与校验的实际形态（第 2 轮已实现）：

- Token 是自签 HS256 JWT，`payload = { sub, jti, iss, aud, iat, exp, client, demo }`，`exp` 默认 30 天（`TOKEN_TTL_DAYS` 可调 1–60）；密钥 `JWT_SIGNING_KEY` 只从 Secrets 读。
- 自包含 token 无法单方作废，所以**每次请求都用 `jti` 反查 `auth_tokens`**：行不存在 → 401 `invalid_token`；`status != active` 或 `revoked_at` 非空 → 401 `token_revoked`（退出登录、恢复码找回、注销都会置位）；`expires_at` 已过 → 401 `token_expired`。库里另存 `token_hash = HMAC(TOKEN_PEPPER, header.payload)`，只用于审计比对，不参与校验。
- 本轮不做滑动续期与 refresh token：30 天到期后由客户端用恢复码走 `POST /api/auth/recover`，换新 `jti` 并轮换恢复码。这样"换手机找回"和"续期"是同一条路径，少一套凭据要管。

归属判定一律以 token 解析出的 `user_id` 为准，**任何请求体/查询串里的 userId 字段都被忽略**。平台网关注入的 `x-qoder-user-context` 只用于站点级访问控制，不参与业务归属，避免"小程序拿不到上下文"与"上下文格式可被伪造"两个问题耦合进来。

## 6. 确定性规则层（金额、任务、结算全部走代码）

PRD G-04 与本轮约束要求：以下逻辑**必须是纯函数**，输入相同则输出相同，可单测、可离线跑、可回放。

第 1 轮设计的 `domain/rules/<规则>.ts` + `domain/content/<词表>.ts` 两级分组在实现时收敛：词表与纯函数都进 `domain/rules.ts`（分类关键词、关系语气、随机源、标题派生），有仓储读写的规则进对应聚合文件（`domain/task.ts`）。理由是关键词表与关系语气表只有几十行，单独建目录会让「改一个阈值要跳三个文件」。

| 规则 | 位置 | 输入 → 输出 | 状态 |
| --- | --- | --- | --- |
| 愿望分类（六类） | `domain/rules.ts#classifyWish` | `raw_input` + 内置 `CLASSIFIER_KEYWORDS` → `{ wishType, confidenceBps }`；同分按 `WISH_TYPES` 顺序取先，零命中 → `life` + 0 | ✓ 第 3 轮 |
| 关系分组与语气 | `domain/rules.ts#RELATION_GROUPS / relationGroupOf` | 12 关系 → `relationGroup`（parent/peer/intimate/mentor/stranger）+ `tone` + `taskTendency` | ✓ 第 3 轮 |
| 展示标题派生 | `domain/rules.ts#deriveTitle` | `raw_input` → 折叠空白、去尾标点、≤30 字（超出加 `…`） | ✓ 第 3 轮 |
| 确定性随机源 | `domain/rules.ts#seededRandom / shuffleWith` | 32 位种子 → mulberry32 序列；Fisher–Yates 由调用方注入随机源 | ✓ 第 3 轮 |
| 任务生成 | `domain/task.ts#planTasks`（池装载 `loadTaskPool`、落库 `insertPlannedTasks`） | `wish_id, wish_type, relation, days, start_date` + 候选池 → 全量任务序列 | ✓ 第 3 轮 |
| 产品日/周窗口 | `lib/time.ts` | `timestamptz` → `productDate`、`weekStartOf`、`isWeekendDate`、`contractEndDate`、`settleOpenAt`、`dayIndexOf`（0 起） | ✓ 第 2–3 轮 |
| 周预算推算 | `domain/ledger.ts#weeklyBudgetFromBand / defaultWeeklyBudgetCents` | `q4_disposable_band` → 首周预算（2,000–20,000 分；缺档兜底 5,000） | ✓ 第 5 轮 |
| 账本聚合 | `domain/ledger.ts#readLedger / setWeekBudget / addLedgerEntry` | `ledger_weeks.budget_cents` + `ledger_entries` + `tasks` → 周结余/兼职/累计兑现额（§6.2） | ✓ 第 5 轮 |
| 礼物匹配 | `domain/settlement.ts#giftCategoryOf / matchReward` | `wish_type + q5 解密文本 → category`；候选 `min_cents ≤ realized`；q5 点名优先，否则价格上限最高；差额 >30% 强制最低价 | ✓ 第 6 轮 |
| 三档结局 | `domain/settlement.ts#decideOutcome / summarizeCompletion` | 必做有 `missed` → `unrealized`；必做全完成但钱任务未全完成 → `cyber_only`；全完成 → `double_realized`；同时产出盖章与计数 | ✓ 第 6 轮 |
| 给自己的小结 | `domain/settlement.ts#summaryFor` | 差额文案、信件模板、每周结余与所需周数、礼物名与类别，全部确定性拼装 | ✓ 第 6 轮 |
| 公开内容规则 | `lib/sensitive.ts#containsSensitive / redactSensitive / toExcerpt` | 联系方式/身份证/外链/引流词 → 回信直接拒绝；公开摘要替换为 `***`、抹掉 6 位以上数字、折叠空白并截到 ≤120 字 | ✓ 第 7 轮 |

### 6.1 任务生成规格（✓ 第 3 轮已实现，`domain/task.ts`，确定性无 AI）

- **随机源**：`seed = parseInt(SHA-256("yuan-ta-task-v1:" + wish_id).slice(0, 8), 16)` → mulberry32（`rules.ts#seededRandom`）。种子只含愿签 id，**不含用户 ID、时间或 `Math.random()`**，所以同一愿签任何时候重算都得到同一副牌。命名空间前缀 `yuan-ta-task-v1` 是版本位：改抽取算法就换前缀，不会与历史任务 id 撞车。
- **候选池**：`task_templates` 按 `.eq('is_active', true).in('wish_type', [wishType, 'any']).limit(200)` 取（走 `task_templates_pool_idx`）；关系过滤在**代码里**做（`!tpl.relation || tpl.relation === relation`），因为客户端 SDK 没有 `or()`，「本关系专属 OR 通用」写不成一条查询。
- **抽牌堆**：每档（`for_ta` / `for_self` / `money`）各建一副，排序键固定 `(关系专属优先, sort_order, id)`，专属档与通用档分别 Fisher–Yates 洗牌后拼接 ⇒ 与数据库返回顺序无关。
- **排布**：`day_index` **从 0 递增**（`dayIndexOf = task_date − start_date`）；每天必做 2 条（`for_ta` + `for_self`，`is_must = true`）；`task_date` 落在周六/周日（Asia/Shanghai）时追加 1 条可选 `money`（`is_must = false`），即每周最多 2 条钱任务，符合 PRD「每周 1~2 个」。同日展示序 `seq` = 1/2/3（`SIDE_SEQ`）。
- **池干怎么办**（用户已确认的口径）：牌堆取完一轮就 `rotation += 1` 从头再取，文案追加「（第 N 轮）」、`template_id` 置 NULL。于是 `tasks (wish_id, template_id)`（多个 NULL 互不冲突）与 `tasks (wish_id, text)`（表级 UNIQUE，文案带轮次后缀天然唯一）都仍然成立，**同一愿签内标题不重复**这条硬要求不破。30 天契约的 `for_ta` 与 14 天起的 `money` 会走到轮转。
- **失败口径**：必做两档任一为空 → 503 `task_pool_empty`（种子没导入）；`money` 档为空只跳过可选任务，不连带必做一起失败。
- **生成时机与顺序**：`POST /api/wishes/:id/contract` 里 **先 `planTasks`（纯函数、只读池）→ 再单行 CAS `draft→active` → 最后 `insertPlannedTasks` 批量落库**。顺序刻意如此：池为空时在改状态之前就失败，不会留下「active 但没有任务」的契约。
- **可重放**：任务 id = `derivedUuid("yuan-ta-task-v1:<wishId>:<day_index>:<seq>")`，批量写走 `insertIfAbsent(values, { onConflict: 'id' })`。重复签署、幂等重放、生成到一半崩溃后重试，都只补缺的那几行，不需要事务。读回上限 `TASKS_PER_WISH_LIMIT = 200`（30 天 × 3 = 90，留一倍余量）。
- **不动态变更**：签署后任务集合固定，后续轮只做状态流转（`pending→done/missed→made_up`），不重排、不新增、不改文案。

### 6.1.1 打卡与补卡规格（✓ 第 4 轮已实现，`domain/checkin.ts` + `api/tasks/`）

- **日界**：`productDate(now)` 固定 Asia/Shanghai、04:00 换日；`weekStartOf(date)` 取自然周周一。没有 cron：今日页、打卡、补卡三个入口都先执行一次 `sweepMissedTasks`（`pending AND task_date < today → missed` 的条件批量更新），重复执行无副作用。
- **今日页**：只查 `tasks (wish_id, task_date = today)`，批量 `in('task_id', …)` 取打卡，不返回总天数/剩余天数；只在契约期 `[start_date, end_date]` 内发本周券。非作者 403 `wish_forbidden`。
- **打卡**：只允许今天的任务。`pending → done` 走 `eq('status','pending')` 单行 CAS；已是 `done` 时 `already_done:true` 并覆盖同一行 `checkins`（`UNIQUE(task_id)` + `insertIfAbsent`→`update`）；`missed` 任务拒绝（`makeup_required`）。`server_ts` 为服务器时间，`client_ts` 恒 `null`。证明文件必须是本人、`ready`、`purpose=checkin_proof`、绑定愿签一致。
- **补卡**：仅 `missed` + 仅当前自然周；券 `available → used` 单行 CAS，再改任务 `missed → made_up`；任务 CAS 失败则把券放回（`task_id` 仍指向该任务时）并回 409 `task_state_conflict`。券过期由读路径按 `expires_at` 惰性改 `expired`。补卡写 `is_makeup:true` 的 `checkins`，不扣分。
- **周券**：`UNIQUE (wish_id, week_start)`；签约发首周券（`week_index` 以 `weekStartOf(start_date)` 为基准，首周 = 1），之后在今日页/补卡请求里惰性补发。
- **限流**：`CHECKIN_PER_MINUTE`（默认 10）按 `checkins (user_id, created_at)` 滚动分钟窗计数；同一任务重复提交只覆盖同一行，不会增加计数。
- **版本**：所有改变任务/打卡的写操作都给 `wishes.version + 1`（读-改-CAS，最多 3 次），供第 5 轮结算判定。

### 6.2 账本聚合与结算公式（账本 ✓ 第 5 轮，结算 ✓ 第 6 轮）

**账本（`domain/ledger.ts`，全部读取时计算）**

```
当周支出  spent_cents  = Σ ledger_entries(entry_kind='expense' AND revoked_at IS NULL AND week_start=W)
当周收入  income_cents = Σ ledger_entries(entry_kind='earned'  AND revoked_at IS NULL AND week_start=W)
周结余    balance_cents = max(0, budget_cents − spent_cents)     // 超预算记 0，同时 over_budget = spent > budget（PRD D-05）
周进度    progress_bps  = budget > 0 ? min(10000, floor(spent × 10000 / budget)) : (spent > 0 ? 10000 : 0)
周是否计入 counted      = 该周存在 status ∈ {done, made_up} 的任务   // 没打卡的周不计入，也不倒扣
累计兑现  realized_cents = Σ(counted 周 balance_cents) + Σ(全部周 income_cents)
```

- **`ledger_weeks` 只存 `budget_cents`**：`spent_cents / saved_cents / earned_cents / counted / over_budget` 都是迁移期预留列，第 5 轮不写、不读，恒为 `0/false`；因此不存在"写流水后重算周表"的崩溃窗口，任何时刻读到的都是明细的真实聚合。
- **首周预算**：签约时按 `q4_disposable_band` 映射（`under_100→2000`、`100_299→4000`、`300_599→8000`、`600_999→12000`、`1000_plus→20000`，缺档 5000），随后可用 `PUT /api/ledger/weeks/:weekStart` 改当前/未来周，历史周锁定（400 `week_not_editable`）。
- **流水方向**：库内 `entry_kind` 只有 `expense / earned` 两种在本轮使用，金额恒为正；接口词表映射为 `expense / earning`。支出不带任务；收入必须关联同周的 `side='money'` 且 `done/made_up` 的任务，`proof_id` 可选但若给出必须是 `ledger_proof`。
- **收入去重**：写入前按 `(wish_id, task_id, entry_kind='earned', revoked_at IS NULL)` 读检查，命中回 400 `duplicate_earning_link`；平台没有部分唯一索引，并发双写是残余风险（03 §9）。
- **并发**：预算修改以 `updated_at` 为令牌做单行 CAS，最多重试 3 次，仍冲突回 409 `ledger_week_conflict`；流水写入失败回 409 `ledger_entry_failed`，两层都由 `Idempotency-Key` 兜网络重试。
- **结算前不透支礼物信息**：账本响应只含金额、周序号、计数与提示文案，`rewards` 名称/价格/匹配结果一律不出现（PRD D-06）。

**结算（`domain/settlement.ts`，✓ 第 6 轮）**

```
结算前置：status='active' AND now >= settleOpenAt(end_date)   // 未到 400 settle_too_early + seconds_remaining
先扫日界：pending AND task_date < productDate(now) → missed    // 与今日页同一条件批量更新

必做计数 must_total / must_done   = COUNT(tasks WHERE is_must)
钱任务计数 money_total / money_done = COUNT(tasks WHERE side='money')
完成判定 done(status)             = status ∈ {done, made_up}

结局 outcome = must_done < must_total               → unrealized   // 不盖章，可续期/降档
             = money_done < money_total             → cyber_only   // 盖章，未拆的信
             = 其余                                 → double_realized // 盖章，完整礼物

累计兑现 total_cents = readLedger(愿签).totals.realized_cents       // 复用第 5 轮，不二次加总
礼物类别 category    = q5 关键词命中最多的类别，零命中按 wish_type 映射
候选 affordable      = rewards(is_active AND category AND min_cents <= total_cents)
匹配                 = q5 点名的礼物在候选内优先，否则 max_cents 最大的一件
差额 median          = floor((reward_min_cents + reward_max_cents) / 2)
    gap_cents        = max(0, median − total_cents)
    gap_bps          = floor(gap_cents × 10000 / median)
gap_band             = gap_bps <= 1000 → exact（刚好够）
                     <= 3000 → near（差一点，给攒钱建议）
                     > 3000 → far（未拆的信；强制改用类别内最低价礼物再算一次）
```

- **结算快照**：`settlements` 一行封存 outcome、计数、账本合计、礼物区间、差额档位、文案与信件模板；读取接口不重算金额，避免"结算后再记流水"改写历史。`task_details` 在读取时从 `tasks` 现取，只用于展示。
- **一致性**：`active→settling` 用 `status + version` 单行 CAS；快照 `insertIfAbsent(wish_id, version)` 先落库，`settling→settled` 后收尾；`settling` 租约 60 秒，超时可由下一请求接管。已 `settled` 的重复调用直接回快照 + `already_settled:true`，不重算。
- **不泄露礼物**：只有 `GET .../settlement` 在 `settled` 后组装第二幕；结算前账本、详情、任务接口都不读 `rewards`。
- **续期**：仅 `cyber_only/unrealized`，每个愿签一次；`.eq(status,'settled').eq(renew_count,0)` CAS，截止日 +7 天、回 `active`，按原开始日重算任务计划并 `insertIfAbsent` 只补新增天数，同时补发覆盖新周的自然周补卡券。再次结算从 `max(version)+1` 写下一版。

金额单位：**分（integer cents）**，只在出参里额外给 `*_yuan`（`Math.floor(cents / 100)`）。禁止浮点参与任何累计。

## 7. 数据一致性（无事务环境的设计）

| 场景 | 风险 | 手段 |
| --- | --- | --- |
| 重复打卡 / 离线重放 | 同一任务两条记录 | **✓ 第 4 轮已实现**：①全局幂等表（同 key 同指纹 → 重放已存结果）②`tasks.status` 单行 CAS：`update().eq('status','pending')`，`affected()` 为 0 即已有人写过 → 回读状态并转覆盖 ③表级 `UNIQUE (task_id)` + `insertIfAbsent` 兜底（一个任务只能有一条记录） |
| 立约后任务生成一半失败 | 缺任务 | **✓ 已实现**：任务 id 由 `(wish_id, day_index, seq)` 派生 + `insertIfAbsent(onConflict:'id')`，重试只补缺行；顺序是「先规划 → 再 CAS → 后批量插」，池为空时在改状态前就 503，不会留下没有任务的 active 契约 |
| 重复签署 / 幂等重放立契 | 插出第二份任务、天数被改 | **✓ 已实现**：`status='active'` 时按首次签署的 `days`/`start_date` 重算同一批 id，`first_sign=false` + `inserted_tasks=0` 返回 200；CAS `.eq('status','draft')` 命中 0 行就读回真实状态再判（仍非 active → 409 `wish_state_conflict`） |
| 五问并发首提交 | 两个请求各插一行 / 答案被静默丢弃 | **✓ 已实现**：`wish_answers_wish_id_uidx` + `insertIfAbsent(onConflict:'wish_id')`；返回 0 行说明别人先建了行，本请求改走 `update`，部分提交的字段不会丢 |
| 结算并发与崩溃 | 重复结算、快照与状态不一致 | **✓ 第 6 轮已实现**：`active→settling` 用 `status + version` CAS，`settled` 重复调用直接回快照；快照先 `insertIfAbsent(wish_id, version)` 再收尾 `settling→settled`，崩在中间可由下一次请求补收尾；`settling` 租约 60 秒，无快照时按 `updated_at` CAS 接管 |
| 续期并发 | 两次续期都成功 | **✓ 第 6 轮已实现**：`.eq(status,'settled').eq(renew_count,0)` 单行 CAS，第二次必然命中 0 行并回 400 `extend_limit_reached`（先判次数再判状态） |
| 账本聚合与明细不一致 | 写流水后汇总失败/漏更新 | **✓ 第 5 轮已实现**：根本不做冗余更新——`ledger_weeks` 只存预算，支出/收入/结余/累计全部在 `readLedger` 里从 `ledger_entries` + `tasks` 聚合，读到的必然是明细真值；`ledger_weeks` 其余统计列恒为 0（冒烟断言） |
| 周预算并发修改 | 两个请求互相覆盖 | **✓ 第 5 轮已实现**：`update(...).eq('id').eq('updated_at', 旧值)` 单行 CAS，写入新的服务端时间；最多重试 3 次，仍失败回 409 `ledger_week_conflict` |
| 补卡券 | 一张券用两次 / 任务没补成但券被烧 | **✓ 第 4 轮已实现**：`makeup_tickets` 单行 CAS `update().eq('status','available')`（表级 `UNIQUE (wish_id, week_start)`），成功才改任务状态；任务 CAS 失败时把券放回（`task_id` 仍指向该任务）并回 409 `task_state_conflict` |
| 惰性日界 | 昨天及以前的 pending 一直挂着 | **✓ 第 4 轮已实现**：今日页/打卡/补卡入口先做条件批量更新 `pending AND task_date < today → missed`；无 cron，重复执行无副作用 |
| 写请求结果未知 | 客户端盲重试造成重复 | 幂等表按原始 key 对账（先查后判），永不自动重放写；`in_progress` 超 60 秒（`updated_at`）由后来者 CAS 接管 |
| 文件先落库后校验 | 脏记录 | **✓ 第 7 轮已实现**：`pending → ready` 必须经 `download` 实测字节 + 文件头与声明 MIME 一致；不一致转 `rejected`，`pending→ready` 用单行 CAS，重复 complete 直接回同一行；打卡/账本只认 `ready` |
| 分享链接重复生成 / 并发首生成 | 同一愿签两条链接、旧链未失效 | **✓ 第 7 轮已实现**：`share_links UNIQUE(wish_id)` + 已有行原地轮换 `token`；首生成并发时另一请求 `insertIfAbsent` 落空，改读回同一行轮换；撤销只置 `status='revoked'`，重复撤销幂等 |
| 举报重复 / 并发满阈值 | 同一人重复计数、帖子反复进 hidden | **✓ 第 7 轮已实现**：`reports UNIQUE(target_type,target_id,reporter_id)` + `insertIfAbsent`；计数后 `update().eq(status,'published')` CAS 隐藏，命中才把 open 举报批量标 `acted` |
| 回信同帖日限并发 | 同一人同帖一天出现两条 | **已知残余竞态**：时间窗无法建 `UNIQUE`，靠 `(post_id, author_id, created_at)` 窗口查询 + 插入；总日限 `REPLY_PER_DAY` 另有计数兜底（03 §9、09） |
| 恢复码并发撞车 | 两个账号同一恢复码 | `users_recovery_code_hash_uidx` + 重新生成最多 3 次（`backend/domain/users.ts`），绝不覆盖他人摘要 |

## 8. 对象存储与文件生命周期

第 7 轮已落地（`backend/domain/upload.ts` + `api/uploads/`，对象存储客户端由 `index.ts` 从平台 `_qoder/storage.mjs` 注入并沿 `Ctx` 传给领域层）：

- 数据库只存元数据（`files` 行）；对象 key 由服务端派生 `u/<userId>/<purpose>/<fileId>.<ext>`，`purpose ∈ checkin_proof / ledger_proof / share_image`，扩展名由 MIME 决定，客户端提交的 `filename` 不参与路径；`files_object_key_uidx` 保证同一 key 不会被写两次。
- **两段式**：`POST /api/uploads/presign`（先限流、要求登录，带 `wish_id` 时校验作者；建 `pending` 行 + 平台签发的短时 PUT URL + `required_headers:{content-type}`，记录 2 小时有效）→ 客户端 **PUT** 原始字节 → `POST /api/uploads/complete {file_id}`（服务端 `download` 实测字节：≤200KB、非空、文件头与**声明 MIME 一致**，通过后 `pending→ready` 并写 `size_bytes/sha256/verified_at`；不一致标 `rejected` 并回 `verification_failed`）。
- **大小以实测为准**：声明 `size_bytes` 只用于早退；`Content-Length` 可谎报，`readBounded` 边读边判并带 15 秒超时。图片只收 JPEG / PNG / WebP，上限统一 200KB（没有分用途放宽）。
- **读取**：`POST /api/uploads/:id/url` 仅归属者可换 600 秒签名 GET URL；`file_not_ready` 拒绝 pending/rejected。签名 URL 是短期 bearer 能力，**不入库、不打日志、不进埋点**，也不出现在任何分享/公开响应里。
- **DTO 白名单**：`toFileDto` 只回 `id/purpose/status/mime_type/size_bytes/wish_id/created_at/verified_at`；`sha256` 与 `object_key` 只在库内，不出接口。
- **业务接入**：打卡要求 `proof_id` 本人、`ready`、`purpose=checkin_proof`、绑定愿签一致；账本流水 `proof_id` 可选，给了就按 `ledger_proof` 校验。服务端**不做图片内容审核、不做 AI 验收**（既有约束）。
- **生命周期**：`pending` 行的 `expires_at` 为 presign 后 **2 小时**；`complete` 时过期即返回 `upload_expired` 并把行标 `expired`，同账号下一次 `presign` 也会按 `expires_at` 惰性批量标记过期 pending。平台无 cron，**残留对象仍需离线清扫**；`DELETE /api/uploads/:id` 未实现。注销/删除后的对象清理仍属上云后的运维项。
- 公开池与分享接口的响应结构里**没有 proof/file/photo/object_key 字段**（契约层面强制，PRD C-07/E-05）。

## 9. AI 编排边界（✓ 第 8 轮实现 P0）

- 能力位共四个（`polish_wish` / `task_candidate` / `reply_draft` / `letter_draft`），**本轮只开放 `POST /api/ai/polish-wish`**；其余三个在 `domain/ai.ts` 里留了函数与常量，调用即 503 `ai_capability_not_implemented`，不暴露半成品接口。
- **统一适配器**：领域层只依赖 `AiAdapter { name, generate(input, signal) }`。解析顺序是「测试显式注入 → `AI_AGENT_ENDPOINT` 配置的 HTTP 端点 → 确定性模板」。端点未配置时本地、比赛演示都只走模板，不依赖外网；端点调用用 `AbortController` 在 `AI_TIMEOUT_MS`（默认 8s）超时。
- **输入先脱敏**：`redactSensitive` 把联系方式、长数字替换成 `***` 后再交给模型；缓存键为 `SHA-256(能力 + 提示词版本 + 脱敏文本 + 关系 + 愿望类型)`，响应只回 `input_redacted` 布尔，不回原文。五问答案从不进入提示词。
- **输出校验**：恰好 3 条、每条 1–60 字、互不重复、无敏感联系方式/URL；任一条不合格整包丢弃。失败原因收敛为 `timeout / agent_error / invalid_output / quota_exceeded`，四种都回退模板并置 `fallback:true`，HTTP 仍是 200，主流程不阻塞（PRD G-03）。
- **标签强制**：顶层 `ai_assisted:true`、`ai_label:"AI辅助"`、`label_required:true`，每条建议也带同名 `label`；`notice` 明确提示"需你确认后才会写入"。接口**从不写 `wishes` / `wish_answers`**，用户点选后仍走原有愿签编辑路径（PRD G-04）。
- **额度**：`AI_POLISH_PER_DAY`（默认 20/产品日）只数 `ai_suggestions.source='agent'` 的行；模板兜底不消耗额度，但额度耗尽后同一输入仍返回已缓存的模板结果。演示身份直接 403 `demo_forbidden`，不触发模型、不占真实额度。
- **缓存**：`ai_suggestions` 以 `(user_id, capability, input_hash)` 唯一；命中且未过期回 `cached:true`，不重复调用、不重复计费；并发首写用 `insertIfAbsent`，落败方回读胜者结果。TTL 由 `AI_CACHE_TTL_HOURS`（默认 72h）控制，过期行在下次命中时惰性删除。
- 兜底文案是 `domain/ai.ts` 内的确定性模板（六类 × 3 条，按关系称谓替换），无 AI 参与；模板自身被改坏时返回 503 `ai_template_invalid`，不返回脏数据。`ai_jobs` 表仍不建：同步请求没有排队/重试，调用留痕只进结构化日志。

## 10. 演示模式隔离（✓ 第 8 轮实现）

主入口是 `POST /api/demo/session`（匿名 + 每 IP 限流），一次返回演示 Bearer Token、人设与基线状态；`POST /api/auth/guest` 的 `x-demo-session` 分支仍保留，只做"同一会话 id 换发演示 token"，不预置数据。`backend/domain/demo.ts` 负责编排，五个路由分别是 session / state / fast-forward / scenario / reset。

- **隔离靠数据行而不是标记**：每次创建都新写一个 `users.is_demo = true` 账号，`demo_sessions.user_id` 指向它（唯一索引 `demo_sessions_user_uidx`）；真实数据的 `user_id` 永远指向 `is_demo = false` 账号。任何按 `user_id` 过滤的查询天然读不到演示数据，前端怎么改都越不过去。`wishes.is_demo` + `demo_session_id` 由第 3 轮写入，`pool_posts` / `replies` 的公开列表强制 `.eq('is_demo', false)`，演示帖子永不进公开池。
- **身份闸门**：演示接口一律 `requireDemoUser`（真实 token 403 `demo_required`）；真实业务写接口在 AI 润色、分享生成、公开池发布/举报/回信处加 `requireRealUser`（演示 token 403 `demo_forbidden`）。演示账号不能绑定真实账号、不能发真实分享链、不能触发真实 AI。
- **基线 100% 走真实引擎**：创建时用 `createWish → saveAnswers → signContract` 生成一张已立契愿签，起始日回拨 2 天；再按真实打卡/账本引擎补 2 条打卡（第 0、1 天）、首周 32 元支出。于是"替妈妈许愿腿疼、第 3 天、累计 168 元"不是 fixture，换任何业务规则都会跟着变。
- **快进**：`POST /api/demo/fast-forward` 把时间锚点回拨 8 天（契约结束于 2 天前，结算闸门必已打开），逐日调用真实打卡引擎补齐 7 天、按周写入支出与钱任务收入，再调真实 `settleWish`。任务统计、账本累计、礼物匹配、结局判定与真实结算完全同源；重复快进不重复生成任务（派生 id + 唯一索引）。
- **三结局回放**：`POST /api/demo/scenario` 接收 `double_realized / cyber_only / failed`，按真实结局判定所需的数据形态重建任务完成情况后重跑结算——双兑现=必做与钱任务全完成；赛博实现=必做完成、钱任务未完成；未实现=必做未完成。演示不另写一套结局算法。
- **状态与并发**：`GET /api/demo/state` 只读；fast-forward / scenario / reset 都先对 `demo_sessions.updated_at` 做单行 CAS，抢不到即 409 `demo_session_busy`，把重建串行化。`reset` 删除该演示账号的愿签子表、把愿签重置为草稿后用真实立契重建基线，再写回 `baseline/mom_knee/3/false`。
- **TTL 与清理**：会话与 token 同源使用 `DEMO_TTL_HOURS`（默认 24h），过期后 `requireDemoSession` 返回 401 `demo_session_expired`；新会话创建时按 `expires_at` 升序**只清本 IP 最早到期的 3 条**，逐条校验 `is_demo` 后删子表、愿签、文件、token、会话行与账号。演示计数每 IP `DEMO_PER_HOUR`（默认 30），超过 429 `demo_too_many_sessions`。
- **不污染真实可见数据**：演示账号 `is_demo=true`，真实用户的列表/详情/分享/公开池都按 `user_id` 或 `is_demo=false` 过滤；当前没有全站运营统计接口，将来加报表必须显式排除 `is_demo`。`events` 表按范围约定仍不建。

未实现：`GET /api/demo/scenario?static=1` 静态兜底、六步引导的逐步 ACK、演示事件埋点。

## 11. 安全与限流

### 11.1 限流（PRD 6.3，全部由既有表计数实现，无需额外计数表）

| 场景 | 阈值 | 实现 | 状态 |
| --- | --- | --- | --- |
| 匿名建号 | 每 IP 10/小时（`GUEST_PER_HOUR`） | `users (reg_ip_hash, created_at)` 窗口计数 | 已实现 |
| 恢复码尝试 | 每 IP 12/小时（`RECOVER_PER_HOUR`） | `auth_attempts (ip_hash, created_at)` 专用表（成功失败都记） | 已实现 |
| 演示会话 | 每 IP 30/小时（`DEMO_PER_HOUR`） | `demo_sessions (ip_hash, created_at)` 窗口计数 | 已实现 |
| **愿签创建** | **每账号 20/产品日**（`WISH_CREATE_PER_DAY`，草稿也计数） | `wishes (user_id, created_at)` + `dailyWindow`（04:00 为界）；超限 429 `wish_create_limited` + `retry-after` | **已实现（第 3 轮）** |
| 打卡 | 每用户 10/分钟（`CHECKIN_PER_MINUTE`） | `checkins (user_id, created_at)` 滚动分钟窗计数 | **已实现（第 4 轮）** |
| 上传凭证 | 每账号 30/小时（`UPLOAD_PER_HOUR`） | `files (user_id, created_at)` 滚动小时窗；超限 429 `upload_rate_limited` | **已实现（第 7 轮）** |
| 发布公开池 | 每账号 5/产品日（`POOL_PUBLISH_PER_DAY`） | `pool_posts (author_id, created_at)` + `dailyWindow`；超限 429 `publish_quota_exceeded` | **已实现（第 7 轮）** |
| 举报 | 每账号 20/小时（`POOL_REPORT_PER_HOUR`） | `reports (reporter_id, created_at)` 滚动小时窗；超限 429 `report_rate_limited` | **已实现（第 7 轮）** |
| 回信 | 每账号 20/产品日（`REPLY_PER_DAY`）+ 同帖每人每天 1 条 | `replies (author_id, created_at)` 走 `enforceWindow`；同帖日限是窗口查询（无 UNIQUE，见 §14）；超限分别 429 `reply_rate_limited` / 409 `reply_daily_limit` | **已实现（第 7 轮）** |
| AI 润色 | 每用户 20/产品日（`AI_POLISH_PER_DAY`） | `ai_suggestions (user_id, source='agent', created_at)` 产品日窗口计数（最多扫 1000 行）；模板兜底不计；超限回模板并标 `quota_exceeded`，不返回 429 | **已实现（第 8 轮）** |

`ip_hash = HMAC-SHA256(IP_HASH_SALT, clientIp)` 的前 32 位，只存摘要不落明文 IP；同一小时窗口用 `created_at >= since` 判定，重置时间由窗口给出。

**阈值上限受扫描上限约束**：`lib/quota.ts#SCAN_LIMIT = 50`，`enforceWindow` 靠「按索引扫时间窗内最多 50 行」计数，所以任何阈值配到 50 以上就永远判不出超限。上表所有默认值（10 / 12 / 30 / 20 / 10 / 30 / 5 / 20 / 20 / 20）都在安全区；要调高必须先改 `SCAN_LIMIT` 并复核索引（AI 额度走单独的 1000 行扫描，上限也是 1000）。阈值一律走环境变量（`GUEST_PER_HOUR` / `RECOVER_PER_HOUR` / `DEMO_PER_HOUR` / `WISH_CREATE_PER_DAY` / `CHECKIN_PER_MINUTE` / `UPLOAD_PER_HOUR` / `POOL_PUBLISH_PER_DAY` / `POOL_REPORT_PER_HOUR` / `REPLY_PER_DAY` / `AI_POLISH_PER_DAY`），不硬编码在业务分支里。

**IP 不可信**：平台目前没有开放可信 client-ip 头，`clientIp()` 依次读 `x-forwarded-for` 首跳、`x-real-ip`、`cf-connecting-ip`，全都可能被伪造。所以上表只用于"从宽"挡误触与脚本刷屏，**不构成安全边界**；真正的防滥用要靠平台 WAF，阈值可在部署验证后收紧（详见 [05-environment.md](../docs/05-environment.md) §4）。

### 11.2 输入与访问控制

- 所有入参先过接口文件里的校验常量（`lib/validate.ts` 执行）：类型、长度、枚举、正则一次过，错误按字段汇总进 `details.fields`；DB 侧只用 SDK 的参数化过滤（固定表名/列名，禁止拼接）。
- 归属判定分两条口径（第 3–5 轮需求明确要求，与第 1 轮「一律 404」不同）：**读操作**在同一查询里带 owner 谓词（`findOwnedWish`），查空即 404 `wish_not_found`，不泄漏「存在但不是你的」；**写操作**先按 id 读再比对作者（`requireAuthor` / `requireTaskAuthor`），不存在 404、存在但非作者 403 `wish_forbidden`。**账本读是读路径的显式例外**：需求要求非作者 403，故 `GET .../ledger` 与今日页一样走 `requireAuthor`；预算与流水当然是写路径 403。演示态写真实数据仍是 403 `demo_forbidden`。
- 非法状态流转返回 **400**（`wish_not_draft` / `answers_locked`），**409 只留给真并发**（`wish_state_conflict` / `idempotency_in_progress` / 指纹不符）。把「状态不对」塞进 409 会让客户端把可预期的业务拒绝当成重试信号。
- GET 绝不改状态；写接口按 `route.maxBodyBytes` 限长（登录类 2–4KB），超限 413 `payload_too_large`，非 JSON 400 `invalid_json`。
- 敏感词/正则拦截在 `lib/sensitive.ts`（确定性代码，不是人工审核队列）：手机号、身份证、外链、邮箱、微信号、带门牌号的地址与引流黑词命中即拒（`sensitive_content`）；公开摘要另走 `redactSensitive` 把联系方式替换成 `***` 并压掉 6 位以上数字，再截到 ≤120 字。
- 公开出口（`/api/s/:token`、`/api/pool*`、回信列表）必须由 DTO/白名单投影组装，不能整行转 JSON；白名单由冒烟断言 `FORBIDDEN_PUBLIC` 正则兜底（五问、账本、金额、礼物、文件、用户标识一律不出现）。

### 11.3 密钥（Sites Secrets，只写不可读）

实际读取点在 `backend/lib/config.ts`，完整清单与轮换策略见 [05-environment.md](../docs/05-environment.md)：

| 名称 | 用途 | 缺失后果 |
| --- | --- | --- |
| `JWT_SIGNING_KEY` | 自建 Bearer Token 的 HS256 签名密钥 | 全部接口 503 `service_not_configured` |
| `TOKEN_PEPPER` | `auth_tokens.token_hash` 的 HMAC 密钥（审计用摘要） | 同上 |
| `RECOVERY_PEPPER` | 恢复码摘要密钥 | 同上；**换值等于全网恢复码失效** |
| `IP_HASH_SALT` | 限流用 IP 摘要盐 | 同上 |
| `IDEM_FINGERPRINT_KEY` | 幂等请求指纹 HMAC | 同上 |
| `FIELD_ENCRYPTION_KEY` | 五问答案字段级加密（AES-256-GCM，实际密钥 = SHA-256(本值)，AAD = `wish_id`） | 同上；**第 3 轮起已是必填项**，`PUT /api/wishes/:id/answers` 靠它落密文。换值 = 全量重加密，必须上线前定稿（05 §2） |

平台已保留 `QODER_*`、`SUPABASE_*`、`POSTGRES_*`、`DATABASE_URL` 前缀，应用密钥不得占用。密钥缺失时服务**不会**带着弱配置跑起来：`loadConfig()` 抛 `ConfigError`，`index.ts` 捕获后除 `GET /api/health`（回 `status: degraded` 方便部署面板定位）外一律 503 `service_not_configured`；`server.ts` 里也留了同样的 `ConfigError` 分支，覆盖本地 `createApp()` 路径。

## 12. 数据库迁移与发布流程

SQL 已落成 `database/migrations/0001…0007`（**7 个文件 / 98 条语句 / 22 张表**，平台子集，`check-migrations.ts` 校验通过）。平台不接受 `CREATE UNIQUE INDEX`，唯一性一律写进建表期的表级 `UNIQUE (...)`（例如 `tasks (wish_id, text)`、`checkins (task_id)`、`makeup_tickets (wish_id, week_start)`、`ledger_weeks (wish_id, week_start)`、`settlements (wish_id, version)`、`share_links (wish_id)`、`pool_posts (wish_id)`、`reports (target_type, target_id, reporter_id)`、`ai_suggestions (user_id, capability, input_hash)`）。**第 3–7 轮没有新增迁移**（第 7 轮的 `files / share_links / pool_posts / replies / reports` 五张表在 0002/0006 已建好）；**第 8 轮新增 0007 `ai_suggestions`**，用于建议缓存与额度计数。执行顺序、真实参数名与回滚约定见 [database/migrations/README.md](../database/migrations/README.md)。要点：

1. `ensure_backend`（database + functions，`databaseAccessModel: function_backend`）。
2. `get_site` → `get_database_schema` 取 `schemaRef`。
3. 每个迁移文件一次 `create_database_migration({ siteId, requestId, schemaRef, clientMigrationId, displayName, sql, accessPolicies: [] })` → 用返回的 `planRef` 调 `apply_database_migration({ migrationId, requestId, planRef, confirm: true })` → 重新 `get_database_schema` 核对表与索引。`accessPolicies: []` 是 function_backend 的写法，策略由平台生成，全部数据只能经 Function 访问。
4. 内容库 `database/seed/*.json`（72 愿望模板 / 120 任务模板 / 24 礼物，由同目录 `.ts` 真源经 `build-seeds.ts` 产出）用 `insert_database_rows` 分批导入；该工具**不支持 upsert**，重跑前先查已有 id、只补缺失行（id 确定性，可安全对齐）。迁移 SQL 内不含 DML，平台也不允许。**不导 `task_templates` 就无法立契**（503 `task_pool_empty`）。
5. `prepare_site({ actionId, projectRoot, webDirectory: "dist", functionDirectory: "backend", databaseAccess: "read_write", schemaRef, secretNames })` → 确认草稿 ready 后 `publish_site`（同一 actionId 与完全相同的输入）。`prepare_site` 只生成不可变草稿、不发布；actionId 在重试时保持不变。
6. 冒烟：`GET /api/health` → `GET /api/health/deep` → `POST /api/auth/guest` → `GET /api/me` → `PATCH /api/me` → `POST /api/auth/recover` → `POST /api/auth/logout` → `POST /api/wishes` → `PUT /api/wishes/:id/answers` → `POST /api/wishes/:id/contract` → `GET /api/wishes/:id/tasks` → `GET /api/wishes/:id` → `GET /api/wishes` → `GET /api/wishes/:id/tasks/today` → `POST /api/tasks/:id/checkin` → `POST /api/tasks/:id/makeup` → `GET /api/wishes/:id/ledger` → `PUT /api/ledger/weeks/:weekStart` → `POST /api/ledger/entries` → `POST /api/wishes/:id/settle` → `GET /api/wishes/:id/settlement` → `POST /api/wishes/:id/extend` → `POST /api/uploads/presign` → 真实 PUT → `POST /api/uploads/complete` → `POST /api/uploads/:id/url` → `POST /api/wishes/:id/share` → `GET /api/s/:token` → `DELETE /api/wishes/:id/share` → `POST /api/pool/publish` → `GET /api/pool` → `GET /api/pool/:id` → `POST /api/pool/:id/replies` → `GET /api/pool/:id/replies` → `DELETE /api/replies/:id` → `POST /api/pool/:id/report` ×3 → `POST /api/pool/:id/unpublish` → `POST /api/ai/polish-wish` → `POST /api/demo/session` → `GET /api/demo/state` → `POST /api/demo/fast-forward` → `POST /api/demo/scenario` ×3 → `POST /api/demo/reset`（42 条路由全覆盖，真实数据非 fixture）。**重点复验九件事**：用 Owner 侧 `delete_database_row` 在测试站点删掉一条 `tasks` 行再重签，应当只补回那一条（`insertIfAbsent` 的逐行忽略冲突语义）；同一任务打卡两次，`checkins` 始终只有一行且字段为最后一次；解一次五问密文确认 Deno edge 的 Web Crypto 与本地 Node 一致；账本读出的 `realized_cents` 必须等于"已计入周结余 + 全部收入"的整数复算；结算并发两次只产生一版快照，且 `settlements` 行落库后愿签才变 `settled`；**对象存储的 presign PUT（带 content-type）→ download 实测字节 → 600 秒签名 GET** 全链路可用且私有桶阻断直连；`GET /api/s/:token`、`/api/pool*`、回信列表的响应体不含五问/账本/金额/文件/用户标识；AI 润色在未配端点时返回 3 条带「AI辅助」标签的模板建议且不写愿签，配端点后同一输入第二次 `cached:true` 且模型只调一次；演示快进的结算统计与 `tasks` 行逐项一致、`realized_cents = saved + income`，且真实用户列表与公开池看不到演示数据。

**第 3–7 步尚未执行**：迁移与 seed 会创建/修改云端资源，且 `prepare_site` 曾被拒绝；本地已验证的是 SQL 子集、seed 形状与 42 条路由的行为（470 项断言 + 任务列表接口的浏览器验收）。0007 尚未在云端执行。

## 13. 非功能目标（后端侧）

| 项 | 目标 | 手段 |
| --- | --- | --- |
| API P95 | ≤500ms | 每接口 ≤3 次 DB 往返；列表走覆盖索引；无 N+1。**例外：立契**（读池 → CAS → 回读 → 批量插 → 读回任务，5 次往返 + 一次批量写），30 天契约 90 行，属一次性重接口 |
| 结算 | ≤1.5s | 纯函数计算 + 单次读明细（≤300 行）+ 单行写 |
| 可用性 | 核心流程 99.5% | 依赖失败返回稳定 503 码 + `requestId`，不重试写 |
| 可观测 | 数据延迟 ≤1h | 已实现：结构化单行日志（code/path/耗时/主体哈希，不含明文与签名 URL）；`events` 埋点表按范围约定不建，接后台时再补 |
| 幂等存档 | ≤64KB/条 | 立契响应要装下 30 天契约的全量任务（90 条 × ~200B），16KB 会被截断 ⇒ `MAX_STORED_BODY_BYTES = 64KB` |

## 14. 风险与待确认

1. **微信小程序域名限制**：小程序 `request` 合法域名要求 HTTPS + 已备案域名。若 `*.qoder.site` 不满足，小程序侧只能走 WebView 打开站点（PRD US-03 本就要求微信内可打开链接），此时 Bearer Token 需存 WebView 内的 `localStorage`。→ **仍待确认**（上云前必须定）；接口设计本身两种形态都兼容（无 Cookie 依赖）。
2. **平台身份隔离待验证**：`function_backend` 的私有策略由平台生成，但"Provider 直连是否被阻断"属部署侧保证，需在实施轮用一条真实请求验证，不能靠本地 fake 推断。
3. **无事务**：跨表多写（立约→生成任务→发补卡券→写结算快照）不能保证原子性，已用幂等 + CAS + 派生 id + 读取时聚合 + "快照先写、状态后收尾"兜底；立约第 3 轮、打卡/补卡券第 4 轮、账本第 5 轮、结算第 6 轮、上传/分享/公开池/回信第 7 轮均落地并冒烟覆盖。若后续要求强一致，需引入单行状态机或补偿任务表。
4. **`insertIfAbsent` 的逐行语义未经真库验证（第 3 轮最大风险）**：本地 fake 按 PostgREST 语义模拟「逐行跳过冲突、只返回真正插入的行」，而**崩溃后补齐任务与重复立契完全依赖这一语义**。若平台实际是整批失败，重签会报错而不是补齐。同理 `affected()` 依赖 SDK 回传行数组长度（写请求一律带 `select`），立契的单行 CAS 判定就靠它。两项都必须在部署后用真实请求复验（05 §6、03 §9）。
5. **轮转副本依赖「唯一索引允许多个 NULL」**：`tasks_wish_template_uidx` 在 `template_id = NULL` 时不互斥，这是 PostgreSQL 标准语义，但平台子集需实测；若不成立，30 天契约的第二轮 `for_ta` 会插不进去。
6. **礼物目录可见性**：PRD D-06 要求结算前全站检索不到礼物名。对客户端不提供任何目录读接口；结算在服务端内部读 `rewards`，只有 `settled` 后的 `GET .../settlement` 才带出命中物品。需同步确认前端不做目录预置。
7. **审核简化偏差**：PRD E-06/F-02 要求"先审后发"。按范围约定改为"发布即公开 + 敏感词规则拦截 + 达阈值举报自动隐藏"（默认 3，`POOL_REPORT_HIDE_THRESHOLD` 可调），`pool_posts.status` 是自由 `text`（迁移子集不允许 CHECK），Function 层只写 `published/hidden/deleted`，后续接后台时加 `pending_review` 取值即可，不改表。第 7 轮已实现举报去重与自动隐藏，但没有申诉/恢复入口：hidden 帖子不可由作者重新发布。
8. **`jsonb` 无默认值**：迁移子集不支持 `DEFAULT '[]'` 之类表达式默认，所有 `jsonb` 列由 Function 必赋值；实现时漏传即报错（这是好事，但要有单测覆盖）。第 3 轮的 `wishes.shown_template_ids`、`wish_answers.skipped` 都显式写 `[]`。
9. **内容规模与需求书算不齐**：愿望模板「40 条 / 12 关系每种 4–6 条」在算术上不成立 ⇒ 落地 72 条（12×6）；任务库「120 条 / 6 类×5 组×≥12」同样不成立 ⇒ 落地 6 类×20 条 + 关系专属/通用兜底 + 轮转副本（用户已确认）。详见 03 §6。
10. **账本收入去重无库级约束（第 5 轮新增风险）**：平台只允许建表期表级 `UNIQUE`，"一条钱任务最多一笔收入"需要部分索引语义，因此只有写前读检查。并发双写可能各插一行，使该周收入重复计入；根治需后续迁移增加 `earning_task_key` 列 + `UNIQUE (wish_id, earning_task_key)`。上线后应按 `ledger_entries (task_id)` 抽查重复。
11. **结算租约依赖 `updated_at` 精度（第 6 轮新增风险）**：`settling` 超过 60 秒无快照时，下一请求用 `updated_at` CAS 接管。真库若在同一毫秒内无法区分首写与接管写，接管会持续 409；部署后需并发打两次 settle 复验。另一条硬约束是**快照必须先于 `settling→settled`**，否则会出现 `settled` 但无结算行的 409 `settlement_missing`。
12. **结算语义与设计稿的偏离（第 6 轮）**：差额改为相对**价格中位数**的三档（`exact/near/far`），`surplus` 不再出现；`>30%` 强制落类别最低价礼物；续期固定 7 天且只允许一次；两幕在 `settled` 后由同一个 GET 返回，设计稿的 ACK/72 小时展开、信件编辑、兑现卡图未实现。详见 08 §3。
13. **对象存储全链路未上真机（第 7 轮新增风险）**：本地 `FakeStorage` 只模拟 `createSignedUploadUrl/createSignedUrl/download` 的形状。真实环境需确认：私有桶是否阻断 Provider 直连；浏览器 PUT 是否接受 `content-type`，以及 presign 后 **2 小时**未确认时 `pending→expired` 的惰性失效是否符合预期；`download` 是否返回可读流与 `content-length`；600 秒 GET 是否按时失效。这些都不影响本地断言，但上线前必须用真实请求各跑一遍（05 §6）。
14. **回信同帖日限的并发残余（第 7 轮新增风险）**：`replies` 没有 `(post_id, author_id, 产品日)` 的唯一约束（时间窗无法写进 `UNIQUE`），实现是"窗口查询 + 插入"。并发双击可能多出一条；总日限 `REPLY_PER_DAY` 由 `enforceWindow` 兜底，但同帖重复本身没有硬约束。根治需增加按产品日归一的列 + 表级 `UNIQUE`。
15. **举报计数按最多 50 行扫描（第 7 轮）**：`countPublishedReplies` 与举报计数都用 `limit(50)` 截断。默认隐藏阈值 3、回信计数用于展示，影响有限；若把 `POOL_REPORT_HIDE_THRESHOLD` 调到 50 以上，隐藏判定会失效。回信数超过 50 时详情页只显示 50，需分页接口取全量。
16. **AI 真实端点未经联调（第 8 轮新增风险）**：本地只验证了模板、注入适配器、超时与坏输出回退；`AI_AGENT_ENDPOINT` 的真实协议（返回 `suggestions` 的位置、限流、计费与延迟）尚未在云端验证。端点不可用会稳定回退模板，但"AI 建议质量"与真实响应格式只能部署后复验。标签目前由服务端强制返回，**前端是否原样展示「AI辅助」不在服务端可控范围**，需客户端联调确认（PRD G-04）。
17. **演示数据长期残留（第 8 轮新增风险）**：演示账号与愿签写真实业务表，仅靠 `is_demo` 区分；过期会话没有定时清理，只在下次创建演示会话时清**本 IP 最早 3 条**。无人再创建演示时，过期账号、愿签、文件与打卡会长期留在库里。当前无全站统计接口，不影响真实用户可见数据；上云后若加运营报表或用 `count(*)` 做容量判断，必须显式排除 `is_demo`，并考虑离线批量清理。
18. **0007 迁移未上云（第 8 轮）**：`ai_suggestions` 只在本地 FakeDb 与 `check-migrations.ts` 中验证过；云端未执行 0007 前，AI 润色接口会因缺表失败（真实端点/模板都会在写缓存时报错）。上线顺序必须是先 0007 再部署含 AI 的 Function。

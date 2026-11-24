# 愿TA · 替 TA 许个愿 — 后端（第 9 轮最终交付）

> 2026 Qoder 高校创造力大赛 Hack4Good 赛道
> 平台：Qoder Sites — Server Functions（Deno edge）+ Qoder Database + Object Storage + Cloud Agents
> 依据：`愿TA_PRD(1).pdf`（v1.2，2026-11-15）、`愿TA_项目简介.docx`
> 状态：**源码与本地验证完成；云端迁移 / seed / Function 发布待授权执行**（本轮未做任何云端写入）

## 一句话说明

这是一个「替 TA 许愿、用 7–30 天小行动兑现」的后端：游客建号 → 写愿签并答五问 → 立契生成每日任务 → 打卡/补卡 → 记账 → 到期结算（三档结局 + 礼物）→ 分享 / 公开池 / 回信 → AI 润色与完整演示模式。全部规则确定性可重放，不依赖定时任务、事务或人工审核。

## 现在能跑什么

```bash
node --version                 # 需要 ≥ 22.18（原生 type-stripping 直接执行 .ts）
node tools/local/serve.ts      # 本地 HTTP：http://127.0.0.1:8787（内存库，密钥见 tools/local/deps.ts）
node tools/local/smoke.ts      # 470 项行为断言
node tools/scripts/check-routes.ts
node tools/scripts/check-migrations.ts
node tools/scripts/check-schema-usage.ts
node tools/scripts/build-seeds.ts --check
node tools/scripts/diff-schema.ts
```

当前结果：

```
470 passed, 0 failed
42 条路由，✓ 路由表自洽
7 文件 / 98 语句 / 22 表，✓ 平台迁移子集
22 表 / 349 列 / 78 个源文件，✓ 代码↔DDL
72 / 120 / 24，✓ seed 形状
```

装了 Deno 时可跑 `deno task verify`（含 `deno check backend/index.ts`）。**本机没有 Deno，本轮未执行类型检查**；部署前应在有 Deno 的环境补跑。

## 已实现能力（42 条路由）

物理前缀固定 `{origin}/functions/v1/app`，逻辑路径如下。

| 模块 | 路由 |
| --- | --- |
| 系统与账号（7） | `GET /api/health`、`GET /api/health/deep`、`POST /api/auth/guest`、`POST /api/auth/recover`、`POST /api/auth/logout`、`GET /api/me`、`PATCH /api/me` |
| 愿签与契约（6） | `POST /api/wishes`、`GET /api/wishes`、`GET /api/wishes/:id`、`PUT /api/wishes/:id/answers`、`POST /api/wishes/:id/contract`、`GET /api/wishes/:id/tasks` |
| 每日任务与补卡（3） | `GET /api/wishes/:id/tasks/today`、`POST /api/tasks/:id/checkin`、`POST /api/tasks/:id/makeup` |
| 账本（3） | `GET /api/wishes/:id/ledger`、`PUT /api/ledger/weeks/:weekStart`、`POST /api/ledger/entries` |
| 结算与续期（3） | `POST /api/wishes/:id/settle`、`GET /api/wishes/:id/settlement`、`POST /api/wishes/:id/extend` |
| 上传（3） | `POST /api/uploads/presign`、`POST /api/uploads/complete`、`POST /api/uploads/:id/url` |
| 分享（3） | `POST /api/wishes/:id/share`、`DELETE /api/wishes/:id/share`、`GET /api/s/:token` |
| 公开池（5） | `GET /api/pool`、`POST /api/pool/publish`、`GET /api/pool/:id`、`POST /api/pool/:id/report`、`POST /api/pool/:id/unpublish` |
| 回信（3） | `POST /api/pool/:id/replies`、`GET /api/pool/:id/replies`、`DELETE /api/replies/:id` |
| AI 辅助（1） | `POST /api/ai/polish-wish` |
| 演示模式（5） | `POST /api/demo/session`、`GET /api/demo/state`、`POST /api/demo/fast-forward`、`POST /api/demo/scenario`、`POST /api/demo/reset` |

每条路由的 `route` 声明、鉴权、幂等、限长与 curl 示例在各自文件头；字段级契约与全局约定以 [docs/04-api-contract.md](docs/04-api-contract.md) 为准，前端接法见 [docs/12-frontend-integration.md](docs/12-frontend-integration.md)。

## 关键设计

- **文件即路由**：`backend/api/**/*.ts` 导出 `route` + 默认处理函数，`backend/manifest.ts` 是唯一登记处，`check-routes.ts` 从文件位置反推路径，防止「改了路径忘登记」。
- **平台子集优先**：无事务、无 CHECK/触发器/外键、无 `date/numeric`；金额一律整数分，日期用 TEXT，唯一性用建表期表级 `UNIQUE`。一致性靠幂等键 + 单行 CAS + 派生 id + 读取时聚合 + 「快照先写、状态后收尾」。
- **确定性规则**：愿望分类、标题派生、任务抽取（mulberry32 + sha256 种子）、轮转副本、三档结局、礼物匹配、差额档位全部是纯函数，不调用 AI、不用 `Math.random`；重放同一契约得到同一批任务。
- **无 cron**：漏卡、券过期、上传过期、AI 缓存、幂等存档、演示会话全部在读写路径上惰性处理；演示每 IP 每次只清最早到期的 3 条会话。
- **安全**：Bearer HS256（无 Cookie、无 refresh）、`jti` 即时撤销；五问 AES-256-GCM（AAD=`wish_id`）、恢复码只存 HMAC；私有对象存储 + 600s 签名 URL；公开/分享 DTO 白名单；统一安全头、405 `Allow`、控制字符清洗、全路由兜底限流；错误响应不回堆栈/SQL/内部路径。
- **AI 只建议**：3 条 ≤60 字建议，强制「AI辅助」标签；输入脱敏、输出校验、模板兜底；超时/失败/额度耗尽仍返回 200；绝不写愿签。
- **演示隔离**：演示数据挂 `is_demo=true` 账号，物理隔离 + 接口隔离；但 100% 复用真实任务/打卡/账本/结算引擎，不是假数据页面。

## 目录

```
backend/
  index.ts            # 唯一 Deno.serve 入口（平台注入 _qoder/*）
  server.ts           # 分发、鉴权、限流、错误封套、安全头
  manifest.ts         # 唯一路由登记表（42 条）
  api/                # 按模块的文件即路由
  domain/             # 纯业务规则（wish/task/checkin/ledger/settlement/upload/share/pool/reply/ai/demo）
  lib/                # config/validate/auth/crypto/time/quota/idempotency/respond/log/rate-limit
database/
  migrations/0001…0007.sql
  seed/*.json + *.ts  # 内容真源与构建产物
tools/
  local/              # serve.ts / smoke.ts / fake-db / fake-storage / deps（种子与密钥）
  scripts/            # 路由/迁移/schema/seed/差异 校验器
docs/                 # 交付文档（见下）
```

## 文档地图

| 文档 | 内容 |
| --- | --- |
| [docs/01-architecture.md](docs/01-architecture.md) | 运行形态、平台约束 → 设计决策、分层职责、鉴权、确定性规则、无事务一致性、隐私白名单、限流与密钥、发布流程、非功能目标、18 条风险 |
| [docs/02-conventions.md](docs/02-conventions.md) | 响应信封、状态码、`errorCode` 总表、Bearer、幂等、时间/金额/枚举、加密、公开出口、分页、响应头、兼容规则 |
| [docs/03-database.md](docs/03-database.md) | 22 张表逐列说明、迁移子集、唯一约束↔业务约束、索引用途、与设计稿差异、未做与并发边界 |
| [docs/04-api-contract.md](docs/04-api-contract.md) | **最终接口契约**：42 条已实现接口、全局约定、errorCode、幂等矩阵、限流表、安全与隐私、分模块 curl |
| [docs/05-environment.md](docs/05-environment.md) | Secrets 与全部环境变量、轮换策略、本地运行、线上开通顺序、未验证清单 |
| [docs/06–10 · 第 4–8 轮总结](docs/10-round8-summary.md) | 各轮实现范围、偏差、测试与风险 |
| [docs/11-deployment.md](docs/11-deployment.md) | **部署手册**：dev/staging/prod、迁移与 seed、Function 发布、域名/HTTPS、验收清单、回滚、排障 |
| [docs/12-frontend-integration.md](docs/12-frontend-integration.md) | **前端对接手册**：基地址、鉴权、幂等、业务调用顺序、两段式上传、错误处理、AI 标签、分享白名单 |
| [docs/13-round9-summary.md](docs/13-round9-summary.md) | 第 9 轮最终开发总结：范围、修复、安全加固、PRD 对齐、边界与后续 |
| [docs/14-test-report.md](docs/14-test-report.md) | **最终测试报告**：470 项分组、路由覆盖、校验器输出、未验证项、结论 |
| [database/migrations/README.md](database/migrations/README.md) | 迁移执行顺序、真实参数、schemaRef 回读、回滚 |
| [database/seed/README.md](database/seed/README.md) | 三份内容库导入步骤与内容真源 |
| [db/schema.sql](db/schema.sql) | 第 1 轮设计稿（24 表），仅作对照，不是执行入口 |

## 第 9 轮变更摘要

- 遗留风险：上传 pending **2 小时**失效（complete 拒绝 + presign 惰性清扫）；演示过期会话每次只清**本 IP 最早 3 条**；重复收入并发边界写入文档。
- 安全：统一安全响应头（CSP/nosniff/DENY/HSTS/no-store/referrer-policy）；405 `Allow`；`API_PER_MINUTE` 全路由兜底限流（health 豁免）；控制字符清洗；配置缺失统一 503 封套；XSS 串按纯文本存储。
- 测试：461 → **470** 项断言，新增上传过期、演示清理、安全头、405、控制字符、XSS、兜底限流用例。
- 文档：契约最终版 + 部署手册 + 前端手册 + 第 9 轮总结 + 测试报告 + README 重写。
- 未新增业务功能、路由或迁移；所有改动向后兼容。

## 实现状态

| 项 | 状态 |
| --- | --- |
| 工程骨架 / 42 条路由 | ✅ 本地行为全绿 |
| 迁移 0001–0007 | ✅ 静态校验；⚠️ 云端执行状态以 `get_database_schema` 为准，0007 需单独核对 |
| seed 72/120/24 | ✅ 形状校验；⚠️ 云端导入未确认 |
| Function / 站点发布 | ⚠️ 源码就绪；本轮未部署、未发布 |
| 真库 / 真存储 / 真 AI | ⚠️ 未验证，部署后按 11 §7 复验 |
| 类型检查 | ⚠️ 本机无 Deno，未执行 |
| 后台管理 / 审核队列 / 埋点 | 按范围约定不做；公开池用「发布即公开 + 举报隐藏」 |
| 微信小程序域名 | ⚠️ 待确认；不满足时走 WebView，接口无 Cookie 依赖 |

## 已知边界（不阻塞交付，但上线必须知道）

1. `insertIfAbsent` 的**逐行**跳过冲突语义、`affected()` 行数、唯一约束含 NULL、`updated_at` 精度都依赖平台真实行为，必须真库复验。
2. 同一 `task_id` 的并发双写可能重复计入收入；根治需后续 `earning_task_key` + 表级 `UNIQUE`。
3. 回信「同帖每人每天一条」是窗口查询 + 插入，无库级唯一约束；并发可能多一条，总量日限仍兜底。
4. 结算 `settling` 60 秒租约依赖时间精度；崩溃窗口靠「先写快照、再改状态 + 重复请求自愈」。
5. IP 不可信：注册/找回/演示限流只作从宽兜底，不是安全边界。
6. 演示数据写真实业务表，靠 `is_demo` 隔离；将来加运营报表必须排除 `is_demo`，并安排离线清扫。
7. `FIELD_ENCRYPTION_KEY`、`RECOVERY_PEPPER` 上线前定稿；换值等于全量重加密/全网恢复码失效。
8. 公开池无人工审核、无申诉恢复；hidden 帖子不可由作者重新发布。

## 下一步

1. 授权部署窗口：迁移 → seed → Function → 发布 → 真库冒烟（[11 §7](docs/11-deployment.md)）。
2. 补跑 `deno task verify` 与真实对象存储/AI 联调。
3. 前端按 [12](docs/12-frontend-integration.md) 联调，重点验上传、错误分支与「AI辅助」标签。
4. 后续迭代：结算 ACK/信件定稿/兑现卡图、AI 其余三能力、撤销打卡/离线同步、公开池接力、运营后台与离线清扫任务。

## 参考资料

原始需求与方案见 `愿TA_PRD(1).pdf` 与 `愿TA_项目简介.docx`。
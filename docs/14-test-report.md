# 14 · 最终回归测试报告

> 被测版本：第 9 轮最终交付（41 条路由 / 7 个迁移 / 3 份 seed）
> 2026-11-24 前后端联调补充：新增 `GET /api/wishes/:id/tasks`（第 42 条路由），由 `tests/browser_smoke.py` 覆盖；原 470 项断言仍全部通过。
> 测试日期：2026-11-22
> 结论：**470 / 470 通过，通过率 100%；四个结构校验器全绿；无产品缺陷阻塞交付。**

## 1. 总览

| 指标 | 结果 |
| --- | --- |
| 行为断言总数 | **470** |
| 通过 | **470** |
| 失败 | **0** |
| 通过率 | **100%** |
| 路由覆盖 | **41 / 41（100%）** |
| 迁移结构校验 | 7 文件 / 98 语句 / 22 表 / 349 列，✓ |
| 代码↔DDL 引用校验 | 78 个 Function 源文件，✓ |
| seed 形状 | 愿望 72 / 任务 120 / 礼物 24，✓ |
| 未执行 | Deno 类型检查、真库/真存储/真 AI、浏览器 E2E、压测（见 §7） |

## 2. 测试环境与方法

| 项 | 值 |
| --- | --- |
| 操作系统 | Windows 10.0.26200（x64） |
| Node.js | v24.22.1（原生 type-stripping，直接执行 `.ts`） |
| 运行命令 | `node tools/local/smoke.ts` |
| 数据库 | `tools/local/fake-db.ts`（内存 PostgREST 子集，镜像 UNIQUE 与 23505） |
| 对象存储 | `tools/local/fake-storage.ts`（内存签名 URL / download） |
| 时钟 | 固定起点 `2026-05-20T06:00:00Z`，`deps.clock.advance(ms)` 推进 |
| 内容库 | 直接读取 `database/seed/*.json`（与线上导入同一份） |
| AI | 模板适配器 + 注入式假 agent（超时/坏输出/额度场景） |
| 断言方式 | 每个用例校验 HTTP 状态、信封 `code`、`errorCode`、关键字段、响应头或库内行 |

> 运行时会输出 `MODULE_TYPELESS_PACKAGE_JSON` 警告：根目录没有 `package.json`，Node 将 `.ts` 按 ESM 重新解析。这是工具链提示，不影响断言结果；未为消除警告而新增 `package.json`，避免改变仓库形态。

## 3. 分组结果

下表按 `tools/local/smoke.ts` 的 16 个段落统计。源码中 `check(...)` 调用共 466 处，运行 470 项——差额来自 4 个参数化/循环用例（同一段代码对多个主体或场景重复执行）。

| # | 段落 | 断言数（源码/运行） | 覆盖要点 |
| --- | --- | --- | --- |
| 1 | 健康检查 | 3 | `/api/health`、`/api/health/deep`、统一安全响应头（JSON/nosniff/DENY/CSP/no-store/HSTS/referrer-policy） |
| 2 | 游客注册 | 6 | 201/200、JWT 三段、恢复码 26 位、30 天 TTL、响应不含摘要与 IP |
| 3 | Bearer 鉴权正反例 | 5 | 无/畸形/篡改/过期/正常 |
| 4 | 资料查询与部分更新 | 12 | `product_today` 04:00 界、部分更新、空改动 422、超长/布尔/数组校验、控制字符清洗、XSS 按文本存储 |
| 5 | 幂等重放 | 4 | 同键重放、同键不同内容 409、非 UUID 400 |
| 6 | 恢复码找回 | 10 | 格式错/码错统一 401、找回后轮换恢复码、旧 token 撤销、新 token 可用、设备数 |
| 7 | 注册限流 | 3 | 第 11 次 429、`Retry-After`、换 IP 可注册 |
| 8 | 演示身份隔离 | 7 | `is_demo`、无恢复码、24h TTL、会话复用、真实/演示 token 有效期 |
| 9 | 路由与前缀 | 7 | 404 `route_not_found`、405 + `Allow`、错误前缀、415、413 |
| 10 | 愿签创建→五问→签署→查询 | 88 | 必填幂等键、201、分类/置信度/标题、五问部分提交与密文、立契全量任务、天数/关系/权限/状态、重复签署补齐、游标分页、创建上限、演示隔离 |
| 11 | 今日任务/打卡/补卡 | 58 | 只回当天、04:00 日界、惰性 missed、覆盖打卡、证明文件校验、周券唯一、跨周、券过期、打卡限频 |
| 12 | 账本 | 73 | 首周预算映射、改预算 CAS、历史周只读、支出/收入/超预算、收入关联钱任务、跨周聚合、累计兑现、权限、幂等 |
| 13 | 结算/彩蛋/续期 | 45 | 开放点前后一毫秒、`active→settling→settled` CAS、三档结局、礼物匹配与差额档位、两幕 DTO、续期 +7 天一次、第二版快照、并发 409、非作者 403 |
| 14 | 上传/分享/公开池/回信 | 101 | presign 白名单/大小、真实 PUT 字节、magic bytes、CAS ready、2h 过期与惰性清扫、600s URL、分享轮换/撤销/白名单、公开池发布/举报隐藏/下架、回信日限/敏感词/删除权限、四个窗口限流 |
| 15 | AI/演示模式 | 42 | 模板 3 条 + 标签、只读不写、脱敏、agent/缓存/额度/超时/坏输出、AI 幂等、演示基线/快进/三结局/重置/过期/本 IP 最早 3 条清理 |
| 16 | `API_PER_MINUTE` 兜底限流 | 2 | 健康探针豁免、同主体第 3 次 429 + `retry-after` |
| **合计** | | **466 / 470** | **原 41 条路由全覆盖；新增任务列表路由由浏览器验收覆盖** |

## 4. 路由覆盖矩阵

| 模块 | 路由数 | 覆盖 | 主要断言维度 |
| --- | --- | --- | --- |
| 系统与账号 | 7 | 7/7 | 健康/深检、注册、恢复、退出、我的、资料更新 |
| 愿签与契约 | 5 | 5/5 | 创建、列表分页、详情、五问、立契（含重签/补齐/池空） |
| 每日任务与补卡 | 3 | 3/3 | 今日页、打卡、补卡（含权限/状态/限频/幂等） |
| 账本 | 3 | 3/3 | 周账本、改预算、记流水（含跨周/超预算/收入关联） |
| 结算与续期 | 3 | 3/3 | 触发结算、读两幕、续期（含时间门禁/并发/版本） |
| 上传 | 3 | 3/3 | presign、complete、签名 URL（含真实字节/过期/越权） |
| 分享 | 3 | 3/3 | 生成/轮换、撤销、匿名访问与白名单 |
| 公开池 | 5 | 5/5 | 列表、发布、详情、举报、下架（含隐藏/配额/重复） |
| 回信 | 3 | 3/3 | 发布、列表、删除（含日限/敏感词/权限） |
| AI | 1 | 1/1 | 润色（模板/agent/缓存/额度/超时/坏输出/标签/只读） |
| 演示 | 5 | 5/5 | 会话、状态、快进、结局、重置（含隔离/过期/限流） |
| **合计** | **41** | **41/41** | |

## 5. 第 9 轮新增/加强的断言（461 → 470）

| 断言 | 验证点 |
| --- | --- |
| 统一安全响应头 | health 响应同时具备 JSON content-type、nosniff、DENY、CSP、no-store、HSTS、referrer-policy |
| 405 带 `Allow` | 方法不支持时 `Allow` 列出该路径支持的动词（GET/PATCH） |
| 控制字符清洗 | `PATCH /api/me` 提交 `阿\u0007甘`，入库为 `阿甘` |
| XSS 按文本存储 | `<img src=x onerror=alert(1)>` 原样存储，响应仍是 JSON + nosniff |
| 上传凭证 2 小时 | `expires_at - created_at = 7_200_000ms`，且声明必须带 content-type |
| `complete` 过期 | 超过 2h → 400 `upload_expired`，行标 `expired` |
| 惰性清扫 | 放弃的 pending 在下次 presign 时被标 `expired` |
| 演示只清最早 3 条 | 同 IP 4 条过期会话，新建会话后只删最早 3 条，第 4 条留给下一次 |
| 兜底限流 | `API_PER_MINUTE=2`：健康探针不受限，同主体第 3 次业务请求 429 `api_rate_limited` + `retry-after` |

## 6. 结构校验器输出

| 命令 | 结果 |
| --- | --- |
| `node tools/scripts/check-routes.ts` | `manifest.ts 登记 42 条路由`；路径↔文件位置、route 字段、operation 唯一性全部通过；`✓ 路由表自洽` |
| `node tools/scripts/check-migrations.ts` | `扫描 7 个文件、98 条语句，表 22 张`；`✓ 全部语句都在平台迁移子集内` |
| `node tools/scripts/check-schema-usage.ts` | `迁移脚本：22 张表、349 列；扫描 78 个 Function 源码文件`；4 处表达式表名/展开写法静态跳过并已在冒烟覆盖；`✓ DAO 引用的表与列都在迁移脚本里` |
| `node tools/scripts/build-seeds.ts --check` | `seed 形状校验通过：wish_templates 72、task_templates 120、rewards 24` |
| `node tools/scripts/diff-schema.ts` | 16 张表存在设计稿与迁移的列级差异；属已知加性演进，不阻断发布 |

## 7. 未执行与未验证

| 项 | 原因 | 影响 |
| --- | --- | --- |
| `deno check` / `tsc --strict` | 本机无 Deno、无网络安装 | 运行时断言全绿不代表类型全绿；部署前需在有 Deno 的环境补跑 `deno task verify` |
| 真库迁移与 seed 导入 | 本轮明确不做云端写入 | 平台对 `insertIfAbsent` 逐行冲突、`affected()` 行数、唯一约束含 NULL 的语义未实测 |
| Function 部署与发布 | 同上 | 真实入口、Secrets 注入、私有策略、`/api/health/deep` 未在云端验证 |
| 真实对象存储 | 本地 FakeStorage 只模拟形状 | 私有桶直连阻断、PUT content-type、download 字节/超时、600s GET 到期未验证 |
| 真实 AI 端点 | 未配置 `AI_AGENT_ENDPOINT` | 只验证模板与假适配器；真实协议/限流/计费/延迟未联调 |
| 浏览器 E2E / UI | 本轮为后端交付 | 前端上传、分享页、标签展示、移动端交互未自动化 |
| 压测 | 范围外 | P95、并发上限、连接池行为未测；仅验证了单行 CAS 的并发 409 |
| 可信 client-ip | 平台未提供 | 所有 IP 维度限流/注册判定只作从宽兜底，不构成安全边界 |

已知并发残余（有文档、无自动断言根治）：同一钱任务并发双写可能重复计入收入；回信「同帖每人每天一条」是窗口查询 + 插入；结算 `settling` 60 秒租约依赖 `updated_at` 精度。三项都建议真库复验或后续迁移加唯一键。

## 8. 本轮执行中修正的问题

| 问题 | 类型 | 处理 |
| --- | --- | --- |
| 冒烟仍断言上传凭证 1 小时 | 测试滞后于代码 | 改为 2 小时（`7_200_000ms`），标题同步 |
| 过期测试先 presign 新文件，触发惰性清扫导致 stale 行提前变 `expired`，`complete` 返回 `file_not_ready` 而非 `upload_expired` | 测试顺序错误 | 改为先 complete 过期文件验证 `upload_expired`，再单独验证惰性清扫；产品代码未改 |

**产品缺陷：0。** 以上均为测试夹具/顺序问题，修正后全量 470 项通过。

## 9. 结论与发布建议

- 本地行为回归、路由自洽、迁移子集、代码↔DDL、seed 形状全部通过，达到「可提交部署」标准。
- 发布建议：**有条件通过**。条件是在部署窗口完成 11 §7 的真库冒烟，重点复验 `insertIfAbsent` 逐行语义、`affected()`、对象存储全链路、结算并发与 AI 端点；并补跑 Deno 类型检查。
- 发布后第一周观察：5xx、429 分布、`config_missing`、`db_error`、上传 `verification_failed`、演示会话清理日志、重复收入抽查。

## 10. 复现

```bash
cd <repo>
node tools/local/smoke.ts
node tools/scripts/check-routes.ts
node tools/scripts/check-migrations.ts
node tools/scripts/check-schema-usage.ts
node tools/scripts/build-seeds.ts --check
node tools/scripts/diff-schema.ts
```

期望最后一行：`470 passed, 0 failed`。
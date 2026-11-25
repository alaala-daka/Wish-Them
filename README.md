# 愿TA · 暖木愿望邮局

替重要的人许一个愿，用 10 天里的小行动把它慢慢兑现。

愿TA 是一个前后端分离的 Web 应用：前端用 React + TypeScript + Vite 构建暖木邮局界面，后端提供游客账号、愿签契约、每日任务、照片打卡、自然周账本、到期结算、公开愿签池与 AI 润色建议。所有业务规则都是确定性的，不依赖定时任务。

![邮局首页](design/desktop-postoffice/01-邮局首页-v2-桌牌修正.png)

## 功能

- **许愿**：12 种关系、称呼与代词、120 字愿望、可选的 AI 表达建议（始终标注「AI辅助」）。
- **动态五问与立契**：问题会根据前面的选择分支；答案加密保存；立契时一次性生成 10 天的每日任务，每天两件必做，周末追加可选钱任务。
- **今日工作台**：任务带 2~3 字标签；上传照片或截图完成打卡；金额任务还需填写实际省下/挣到的金额；漏卡可在当周用唯一一张补卡券补上。
- **账本**：自然周预算与非必要支出；钱任务金额在打卡时自动入账；周预算结余只作参考，不重复计入愿望基金。
- **到期结算与彩蛋**：双重兑现 / 赛博实现 / 未实现三档结局；DeepSeek 结合十天金额与问卷生成具体彩蛋，失败自动回退模板；结算页可自选 1~5 天续期。
- **愿签池**：匿名发布已结算的愿签，阅读与回信；举报达到阈值自动隐藏。
- **账号**：游客建号、恢复码找回、30 天 Bearer Token；没有 Cookie 与静默刷新。
- **流程速览**：`/#/tour` 是纯前端教程式演示，不依赖后端与 API，三分钟走完许愿、十天小事、总结与彩蛋。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite 6、lucide-react |
| 后端 | TypeScript，Deno 风格路由；本地用 Node.js 22 原生类型擦除直接运行 |
| 数据 | 平台数据库（22 张表、7 份迁移）；本地为内存数据库，重启即清空 |
| 存储 | 私有对象存储，两段式直传 + 600 秒签名 URL；本地提供内存版对象存储 |
| 测试 | Node `node:test` 领域规则测试；470 项后端冒烟断言；Python Playwright 浏览器验收 |

## 快速开始

### 一键启动（Windows）

双击项目根目录的 `start.bat`。脚本会检查 Node.js、安装依赖、启动后端与前端，并打开浏览器。

### 手动启动

需要 Node.js **22.18 或更新版本**（后端直接运行 TypeScript）。

```bash
npm install        # 安装前端依赖
npm run server     # 终端 1：后端 http://127.0.0.1:8787
npm run dev        # 终端 2：前端 http://127.0.0.1:5173
```

浏览器打开 <http://127.0.0.1:5173>。Vite 会把 `/functions/v1/app` 与 `/__storage` 代理到本机后端，因此本地不需要额外配置 CORS。

> 本地后端使用内存数据库和内存对象存储，**重启后端后数据清空**。适合联调与演示，不用于持久化部署。

### 生产构建

```bash
npm run build      # 输出 dist/
npm run preview    # 本地预览，代理配置与开发环境一致
```

部署到其他域名时，用 `VITE_API_BASE` 指向完整 Function 前缀（例如 `https://example.com/functions/v1/app`），并在后端 `CORS_ALLOW_ORIGINS` 中放行前端来源。

## 配置

本地密钥与限流默认值见 `tools/local/deps.ts`，只用于开发，不要复用到线上。线上配置项见 `.env.example`：

- 必填：`JWT_SIGNING_KEY`、`TOKEN_PEPPER`、`RECOVERY_PEPPER`、`IP_HASH_SALT`、`IDEM_FINGERPRINT_KEY`、`FIELD_ENCRYPTION_KEY`。
- 可选：Token 有效期、各接口限流阈值、公开池举报阈值、AI 端点与额度、DeepSeek 彩蛋等。
- AI 未配置外部端点时自动使用模板建议，主流程不受影响。
- 彩蛋默认走确定性模板；在 `.env` 填入 `DEEPSEEK_API_KEY` 后才会调用 DeepSeek，失败/超时仍自动回退。
- `/#/tour` 流程速览是纯前端演示，后端和 DeepSeek 都不需要启动。

## API

后端共 42 条路由，统一前缀 `/functions/v1/app`，成功与失败共用一个信封：

```json
{ "code": 0, "data": {}, "message": "ok", "requestId": "..." }
{ "code": 400, "data": null, "message": "参数不合法。", "errorCode": "invalid_parameter", "requestId": "..." }
```

- 鉴权：`Authorization: Bearer <access_token>`。
- 幂等：创建愿签必须带 `Idempotency-Key`，其余写接口可选。
- 上传：`presign → 对象存储 PUT → complete`，业务接口只引用 `ready` 的文件。

完整字段、错误码与调用顺序见：

- [接口契约](docs/04-api-contract.md)
- [前端对接手册](docs/12-frontend-integration.md)
- [架构说明](docs/01-architecture.md)

## 目录

```text
src/                 React 应用
  api.ts             后端 HTTP 客户端与 DTO 类型
  remote.ts          服务端 DTO → 页面视图映射
  session.ts         Token / 恢复码本机会话
  actions.ts         页面可调用的业务动作类型
  pages/             首页、今日、账本、愿签池、我的、结算
  Create.tsx         四步许愿与草稿
  domain.ts          时间、金额、演示与结算的纯规则
  storage.ts         本机草稿与图片压缩
backend/
  server.ts          路由分发、鉴权、幂等、限流、错误封套
  api/               按模块的文件即路由
  domain/            纯业务规则
  lib/               配置、加密、时间、校验、响应等基础设施
database/
  migrations/        7 份数据库迁移
  seed/              任务模板、愿望模板与礼物目录
tools/
  local/             本地 HTTP 服务、内存数据库与对象存储
  scripts/           路由 / 迁移 / schema / seed 校验器
tests/               领域规则与浏览器验收
docs/                架构、契约、部署与测试文档
design/              视觉参考与素材说明
public/              场景与角色素材
```

## 测试

```bash
npm test           # 领域规则（中国时区日界、任务规则、账本、结算、问卷、彩蛋）
npm run check      # 路由表、迁移、schema 引用、seed 形状
python tests/browser_smoke.py   # 前后端联调验收（需先启动 server 与 dev）
```

浏览器验收需要 Python Playwright 与系统 Edge；脚本覆盖注册、动态五问、上传打卡、账本、愿签池、恢复码、流程速览与窄屏布局。

后端全量行为断言：

```bash
node tools/local/smoke.ts          # 470 项
```

## 隐私与数据

- 五问答案以 AES-256-GCM 字段级加密保存，接口不回显。
- 打卡与账本证明存放在私有对象存储，只通过 600 秒签名 URL 访问。
- 愿签默认私密；公开愿签池只展示白名单字段，不包含昵称、账号、五问或账本明细。
- Token 只放 `Authorization` 头；恢复码只在注册或找回成功时返回一次。
- 导出文字记录不包含五问答案和照片，不能作为跨设备恢复手段。

## 文档

- [BACKEND.md](BACKEND.md)：后端能力、路由与设计取舍
- [docs/architecture](docs/01-architecture.md)：运行形态与分层
- [docs/conventions](docs/02-conventions.md)：响应、错误码、时间与金额约定
- [docs/deployment](docs/11-deployment.md)：迁移、seed、发布与回滚
- [docs/test-report](docs/14-test-report.md)：测试分组与未验证项

## License

[MIT](LICENSE)

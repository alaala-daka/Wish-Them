/** 跨层共享类型：路由声明、请求上下文、响应封装。业务语义不放这里。 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** 鉴权模式：none=游客可访问；bearer=必须携带有效 Bearer Token */
export type AuthMode = 'none' | 'bearer';

/** 幂等声明：required=必须带 Idempotency-Key；optional=带了就重放；none=不纳入幂等 */
export type IdempotencyMode = 'none' | 'optional' | 'required';

export interface RouteDef {
  /** 逻辑路径，含 `:param` 段；与文件位置由 check-routes.ts 校验一致 */
  path: string;
  method: HttpMethod;
  auth: AuthMode;
  /** 幂等作用域标识，形如 `auth.guest`；auth=none 时主体退化为 ip 哈希 */
  operation: string;
  idempotent: IdempotencyMode;
  /** JSON 请求体字节上限，超限 413 */
  maxBodyBytes: number;
}

export interface Principal {
  userId: string;
  /** JWT jti，同时也是 app.auth_tokens.id，用于即时撤销 */
  tokenId: string;
  client: string;
  isDemo: boolean;
  tokenExpiresAt: string;
}

export interface Ctx {
  request: Request;
  requestId: string;
  /** 服务端权威时间，所有判定只用它，不用客户端时间 */
  now: Date;
  config: AppConfig;
  db: DbClient;
  params: Record<string, string>;
  /** 已剥离函数前缀的业务路径 */
  path: string;
  /** server.ts 已按 route.maxBodyBytes 限长解析好的 JSON body；GET/无体时为 {} */
  body: Record<string, unknown>;
  /** 本次请求的幂等键（若客户端携带） */
  idempotencyKey?: string;
  /** 客户端 IP 的 HMAC 摘要，仅用于限流与风控 */
  ipHash: string | null;
  /** 对象存储客户端：签名上传/下载 URL 都由此签发，签名 URL 不入库 */
  storage: StorageClient;
  /** AI 适配器：生产按环境变量解析，本地默认为模板兜底（不依赖外部服务） */
  ai?: AiAdapter;
  principal?: Principal;
  /** 幂等中间件已占位时注入，handler 成功返回后由 server 落结果 */
  idempotency?: IdempotencyClaim;
}

/** AI 调用输入：文本必须已脱敏；其余字段只用于提示词组织，不落原文 */
export interface AiGenerationInput {
  capability: string;
  text: string;
  relation: string;
  wishType: string;
}

/**
 * 统一 AI 适配器：新增能力或切换模型只改这一层。
 * generate 必须返回原始候选文本，格式与长度由 domain/ai.ts 统一校验。
 */
export interface AiAdapter {
  readonly name: string;
  generate(input: AiGenerationInput, signal: AbortSignal): Promise<string[]>;
}

export interface IdempotencyClaim {
  id: string;
  principal: string;
  operation: string;
  key: string;
  fingerprint: string;
}

export type Handler = (ctx: Ctx) => Promise<Response>;
export interface RouteModule {
  route: RouteDef;
  default: Handler;
}

/** 依赖注入点：生产由 _qoder 注入真客户端，本地用 fake 跑同一条路由 */
export interface AppDeps {
  db: DbClient;
  config: AppConfig;
  storage: StorageClient;
  /** 便于测试注入时钟 */
  now?: () => Date;
  /** AI 适配器注入点：本地测试用模板或自定义适配器，生产按环境变量解析 */
  ai?: AiAdapter;
}

/**
 * 平台对象存储的最小接口（_qoder/storage.mjs）。
 * 方法签名按平台文档收窄：objectPath 是桶内相对路径，由服务端派生，客户端不可指定。
 */
export interface StorageClient {
  createSignedUploadUrl(objectPath: string, options: { upsert: boolean }): Promise<{ signedUrl: string }>;
  createSignedUrl(objectPath: string, expiresInSeconds: number): Promise<{ signedUrl: string }>;
  download(objectPath: string): Promise<Response>;
  remove(objectPaths: string[]): Promise<unknown>;
}

export interface AppConfig {
  jwtSecret: string;
  /** Bearer Token 落库存档用的 HMAC pepper */
  tokenPepper: string;
  /** 恢复码哈希用的 pepper，与 token pepper 分离 */
  recoveryPepper: string;
  ipSalt: string;
  fingerprintKey: string;
  /** 五问答案字段级加密根密钥（AES-256-GCM，AAD = wish_id） */
  fieldEncryptionKey: string;
  /** JWT 有效期（秒），默认 30 天 */
  tokenTtlSeconds: number;
  guestPerHour: number;
  recoverPerHour: number;
  /** 单个 IP 每小时可开的演示会话数，环境变量 DEMO_PER_HOUR */
  demoPerHour: number;
  /** 演示会话有效期（小时），环境变量 DEMO_TTL_HOURS，默认 24 */
  demoTtlHours: number;
  /** 单个账号每产品日可调用的 AI 润色次数，环境变量 AI_POLISH_PER_DAY */
  aiPolishPerDay: number;
  /** 单次 AI 调用超时（毫秒），环境变量 AI_TIMEOUT_MS；超时回退模板 */
  aiTimeoutMs: number;
  /** AI 建议缓存有效期（小时），环境变量 AI_CACHE_TTL_HOURS */
  aiCacheTtlHours: number;
  /** Qoder Cloud Agents 端点；为空时只走模板兜底，不发起任何外部请求 */
  aiAgentEndpoint: string;
  /** Agents 端点鉴权令牌；未配置时不带 Authorization 头 */
  aiAgentToken: string;
  /** DeepSeek 彩蛋生成：密钥只放服务端；为空时彩蛋走确定性模板 */
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  /** 是否启用 DeepSeek 彩蛋（默认开启，但没有密钥时自然回退模板） */
  aiEasterEggEnabled: boolean;
  /** 彩蛋生成超时（毫秒）；超时立即回退模板，不阻塞结算 */
  aiEasterEggTimeoutMs: number;
  /** 单个账号每个产品日可创建的愿签数（草稿也计数），环境变量 WISH_CREATE_PER_DAY */
  wishCreatePerDay: number;
  /** 单个账号每分钟可提交的打卡次数，环境变量 CHECKIN_PER_MINUTE */
  checkinPerMinute: number;
  /** 单个账号每小时可申请的上传凭证数，环境变量 UPLOAD_PER_HOUR */
  uploadPerHour: number;
  /** 单个账号每产品日可新发布的公开池帖子数，环境变量 POOL_PUBLISH_PER_DAY */
  poolPublishPerDay: number;
  /** 单个账号每小时可提交的举报数，环境变量 POOL_REPORT_PER_HOUR */
  poolReportPerHour: number;
  /** 同一帖子收到多少条举报后自动隐藏，环境变量 POOL_REPORT_HIDE_THRESHOLD */
  poolReportHideThreshold: number;
  /** 单个账号每产品日可发布的回信数，环境变量 REPLY_PER_DAY */
  replyPerDay: number;
  /** 服务层兜底限流：同一主体每分钟最多请求数，环境变量 API_PER_MINUTE */
  apiPerMinute: number;
  /** 允许跨域的来源白名单，空数组表示只允许同源 */
  corsAllowOrigins: string[];
  /** 部署后首次请求时是否幂等补给三张模板表；SEED_ON_START=1 时开启 */
  seedOnStart: boolean;
  issuer: string;
  audience: string;
  apiVersion: string;
}

/** lib/db.ts 暴露的最小客户端接口，这里仅前向声明避免循环依赖 */
export interface DbClient {
  from(table: string): DbQueryChain;
}

export interface DbResult<T = Record<string, unknown>> {
  data: T | T[] | null;
  error: { code?: string; message?: string; hint?: string } | null;
  count?: number | null;
}

/** 一行原始记录：字段语义由各 domain 模块自己收窄，禁止在接口层直接外发 */
export type DbRow = Record<string, unknown>;

export interface DbQueryChain extends PromiseLike<DbResult> {
  select(columns?: string, options?: { count?: 'exact' | 'planned' }): DbQueryChain;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): DbQueryChain;
  insertIfAbsent(values: Record<string, unknown> | Record<string, unknown>[], options: { onConflict: string }): DbQueryChain;
  update(values: Record<string, unknown>): DbQueryChain;
  delete(): DbQueryChain;
  eq(column: string, value: unknown): DbQueryChain;
  neq(column: string, value: unknown): DbQueryChain;
  isNull(column: string): DbQueryChain;
  in(column: string, values: unknown[]): DbQueryChain;
  gte(column: string, value: unknown): DbQueryChain;
  gt(column: string, value: unknown): DbQueryChain;
  lte(column: string, value: unknown): DbQueryChain;
  lt(column: string, value: unknown): DbQueryChain;
  order(column: string, options?: { ascending?: boolean }): DbQueryChain;
  limit(count: number): DbQueryChain;
  maybeSingle(): Promise<DbResult>;
  single(): Promise<DbResult>;
}

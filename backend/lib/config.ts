/**
 * 配置装载：生产从 Sites Secrets（Deno.env）读取，本地从 process.env 读取。
 * 密钥缺失时不启动成"半可用"状态，由 server.ts 统一返回 service_not_configured。
 */

import { SCAN_LIMIT } from './quota.ts';
import type { AppConfig } from './types.ts';

/** Deno 与 Node 都能取到环境变量，避免在边缘包里引入 Node 专属模块 */
function readEnv(name: string): string | undefined {
  const global = globalThis as { Deno?: { env?: { get(k: string): string | undefined } }; process?: { env?: Record<string, string | undefined> } };
  const fromDeno = global.Deno?.env?.get?.(name);
  if (typeof fromDeno === 'string' && fromDeno.length > 0) return fromDeno;
  const fromNode = global.process?.env?.[name];
  return typeof fromNode === 'string' && fromNode.length > 0 ? fromNode : undefined;
}

export class ConfigError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`missing secrets: ${missing.join(', ')}`);
    this.name = 'ConfigError';
    this.missing = missing;
  }
}

function requireEnv(names: string[]): Map<string, string> {
  const values = new Map<string, string>();
  const missing: string[] = [];
  for (const name of names) {
    const value = readEnv(name);
    if (!value) missing.push(name);
    else values.set(name, value);
  }
  if (missing.length) throw new ConfigError(missing);
  return values;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = readEnv(name);
  if (!raw) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

const REQUIRED = ['JWT_SIGNING_KEY', 'TOKEN_PEPPER', 'RECOVERY_PEPPER', 'IP_HASH_SALT', 'IDEM_FINGERPRINT_KEY', 'FIELD_ENCRYPTION_KEY'] as const;

export function loadConfig(): AppConfig {
  const env = requireEnv([...REQUIRED]);
  const ttlDays = intEnv('TOKEN_TTL_DAYS', 30, 1, 60);
  return {
    jwtSecret: env.get('JWT_SIGNING_KEY') as string,
    tokenPepper: env.get('TOKEN_PEPPER') as string,
    recoveryPepper: env.get('RECOVERY_PEPPER') as string,
    ipSalt: env.get('IP_HASH_SALT') as string,
    fingerprintKey: env.get('IDEM_FINGERPRINT_KEY') as string,
    fieldEncryptionKey: env.get('FIELD_ENCRYPTION_KEY') as string,
    tokenTtlSeconds: ttlDays * 24 * 60 * 60,
    // 数据库窗口计数的上限是 SCAN_LIMIT：阈值配得比它高，enforceWindow 永远数不满，
    // 只会让限流静默失效。这里直接把范围钉在 SCAN_LIMIT，越界值回落到默认值。
    guestPerHour: intEnv('GUEST_PER_HOUR', 10, 1, SCAN_LIMIT),
    recoverPerHour: intEnv('RECOVER_PER_HOUR', 12, 1, SCAN_LIMIT),
    demoPerHour: intEnv('DEMO_PER_HOUR', 30, 1, SCAN_LIMIT),
    demoTtlHours: intEnv('DEMO_TTL_HOURS', 24, 1, 72),
    // AI 日额度由 domain/ai.ts#agentUsedToday 单独扫描（上限 1000），不受 SCAN_LIMIT 约束
    aiPolishPerDay: intEnv('AI_POLISH_PER_DAY', 20, 1, 1000),
    aiTimeoutMs: intEnv('AI_TIMEOUT_MS', 8000, 100, 60_000),
    aiCacheTtlHours: intEnv('AI_CACHE_TTL_HOURS', 72, 1, 720),
    // 未配置端点时只走模板兜底；本地/比赛演示都无需外部服务
    aiAgentEndpoint: readEnv('AI_AGENT_ENDPOINT') ?? '',
    aiAgentToken: readEnv('AI_AGENT_TOKEN') ?? '',
    // DeepSeek 彩蛋：密钥为空时只走预设文案；端点/模型都可用环境变量覆盖
    deepseekApiKey: readEnv('DEEPSEEK_API_KEY') ?? '',
    deepseekBaseUrl: (readEnv('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com/v1').replace(/\/$/, ''),
    deepseekModel: readEnv('DEEPSEEK_MODEL') ?? 'deepseek-chat',
    aiEasterEggEnabled: boolEnv('AI_EASTER_EGG_ENABLED', true),
    aiEasterEggTimeoutMs: intEnv('AI_EASTER_EGG_TIMEOUT_MS', 7000, 1000, 30_000),
    wishCreatePerDay: intEnv('WISH_CREATE_PER_DAY', 20, 1, SCAN_LIMIT),
    checkinPerMinute: intEnv('CHECKIN_PER_MINUTE', 10, 1, SCAN_LIMIT),
    uploadPerHour: intEnv('UPLOAD_PER_HOUR', 30, 1, SCAN_LIMIT),
    poolPublishPerDay: intEnv('POOL_PUBLISH_PER_DAY', 5, 1, SCAN_LIMIT),
    poolReportPerHour: intEnv('POOL_REPORT_PER_HOUR', 20, 1, SCAN_LIMIT),
    poolReportHideThreshold: intEnv('POOL_REPORT_HIDE_THRESHOLD', 3, 1, 20),
    replyPerDay: intEnv('REPLY_PER_DAY', 20, 1, SCAN_LIMIT),
    // 兜底限流按实例内存计数，是 WAF 之外的最后一道保险；具体业务阈值仍由上面各项控制
    apiPerMinute: intEnv('API_PER_MINUTE', 1200, 60, 100_000),
    // 小程序与 H5 默认同源部署 ⇒ 空数组即不发 CORS 头；跨域时才按需配置
    corsAllowOrigins: (readEnv('CORS_ALLOW_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean),
    // 目录表为空时于首个请求幂等补齐；表行数已达期望值时不会发起任何写请求
    seedOnStart: boolEnv('SEED_ON_START', true),
    issuer: 'yuan-ta',
    audience: 'yuan-ta-api',
    apiVersion: 'v1',
  };
}

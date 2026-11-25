/**
 * 本地依赖装配：把内存数据库和测试配置注入 createApp()，
 * 让 tools/local/smoke.ts 与线上共用同一套路由/鉴权/幂等代码。
 * 这里的密钥只用于本地，线上必须换成 Sites Secrets（见 docs/05-environment.md）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeDb } from './fake-db.ts';
import { FakeStorage } from './fake-storage.ts';
import type { AppConfig, AppDeps, DbRow } from '../../backend/lib/types.ts';

const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'database', 'seed');

export const LOCAL_SECRETS = {
  JWT_SIGNING_KEY: 'local-jwt-signing-key-do-not-reuse',
  TOKEN_PEPPER: 'local-token-pepper',
  RECOVERY_PEPPER: 'local-recovery-pepper',
  IP_HASH_SALT: 'local-ip-salt',
  IDEM_FINGERPRINT_KEY: 'local-fingerprint-key',
  FIELD_ENCRYPTION_KEY: 'local-field-encryption-key-do-not-reuse',
};

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    jwtSecret: LOCAL_SECRETS.JWT_SIGNING_KEY,
    tokenPepper: LOCAL_SECRETS.TOKEN_PEPPER,
    recoveryPepper: LOCAL_SECRETS.RECOVERY_PEPPER,
    ipSalt: LOCAL_SECRETS.IP_HASH_SALT,
    fingerprintKey: LOCAL_SECRETS.IDEM_FINGERPRINT_KEY,
    fieldEncryptionKey: LOCAL_SECRETS.FIELD_ENCRYPTION_KEY,
    tokenTtlSeconds: 30 * 24 * 60 * 60,
    guestPerHour: 10,
    recoverPerHour: 12,
    demoPerHour: 30,
    demoTtlHours: 24,
    aiPolishPerDay: 20,
    aiTimeoutMs: 8000,
    aiCacheTtlHours: 72,
    aiAgentEndpoint: '',
    aiAgentToken: '',
    deepseekApiKey: '',
    deepseekBaseUrl: 'https://api.deepseek.com/v1',
    deepseekModel: 'deepseek-chat',
    aiEasterEggEnabled: true,
    aiEasterEggTimeoutMs: 7000,
    wishCreatePerDay: 20,
    checkinPerMinute: 10,
    uploadPerHour: 30,
    poolPublishPerDay: 5,
    poolReportPerHour: 20,
    poolReportHideThreshold: 3,
    replyPerDay: 20,
    apiPerMinute: 1200,
    corsAllowOrigins: [],
    seedOnStart: false,
    issuer: 'yuan-ta',
    audience: 'yuan-ta-api',
    apiVersion: 'v1',
    ...overrides,
  };
}

export interface LocalDeps extends AppDeps {
  db: FakeDb;
  storage: FakeStorage;
  /** 固定时钟：限流窗口与产品日判定都可预期 */
  clock: { now: Date; advance(ms: number): void };
}

/**
 * 配置表种子：直接读 build-seeds 生成的 JSON，与线上导入的是同一份数据。
 * 本地不另写一套内容，否则「线上抽得到、本地抽不到」这类漂移就测不出来了。
 */
export function seedCatalog(db: FakeDb): void {
  const files: Array<[string, string]> = [
    ['wish_templates', 'wish_templates.json'],
    ['task_templates', 'task_templates.json'],
    ['rewards', 'rewards.json'],
  ];
  for (const [table, file] of files) {
    const payload = JSON.parse(readFileSync(join(SEED_DIR, file), 'utf8')) as { rows: DbRow[] };
    db.seed(table, payload.rows);
  }
}

export function createLocalDeps(
  start = '2026-05-20T06:00:00.000Z',
  overrides: Partial<AppConfig> = {},
  /** 本地 HTTP 服务的对象存储地址前缀；空串 = 同源相对路径（走 Vite 代理） */
  storageBase = 'https://storage.local',
): LocalDeps {
  const db = new FakeDb();
  seedCatalog(db);
  let current = new Date(start);
  return {
    db,
    storage: new FakeStorage(storageBase),
    config: testConfig(overrides),
    now: () => current,
    clock: {
      get now() {
        return current;
      },
      advance(ms: number) {
        current = new Date(current.getTime() + ms);
      },
    },
  };
}

export { FakeDb, FakeStorage };

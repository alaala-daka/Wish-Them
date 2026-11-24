/**
 * 本机会话：保存 Bearer Token 与恢复码。
 *
 * 产品没有 Cookie / refresh token：Token 默认 30 天有效，失效后用恢复码重新登录。
 * 恢复码只在注册/找回成功时由服务端返回一次，这里按「用户自己的本机」保存，
 * 与 PRD 的「让用户抄下或存进安全存储」一致；不进日志、不上报。
 */
import { guest } from './api';

const TOKEN_KEY = 'yuanta.session.token';
const EXPIRES_KEY = 'yuanta.session.expires_at';
const RECOVERY_KEY = 'yuanta.recovery_code';
const USER_KEY = 'yuanta.user';

export type StoredSession = {
  token: string;
  expiresAt: string;
  recoveryCode: string;
  userId: string;
  nickname: string;
};

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // 隐私模式禁用存储时仍允许本次会话使用内存中的 token
  }
}

export function loadSession(): StoredSession | null {
  const token = read(TOKEN_KEY);
  if (!token) return null;
  return {
    token,
    expiresAt: read(EXPIRES_KEY),
    recoveryCode: read(RECOVERY_KEY),
    userId: read(USER_KEY),
    nickname: '',
  };
}

export function saveSession(input: {
  token: string;
  expiresAt: string;
  recoveryCode?: string;
  userId?: string;
  nickname?: string;
}): StoredSession {
  write(TOKEN_KEY, input.token);
  write(EXPIRES_KEY, input.expiresAt);
  if (input.recoveryCode) write(RECOVERY_KEY, input.recoveryCode);
  if (input.userId) write(USER_KEY, input.userId);
  return {
    token: input.token,
    expiresAt: input.expiresAt,
    recoveryCode: input.recoveryCode ?? read(RECOVERY_KEY),
    userId: input.userId ?? read(USER_KEY),
    nickname: input.nickname ?? '',
  };
}

export function clearSession(): void {
  write(TOKEN_KEY, '');
  write(EXPIRES_KEY, '');
  write(RECOVERY_KEY, '');
  write(USER_KEY, '');
  try {
    localStorage.removeItem('yuanta.recovery_seen');
  } catch {
    // 隐私模式忽略
  }
}

/** 没有会话时自动创建一个游客账号；已有会话直接复用。 */
export async function ensureSession(): Promise<StoredSession> {
  const existing = loadSession();
  if (existing) return existing;
  const result = await guest('暖木邮局的访客');
  return saveSession({
    token: result.session.access_token,
    expiresAt: result.session.expires_at,
    recoveryCode: result.recovery_code,
    userId: result.user.id,
    nickname: result.user.nickname,
  });
}

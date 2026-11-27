/**
 * 后端 HTTP 客户端与 DTO 类型。
 *
 * 本地开发时 API_BASE 走同源 `/functions/v1/app`，由 Vite 代理到
 * http://127.0.0.1:8787；部署时可设置 VITE_API_BASE 指向完整 Function 前缀。
 *
 * 约定（docs/02-conventions.md、docs/12-frontend-integration.md）：
 * - 成功/失败共用一个信封 { code, data, message, requestId, errorCode? }；
 * - Token 只放 Authorization 头，不写日志、不进 URL；
 * - 写接口按需携带 Idempotency-Key，重试沿用同一个键。
 */

export const API_BASE = (import.meta.env.VITE_API_BASE || '/functions/v1/app').replace(/\/$/, '');

export type Envelope<T> = {
  code: number;
  data: T | null;
  message: string;
  requestId: string;
  errorCode?: string;
  details?: Record<string, unknown>;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly envelope: Envelope<unknown>,
  ) {
    super(envelope.message || `请求失败（${status}）`);
  }

  get errorCode() {
    return this.envelope.errorCode ?? 'unknown';
  }

  get requestId() {
    return this.envelope.requestId;
  }
}

export type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);
  if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey);
  headers.set('x-client', 'web');

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, {
      code: 0,
      data: null,
      message: '无法连接服务，请确认后端已启动。',
      requestId: '',
      errorCode: 'network_error',
    });
  }

  const raw = await response.text();
  let envelope: Envelope<T>;
  try {
    envelope = JSON.parse(raw) as Envelope<T>;
  } catch {
    throw new ApiError(response.status, {
      code: response.status,
      data: null,
      message: '服务器返回了无法识别的响应。',
      requestId: response.headers.get('x-request-id') ?? '',
      errorCode: 'invalid_response',
    });
  }
  if (!response.ok || envelope.code !== 0) throw new ApiError(response.status, envelope);
  return envelope.data as T;
}

export type UserDto = {
  id: string;
  nickname: string;
  avatar: string;
  client: string;
  is_demo: boolean;
  profile_text: string;
  wish_style_tags: string[];
  share_default_public: boolean;
  created_at: string;
};

export type SessionDto = {
  access_token: string;
  token_type: 'Bearer';
  expires_at: string;
};

export type GuestResult = {
  user: UserDto;
  session: SessionDto;
  recovery_code?: string;
  recovery_code_notice?: string;
  is_new?: boolean;
};

export type RecoverResult = GuestResult & { revoked_tokens: number };

export type WishDto = {
  id: string;
  status: string;
  relation: string;
  relation_group: string;
  nickname: string;
  pronoun: 'she' | 'he' | 'they';
  title: string;
  wish_text: string;
  wish_type: string;
  classifier_type: string;
  classifier_confidence_bps: number;
  five_questions_done: boolean;
  days: number;
  start_date: string;
  end_date: string;
  settle_open_at: string;
  signed_at: string | null;
  is_public: boolean;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
};

export type WishSummaryDto = Pick<
  WishDto,
  | 'id'
  | 'status'
  | 'relation'
  | 'nickname'
  | 'pronoun'
  | 'title'
  | 'wish_type'
  | 'five_questions_done'
  | 'days'
  | 'start_date'
  | 'end_date'
  | 'signed_at'
  | 'is_demo'
  | 'created_at'
>;

export type TaskDto = {
  id: string;
  day_index: number;
  task_date: string;
  type: 'ta' | 'self' | 'money';
  title: string;
  status: 'pending' | 'done' | 'missed' | 'made_up';
  is_must: boolean;
  is_optional: boolean;
  seq: number;
  proof_kind: string;
  time_slot: string;
  min_budget_cents: number;
  tags: string[];
  money_kind: 'save' | 'earn' | '';
  rotation: number;
  checkin?: CheckinDto | null;
};

export type CheckinDto = {
  id: string;
  task_id: string;
  proof_id: string | null;
  note: string;
  amount_cents: number | null;
  amount_kind: 'saved' | 'earned' | '';
  is_makeup: boolean;
  channel: string;
  checkin_date: string;
  server_ts: string;
  client_ts: string | null;
  created_at: string;
  updated_at: string;
};

export type LedgerWeekDto = {
  week_start: string;
  week_index: number;
  is_current: boolean;
  is_future: boolean;
  counted: boolean;
  budget_cents: number;
  budget_yuan: number;
  spent_cents: number;
  spent_yuan: number;
  income_cents: number;
  income_yuan: number;
  task_saved_cents: number;
  task_saved_yuan: number;
  balance_cents: number;
  balance_yuan: number;
  over_budget: boolean;
  progress_bps: number;
  notice: string;
};

export type LedgerEntryDto = {
  id: string;
  wish_id: string;
  week_start: string;
  type: 'expense' | 'earning' | 'saved';
  amount_cents: number;
  amount_yuan: number;
  note: string;
  proof_id: string | null;
  task_id: string | null;
  server_ts: string;
  created_at: string;
};

export type LedgerViewDto = {
  wish_id: string;
  week: LedgerWeekDto;
  weeks: LedgerWeekDto[];
  entries: LedgerEntryDto[];
  totals: {
    contract_weeks: number;
    counted_weeks: number;
    budget_cents: number;
    spent_cents: number;
    saved_cents: number;
    budget_balance_cents: number;
    task_saved_cents: number;
    income_cents: number;
    realized_cents: number;
    current_week_start: string;
  };
  progress: {
    over_budget: boolean;
    budget_used_bps: number;
    counted_weeks: number;
    contract_weeks: number;
    message: string;
  };
};

export type PresignResult = {
  file: { id: string; status: string };
  file_id: string;
  upload_url: string;
  upload_method: 'PUT';
  required_headers: Record<string, string>;
  expires_at: string;
  max_bytes: number;
  allowed_mime_types: string[];
};

export type AiSuggestion = { id: string; text: string; label: string };

export type AiResult = {
  ai_assisted: boolean;
  ai_label: string;
  label_required: boolean;
  capability: string;
  suggestions: AiSuggestion[];
  source: 'agent' | 'template';
  fallback: boolean;
  fallback_reason: string;
  model: string;
  cached: boolean;
  input_redacted: boolean;
  quota: { daily_limit: number; used: number; remaining: number };
  notice: string;
};

export type PoolPostDto = {
  id: string;
  status: string;
  category: string;
  wish_type: string;
  relation: string;
  excerpt: string;
  display_label: string;
  is_anonymous: boolean;
  reply_count: number;
  published_at: string;
};

export type ReplyDto = {
  id: string;
  content: string;
  display_label: string;
  created_at: string;
};

export type DemoStateDto = {
  demo: {
    session_id: string;
    scenario: string;
    mode: string;
    step: number;
    ttl_hours: number;
    expires_at: string;
    is_completed: boolean;
    server_now: string;
  };
  persona: { label: string; relation: string; pronoun: string; wish_text: string; preset: string };
  wish: WishDto;
  progress: Record<string, number>;
  today_tasks: TaskDto[];
  tasks: TaskDto[];
  ledger: LedgerViewDto | null;
  settlement: import('./domain').SettlementView | null;
  settle_open_at: string;
};

export type DemoSessionResult = {
  session: {
    demo_session_id: string;
    access_token: string;
    token_type: 'Bearer';
    expires_at: string;
    expires_in_seconds: number;
  };
  user: UserDto;
  persona: DemoStateDto['persona'];
  state: DemoStateDto;
};

export const guest = (nickname?: string) =>
  api<GuestResult>('/api/auth/guest', {
    body: { nickname, channel: 'other' },
  });

export const recover = (recoveryCode: string) =>
  api<RecoverResult>('/api/auth/recover', { body: { recovery_code: recoveryCode } });

export const logout = (token: string, allDevices = false) =>
  api<{ revoked_tokens: number }>('/api/auth/logout', {
    method: 'POST',
    token,
    body: { all_devices: allDevices },
  });

export const me = (token: string) => api<{ user: UserDto }>('/api/me', { token });

export const listWishes = (token: string, limit = 20) =>
  api<{ items: WishSummaryDto[]; next_cursor: string | null; has_more: boolean; limit: number }>(
    `/api/wishes?limit=${limit}`,
    { token },
  );

export const getWish = (token: string, id: string) =>
  api<{ wish: WishDto }>(`/api/wishes/${id}`, { token });

export const createWish = (
  token: string,
  input: { relation: string; nickname: string; pronoun: 'she' | 'he' | 'they'; wish_text: string },
  idempotencyKey: string,
) =>
  api<{ wish: WishDto }>('/api/wishes', {
    token,
    idempotencyKey,
    body: input,
  });

export const saveAnswers = (
  token: string,
  id: string,
  answers: Record<string, string>,
  meta?: Record<string, string>,
) =>
  api<{ answered: string[]; five_questions_done: boolean }>(`/api/wishes/${id}/answers`, {
    method: 'PUT',
    token,
    body: { ...answers, meta },
  });

export const signContract = (token: string, id: string, days = 10) =>
  api<{
    wish: WishDto;
    tasks: TaskDto[];
    task_summary: Record<string, number>;
    first_sign: boolean;
  }>(`/api/wishes/${id}/contract`, { token, body: { days } });

export const listTasks = (token: string, wishId: string, date?: string) =>
  api<{ wish_id: string; date: string | null; tasks: TaskDto[] }>(
    `/api/wishes/${wishId}/tasks${date ? `?date=${encodeURIComponent(date)}` : ''}`,
    { token },
  );

export const getTodayTasks = (token: string, wishId: string) =>
  api<{
    wish_id: string;
    date: string;
    tasks: TaskDto[];
    makeup_ticket: { status: 'available' | 'used' | 'expired' } | null;
  }>(`/api/wishes/${wishId}/tasks/today`, { token });

export const getLedger = (token: string, wishId: string, weekStart?: string) =>
  api<LedgerViewDto>(
    `/api/wishes/${wishId}/ledger${weekStart ? `?week_start=${encodeURIComponent(weekStart)}` : ''}`,
    { token },
  );

export const setWeekBudget = (
  token: string,
  wishId: string,
  weekStart: string,
  budgetCents: number,
) =>
  api<{ week: LedgerWeekDto; totals: LedgerViewDto['totals'] }>(`/api/ledger/weeks/${weekStart}`, {
    method: 'PUT',
    token,
    body: { wish_id: wishId, budget_cents: budgetCents },
  });

export const addLedgerEntry = (
  token: string,
  input: {
    wish_id: string;
    week_start: string;
    type: 'expense' | 'earning' | 'saved';
    amount_cents: number;
    note?: string;
    task_id?: string;
  },
) => api<{ entry: LedgerEntryDto }>('/api/ledger/entries', { token, body: input });

export const checkinTask = (
  token: string,
  taskId: string,
  proofId: string,
  note: string,
  amountCents?: number,
) =>
  api<{ task: TaskDto; checkin: CheckinDto }>(`/api/tasks/${taskId}/checkin`, {
    token,
    body: amountCents === undefined
      ? { proof_id: proofId, note }
      : { proof_id: proofId, note, amount_cents: amountCents },
  });

export const makeupTask = (
  token: string,
  taskId: string,
  proofId: string,
  note: string,
  amountCents?: number,
) =>
  api<{ task: TaskDto; checkin: CheckinDto }>(`/api/tasks/${taskId}/makeup`, {
    token,
    body: amountCents === undefined
      ? { proof_id: proofId, note }
      : { proof_id: proofId, note, amount_cents: amountCents },
  });

export const settleWish = (token: string, wishId: string) =>
  api<{ settlement: import('./domain').SettlementView; already_settled: boolean }>(
    `/api/wishes/${wishId}/settle`,
    { method: 'POST', token, body: {} },
  );

export const getSettlement = (token: string, wishId: string) =>
  api<import('./domain').SettlementView>(`/api/wishes/${wishId}/settlement`, { token });

export const extendWish = (token: string, wishId: string, days: number) =>
  api<{ wish: WishDto; new_end_date: string; days: number; added_tasks: number }>(
    `/api/wishes/${wishId}/extend`,
    {
      method: 'POST',
      token,
      body: { days },
    },
  );

export const getFileUrl = (token: string, fileId: string) =>
  api<{ file_id: string; url: string; expires_in: number }>(`/api/uploads/${fileId}/url`, {
    method: 'POST',
    token,
    body: {},
  });

export const polishWish = (token: string, wishText: string, relation: string) =>
  api<AiResult>('/api/ai/polish-wish', { token, body: { wish_text: wishText, relation } });

export const listPool = (category?: string) =>
  api<{ items: PoolPostDto[]; next_cursor: string | null; has_more: boolean; limit: number }>(
    `/api/pool?limit=50${category ? `&category=${encodeURIComponent(category)}` : ''}`,
  );

export const getPoolPost = (id: string) => api<{ post: PoolPostDto }>(`/api/pool/${id}`);

export const listReplies = (postId: string) =>
  api<{ items: ReplyDto[]; next_cursor: string | null; has_more: boolean; limit: number }>(
    `/api/pool/${postId}/replies?limit=50`,
  );

export const createReply = (token: string, postId: string, content: string) =>
  api<{ reply: ReplyDto; post: { reply_count: number }; quota: { daily_remaining: number } }>(
    `/api/pool/${postId}/replies`,
    { token, body: { content } },
  );

export const demoSession = () => api<DemoSessionResult>('/api/demo/session', { body: {} });

export const demoScenario = (token: string, outcome: 'double_realized' | 'cyber_only' | 'failed') =>
  api<{ state: DemoStateDto; settlement: import('./domain').SettlementView }>(
    '/api/demo/scenario',
    {
      token,
      body: { outcome },
    },
  );

/** 两段式上传：presign → 对象存储 PUT → complete，返回可被业务接口引用的 file_id。 */
export async function uploadImage(
  token: string,
  dataUrl: string,
  purpose: 'checkin_proof' | 'ledger_proof' | 'share_image',
  wishId?: string,
): Promise<string> {
  const blob = dataUrlToBlob(dataUrl);
  const presign = await api<PresignResult>('/api/uploads/presign', {
    token,
    body: {
      purpose,
      mime_type: blob.type,
      filename: `proof-${Date.now()}.jpg`,
      size_bytes: blob.size,
      wish_id: wishId,
    },
  });

  const uploadHeaders = new Headers(presign.required_headers);
  const put = await fetch(presign.upload_url, {
    method: presign.upload_method,
    headers: uploadHeaders,
    body: blob,
  });
  if (!put.ok) throw new Error('图片上传失败，请检查网络后重试。');

  const completed = await api<{ file_id: string }>('/api/uploads/complete', {
    token,
    body: { file_id: presign.file_id },
  });
  return completed.file_id;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('图片数据格式不正确，请重新选择。');
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * AI 辅助（第 8 轮）：P0 只开放「愿望润色」，其余能力预留架构位。
 *
 * 业务红线：
 * - 只建议、不代写：本模块从不写 wishes / wish_answers，返回的文本必须由用户主动确认；
 * - 所有出参统一携带「AI辅助」标签（顶层 ai_label + 每条 suggestion.label）；
 * - 输入先脱敏再交给模型；输出做条数、长度、联系方式与链接校验，不合格即丢弃并回退模板；
 * - 超时、调用失败、额度耗尽都回退确定性模板，主流程不阻塞；
 * - 相同用户 + 相同能力 + 相同输入命中缓存，不重复调用模型、不重复计费。
 *
 * 额度口径：只统计 source='agent' 的缓存行（模板兜底不消耗额度）；
 * 缓存放 app.ai_suggestions，过期行惰性清理，无定时任务。
 */

import { count, first, write } from '../lib/db.ts';
import { sha256Hex, utf8 } from '../lib/crypto.ts';
import { uuid } from '../lib/id.ts';
import { unavailable } from '../lib/errors.ts';
import { containsSensitive, redactSensitive } from '../lib/sensitive.ts';
import { dailyWindow } from '../lib/quota.ts';
import type {
  AiAdapter,
  AiGenerationInput,
  AppConfig,
  DbClient,
  DbRow,
  Principal,
} from '../lib/types.ts';

export const AI_LABEL = 'AI辅助';
export const AI_CAPABILITY_POLISH = 'polish_wish';
export const MAX_SUGGESTION_CHARS = 60;
const SUGGESTION_COUNT = 3;
const PROMPT_VERSION = 'polish-v1';
const CACHE_LIMIT = 1;
const QUOTA_SCAN = 1_000;

export const AI_NOTICE = 'AI 只提供参考建议，愿签内容需要你确认后才会写入。';

export interface PolishInput {
  wishText: string;
  relation: string;
  wishType: string;
}

export interface SuggestionDto {
  id: string;
  text: string;
  label: string;
}

export interface AiQuotaView {
  daily_limit: number;
  used: number;
  remaining: number;
}

export interface PolishOutcome {
  ai_assisted: true;
  ai_label: string;
  label_required: true;
  capability: string;
  suggestions: SuggestionDto[];
  source: 'agent' | 'template';
  fallback: boolean;
  fallback_reason: string;
  model: string;
  cached: boolean;
  input_redacted: boolean;
  quota: AiQuotaView;
  notice: string;
}

export type FallbackReason = 'timeout' | 'agent_error' | 'invalid_output' | 'quota_exceeded';

/** 确定性模板：六类愿望各 3 条，克制、具象、不说教；{rel} 用关系称谓替换 */
const TEMPLATE_POOLS: Record<string, readonly string[]> = {
  body: [
    '希望{rel}的腿疼能轻一点，每天睡前都能踏实躺下。',
    '想给{rel}买一副护膝，让 TA 下楼时膝盖能暖一点。',
    '这周陪{rel}走两段路，顺手问问 TA 最近腿还疼不疼。',
  ],
  sleep: [
    '希望{rel}每天能睡个整觉，睡前不再刷手机到很晚。',
    '想给{rel}换一床更暖的被子，让 TA 夜里少醒几次。',
    '这周和{rel}约好固定熄灯时间，一起早点休息。',
  ],
  lonely: [
    '希望{rel}一个人在家时，也能有人陪 TA 说说话。',
    '想每天给{rel}打个电话，哪怕只聊三五分钟。',
    '这周回家陪{rel}吃顿饭，问问 TA 最近在忙什么。',
  ],
  study: [
    '希望{rel}备考时少一点压力，每天都能睡够六小时。',
    '想给{rel}买一盏护眼灯，让晚自习回来不那么累。',
    '这周帮{rel}整理一次资料，让 TA 少熬一个晚上。',
  ],
  emotion: [
    '希望{rel}难过的时候，能先被听见，而不是被劝住。',
    '想每周留一个晚上，专门听{rel}说说最近的事。',
    '这周给{rel}发一条具体的关心，不催 TA 快点好起来。',
  ],
  life: [
    '希望{rel}日常的琐事能少一点，周末真正歇一歇。',
    '想帮{rel}把家里的灯泡和插座都检查一遍。',
    '这周替{rel}做一顿饭，让 TA 下班回家就能吃上。',
  ],
};

const FALLBACK_TEMPLATES = [
  '把愿望写得更具体一点：这周想为{rel}做的第一件小事是什么。',
  '试着补上时间和动作，比如「周六上午陪{rel}去复查」。',
  '保留原意，去掉说教，只留下你真正想做的那件事。',
];

export function templateSuggestions(relation: string, wishType: string): string[] {
  const rel = relation === '' ? 'TA' : relation;
  const pool = TEMPLATE_POOLS[wishType] ?? FALLBACK_TEMPLATES;
  return Array.from({ length: SUGGESTION_COUNT }, (_, index) => {
    const source = pool[index % pool.length] ?? FALLBACK_TEMPLATES[index % FALLBACK_TEMPLATES.length];
    return source.replace(/\{rel\}/g, rel);
  });
}

class TemplateAdapter implements AiAdapter {
  readonly name = 'template';
  async generate(input: AiGenerationInput): Promise<string[]> {
    return templateSuggestions(input.relation, input.wishType);
  }
}

const TEMPLATE_ADAPTER: AiAdapter = new TemplateAdapter();

/** 生产适配器：Qoder Cloud Agents 兼容端点；未配置端点时永远走模板，不发起外部请求 */
export function createAgentAdapter(config: AppConfig): AiAdapter {
  return {
    name: 'qoder-agents',
    async generate(input, signal) {
      const endpoint = config.aiAgentEndpoint;
      if (endpoint === '') throw new Error('agent endpoint not configured');
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (config.aiAgentToken) headers.authorization = `Bearer ${config.aiAgentToken}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          capability: input.capability,
          input: { wish_text: input.text, relation: input.relation, wish_type: input.wishType },
          output: { count: SUGGESTION_COUNT, max_chars: MAX_SUGGESTION_CHARS, label: AI_LABEL },
        }),
        signal,
      });
      if (!response.ok) throw new Error(`agent status ${response.status}`);
      return extractAgentSuggestions(await response.json() as unknown);
    },
  };
}

/** 端点返回格式收窄：{suggestions} / {data:{suggestions}} / {output:{suggestions}}，其余视为异常 */
function extractAgentSuggestions(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') throw new Error('agent payload invalid');
  const record = payload as Record<string, unknown>;
  const nested = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>).suggestions;
  };
  const candidates = record.suggestions ?? nested(record.data) ?? nested(record.output);
  if (!Array.isArray(candidates)) throw new Error('agent suggestions missing');
  return candidates.filter((item): item is string => typeof item === 'string');
}

/** 适配器解析顺序：显式注入（测试）→ 环境变量端点 → 模板 */
export function resolveAiAdapter(config: AppConfig, injected?: AiAdapter): AiAdapter {
  if (injected) return injected;
  if (config.aiAgentEndpoint !== '') return createAgentAdapter(config);
  return TEMPLATE_ADAPTER;
}

export function isTemplateAdapter(adapter: AiAdapter): boolean {
  return adapter.name === 'template';
}

class AiTimeoutError extends Error {
  constructor() {
    super('ai timeout');
    this.name = 'AiTimeoutError';
  }
}

async function generateWithTimeout(adapter: AiAdapter, input: AiGenerationInput, timeoutMs: number): Promise<string[]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([adapter.generate(input, controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 输出校验：恰好 3 条、1~60 字、无联系方式/链接、互不重复；不合法返回 null 由调用方回退模板 */
export function validateSuggestions(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length !== SUGGESTION_COUNT) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return null;
    const text = item.replace(/\s+/g, ' ').trim();
    if (text.length === 0 || text.length > MAX_SUGGESTION_CHARS) return null;
    if (containsSensitive(text) || /https?:\/\/|www\./i.test(text)) return null;
    out.push(text);
  }
  return new Set(out).size === SUGGESTION_COUNT ? out : null;
}

interface CacheRow extends DbRow {
  id: string;
}

async function readCache(db: DbClient, userId: string, inputHash: string): Promise<CacheRow | null> {
  return first(
    db.from('ai_suggestions').select('*')
      .eq('user_id', userId).eq('capability', AI_CAPABILITY_POLISH).eq('input_hash', inputHash)
      .limit(CACHE_LIMIT),
    'read ai cache',
  ) as Promise<CacheRow | null>;
}

function parseStoredSuggestions(row: CacheRow): string[] | null {
  const value = row.suggestions;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string' && value !== '') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      return null;
    }
  }
  return null;
}

/** 过期缓存惰性删除（无定时任务）：下次同一输入再算一次，并按当天的额度重新计数 */
async function dropCache(db: DbClient, row: CacheRow): Promise<void> {
  await write(db.from('ai_suggestions').delete().eq('id', row.id).select('id'), 'drop ai cache');
}

async function agentUsedToday(db: DbClient, userId: string, since: string, limit: number): Promise<number> {
  return count(
    db.from('ai_suggestions').select('id')
      .eq('user_id', userId).eq('source', 'agent').gte('created_at', since).limit(QUOTA_SCAN),
    'count ai quota',
  ).then((hit) => Math.min(hit, limit));
}

async function storeCache(
  db: DbClient,
  config: AppConfig,
  userId: string,
  inputHash: string,
  inputRedacted: string,
  texts: string[],
  meta: { source: 'agent' | 'template'; fallbackReason: string; model: string },
  now: Date,
): Promise<CacheRow> {
  const timestamp = now.toISOString();
  const expiresAt = new Date(now.getTime() + config.aiCacheTtlHours * 3_600_000).toISOString();
  const cacheInsert = {
    id: uuid(),
    user_id: userId,
    capability: AI_CAPABILITY_POLISH,
    input_hash: inputHash,
    input_redacted: inputRedacted,
    suggestions: texts,
    source: meta.source,
    fallback_reason: meta.fallbackReason,
    model: meta.model,
    expires_at: expiresAt,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const inserted = await write(
    db.from('ai_suggestions').insertIfAbsent(cacheInsert, { onConflict: 'user_id,capability,input_hash' }).select('*'),
    'store ai cache',
  );
  if (inserted.length === 1) return inserted[0] as CacheRow;
  // 并发写缓存：另一条请求先落了同一输入，回读它的结果（不再计费）
  const raced = await readCache(db, userId, inputHash);
  if (!raced) throw new Error('ai cache write raced');
  return raced;
}

function toOutcome(
  texts: string[],
  meta: { source: 'agent' | 'template'; fallbackReason: string; model: string; cached: boolean; inputRedacted: boolean },
  quota: AiQuotaView,
): PolishOutcome {
  return {
    ai_assisted: true,
    ai_label: AI_LABEL,
    label_required: true,
    capability: AI_CAPABILITY_POLISH,
    suggestions: texts.slice(0, SUGGESTION_COUNT).map((text, index) => ({
      id: `s${index + 1}`,
      text,
      label: AI_LABEL,
    })),
    source: meta.source,
    fallback: meta.source === 'template' && meta.fallbackReason !== '',
    fallback_reason: meta.fallbackReason,
    model: meta.model,
    cached: meta.cached,
    input_redacted: meta.inputRedacted,
    quota,
    notice: AI_NOTICE,
  };
}

function quotaView(config: AppConfig, used: number): AiQuotaView {
  return {
    daily_limit: config.aiPolishPerDay,
    used,
    remaining: Math.max(0, config.aiPolishPerDay - used),
  };
}

/**
 * 愿望润色：读缓存 → 判额度 → 调用适配器（超时/异常/坏输出回退模板）→ 写缓存。
 * 返回值只含建议文本，绝不修改任何愿签字段。
 */
export async function polishWish(
  db: DbClient,
  config: AppConfig,
  principal: Principal,
  adapter: AiAdapter,
  input: PolishInput,
  now: Date,
): Promise<PolishOutcome> {
  const userId = principal.userId;
  const trimmed = input.wishText.trim();
  const redacted = redactSensitive(trimmed);
  const inputRedacted = redacted !== trimmed;
  const inputHash = await sha256Hex(utf8([
    AI_CAPABILITY_POLISH,
    PROMPT_VERSION,
    input.relation,
    input.wishType,
    redacted,
  ].join('\n')));

  const window = dailyWindow(now);
  let used = await agentUsedToday(db, userId, window.since, config.aiPolishPerDay);

  const cached = await readCache(db, userId, inputHash);
  if (cached) {
    const stored = validateSuggestions(parseStoredSuggestions(cached));
    if (stored && String(cached.expires_at ?? '') > now.toISOString()) {
      const source = String(cached.source) === 'agent' ? 'agent' : 'template';
      return toOutcome(stored, {
        source,
        fallbackReason: String(cached.fallback_reason ?? ''),
        model: String(cached.model ?? ''),
        cached: true,
        inputRedacted,
      }, quotaView(config, used));
    }
    // 缓存过期或内容损坏：删掉重算，避免把坏结果永久回放
    await dropCache(db, cached);
  }

  const generation: AiGenerationInput = {
    capability: AI_CAPABILITY_POLISH,
    text: redacted,
    relation: input.relation,
    wishType: input.wishType,
  };

  let texts: string[] | null = null;
  let reason = '';
  let model = adapter.name;

  if (!isTemplateAdapter(adapter) && used >= config.aiPolishPerDay) {
    reason = 'quota_exceeded';
  } else if (isTemplateAdapter(adapter)) {
    texts = validateSuggestions(await adapter.generate(generation, new AbortController().signal));
  } else {
    try {
      texts = validateSuggestions(await generateWithTimeout(adapter, generation, config.aiTimeoutMs));
      if (texts === null) reason = 'invalid_output';
    } catch (error) {
      reason = error instanceof AiTimeoutError ? 'timeout' : 'agent_error';
    }
  }

  if (texts === null) {
    // 兜底必须走确定性模板：resolveAiAdapter(config) 在配置了 AI_AGENT_ENDPOINT 时会再次返回
    // agent 适配器（且没有超时与额度检查），会把「超时/失败/额度用尽回退模板」变成再打一次模型。
    texts = validateSuggestions(await TEMPLATE_ADAPTER.generate(generation, new AbortController().signal));
    if (texts === null) {
      // 模板是确定性内容，走到这里说明代码被改坏：直接报错比返回脏数据好
      throw unavailable('ai_template_invalid', '建议生成失败，请稍后再试。');
    }
    model = 'template';
  } else if (reason === '' && !isTemplateAdapter(adapter)) {
    used += 1;
  }

  const source: 'agent' | 'template' = reason === '' && !isTemplateAdapter(adapter) ? 'agent' : 'template';
  const row = await storeCache(db, config, userId, inputHash, redacted, texts, {
    source,
    fallbackReason: reason,
    model,
  }, now);

  const stored = validateSuggestions(parseStoredSuggestions(row)) ?? texts;
  return toOutcome(stored, {
    source,
    fallbackReason: reason,
    model,
    cached: false,
    inputRedacted,
  }, quotaView(config, used));
}

/* ── 扩展预留：本轮不实现具体逻辑，仅保留统一入口与缓存/脱敏能力 ───────── */

export interface TaskCandidateInput {
  wishType: string;
  relation: string;
  existingTitles: string[];
}

export async function suggestTaskCandidates(
  _db: DbClient,
  _config: AppConfig,
  _principal: Principal,
  _input: TaskCandidateInput,
): Promise<PolishOutcome> {
  throw unavailable('ai_capability_not_implemented', '任务候选建议尚未开放。');
}

export interface ReplyDraftInput {
  postExcerpt: string;
  tone: string;
}

export async function draftReply(
  _db: DbClient,
  _config: AppConfig,
  _principal: Principal,
  _input: ReplyDraftInput,
): Promise<PolishOutcome> {
  throw unavailable('ai_capability_not_implemented', '回信草稿尚未开放。');
}

export interface LetterDraftInput {
  outcome: string;
  targetName: string;
}

export async function draftLetter(
  _db: DbClient,
  _config: AppConfig,
  _principal: Principal,
  _input: LetterDraftInput,
): Promise<PolishOutcome> {
  throw unavailable('ai_capability_not_implemented', '信件草稿尚未开放。');
}
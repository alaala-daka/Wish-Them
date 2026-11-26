import type { AiResult, PoolPostDto, ReplyDto } from './api';
import type { Draft } from './domain';

/**
 * 页面可调用的业务动作。所有函数在失败时抛出 Error（ApiError 的 message 可直接展示），
 * 成功后由 App 统一刷新服务端状态，页面不自己拼装远程数据。
 */
export type Actions = {
  createWish(draft: Draft, signature: string): Promise<void>;
  checkin(taskId: string, imageDataUrl: string, note: string, amountCents?: number): Promise<void>;
  makeup(taskId: string, imageDataUrl: string, note: string, amountCents?: number): Promise<void>;
  setWeekBudget(cents: number): Promise<void>;
  addLedgerEntry(
    kind: 'expense' | 'income' | 'saved',
    cents: number,
    note: string,
    taskId?: string,
  ): Promise<void>;
  settle(): Promise<void>;
  extend(days: number): Promise<void>;
  polish(text: string, relation: string): Promise<AiResult>;
  listPool(category?: string): Promise<PoolPostDto[]>;
  getPost(id: string): Promise<{ post: PoolPostDto; replies: ReplyDto[] }>;
  replyToPost(id: string, content: string): Promise<void>;
  recover(code: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
};

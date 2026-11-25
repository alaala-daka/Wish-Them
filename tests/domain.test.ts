import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  productDay,
  weekStart,
  createWish,
  emptyDraft,
  totals,
  demoData,
  settlement,
  category,
} from '../src/domain';
test('中国时区04:00分日，不受运行机器时区影响', () => {
  assert.equal(productDay(new Date('2026-11-20T19:59:59Z')), '2026-11-20');
  assert.equal(productDay(new Date('2026-11-20T20:00:00Z')), '2026-11-21');
  assert.equal(weekStart('2026-11-22'), '2026-11-16');
});
test('十天各两件必做，钱任务只在周末，末尾允许轮转', () => {
  const wish = createWish(
    { ...emptyDraft(), text: '希望妈妈睡好觉' },
    new Date('2026-11-16T04:00:00Z'),
  );
  assert.equal(wish.tasks.filter((t) => t.kind !== 'money').length, 20);
  assert.equal(new Set(wish.tasks.map((t) => t.title)).size, 15);
  assert.equal(wish.tasks.filter((t) => t.kind === 'money').length, 2);
  assert.equal(wish.tasks[0].date, '2026-11-16');
  assert.equal(wish.tasks.at(-1)?.date, '2026-11-25');
  assert.ok(wish.tasks.every((task) => task.tags.length > 0));
});
test('周三开始也自动对齐现实周末：金额任务只落在周六周日', () => {
  const wish = createWish(
    { ...emptyDraft(), text: '希望妈妈睡好觉' },
    new Date('2026-11-18T04:00:00Z'),
  );
  const moneyDates = wish.tasks.filter((task) => task.kind === 'money').map((task) => task.date);
  assert.deepEqual(moneyDates, ['2026-11-21', '2026-11-22']);
  assert.equal(wish.tasks[0].date, '2026-11-18');
});
test('自然周独立计算结余，超支不抵扣其他周，示例账本合计168', () => {
  const d = demoData();
  assert.deepEqual(totals(d.ledger), { saved: 48, earned: 120, total: 168 });
  const entries = [
    ...d.ledger,
    { id: 'over', week: '2020-01-06', kind: 'expense' as const, amount: 999, note: '' },
  ];
  assert.equal(totals(entries).total, 168);
});
test('未到期不能结算，三种演示结局规则一致', () => {
  assert.equal(settlement(demoData('full')).outcome, 'full');
  assert.equal(settlement(demoData('cyber')).outcome, 'cyber');
  assert.equal(settlement(demoData('unfinished')).complete, false);
  const d = demoData();
  assert.equal(settlement(d, new Date(d.wish!.start + 'T04:00:00Z')).due, false);
});
test('类型按关键词最多匹配，相同分数使用固定优先级', () => {
  assert.equal(category('腿疼想睡好觉'), '身体');
  assert.equal(category('考试论文学习'), '学业');
  assert.equal(category('平安快乐'), '生活');
});

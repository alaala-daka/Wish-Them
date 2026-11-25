import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from '../tools/local/fake-db.ts';
import { testConfig } from '../tools/local/deps.ts';
import { saveAnswers } from '../backend/domain/wish.ts';
import type { WishRow } from '../backend/domain/wish.ts';

test('动态问卷 meta 只写粗粒度档位，原文仍是密文', async () => {
  const db = new FakeDb();
  const wish = {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: '33333333-3333-4333-8333-333333333333',
    status: 'draft',
    five_questions_done: false,
  } as unknown as WishRow;
  await saveAnswers(
    db,
    testConfig(),
    wish,
    {
      q1: '她一个人在老家',
      q2: '常常一个人',
      q3: '济南|北京',
      q4: '300–599',
      q5: '见到面',
    },
    new Date('2026-11-25T00:00:00Z'),
    { giftCategory: 'lonely', aloneLevel: 'high', travelBand: 'near', costBand: '100_299', disposableBand: '300_599' },
  );
  const row = db.rowsOf('wish_answers')[0];
  assert.ok(String(row.q1_worry_enc).startsWith('v1:'));
  assert.ok(String(row.q3_home_enc).startsWith('v1:'));
  assert.equal(row.q2_alone_level, 'high');
  assert.equal(row.q3_travel_band, 'near');
  assert.equal(row.q3_cost_band, '100_299');
  assert.equal(row.q4_disposable_band, '300_599');
  assert.equal(row.q1_gift_category, 'lonely');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from '../tools/local/fake-db.ts';
import { testConfig } from '../tools/local/deps.ts';
import { buildEasterEgg } from '../backend/domain/easter-egg.ts';
import type { WishRow } from '../backend/domain/wish.ts';

const wish = {
  id: '11111111-1111-4111-8111-111111111111',
  wish_type: 'lonely',
  relation: '姥姥',
  target_name: '姥姥',
  raw_input: '她一个人在老家，希望她别总是一个人吃饭。',
  days: 10,
} as unknown as WishRow;

function answersDb() {
  const db = new FakeDb();
  db.seed('wish_answers', [{
    id: '22222222-2222-4222-8222-222222222222',
    wish_id: String(wish.id),
    user_id: '33333333-3333-4333-8333-333333333333',
    q1_worry_enc: '',
    q2_alone_level: 'high',
    q3_home_enc: '',
    q3_travel_band: 'near',
    q3_cost_band: '300_599',
    q4_disposable_band: '300_599',
    q5_gift_enc: '',
  }]);
  return db;
}

test('DeepSeek 彩蛋：合法 JSON 走 agent，价格不越界', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          title: '一张回家的往返车票',
          summary: '用这十天攒下的钱，把北京到济南的往返车票变成一次真的见面。',
          plan_steps: ['先查周末车次。', '把钱单独放进一个信封。', '回去陪姥姥吃一顿饭。'],
          cost_min_yuan: 150,
          cost_max_yuan: 250,
          affordable: true,
          gap_yuan: 0,
          closing: '有些距离，一张车票就能缩短。',
        }),
      },
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    const egg = await buildEasterEgg(
      answersDb(),
      testConfig({ deepseekApiKey: 'test-key', deepseekBaseUrl: 'http://mock.local/v1', aiEasterEggEnabled: true }),
      wish,
      { realizedCents: 68_000, savedCents: 48_000, earnedCents: 20_000 },
      new Date('2026-11-25T00:00:00Z'),
    );
    assert.equal(egg.source, 'agent');
    assert.equal(egg.direction, 'visit');
    assert.equal(egg.title, '一张回家的往返车票');
    assert.equal(egg.plan_steps.length, 3);
    assert.ok(egg.affordable);
  } finally {
    globalThis.fetch = original;
  }
});

test('DeepSeek 坏输出自动回退模板，页面不空', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: '这不是 JSON' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    const egg = await buildEasterEgg(
      answersDb(),
      testConfig({ deepseekApiKey: 'test-key', deepseekBaseUrl: 'http://mock.local/v1', aiEasterEggEnabled: true }),
      wish,
      { realizedCents: 68_000, savedCents: 48_000, earnedCents: 20_000 },
      new Date('2026-11-25T00:00:00Z'),
    );
    assert.equal(egg.source, 'template');
    assert.equal(egg.direction, 'visit');
    assert.ok(egg.plan_steps.length >= 2);
  } finally {
    globalThis.fetch = original;
  }
});

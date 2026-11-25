import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDraft } from '../src/domain';
import { branchOf, citiesOf, metaOf, questionsFor, withChoice, withCities } from '../src/questionnaire';

const draft = () => ({ ...emptyDraft(), choices: ['', '', '', '', ''], meta: {} });

test('Q2 选择决定分支，题目跟着换', () => {
  const lonely = { ...draft(), choices: ['', 'alone', '', '', ''] };
  assert.equal(branchOf(lonely), 'lonely');
  assert.equal(questionsFor(lonely)[2].cityPair, true);

  const health = { ...draft(), choices: ['', 'unwell', '', '', ''] };
  assert.equal(branchOf(health), 'health');
  assert.ok(questionsFor(health)[2].choices.some((choice) => choice.id === 'legs'));

  const emotion = { ...draft(), choices: ['', 'heavy', '', '', ''] };
  assert.equal(branchOf(emotion), 'emotion');
  assert.ok(questionsFor(emotion)[2].choices.some((choice) => choice.id === 'month'));
});

test('孤单分支的城市对会存成可解析的「TA|我」', () => {
  const next = withCities(draft(), '济南', '北京');
  assert.deepEqual(citiesOf(next), { toCity: '济南', fromCity: '北京' });
});

test('选择会写入答案并派生后端档位', () => {
  let next = draft();
  next = withChoice(next, 1, { id: 'alone', label: '常常一个人' });
  next = withChoice(next, 2, { id: 'near', label: '高铁 2 小时内' });
  next = withChoice(next, 3, { id: '300_599', label: '300–599' });
  const meta = metaOf(next);
  assert.equal(meta.aloneLevel, 'high');
  assert.equal(meta.travelBand, 'near');
  assert.equal(meta.costBand, '100_299');
  assert.equal(meta.disposableBand, '300_599');
  assert.equal(meta.giftCategory, 'lonely');
});

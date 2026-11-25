import { useState } from 'react';
import { Check, Feather, RefreshCw, ShieldCheck } from 'lucide-react';
import { emptyDraft, relations, type AppData, type Draft } from './domain';
import {
  branchOf,
  citiesOf,
  metaOf,
  questionsFor,
  withChoice,
  withCities,
  type Choice,
} from './questionnaire';
import type { Update } from './App';
import type { Actions } from './actions';
import type { AiResult } from './api';
import { go, Heading, Mascot, Paper, PrivateNote, WishCard } from './components';
export default function Create({
  data,
  update,
  notify,
  actions,
}: {
  data: AppData;
  update: Update;
  notify: (s: string) => void;
  actions: Actions;
}) {
  const [draft, setDraft] = useState(data.draft),
    [aiResult, setAiResult] = useState<AiResult | null>(null),
    [aiBusy, setAiBusy] = useState(false),
    [batch, setBatch] = useState(0),
    [agreed, setAgreed] = useState(false),
    [signature, setSignature] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  function change(patch: Partial<Draft>) {
    const next = { ...draft, ...patch };
    next.meta = metaOf(next);
    setDraft(next);
    void update((d) => ({ ...d, draft: next })).catch(() => setError('草稿未保存，请重试。'));
  }
  const views = questionsFor(draft);
  const view = views[draft.question];
  const branch = branchOf(draft);
  const { toCity, fromCity } = citiesOf(draft);
  const questionReady = draft.step !== 2
    || (Boolean(draft.answers[draft.question]?.trim())
      && (!view.cityPair || (toCity.trim() !== '' && fromCity.trim() !== '')));
  function choose(choice: Choice) {
    const next = withChoice(draft, draft.question, choice);
    // Q2 改变分支时，后面的题会换一套，清掉旧答案避免张冠李戴
    if (draft.question === 1) {
      next.answers = [...next.answers];
      next.choices = [...next.choices];
      for (let index = 2; index < 5; index += 1) {
        next.answers[index] = '';
        next.choices[index] = '';
      }
    }
    change({ answers: next.answers, choices: next.choices });
  }
  function setAnswer(value: string) {
    const answers = [...draft.answers];
    answers[draft.question] = value;
    const choices = [...draft.choices];
    if (draft.question === 3 && /^\d+$/.test(value.trim())) choices[3] = '';
    change({ answers, choices });
  }
  const templates = [
    `希望${draft.name}每天都能睡个好觉。`,
    `希望${draft.name}的身体舒服一点，不再被小毛病打扰。`,
    `希望${draft.name}忙碌之余，也能留点时间给自己。`,
    `希望${draft.name}不觉得孤单，想说话的时候有人听。`,
    `希望${draft.name}最近的烦心事，都慢慢有了答案。`,
    `希望${draft.name}每天好好吃饭，平安快乐。`,
  ];
  async function askAi() {
    if (!draft.text.trim()) {
      setError('先写一句愿望，再让 AI 帮你找表达。');
      return;
    }
    setAiBusy(true);
    setError('');
    try {
      setAiResult(await actions.polish(draft.text.trim(), draft.relation));
    } catch (e) {
      setError((e as Error).message || 'AI 润色暂时不可用，可先使用模板。');
    } finally {
      setAiBusy(false);
    }
  }
  async function sign() {
    if (!agreed || !signature.trim() || busy) return;
    const missing = draft.answers.findIndex((answer) => !answer.trim());
    if (missing >= 0) {
      setDraft({ ...draft, step: 2, question: missing });
      setError(`还需要回答第 ${missing + 1} 个问题，才能签下约定。`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await actions.createWish({ ...draft, meta: metaOf(draft) }, signature.trim());
      notify('约定已签下，愿签已保存到你的账号。');
      go('/today');
    } catch (e) {
      setError((e as Error).message || '约定没有保存，请重试。');
    } finally {
      setBusy(false);
    }
  }
  if (data.wish && data.wish.status !== 'settled')
    return (
      <div className="page">
        <Paper className="empty">
          <h1>先照顾好手上的这份心意</h1>
          <p>你已经有一张愿签。可以在“我的”里查看。</p>
          <button className="primary" onClick={() => go('/today')}>
            回到今天的小事
          </button>
        </Paper>
      </div>
    );
  return (
    <div className="page">
      <Heading
        eyebrow="WRITE A LITTLE WISH"
        title="在这里，把牵挂写下来"
        description="不必说得很漂亮，真心就很好。"
      />
      <div className="create-layout">
        <aside className="steps">
          {['想替谁许愿', '写下心愿', '几个小问题', '签下约定'].map((s, i) => (
            <div key={s} className={draft.step === i ? 'current' : ''}>
              <span>{draft.step > i ? <Check size={16} /> : i + 1}</span>
              {s}
            </div>
          ))}
          <p>
            <ShieldCheck size={20} />
            问答会加密保存在账号里，不会出现在愿签池。
          </p>
        </aside>
        <Paper className="editor">
          <span className="eyebrow">
            {
              [
                '一个具体的人，一份具体的牵挂',
                '这句话，只要你自己喜欢',
                '更了解一点，才好靠近一点',
                '让愿望，从小事开始',
              ][draft.step]
            }
          </span>
          {draft.step === 0 && (
            <>
              <h2>你想替谁许个愿？</h2>
              <div className="relations" role="group" aria-label="选择关系">
                {relations.map((r) => (
                  <button
                    key={r}
                    className={draft.relation === r ? 'selected' : ''}
                    aria-pressed={draft.relation === r}
                    onClick={() => change({ relation: r, name: r })}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <label>
                你平时怎么称呼TA？
                <input
                  maxLength={8}
                  value={draft.name}
                  onChange={(e) => change({ name: e.target.value })}
                />
              </label>
              <label>
                TA的代词
                <select value={draft.pronoun} onChange={(e) => change({ pronoun: e.target.value })}>
                  <option>她</option>
                  <option>他</option>
                  <option>TA</option>
                </select>
              </label>
            </>
          )}
          {draft.step === 1 && (
            <>
              <h2>替{draft.name}，许一个小小的愿</h2>
              <label>
                写下你的愿望
                <textarea
                  rows={5}
                  maxLength={120}
                  value={draft.text}
                  onChange={(e) => change({ text: e.target.value, ai: false })}
                  placeholder={`希望${draft.name}……`}
                />
              </label>
              <div className="field-meta">
                <span>具体一点，温柔一点。</span>
                <span>{draft.text.length}/120</span>
              </div>
              <div className="section-label">
                也可以从一句话开始
                <button className="text-button" onClick={() => setBatch(batch ? 0 : 1)}>
                  <RefreshCw size={14} />
                  换一批
                </button>
              </div>
              <div className="template-list">
                {templates.slice(batch * 3, batch * 3 + 3).map((t) => (
                  <button key={t} onClick={() => change({ text: t, ai: false })}>
                    {t}
                  </button>
                ))}
              </div>
              <button
                className="secondary polish"
                disabled={aiBusy}
                onClick={() => void askAi()}
              >
                <Feather size={16} />
                {aiBusy ? '正在想表达…' : '帮我找找表达'}
              </button>
              {aiResult && (
                <div className="suggestions">
                  <p className="muted">
                    <span className="tag">{aiResult.ai_label}</span>
                    {aiResult.fallback
                      ? ' AI 服务暂不可用，以下为模板建议；选用后才会替换，不会自动保存。'
                      : ' 以下建议仅供参考，选用后才会替换，不会自动保存。'}
                    {aiResult.quota && ` 今日剩余额度 ${aiResult.quota.remaining} 次。`}
                  </p>
                  {aiResult.suggestions.map((suggestion) => (
                    <div key={suggestion.id}>
                      <p>
                        <span className="tag">{suggestion.label}</span> {suggestion.text}
                      </p>
                      <button
                        onClick={() => {
                          change({ text: suggestion.text, ai: true });
                          setAiResult(null);
                        }}
                      >
                        选用
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {draft.step === 2 && (
            <>
              <span className="tag">
                问题 {draft.question + 1} / 5 · {branch === 'lonely' ? '关于距离' : branch === 'health' ? '关于身体' : branch === 'emotion' ? '关于心事' : '关于生活'}
              </span>
              <h2>{view.prompt}</h2>
              {view.hint && <p className="muted">{view.hint}</p>}
              {view.choices.length > 0 && (
                <div className="question-choices" role="group" aria-label="选择一个最接近的">
                  {view.choices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      className={draft.choices[draft.question] === choice.id ? 'selected' : ''}
                      aria-pressed={draft.choices[draft.question] === choice.id}
                      onClick={() => choose(choice)}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              )}
              {view.cityPair ? (
                <div className="city-pair">
                  <label>
                    TA 在的城市
                    <input
                      maxLength={12}
                      value={toCity}
                      onChange={(e) => change(withCities(draft, e.target.value, fromCity))}
                      placeholder="例如：济南"
                    />
                  </label>
                  <label>
                    你在的城市
                    <input
                      maxLength={12}
                      value={fromCity}
                      onChange={(e) => change(withCities(draft, toCity, e.target.value))}
                      placeholder="例如：北京"
                    />
                  </label>
                </div>
              ) : view.amountInput ? (
                <label>
                  具体金额（元，可不填）
                  <input
                    type="number"
                    min="0"
                    max="9999"
                    step="1"
                    value={/^\d+$/.test(draft.answers[draft.question]) ? draft.answers[draft.question] : ''}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder={view.placeholder}
                  />
                </label>
              ) : (
                <label>
                  {draft.question === 0 || !view.freeText ? '写一点你愿意说的' : '想补充的话（可不填）'}
                  <textarea
                    rows={5}
                    maxLength={200}
                    value={draft.answers[draft.question]}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder={view.placeholder}
                  />
                </label>
              )}
              <p className="muted">
                答案只会加密保存在你的账号里，不会出现在公开愿签和分享内容中。
              </p>
            </>
          )}
          {draft.step === 3 && (
            <>
              <h2>一份小小的约定</h2>
              <p>接下来的十天，为{draft.name}做一点，也好好照顾自己。</p>
              <ul className="contract">
                <li>每天两件必做小事，每件不超过十分钟。</li>
                <li>拍一张照片或截图，把行动留作记录。</li>
                <li>周末有可选的小兼职，量力而行。</li>
                <li>到期后查看结果，完成全部必做才会盖章。</li>
              </ul>
              <label>
                签下你的称呼
                <input
                  value={signature}
                  maxLength={16}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="键入名字，同样是一份认真"
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                我愿意认真完成约定；五问会加密保存，照片仅自己可见。
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="editor-actions">
            <button
              className="secondary"
              disabled={draft.step === 0 && !draft.question}
              onClick={() =>
                draft.step === 2 && draft.question > 0
                  ? change({ question: draft.question - 1 })
                  : change({ step: draft.step - 1 })
              }
            >
              上一步
            </button>
            {draft.step === 2 && (
              <button
                className="text-button"
                disabled={!questionReady}
                onClick={() =>
                  draft.question < 4
                    ? change({ question: draft.question + 1 })
                    : change({ step: 3 })
                }
              >
                下一题
              </button>
            )}
            {draft.step < 3 ? (
              <button
                className="primary"
                disabled={
                  draft.step === 0
                    ? !draft.name.trim()
                    : draft.step === 1
                      ? !draft.text.trim()
                      : !questionReady
                }
                onClick={() =>
                  draft.step === 2 && draft.question < 4
                    ? change({ question: draft.question + 1 })
                    : change({ step: draft.step + 1 })
                }
              >
                下一步
              </button>
            ) : (
              <button
                className="primary"
                disabled={!agreed || !signature.trim() || busy}
                onClick={sign}
              >
                {busy ? '正在保存…' : '签下约定'}
              </button>
            )}
          </div>
          <PrivateNote />
        </Paper>
        <aside className="preview">
          <span className="eyebrow">你的愿签预览</span>
          <WishCard
            wish={{
              name: draft.name || 'TA',
              text: draft.text || '你的牵挂，会在这里变成一张愿签。',
              ai: draft.ai,
            }}
          />
          <Mascot small message="说不出口的话，可以慢慢写。" />
        </aside>
      </div>
    </div>
  );
}

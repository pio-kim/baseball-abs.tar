import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, transition, canInput, toPublic, DEFAULT_CONFIG } from '../state.js';

const P1 = { id: 'p1', seq: 1, x: 0, z: 0, verdict: 'strike' };

function endedWith(inning, pitches) {
  const s = createState();
  s.game = { inning, status: 'ended', pitches };
  return s;
}

test('시작 상태는 1회 idle이고 입력 불가다', () => {
  const s = createState();
  assert.equal(s.game.inning, 1);
  assert.equal(s.game.status, 'idle');
  assert.deepEqual(s.game.pitches, []);
  assert.equal(canInput(s), false);
});

test('기본 설정값은 DEFAULT_CONFIG를 따른다', () => {
  const s = createState();
  assert.deepEqual(s.zone, DEFAULT_CONFIG.zone);
  assert.deepEqual(s.placement, DEFAULT_CONFIG.placement);
});

test('설정을 주면 그 값으로 시작한다', () => {
  const s = createState({ zone: { aspect: 1.5 }, placement: { x: 0.1, y: 0.2, scale: 0.3 } });
  assert.equal(s.zone.aspect, 1.5);
  assert.equal(s.placement.x, 0.1);
});

test('idle에서 이닝 시작하면 live가 되고 입력 가능해진다', () => {
  const { state } = transition(createState(), { type: 'INNING_START' });
  assert.equal(state.game.status, 'live');
  assert.equal(canInput(state), true);
});

test('이닝 종료는 ended로 가고 저장 효과를 낸다', () => {
  const s = transition(createState(), { type: 'INNING_START' }).state;
  s.game.pitches = [P1];
  const { state, effects } = transition(s, { type: 'INNING_END' });
  assert.equal(state.game.status, 'ended');
  assert.equal(canInput(state), false);
  assert.deepEqual(effects, [{ type: 'SAVE_INNING', inning: 1, pitches: [P1] }]);
});

test('ended에서 이닝 시작은 같은 이닝을 이어가고 화면을 지우지 않는다', () => {
  const { state } = transition(endedWith(3, [P1]), { type: 'INNING_START' });
  assert.equal(state.game.inning, 3);
  assert.equal(state.game.status, 'live');
  assert.deepEqual(state.game.pitches, [P1]);
});

test('ended에서 다음 이닝은 이닝을 올리고 화면을 지우며 바로 live가 된다', () => {
  const { state } = transition(endedWith(3, [P1]), { type: 'INNING_NEXT' });
  assert.equal(state.game.inning, 4);
  assert.equal(state.game.status, 'live');
  assert.deepEqual(state.game.pitches, []);
});

test('live에서 다음 이닝은 무시되고 경고를 남긴다', () => {
  const s = transition(createState(), { type: 'INNING_START' }).state;
  const { state, effects } = transition(s, { type: 'INNING_NEXT' });
  assert.equal(state.game.inning, 1);
  assert.equal(state.game.status, 'live');
  assert.equal(effects[0].type, 'WARN');
});

test('idle에서 이닝 종료는 무시된다', () => {
  const { state, effects } = transition(createState(), { type: 'INNING_END' });
  assert.equal(state.game.status, 'idle');
  assert.equal(effects[0].type, 'WARN');
});

test('알 수 없는 액션은 무시되고 경고를 남긴다', () => {
  const s = createState();
  const { state, effects } = transition(s, { type: 'NOPE' });
  assert.equal(state, s);
  assert.equal(effects[0].type, 'WARN');
});

test('transition은 입력 상태를 변경하지 않는다', () => {
  const s = createState();
  transition(s, { type: 'INNING_START' });
  assert.equal(s.game.status, 'idle');
});

test('toPublic은 내부 필드를 노출하지 않는다', () => {
  const pub = toPublic(createState());
  assert.equal(pub.nextId, undefined);
  assert.equal(pub.undoStack, undefined);
  assert.ok(pub.game);
  assert.ok(pub.zone);
});

function live(pitches = []) {
  const s = transition(createState(), { type: 'INNING_START' }).state;
  return { ...s, game: { ...s.game, pitches } };
}

test('투구를 추가하면 seq 1, id p1, 판정이 붙는다', () => {
  const { state } = transition(live(), { type: 'PITCH_ADD', x: 0.3, z: -0.8 });
  assert.deepEqual(state.game.pitches, [
    { id: 'p1', seq: 1, x: 0.3, z: -0.8, verdict: 'strike' },
  ]);
});

test('존 밖 클릭은 볼로 판정된다', () => {
  const { state } = transition(live(), { type: 'PITCH_ADD', x: 1.4, z: 0.1 });
  assert.equal(state.game.pitches[0].verdict, 'ball');
});

test('투구를 연달아 추가하면 seq와 id가 증가한다', () => {
  let s = live();
  s = transition(s, { type: 'PITCH_ADD', x: 0, z: 0 }).state;
  s = transition(s, { type: 'PITCH_ADD', x: 0.5, z: 0.5 }).state;
  assert.deepEqual(s.game.pitches.map((p) => [p.id, p.seq]), [['p1', 1], ['p2', 2]]);
});

test('idle 상태의 투구 추가는 무시된다', () => {
  const { state, effects } = transition(createState(), { type: 'PITCH_ADD', x: 0, z: 0 });
  assert.deepEqual(state.game.pitches, []);
  assert.equal(effects[0].type, 'WARN');
});

test('ended 상태의 투구 추가는 무시된다', () => {
  const { state, effects } = transition(endedWith(2, []), { type: 'PITCH_ADD', x: 0, z: 0 });
  assert.deepEqual(state.game.pitches, []);
  assert.equal(effects[0].type, 'WARN');
});

test('공을 옮기면 판정이 다시 계산된다', () => {
  let s = transition(live(), { type: 'PITCH_ADD', x: 0, z: 0 }).state;
  assert.equal(s.game.pitches[0].verdict, 'strike');
  s = transition(s, { type: 'PITCH_MOVE', id: 'p1', x: 1.6, z: 0 }).state;
  assert.equal(s.game.pitches[0].x, 1.6);
  assert.equal(s.game.pitches[0].verdict, 'ball');
});

test('공을 옮겨도 seq는 유지된다', () => {
  let s = live();
  s = transition(s, { type: 'PITCH_ADD', x: 0, z: 0 }).state;
  s = transition(s, { type: 'PITCH_ADD', x: 0.2, z: 0.2 }).state;
  s = transition(s, { type: 'PITCH_MOVE', id: 'p1', x: 2, z: 2 }).state;
  assert.deepEqual(s.game.pitches.map((p) => p.seq), [1, 2]);
});

test('없는 id를 옮기려 하면 무시된다', () => {
  const s = transition(live(), { type: 'PITCH_ADD', x: 0, z: 0 }).state;
  const { state, effects } = transition(s, { type: 'PITCH_MOVE', id: 'nope', x: 1, z: 1 });
  assert.equal(state.game.pitches[0].x, 0);
  assert.equal(effects[0].type, 'WARN');
});

test('공을 삭제하면 seq가 재부여된다', () => {
  let s = live();
  for (const x of [0, 0.2, 0.4]) s = transition(s, { type: 'PITCH_ADD', x, z: 0 }).state;
  s = transition(s, { type: 'PITCH_DELETE', id: 'p2' }).state;
  assert.deepEqual(s.game.pitches.map((p) => [p.id, p.seq]), [['p1', 1], ['p3', 2]]);
});

test('없는 id를 삭제하려 하면 무시된다', () => {
  const s = transition(live(), { type: 'PITCH_ADD', x: 0, z: 0 }).state;
  const { state, effects } = transition(s, { type: 'PITCH_DELETE', id: 'nope' });
  assert.equal(state.game.pitches.length, 1);
  assert.equal(effects[0].type, 'WARN');
});

test('모두 지우면 pitches가 빈다', () => {
  let s = live();
  for (const x of [0, 0.2]) s = transition(s, { type: 'PITCH_ADD', x, z: 0 }).state;
  s = transition(s, { type: 'PITCH_CLEAR_ALL' }).state;
  assert.deepEqual(s.game.pitches, []);
});

test('투구 변경마다 되돌리기 스냅샷이 쌓인다', () => {
  let s = live();
  s = transition(s, { type: 'PITCH_ADD', x: 0, z: 0 }).state;
  assert.equal(s.undoStack.length, 1);
  s = transition(s, { type: 'PITCH_MOVE', id: 'p1', x: 0.1, z: 0 }).state;
  assert.equal(s.undoStack.length, 2);
  s = transition(s, { type: 'PITCH_DELETE', id: 'p1' }).state;
  assert.equal(s.undoStack.length, 3);
  s = transition(s, { type: 'PITCH_CLEAR_ALL' }).state;
  assert.equal(s.undoStack.length, 4);
});

import { UNDO_LIMIT } from '../state.js';

test('추가를 되돌리면 공이 사라진다', () => {
  let s = transition(live(), { type: 'PITCH_ADD', x: 0, z: 0 }).state;
  s = transition(s, { type: 'UNDO' }).state;
  assert.deepEqual(s.game.pitches, []);
});

test('이동을 되돌리면 원래 좌표와 판정이 복원된다', () => {
  let s = transition(live(), { type: 'PITCH_ADD', x: 0, z: 0 }).state;
  s = transition(s, { type: 'PITCH_MOVE', id: 'p1', x: 1.9, z: 0 }).state;
  assert.equal(s.game.pitches[0].verdict, 'ball');
  s = transition(s, { type: 'UNDO' }).state;
  assert.equal(s.game.pitches[0].x, 0);
  assert.equal(s.game.pitches[0].verdict, 'strike');
});

test('삭제를 되돌리면 공과 seq가 복원된다', () => {
  let s = live();
  for (const x of [0, 0.2, 0.4]) s = transition(s, { type: 'PITCH_ADD', x, z: 0 }).state;
  s = transition(s, { type: 'PITCH_DELETE', id: 'p2' }).state;
  s = transition(s, { type: 'UNDO' }).state;
  assert.deepEqual(s.game.pitches.map((p) => [p.id, p.seq]), [['p1', 1], ['p2', 2], ['p3', 3]]);
});

test('전체 삭제를 되돌리면 공이 모두 복원된다', () => {
  let s = live();
  for (const x of [0, 0.2]) s = transition(s, { type: 'PITCH_ADD', x, z: 0 }).state;
  s = transition(s, { type: 'PITCH_CLEAR_ALL' }).state;
  s = transition(s, { type: 'UNDO' }).state;
  assert.equal(s.game.pitches.length, 2);
});

test('되돌릴 내용이 없으면 경고를 남긴다', () => {
  const { state, effects } = transition(live(), { type: 'UNDO' });
  assert.deepEqual(state.game.pitches, []);
  assert.equal(effects[0].type, 'WARN');
});

test('되돌리기 스택은 UNDO_LIMIT를 넘지 않는다', () => {
  let s = live();
  for (let i = 0; i < UNDO_LIMIT + 5; i++) {
    s = transition(s, { type: 'PITCH_ADD', x: 0, z: 0 }).state;
  }
  assert.equal(s.undoStack.length, UNDO_LIMIT);
});

test('되돌리기는 nextId도 복원한다', () => {
  let s = transition(live(), { type: 'PITCH_ADD', x: 0, z: 0 }).state;
  assert.equal(s.nextId, 2);
  s = transition(s, { type: 'UNDO' }).state;
  assert.equal(s.nextId, 1);
});

const SAVED = [{ seq: 1, x: 0.1, z: 0.2, verdict: 'strike' }];

test('다시보기에 들어가면 입력이 잠긴다', () => {
  let s = live();
  s = transition(s, { type: 'REVIEW_ENTER', inning: 1, pitches: SAVED }).state;
  assert.deepEqual(s.review, { inning: 1, pitches: SAVED });
  assert.equal(canInput(s), false);
});

test('다시보기 중 투구 추가는 무시되고 라이브 화면이 변하지 않는다', () => {
  let s = transition(live(), { type: 'PITCH_ADD', x: 0, z: 0 }).state;
  s = transition(s, { type: 'REVIEW_ENTER', inning: 1, pitches: SAVED }).state;
  const { state, effects } = transition(s, { type: 'PITCH_ADD', x: 0.9, z: 0.9 });
  assert.equal(state.game.pitches.length, 1);
  assert.equal(state.game.pitches[0].x, 0);
  assert.equal(effects[0].type, 'WARN');
});

test('다시보기를 나가면 라이브 상태가 온전히 돌아온다', () => {
  let s = transition(live(), { type: 'PITCH_ADD', x: 0, z: 0 }).state;
  s = transition(s, { type: 'REVIEW_ENTER', inning: 1, pitches: SAVED }).state;
  s = transition(s, { type: 'REVIEW_EXIT' }).state;
  assert.equal(s.review, null);
  assert.equal(s.game.status, 'live');
  assert.equal(s.game.pitches.length, 1);
  assert.equal(canInput(s), true);
});

test('idle 상태에서도 다시보기에 들어갈 수 있다', () => {
  const { state } = transition(createState(), { type: 'REVIEW_ENTER', inning: 2, pitches: SAVED });
  assert.equal(state.review.inning, 2);
});

test('존 종횡비를 바꾸면 설정 저장 효과가 난다', () => {
  const { state, effects } = transition(createState(), { type: 'ZONE_SET', aspect: 1.4 });
  assert.equal(state.zone.aspect, 1.4);
  assert.deepEqual(effects, [
    { type: 'SAVE_CONFIG', zone: { aspect: 1.4 }, placement: DEFAULT_CONFIG.placement },
  ]);
});

test('송출 배치를 바꾸면 설정 저장 효과가 난다', () => {
  const { state, effects } = transition(createState(), { type: 'PLACEMENT_SET', x: 0.6, y: 0.4, scale: 0.3 });
  assert.deepEqual(state.placement, { x: 0.6, y: 0.4, scale: 0.3 });
  assert.equal(effects[0].type, 'SAVE_CONFIG');
});

test('송출 배치 변경은 어떤 공의 판정도 바꾸지 않는다', () => {
  let s = live();
  s = transition(s, { type: 'PITCH_ADD', x: 0.99, z: 0.99 }).state;
  s = transition(s, { type: 'PITCH_ADD', x: 1.01, z: 0 }).state;
  const before = s.game.pitches.map((p) => p.verdict);
  s = transition(s, { type: 'PLACEMENT_SET', x: 0.1, y: 0.9, scale: 0.9 }).state;
  assert.deepEqual(s.game.pitches.map((p) => p.verdict), before);
  assert.deepEqual(before, ['strike', 'ball']);
});

test('종횡비가 숫자가 아니면 무시하고 경고한다', () => {
  const base = createState();
  for (const aspect of [null, NaN, '1.4', undefined, Infinity]) {
    const { state, effects } = transition(base, { type: 'ZONE_SET', aspect });
    assert.equal(state.zone.aspect, DEFAULT_CONFIG.zone.aspect);
    assert.equal(effects.length, 1);
    assert.equal(effects[0].type, 'WARN');
  }
});

test('배치값이 숫자가 아니면 무시하고 경고한다', () => {
  const base = createState();
  const bad = [
    { x: null, y: 0.4, scale: 0.3 },
    { x: 0.6, y: NaN, scale: 0.3 },
    { x: 0.6, y: 0.4, scale: '0.3' },
    { x: 0.6, y: 0.4 },
  ];
  for (const payload of bad) {
    const { state, effects } = transition(base, { type: 'PLACEMENT_SET', ...payload });
    assert.deepEqual(state.placement, DEFAULT_CONFIG.placement);
    assert.equal(effects.length, 1);
    assert.equal(effects[0].type, 'WARN');
  }
});

test('좌표가 숫자가 아니면 공이 추가되지 않고 경고한다', () => {
  const base = live();
  for (const payload of [{ x: null, z: 0 }, { x: 0, z: NaN }, { x: '0', z: 0 }, { z: 0 }]) {
    const { state, effects } = transition(base, { type: 'PITCH_ADD', ...payload });
    assert.equal(state.game.pitches.length, 0);
    assert.equal(effects.length, 1);
    assert.equal(effects[0].type, 'WARN');
  }
});

test('좌표가 숫자가 아니면 공이 이동하지 않고 경고한다', () => {
  const base = transition(live(), { type: 'PITCH_ADD', x: 0.2, z: 0.2 }).state;
  const { state, effects } = transition(base, { type: 'PITCH_MOVE', id: 'p1', x: NaN, z: 0 });
  assert.deepEqual(state.game.pitches, base.game.pitches);
  assert.equal(effects[0].type, 'WARN');
});

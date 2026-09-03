import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusMessage } from '../public/console-status.js';
import { createState, transition } from '../state.js';

const liveState = transition(createState(), { type: 'INNING_START' }).state;

test('연결이 끊기면 그 사실이 최우선으로 표시된다', () => {
  assert.equal(
    statusMessage({ state: liveState, canInput: true, connected: false }),
    '서버 연결 끊김 — 재연결 중…',
  );
});

test('idle이면 이닝 시작을 안내한다', () => {
  assert.equal(
    statusMessage({ state: createState(), canInput: false, connected: true }),
    '이닝 시작을 눌러주세요',
  );
});

test('ended면 이닝 번호와 두 선택지를 안내한다', () => {
  const s = createState();
  s.game = { inning: 3, status: 'ended', pitches: [] };
  assert.equal(
    statusMessage({ state: s, canInput: false, connected: true }),
    '3회 종료됨 — 이닝 시작 또는 다음 이닝',
  );
});

test('다시보기 중이면 그 사실이 상태보다 먼저 표시된다', () => {
  const s = { ...liveState, review: { inning: 1, pitches: [] } };
  assert.equal(
    statusMessage({ state: s, canInput: false, connected: true }),
    '1회 다시보기 중 — 라이브 복귀',
  );
});

test('입력 가능하면 문구가 없다', () => {
  assert.equal(statusMessage({ state: liveState, canInput: true, connected: true }), null);
});

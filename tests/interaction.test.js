import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hitTest,
  isDrag,
  resolvePointerUp,
  resolvePointerMove,
  HIT_RADIUS,
  DRAG_THRESHOLD,
} from '../public/interaction.js';
import { zoneRect } from '../public/zone.js';

const rect = zoneRect(500, 300, 100, 1.0);
// x=0,z=0 → (500,300) / x=1,z=0 → (600,300)
const pitches = [
  { id: 'p1', x: 0, z: 0 },
  { id: 'p2', x: 1, z: 0 },
];

test('공 중심을 누르면 그 공이 잡힌다', () => {
  assert.equal(hitTest(pitches, 500, 300, rect), 'p1');
  assert.equal(hitTest(pitches, 600, 300, rect), 'p2');
});

test('반경 정확히 14px은 잡힌다', () => {
  assert.equal(hitTest(pitches, 514, 300, rect), 'p1');
});

test('반경 15px은 잡히지 않는다', () => {
  assert.equal(hitTest(pitches, 515, 300, rect), null);
});

test('두 공이 겹치면 더 가까운 공이 잡힌다', () => {
  const close = [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 0.1, z: 0 }]; // (500,300), (510,300)
  assert.equal(hitTest(close, 508, 300, rect), 'b');
  assert.equal(hitTest(close, 502, 300, rect), 'a');
});

test('빈 곳은 null이다', () => {
  assert.equal(hitTest(pitches, 300, 300, rect), null);
  assert.equal(hitTest([], 500, 300, rect), null);
});

test('2px 이동은 드래그가 아니다', () => {
  assert.equal(isDrag(100, 100, 102, 100), false);
});

test('임계값 3px 이동은 드래그다', () => {
  assert.equal(isDrag(100, 100, 103, 100), true);
});

test('4px 이동은 드래그다', () => {
  assert.equal(isDrag(100, 100, 100, 104), true);
});

test('상수는 스펙 값과 같다', () => {
  assert.equal(HIT_RADIUS, 14);
  assert.equal(DRAG_THRESHOLD, 3);
});

test('기존 공을 임계값 이상 끌면 놓는 지점으로 이동한다', () => {
  const action = resolvePointerUp({ px: 500, py: 300, hitId: 'p1' }, 540, 320);
  assert.deepEqual(action, { kind: 'move', id: 'p1', px: 540, py: 320 });
});

test('기존 공을 임계값 미만 움직이면 선택만 하고 아무 액션도 없다', () => {
  assert.equal(resolvePointerUp({ px: 500, py: 300, hitId: 'p1' }, 502, 300), null);
});

test('기존 공을 전혀 움직이지 않으면 아무 액션도 없다', () => {
  assert.equal(resolvePointerUp({ px: 500, py: 300, hitId: 'p1' }, 500, 300), null);
});

test('빈 곳을 누르고 놓으면 누른 지점에 공이 추가된다', () => {
  const action = resolvePointerUp({ px: 420, py: 260, hitId: null }, 420, 260);
  assert.deepEqual(action, { kind: 'add', px: 420, py: 260 });
});

test('빈 곳을 누르고 멀리 끌어도 추가 좌표는 누른 지점이다', () => {
  const action = resolvePointerUp({ px: 420, py: 260, hitId: null }, 610, 350);
  assert.deepEqual(action, { kind: 'add', px: 420, py: 260 });
});

test('드래그 중에는 어떤 서버 액션도 만들어지지 않는다', () => {
  assert.equal(resolvePointerMove(), null);
  assert.equal(resolvePointerMove({ px: 0, py: 0, hitId: 'p1' }, 999, 999), null);
});

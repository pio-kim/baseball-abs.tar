import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneRect, toNormalized, toPixels, judge } from '../public/zone.js';

// 중심 (500, 300), 반높이 100px, 종횡비 1.0 → 존은 400~600 x 200~400
const rect = zoneRect(500, 300, 100, 1.0);

test('존 중심은 (0, 0)으로 정규화된다', () => {
  assert.deepEqual(toNormalized(500, 300, rect), { x: 0, z: 0 });
});

test('화면 위쪽이 z 양수다 (부호 반전)', () => {
  assert.equal(toNormalized(500, 200, rect).z, 1);
  assert.equal(toNormalized(500, 400, rect).z, -1);
});

test('toNormalized와 toPixels는 왕복 변환된다', () => {
  const { x, z } = toNormalized(437, 218, rect);
  const { px, py } = toPixels(x, z, rect);
  assert.ok(Math.abs(px - 437) < 1e-9);
  assert.ok(Math.abs(py - 218) < 1e-9);
});

test('종횡비가 커지면 존 폭만 넓어진다', () => {
  const wide = zoneRect(500, 300, 100, 2.0);
  assert.equal(wide.halfW, 200);
  assert.equal(wide.halfH, 100);
});

test('존 경계는 종횡비와 무관하게 정규화 ±1이다', () => {
  const wide = zoneRect(500, 300, 100, 2.0);
  assert.equal(toNormalized(700, 300, wide).x, 1);
  assert.equal(toNormalized(300, 300, wide).x, -1);
  assert.equal(toNormalized(500, 200, wide).z, 1);
});

test('경계값은 스트라이크다', () => {
  assert.equal(judge(1, 0), 'strike');
  assert.equal(judge(-1, 0), 'strike');
  assert.equal(judge(0, 1), 'strike');
  assert.equal(judge(0, -1), 'strike');
  assert.equal(judge(1, 1), 'strike');
});

test('경계를 아주 조금 넘으면 볼이다', () => {
  assert.equal(judge(1.0001, 0), 'ball');
  assert.equal(judge(0, -1.0001), 'ball');
  assert.equal(judge(-1.5, 0.5), 'ball');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldExecute, CONFIRM_WINDOW_MS } from '../public/confirm.js';

test('확인 창은 3초다', () => {
  assert.equal(CONFIRM_WINDOW_MS, 3000);
});

test('처음 누른 것은 실행되지 않는다', () => {
  assert.equal(shouldExecute(null, 1000), false);
});

test('3초 안에 다시 누르면 실행된다', () => {
  assert.equal(shouldExecute(1000, 1500), true);
  assert.equal(shouldExecute(1000, 4000), true);
});

test('3초를 넘겨 누르면 실행되지 않는다', () => {
  assert.equal(shouldExecute(1000, 4001), false);
});

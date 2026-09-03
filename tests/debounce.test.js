import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debounce } from '../public/debounce.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('연달아 호출하면 마지막 인자로 한 번만 실행된다', async () => {
  const calls = [];
  const fn = debounce((v) => calls.push(v), 20);
  fn(1);
  fn(2);
  fn(3);
  await sleep(60);
  assert.deepEqual(calls, [3]);
});

test('간격을 두면 각각 실행된다', async () => {
  const calls = [];
  const fn = debounce((v) => calls.push(v), 20);
  fn('a');
  await sleep(60);
  fn('b');
  await sleep(60);
  assert.deepEqual(calls, ['a', 'b']);
});

test('cancel하면 실행되지 않는다', async () => {
  const calls = [];
  const fn = debounce((v) => calls.push(v), 20);
  fn(1);
  fn.cancel();
  await sleep(60);
  assert.deepEqual(calls, []);
});

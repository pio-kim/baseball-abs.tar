import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDelay, connect } from '../public/ws-client.js';

test('첫 재시도는 500ms다', () => {
  assert.equal(nextDelay(0), 500);
});

test('재시도마다 두 배로 늘어난다', () => {
  assert.equal(nextDelay(1), 1000);
  assert.equal(nextDelay(2), 2000);
  assert.equal(nextDelay(3), 4000);
});

test('최대 5000ms에서 멈춘다', () => {
  assert.equal(nextDelay(4), 5000);
  assert.equal(nextDelay(20), 5000);
});

test('dispose는 대기 중인 재연결 타이머를 취소한다', async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 스텁 WebSocket 설정
  const originalWebSocket = globalThis.WebSocket;
  let wsCount = 0;
  let lastWsInstance = null;

  globalThis.WebSocket = class FakeWebSocket {
    constructor() {
      wsCount += 1;
      lastWsInstance = this;
      this.handlers = {};
    }

    addEventListener(event, handler) {
      this.handlers[event] = handler;
    }

    close() {
      // close 핸들러를 비동기로 호출 (실제 WebSocket처럼)
      if (this.handlers.close) {
        setImmediate(() => this.handlers.close());
      }
    }
  };

  try {
    // 연결 시도
    const client = connect('ws://fake', {});

    // 첫 소켓이 close 되게 함 → 재연결 타이머 예약
    if (lastWsInstance) {
      lastWsInstance.close();
    }

    // 재연결 타이머가 발화하기 전에 dispose 호출
    await sleep(100); // close 이벤트가 처리되길 기다림
    client.dispose();

    // 첫 번째 백오프 (500ms)보다 길게 기다림
    await sleep(600);

    // dispose로 타이머가 취소되었으므로 재연결되지 않음
    // 초기 연결(1) + dispose 후 재연결 없음 = 총 1개
    assert.equal(wsCount, 1, 'dispose 후에도 새 소켓이 생성되면 안 됨');
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test('dispose 이후에는 재연결하지 않는다', async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 스텁 WebSocket 설정
  const originalWebSocket = globalThis.WebSocket;
  let wsCount = 0;
  const handlersMap = new Map();

  globalThis.WebSocket = class FakeWebSocket {
    constructor() {
      wsCount += 1;
      this.handlers = {};
    }

    addEventListener(event, handler) {
      this.handlers[event] = handler;
    }

    close() {
      // close 핸들러 호출
      if (this.handlers.close) {
        this.handlers.close();
      }
    }

    get readyState() {
      return 1; // OPEN
    }
  };

  try {
    // 정상 연결 설정
    const client = connect('ws://fake', {});

    // dispose 호출
    client.dispose();

    // 장시간 기다림 (어떤 백오프 시간이든 충분히 길게)
    await sleep(1000);

    // dispose 후에는 정확히 1개의 소켓만 생성되어야 함
    assert.equal(wsCount, 1, 'dispose 후에는 새 소켓이 생성되면 안 됨');
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

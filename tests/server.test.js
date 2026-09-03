import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../server.js';
import { saveInning } from '../store.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'abs-server-'));
}

async function boot() {
  const dir = tmpDir();
  const srv = startServer({ port: 0, dataDir: dir, configPath: path.join(dir, 'config.json') });
  await srv.ready;
  return { srv, dir };
}

// 이 샌드박스의 루프백 소켓은 핸드셰이크 응답과 서버가 연결 직후 보내는 첫
// 메시지를 같은 'data' 이벤트로 합쳐 전달하는 경우가 있다. 그 경우 'open'과
// 'message'가 같은 동기 실행 구간 안에서 함께 발생해, await로 리스너를 나중에
// 붙이면 그 사이에 지나간 메시지를 영영 놓친다(실측 재현: server.js 없이도
// 재현되는 ws 라이브러리 자체의 동작). 그래서 메시지 리스너를 소켓 생성 시점에
// 한 번만 동기로 붙이고 큐에 쌓아 두며, nextMessage는 큐에서 꺼내거나 다음
// 도착을 기다린다. 각 테스트의 호출 순서·검증 내용은 브리프 그대로다.
function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.__queue = [];
  ws.__waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (ws.__waiters.length > 0) ws.__waiters.shift()(msg);
    else ws.__queue.push(msg);
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws) {
  if (ws.__queue.length > 0) return Promise.resolve(ws.__queue.shift());
  return new Promise((resolve) => ws.__waiters.push(resolve));
}

test('접속하면 즉시 전체 상태를 받는다', async () => {
  const { srv } = await boot();
  const ws = await connect(srv.port);
  const msg = await nextMessage(ws);
  assert.equal(msg.type, 'STATE');
  assert.equal(msg.state.game.status, 'idle');
  assert.equal(msg.canInput, false);
  assert.deepEqual(msg.innings, []);
  ws.close();
  await srv.close();
});

test('내부 필드는 전송되지 않는다', async () => {
  const { srv } = await boot();
  const ws = await connect(srv.port);
  const msg = await nextMessage(ws);
  assert.equal(msg.state.undoStack, undefined);
  assert.equal(msg.state.nextId, undefined);
  ws.close();
  await srv.close();
});

test('두 클라이언트가 동일한 상태를 받는다', async () => {
  const { srv } = await boot();
  const a = await connect(srv.port);
  const b = await connect(srv.port);
  await nextMessage(a);
  await nextMessage(b);

  a.send(JSON.stringify({ type: 'INNING_START' }));
  await Promise.all([nextMessage(a), nextMessage(b)]);

  // 두 리스너를 먼저 붙인 뒤에 전송한다 — 등록 순서가 결과에 영향을 주지 않게
  const pending = Promise.all([nextMessage(a), nextMessage(b)]);
  a.send(JSON.stringify({ type: 'PITCH_ADD', x: 1.5, z: 0 }));
  const [ma, mb] = await pending;

  assert.deepEqual(ma.state, mb.state);
  assert.equal(ma.state.game.pitches[0].verdict, 'ball');
  a.close();
  b.close();
  await srv.close();
});

test('늦게 접속한 클라이언트도 현재 상태를 받는다', async () => {
  const { srv } = await boot();
  const a = await connect(srv.port);
  await nextMessage(a);
  a.send(JSON.stringify({ type: 'INNING_START' }));
  await nextMessage(a);

  const b = await connect(srv.port);
  const msg = await nextMessage(b);
  assert.equal(msg.state.game.status, 'live');
  assert.equal(msg.canInput, true);
  a.close();
  b.close();
  await srv.close();
});

test('이닝 종료가 파일에 저장되고 innings 목록에 나타난다', async () => {
  const { srv, dir } = await boot();
  const ws = await connect(srv.port);
  await nextMessage(ws);
  ws.send(JSON.stringify({ type: 'INNING_START' }));
  await nextMessage(ws);
  ws.send(JSON.stringify({ type: 'PITCH_ADD', x: 0, z: 0 }));
  await nextMessage(ws);
  ws.send(JSON.stringify({ type: 'INNING_END' }));
  const msg = await nextMessage(ws);

  assert.deepEqual(msg.innings, [1]);
  const date = new Date().toISOString().slice(0, 10);
  assert.ok(fs.existsSync(path.join(dir, `${date}.json`)));
  ws.close();
  await srv.close();
});

test('REVIEW_ENTER는 저장된 기록을 실어 온다', async () => {
  const dir = tmpDir();
  const date = new Date().toISOString().slice(0, 10);
  saveInning(dir, date, 2, [{ seq: 1, x: 0.5, z: 0.5, verdict: 'strike' }]);
  const srv = startServer({ port: 0, dataDir: dir, configPath: path.join(dir, 'config.json') });
  await srv.ready;

  const ws = await connect(srv.port);
  await nextMessage(ws);
  ws.send(JSON.stringify({ type: 'REVIEW_ENTER', inning: 2 }));
  const msg = await nextMessage(ws);
  assert.equal(msg.state.review.inning, 2);
  assert.equal(msg.state.review.pitches.length, 1);
  assert.equal(msg.canInput, false);
  ws.close();
  await srv.close();
});

test('잘못된 JSON은 서버를 죽이지 않는다', async () => {
  const { srv } = await boot();
  const ws = await connect(srv.port);
  await nextMessage(ws);
  ws.send('이건 JSON이 아니다');
  ws.send(JSON.stringify({ type: 'INNING_START' }));
  const msg = await nextMessage(ws);
  assert.equal(msg.state.game.status, 'live');
  ws.close();
  await srv.close();
});

test('배치 보정값이 config 파일에 저장된다', async () => {
  const { srv, dir } = await boot();
  const ws = await connect(srv.port);
  await nextMessage(ws);
  ws.send(JSON.stringify({ type: 'PLACEMENT_SET', x: 0.7, y: 0.3, scale: 0.4 }));
  await nextMessage(ws);
  // 브로드캐스트는 즉시지만 파일 저장은 200ms 디바운스된다(슬라이더 드래그로
  // 초당 수십 번 쓰는 것을 막기 위한 것). 저장이 일어날 시간을 준 뒤 확인한다.
  await new Promise((r) => setTimeout(r, 300));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.deepEqual(cfg.placement, { x: 0.7, y: 0.3, scale: 0.4 });
  ws.close();
  await srv.close();
});

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createState, transition, toPublic, canInput } from './state.js';
import * as store from './store.js';
// DOM에 의존하지 않는 순수 유틸이므로 서버에서 그대로 재사용한다.
import { debounce } from './public/debounce.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const WS_OPEN = 1;

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function startServer({
  port = 3000,
  dataDir = path.join(HERE, 'data'),
  configPath = path.join(HERE, 'config.json'),
  publicDir = path.join(HERE, 'public'),
} = {}) {
  let state = createState(store.loadConfig(configPath));

  const httpServer = http.createServer((req, res) => {
    const url = req.url === '/' ? '/console.html' : req.url.split('?')[0];
    const file = path.join(publicDir, path.normalize(url));
    if (!file.startsWith(publicDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('없는 경로입니다');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ server: httpServer });

  // 브로드캐스트마다 기록 파일을 다시 읽을 이유가 없다. 날짜가 바뀌면(자정 넘김)
  // 캐시가 다른 날의 목록을 들고 있게 되므로 날짜도 함께 보관한다.
  let inningsCache = null; // { date, list }
  function innings() {
    const date = today();
    if (inningsCache === null || inningsCache.date !== date) {
      inningsCache = { date, list: store.listInnings(dataDir, date) };
    }
    return inningsCache.list;
  }

  function snapshot() {
    return JSON.stringify({
      type: 'STATE',
      state: toPublic(state),
      canInput: canInput(state),
      innings: innings(),
    });
  }

  function broadcast() {
    const msg = snapshot();
    for (const client of wss.clients) {
      if (client.readyState === WS_OPEN) client.send(msg);
    }
  }

  // 슬라이더 드래그는 초당 수십 번 SAVE_CONFIG를 낸다. 저장만 묶고
  // 브로드캐스트는 즉시 유지해야 송출 반응성이 떨어지지 않는다.
  let pendingConfig = null; // 아직 파일에 쓰이지 않은 마지막 보정값
  const saveConfigDebounced = debounce(() => {
    const cfg = pendingConfig;
    pendingConfig = null;
    try {
      store.saveConfig(configPath, cfg);
    } catch (err) {
      console.error('설정 저장 실패:', err.message);
    }
  }, 200);

  function applyEffects(effects) {
    for (const e of effects) {
      if (e.type === 'SAVE_INNING') {
        // 저장 실패가 이닝 진행을 막아서는 안 된다.
        try {
          store.saveInning(dataDir, today(), e.inning, e.pitches);
        } catch (err) {
          console.error('이닝 저장 실패:', err.message);
        }
        inningsCache = null;
      } else if (e.type === 'SAVE_CONFIG') {
        pendingConfig = { zone: e.zone, placement: e.placement };
        saveConfigDebounced();
      } else if (e.type === 'WARN') {
        console.warn('무시된 액션:', e.message);
      }
    }
  }

  function dispatch(action) {
    let a = action;
    if (a.type === 'REVIEW_ENTER') {
      const pitches = store.loadInning(dataDir, today(), a.inning);
      if (!pitches) {
        console.warn(`${a.inning}회 기록이 없습니다`);
        return;
      }
      a = { ...a, pitches };
    }
    const result = transition(state, a);
    state = result.state;
    applyEffects(result.effects);
    broadcast();
  }

  wss.on('connection', (ws) => {
    ws.send(snapshot());
    ws.on('message', (raw) => {
      let action;
      try {
        action = JSON.parse(raw.toString());
      } catch {
        console.warn('JSON 파싱 실패, 메시지를 무시합니다');
        return;
      }
      if (action && typeof action.type === 'string') dispatch(action);
    });
  });

  // listen은 비동기다. port: 0으로 띄우는 테스트가 실제 포트를 알아야 하므로
  // ready를 기다린 뒤 port를 읽는다.
  let boundPort = port;
  const ready = new Promise((resolve) => {
    httpServer.once('listening', () => {
      boundPort = httpServer.address().port;
      resolve();
    });
  });
  // 인증이 없다. 기본은 루프백만 — 같은 네트워크의 누구든 콘솔을 열어
  // 생방송 그래픽을 조작하는 일을 막는다. OBS는 같은 머신에서 돌기 때문에
  // 기능 손실이 없다. 노출은 HOST로 명시적으로만.
  httpServer.listen(port, process.env.HOST ?? '127.0.0.1');

  return {
    get port() {
      return boundPort;
    },
    ready,
    close: () =>
      new Promise((resolve) => {
        // 대기 중인 저장을 그냥 버리면 마지막 보정값이 유실된다.
        // 동기로 한 번 쓰고 나서 타이머를 취소한다.
        if (pendingConfig !== null) {
          try {
            store.saveConfig(configPath, pendingConfig);
          } catch (err) {
            console.error('설정 저장 실패:', err.message);
          }
          pendingConfig = null;
        }
        saveConfigDebounced.cancel();
        for (const c of wss.clients) c.terminate();
        wss.close(() => httpServer.close(resolve));
      }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const srv = startServer({ port: Number(process.env.PORT ?? 3000) });
  await srv.ready;
  console.log(`콘솔:     http://localhost:${srv.port}/console.html`);
  console.log(`오버레이: http://localhost:${srv.port}/overlay.html`);
}

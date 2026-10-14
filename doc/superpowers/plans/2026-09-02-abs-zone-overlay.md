# 야구 ABS 존 오버레이 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오퍼레이터가 브라우저에서 클릭한 지점을 ABS 스트라이크 존 좌표로 변환해 OBS 송출 화면에 오버레이하고, 이닝 단위로 기록·수정·다시보기를 지원하는 로컬 웹 애플리케이션을 만든다.

**Architecture:** 순수 모듈(`zone.js` 좌표·판정, `interaction.js` 히트 테스트, `state.js` 상태 기계, `store.js` 파일 I/O)을 먼저 완성하고 테스트로 고정한 뒤, `server.js`가 이들을 조립해 WebSocket으로 전체 상태를 브로드캐스트한다. 화면은 `overlay.html`(송출, 렌더링 전용)과 `console.html`(오퍼레이터, 입력·편집)로 나뉘며 둘 다 서버 상태를 받아 전체를 다시 그린다. 판정은 서버가 단독으로 수행한다.

**Tech Stack:** Node.js 20 (ESM), `ws` 8.x, 바닐라 JS + Canvas 2D, `node:test`. 빌드 단계 없음.

**Spec:** `docs/superpowers/specs/2026-09-02-abs-zone-overlay-design.md`

## Global Constraints

- Node.js 20 이상. `package.json`에 `"type": "module"`. 모든 파일 ESM (`import`/`export`).
- **런타임 의존성은 `ws` 하나만.** 프레임워크·번들러·트랜스파일러를 추가하지 않는다.
- 테스트는 `node:test` + `node:assert/strict`만 사용한다. 테스트 러너를 추가하지 않는다.
- **사용자에게 보이는 모든 문구는 한글.** 코드 식별자·로그는 영문 허용.
- 정규화 좌표 경계는 `±1`. 판정은 `|x| ≤ 1 && |z| ≤ 1 → 'strike'`.
- 상수 고정값: `HIT_RADIUS = 14`, `DRAG_THRESHOLD = 3`, `UNDO_LIMIT = 20`, 2단 확인 창 `3000`ms, 방향키 디바운스 `300`ms, 재연결 백오프 최대 `5000`ms.
- 오버레이 캔버스 기준 해상도 `1920 × 1080`. 기본 포트 `3000`.
- 작업 루트는 `/home/ec2-user/claude-lab/abs-overlay/`. 이 디렉터리에서 `git init`한다 (상위 `claude-lab`은 git 저장소가 아니다).

## 스펙과의 차이 (의도된 정제)

스펙을 구현으로 옮기면서 다음을 조정했다. 설계 결정은 바뀌지 않았고, 테스트 가능성을 위해 경계를 다시 그은 것이다.

| 항목 | 스펙 | 계획 | 이유 |
|---|---|---|---|
| 히트 테스트 / 드래그 임계값 | `state.js` 테스트에 포함 | `public/interaction.js`로 분리 | 콘솔 측 로직이며 서버 상태와 무관하다. 순수 함수로 떼어내면 DOM 없이 테스트된다 |
| 입력 불가 문구 | 콘솔 안에 구현 | `public/console-status.js`로 분리 | 문구 선택 규칙(우선순위)이 조건 분기라 테스트 대상이다 |
| 재연결 백오프 | 서술만 | `public/ws-client.js`, 지연 계산은 순수 함수 | 백오프 계산을 테스트로 고정한다 |
| 2단 확인 | 서술만 | `public/confirm.js`의 순수 판정 함수 | 시간 창 판정을 테스트로 고정한다 |
| 방향키 이동 송출 | "즉시 반영, 스냅샷만 디바운스" | **전송 자체를 300ms 디바운스** | 상태 기계에 시계를 넣지 않아도 같은 결과를 얻는다. 1px 이동의 300ms 지연은 시각적으로 감지되지 않는다 |

---

## 파일 구조

```
abs-overlay/
  package.json           의존성·스크립트
  .gitignore             node_modules, data/, config.json
  server.js              HTTP 정적 서버 + WS 허브. 상태 보유·부수효과 실행
  state.js               상태 기계 (순수). 전이·되돌리기·입력 게이트
  store.js               이닝 기록·설정 ↔ JSON 파일 (I/O만)
  public/
    zone.js              좌표 변환 + 스트라이크 판정 (순수)
    interaction.js       히트 테스트 + 드래그 임계값 (순수)
    console-status.js    입력 불가 문구 선택 (순수)
    confirm.js           2단 확인 시간 창 판정 (순수)
    debounce.js          디바운스 유틸
    ws-client.js         WS 연결 + 지수 백오프 재연결
    overlay.html         OBS 브라우저 소스 진입점
    overlay.js           송출 렌더링 (입력 없음)
    console.html         오퍼레이터 콘솔 진입점
    console.css          콘솔 레이아웃
    console.js           콘솔 상태·이벤트·렌더링
  tests/
    zone.test.js
    interaction.test.js
    state.test.js
    store.test.js
    server.test.js
    console-status.test.js
    confirm.test.js
    debounce.test.js
    ws-client.test.js
  README.md              실행 방법 + OBS 설정 + 수동 검증 체크리스트
```

**의존 방향은 한 방향이다.** `public/*`의 순수 모듈은 아무것도 import하지 않거나 `zone.js`만 import한다. `state.js`는 `zone.js`만, `store.js`는 `state.js`의 상수만, `server.js`가 전부를 조립한다. 화면 코드는 서버 코드를 import하지 않는다.

---

## Task 1: 프로젝트 초기화 + `zone.js` (좌표 변환·판정)

**Files:**
- Create: `abs-overlay/package.json`
- Create: `abs-overlay/.gitignore`
- Create: `abs-overlay/public/zone.js`
- Test: `abs-overlay/tests/zone.test.js`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `zoneRect(cx, cy, halfH, aspect) → { cx, cy, halfW, halfH }` — 존 사각형. `aspect`는 폭/높이, `halfW = halfH * aspect`
  - `toNormalized(px, py, rect) → { x, z }`
  - `toPixels(x, z, rect) → { px, py }`
  - `judge(x, z) → 'strike' | 'ball'`

- [ ] **Step 1: 디렉터리와 프로젝트 파일 생성**

```bash
mkdir -p /home/ec2-user/claude-lab/abs-overlay/public /home/ec2-user/claude-lab/abs-overlay/tests
cd /home/ec2-user/claude-lab/abs-overlay
git init
npm install ws@^8.18.0
```

`package.json`을 아래 내용으로 덮어쓴다:

```json
{
  "name": "abs-overlay",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "start": "node server.js"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

`.gitignore`:

```
node_modules/
data/
config.json
*.tmp
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/zone.test.js`:

```js
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
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../public/zone.js'`

- [ ] **Step 4: 최소 구현 작성**

`public/zone.js`:

```js
// 정규화 존 좌표계
//   x: 좌우. 0 = 존 중앙, ±1 = 존 좌우 경계
//   z: 상하. 0 = 존 중앙, +1 = 존 상단, -1 = 존 하단
// 화면 y축은 아래로 증가하므로 z는 부호가 반대다.
// 이 부호 반전은 이 파일 안에만 존재해야 한다.

export function zoneRect(cx, cy, halfH, aspect) {
  return { cx, cy, halfW: halfH * aspect, halfH };
}

export function toNormalized(px, py, rect) {
  return { x: (px - rect.cx) / rect.halfW, z: (rect.cy - py) / rect.halfH };
}

export function toPixels(x, z, rect) {
  return { px: rect.cx + x * rect.halfW, py: rect.cy - z * rect.halfH };
}

export function judge(x, z) {
  return Math.abs(x) <= 1 && Math.abs(z) <= 1 ? 'strike' : 'ball';
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 7 tests

- [ ] **Step 6: 커밋**

```bash
git add package.json package-lock.json .gitignore public/zone.js tests/zone.test.js
git commit -m "feat: 정규화 존 좌표 변환과 스트라이크 판정 추가"
```

---

## Task 2: `interaction.js` (히트 테스트 + 드래그 임계값)

**Files:**
- Create: `abs-overlay/public/interaction.js`
- Test: `abs-overlay/tests/interaction.test.js`

**Interfaces:**
- Consumes: `zone.js`의 `toPixels`, `zoneRect`
- Produces:
  - `HIT_RADIUS = 14`, `DRAG_THRESHOLD = 3`
  - `hitTest(pitches, px, py, rect, radius?) → id | null` — `pitches`는 `{ id, x, z }`를 가진 객체 배열. 반경 내에서 **가장 가까운** 공의 `id`
  - `isDrag(sx, sy, px, py, threshold?) → boolean`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/interaction.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitTest, isDrag, HIT_RADIUS, DRAG_THRESHOLD } from '../public/interaction.js';
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/interaction.test.js`
Expected: FAIL — `Cannot find module '.../public/interaction.js'`

- [ ] **Step 3: 최소 구현 작성**

`public/interaction.js`:

```js
import { toPixels } from './zone.js';

export const HIT_RADIUS = 14;
export const DRAG_THRESHOLD = 3;

export function hitTest(pitches, px, py, rect, radius = HIT_RADIUS) {
  let bestId = null;
  let bestDist = Infinity;
  for (const p of pitches) {
    const c = toPixels(p.x, p.z, rect);
    const d = Math.hypot(px - c.px, py - c.py);
    if (d <= radius && d < bestDist) {
      bestId = p.id;
      bestDist = d;
    }
  }
  return bestId;
}

export function isDrag(sx, sy, px, py, threshold = DRAG_THRESHOLD) {
  return Math.hypot(px - sx, py - sy) >= threshold;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/interaction.test.js`
Expected: PASS — 9 tests

- [ ] **Step 5: 커밋**

```bash
git add public/interaction.js tests/interaction.test.js
git commit -m "feat: 히트 테스트와 드래그 임계값 판정 추가"
```

---

## Task 3: `state.js` 골격 + 이닝 전이

**Files:**
- Create: `abs-overlay/state.js`
- Test: `abs-overlay/tests/state.test.js`

**Interfaces:**
- Consumes: 없음 (이 태스크에서는 `zone.js`를 아직 쓰지 않는다)
- Produces:
  - `DEFAULT_CONFIG = { zone: { aspect: 1.0 }, placement: { x: 0.5, y: 0.45, scale: 0.22 } }`
  - `UNDO_LIMIT = 20`
  - `createState(config?) → state`
  - `canInput(state) → boolean`
  - `toPublic(state) → state에서 nextId·undoStack을 제거한 객체`
  - `transition(state, action) → { state, effects }` — `effects`는 `{type:'SAVE_INNING'|'SAVE_CONFIG'|'WARN', ...}` 배열
  - 액션 `INNING_START`, `INNING_END`, `INNING_NEXT`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/state.test.js`:

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/state.test.js`
Expected: FAIL — `Cannot find module '.../state.js'`

- [ ] **Step 3: 최소 구현 작성**

`state.js`:

```js
export const DEFAULT_CONFIG = {
  zone: { aspect: 1.0 },
  placement: { x: 0.5, y: 0.45, scale: 0.22 },
};

export const UNDO_LIMIT = 20;

export function createState(config = DEFAULT_CONFIG) {
  return {
    zone: { ...config.zone },
    placement: { ...config.placement },
    game: { inning: 1, status: 'idle', pitches: [] },
    review: null,
    nextId: 1,
    undoStack: [],
  };
}

// 입력 가능 조건은 이 프로젝트에서 이 함수 하나에만 존재한다.
// 콘솔은 서버가 보내준 값을 쓰고 스스로 판단하지 않는다.
export function canInput(state) {
  return state.game.status === 'live' && state.review === null;
}

export function toPublic(state) {
  const { nextId, undoStack, ...pub } = state;
  return pub;
}

function warn(state, message) {
  return { state, effects: [{ type: 'WARN', message }] };
}

export function transition(state, action) {
  const g = state.game;

  switch (action.type) {
    case 'INNING_START': {
      if (g.status === 'live') return warn(state, '이미 진행 중인 이닝입니다');
      const pitches = g.status === 'ended' ? g.pitches : [];
      return { state: { ...state, game: { ...g, status: 'live', pitches } }, effects: [] };
    }

    case 'INNING_END': {
      if (g.status !== 'live') return warn(state, 'live 상태가 아니어서 종료할 수 없습니다');
      return {
        state: { ...state, game: { ...g, status: 'ended' } },
        effects: [{ type: 'SAVE_INNING', inning: g.inning, pitches: g.pitches }],
      };
    }

    case 'INNING_NEXT': {
      if (g.status !== 'ended') return warn(state, '이닝 종료 후에만 다음 이닝으로 갈 수 있습니다');
      return {
        state: { ...state, game: { inning: g.inning + 1, status: 'live', pitches: [] } },
        effects: [],
      };
    }

    default:
      return warn(state, `알 수 없는 액션: ${action.type}`);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/state.test.js`
Expected: PASS — 12 tests

- [ ] **Step 5: 커밋**

```bash
git add state.js tests/state.test.js
git commit -m "feat: 상태 기계 골격과 이닝 전이 추가"
```

---

## Task 4: 투구 추가·이동·삭제·전체삭제

**Files:**
- Modify: `abs-overlay/state.js` (`transition`에 케이스 추가, `judge` import, 헬퍼 추가)
- Modify: `abs-overlay/tests/state.test.js` (테스트 추가)

**Interfaces:**
- Consumes: Task 1의 `judge(x, z)`, Task 3의 `createState` / `transition` / `canInput`
- Produces: 액션 `PITCH_ADD {x, z}`, `PITCH_MOVE {id, x, z}`, `PITCH_DELETE {id}`, `PITCH_CLEAR_ALL`
  - 공 객체 형태: `{ id: 'p<n>', seq: <1부터>, x, z, verdict: 'strike' | 'ball' }`
  - `id`는 `state.nextId` 카운터로 결정론적으로 생성된다 (테스트 가능)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/state.test.js` 끝에 추가:

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/state.test.js`
Expected: FAIL — 새로 추가한 테스트들이 `WARN`(알 수 없는 액션) 때문에 실패

- [ ] **Step 3: 구현 추가**

`state.js` 최상단에 import 추가:

```js
import { judge } from './public/zone.js';
```

`warn` 함수 아래에 헬퍼 추가:

```js
function reseq(pitches) {
  return pitches.map((p, i) => ({ ...p, seq: i + 1 }));
}

// 변경 직전의 pitches를 스냅샷으로 쌓는다.
// 역연산을 구현하는 것보다 단순하고, 데이터가 작아 부담이 없다.
function pushUndo(state) {
  return { ...state, undoStack: [...state.undoStack, { pitches: state.game.pitches, nextId: state.nextId }] };
}
```

`transition`의 `switch`에 `default` 직전에 케이스 추가:

```js
    case 'PITCH_ADD': {
      if (!canInput(state)) return warn(state, '입력 가능 상태가 아닙니다');
      const pitch = {
        id: `p${state.nextId}`,
        seq: g.pitches.length + 1,
        x: action.x,
        z: action.z,
        verdict: judge(action.x, action.z),
      };
      const base = pushUndo(state);
      return {
        state: { ...base, game: { ...g, pitches: [...g.pitches, pitch] }, nextId: state.nextId + 1 },
        effects: [],
      };
    }

    case 'PITCH_MOVE': {
      if (!canInput(state)) return warn(state, '입력 가능 상태가 아닙니다');
      if (!g.pitches.some((p) => p.id === action.id)) return warn(state, `없는 공입니다: ${action.id}`);
      const pitches = g.pitches.map((p) =>
        p.id === action.id
          ? { ...p, x: action.x, z: action.z, verdict: judge(action.x, action.z) }
          : p,
      );
      return { state: { ...pushUndo(state), game: { ...g, pitches } }, effects: [] };
    }

    case 'PITCH_DELETE': {
      if (!canInput(state)) return warn(state, '입력 가능 상태가 아닙니다');
      if (!g.pitches.some((p) => p.id === action.id)) return warn(state, `없는 공입니다: ${action.id}`);
      const pitches = reseq(g.pitches.filter((p) => p.id !== action.id));
      return { state: { ...pushUndo(state), game: { ...g, pitches } }, effects: [] };
    }

    case 'PITCH_CLEAR_ALL': {
      if (!canInput(state)) return warn(state, '입력 가능 상태가 아닙니다');
      return { state: { ...pushUndo(state), game: { ...g, pitches: [] } }, effects: [] };
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/state.test.js`
Expected: PASS — 24 tests

- [ ] **Step 5: 커밋**

```bash
git add state.js tests/state.test.js
git commit -m "feat: 투구 추가·이동·삭제와 seq 재부여 추가"
```

---

## Task 5: 되돌리기

**Files:**
- Modify: `abs-overlay/state.js` (`UNDO` 케이스, `pushUndo`에 개수 제한)
- Modify: `abs-overlay/tests/state.test.js`

**Interfaces:**
- Consumes: Task 4의 `pushUndo`가 쌓은 `undoStack`
- Produces: 액션 `UNDO`. 스택은 `UNDO_LIMIT`(20)개를 넘지 않는다

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/state.test.js` 끝에 추가:

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/state.test.js`
Expected: FAIL — `UNDO`가 알 수 없는 액션이고, 스택 제한 테스트도 실패(25개)

- [ ] **Step 3: 구현 수정**

`state.js`의 `pushUndo`에 개수 제한 적용:

```js
function pushUndo(state) {
  const snap = { pitches: state.game.pitches, nextId: state.nextId };
  return { ...state, undoStack: [...state.undoStack, snap].slice(-UNDO_LIMIT) };
}
```

`transition`의 `switch`에 `default` 직전에 케이스 추가:

```js
    case 'UNDO': {
      if (!canInput(state)) return warn(state, '입력 가능 상태가 아닙니다');
      if (state.undoStack.length === 0) return warn(state, '되돌릴 내용이 없습니다');
      const stack = state.undoStack.slice(0, -1);
      const snap = state.undoStack[state.undoStack.length - 1];
      return {
        state: { ...state, game: { ...g, pitches: snap.pitches }, nextId: snap.nextId, undoStack: stack },
        effects: [],
      };
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/state.test.js`
Expected: PASS — 31 tests

- [ ] **Step 5: 커밋**

```bash
git add state.js tests/state.test.js
git commit -m "feat: 스냅샷 스택 기반 되돌리기 추가"
```

---

## Task 6: 다시보기 + 보정값

**Files:**
- Modify: `abs-overlay/state.js`
- Modify: `abs-overlay/tests/state.test.js`

**Interfaces:**
- Consumes: Task 3의 `transition`, Task 4의 `PITCH_ADD`
- Produces: 액션
  - `REVIEW_ENTER {inning, pitches}` — `pitches`는 **호출자(서버)가 파일에서 읽어 실어 보낸다.** `transition`은 순수하게 유지된다
  - `REVIEW_EXIT`
  - `ZONE_SET {aspect}` → `SAVE_CONFIG` 효과
  - `PLACEMENT_SET {x, y, scale}` → `SAVE_CONFIG` 효과
  - `SAVE_CONFIG` 효과 형태: `{ type: 'SAVE_CONFIG', zone, placement }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/state.test.js` 끝에 추가:

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/state.test.js`
Expected: FAIL — `REVIEW_ENTER` 등이 알 수 없는 액션

- [ ] **Step 3: 구현 추가**

`state.js`의 `switch`에 `default` 직전에 케이스 추가:

```js
    case 'REVIEW_ENTER':
      return {
        state: { ...state, review: { inning: action.inning, pitches: action.pitches } },
        effects: [],
      };

    case 'REVIEW_EXIT':
      return { state: { ...state, review: null }, effects: [] };

    case 'ZONE_SET': {
      const zone = { aspect: action.aspect };
      return {
        state: { ...state, zone },
        effects: [{ type: 'SAVE_CONFIG', zone, placement: state.placement }],
      };
    }

    case 'PLACEMENT_SET': {
      const placement = { x: action.x, y: action.y, scale: action.scale };
      return {
        state: { ...state, placement },
        effects: [{ type: 'SAVE_CONFIG', zone: state.zone, placement }],
      };
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/state.test.js`
Expected: PASS — 38 tests

- [ ] **Step 5: 전체 테스트 확인 후 커밋**

Run: `npm test`
Expected: PASS

```bash
git add state.js tests/state.test.js
git commit -m "feat: 다시보기와 존·배치 보정값 전이 추가"
```

---

## Task 7: `store.js` (이닝 기록·설정 파일)

**Files:**
- Create: `abs-overlay/store.js`
- Test: `abs-overlay/tests/store.test.js`

**Interfaces:**
- Consumes: `state.js`의 `DEFAULT_CONFIG`
- Produces:
  - `saveInning(dir, date, inning, pitches)` — 같은 `inning`이 있으면 **교체**. `id`는 저장하지 않는다
  - `loadInning(dir, date, inning) → pitches[] | null`
  - `listInnings(dir, date) → number[]` (오름차순)
  - `loadConfig(file) → config` (없거나 손상 시 `DEFAULT_CONFIG`)
  - `saveConfig(file, config)`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveInning, loadInning, listInnings, loadConfig, saveConfig } from '../store.js';
import { DEFAULT_CONFIG } from '../state.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'abs-store-'));
}

const DATE = '2026-09-02';
const PITCHES = [
  { id: 'p1', seq: 1, x: 0.31, z: -0.82, verdict: 'strike' },
  { id: 'p2', seq: 2, x: 1.24, z: 0.1, verdict: 'ball' },
];

test('저장한 이닝을 그대로 읽는다', () => {
  const dir = tmp();
  saveInning(dir, DATE, 1, PITCHES);
  assert.deepEqual(loadInning(dir, DATE, 1), [
    { seq: 1, x: 0.31, z: -0.82, verdict: 'strike' },
    { seq: 2, x: 1.24, z: 0.1, verdict: 'ball' },
  ]);
});

test('id는 저장하지 않는다', () => {
  const dir = tmp();
  saveInning(dir, DATE, 1, PITCHES);
  const raw = fs.readFileSync(path.join(dir, `${DATE}.json`), 'utf8');
  assert.equal(raw.includes('"id"'), false);
});

test('같은 이닝을 두 번 저장하면 항목이 교체된다', () => {
  const dir = tmp();
  saveInning(dir, DATE, 3, PITCHES);
  saveInning(dir, DATE, 3, [{ seq: 1, x: 0, z: 0, verdict: 'strike' }]);
  assert.deepEqual(listInnings(dir, DATE), [3]);
  assert.equal(loadInning(dir, DATE, 3).length, 1);
});

test('다른 이닝은 이어서 쌓이고 오름차순으로 정렬된다', () => {
  const dir = tmp();
  saveInning(dir, DATE, 3, PITCHES);
  saveInning(dir, DATE, 1, PITCHES);
  assert.deepEqual(listInnings(dir, DATE), [1, 3]);
});

test('없는 이닝은 null이다', () => {
  const dir = tmp();
  assert.equal(loadInning(dir, DATE, 1), null);
  saveInning(dir, DATE, 1, PITCHES);
  assert.equal(loadInning(dir, DATE, 9), null);
});

test('기록이 없는 날짜는 빈 목록이다', () => {
  assert.deepEqual(listInnings(tmp(), DATE), []);
});

test('endedAt이 ISO 문자열로 기록된다', () => {
  const dir = tmp();
  saveInning(dir, DATE, 1, PITCHES);
  const game = JSON.parse(fs.readFileSync(path.join(dir, `${DATE}.json`), 'utf8'));
  assert.match(game.innings[0].endedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(game.date, DATE);
});

test('손상된 기록 파일은 예외 대신 빈 결과를 준다', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, `${DATE}.json`), '{ 이건 JSON이 아니다');
  assert.deepEqual(listInnings(dir, DATE), []);
  assert.equal(loadInning(dir, DATE, 1), null);
});

test('설정 파일이 없으면 기본값을 준다', () => {
  assert.deepEqual(loadConfig(path.join(tmp(), 'config.json')), DEFAULT_CONFIG);
});

test('설정을 저장하고 읽는다', () => {
  const file = path.join(tmp(), 'config.json');
  const cfg = { zone: { aspect: 1.4 }, placement: { x: 0.6, y: 0.4, scale: 0.3 } };
  saveConfig(file, cfg);
  assert.deepEqual(loadConfig(file), cfg);
});

test('손상된 설정 파일은 기본값으로 대체된다', () => {
  const file = path.join(tmp(), 'config.json');
  fs.writeFileSync(file, '{{{');
  assert.deepEqual(loadConfig(file), DEFAULT_CONFIG);
});

test('필드가 빠진 설정 파일도 기본값으로 대체된다', () => {
  const file = path.join(tmp(), 'config.json');
  fs.writeFileSync(file, JSON.stringify({ zone: { aspect: 1.2 } }));
  assert.deepEqual(loadConfig(file), DEFAULT_CONFIG);
});

test('저장 후 임시 파일이 남지 않는다', () => {
  const dir = tmp();
  saveInning(dir, DATE, 1, PITCHES);
  assert.deepEqual(fs.readdirSync(dir), [`${DATE}.json`]);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/store.test.js`
Expected: FAIL — `Cannot find module '.../store.js'`

- [ ] **Step 3: 최소 구현 작성**

`store.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG } from './state.js';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// 임시 파일에 쓴 뒤 rename한다. 저장 도중 프로세스가 죽어도
// 기존 기록이 깨지지 않는다.
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function gameFile(dir, date) {
  return path.join(dir, `${date}.json`);
}

export function saveInning(dir, date, inning, pitches) {
  const loaded = readJson(gameFile(dir, date));
  const game = Array.isArray(loaded?.innings) ? loaded : { date, innings: [] };
  const entry = {
    inning,
    endedAt: new Date().toISOString(),
    pitches: pitches.map(({ seq, x, z, verdict }) => ({ seq, x, z, verdict })),
  };
  const i = game.innings.findIndex((e) => e.inning === inning);
  if (i >= 0) game.innings[i] = entry;
  else game.innings.push(entry);
  game.innings.sort((a, b) => a.inning - b.inning);
  writeJsonAtomic(gameFile(dir, date), game);
}

export function loadInning(dir, date, inning) {
  const game = readJson(gameFile(dir, date));
  if (!Array.isArray(game?.innings)) return null;
  const entry = game.innings.find((e) => e.inning === inning);
  return entry ? entry.pitches : null;
}

export function listInnings(dir, date) {
  const game = readJson(gameFile(dir, date));
  if (!Array.isArray(game?.innings)) return [];
  return game.innings.map((e) => e.inning).sort((a, b) => a - b);
}

export function loadConfig(file) {
  const cfg = readJson(file);
  const ok =
    typeof cfg?.zone?.aspect === 'number' &&
    typeof cfg?.placement?.x === 'number' &&
    typeof cfg?.placement?.y === 'number' &&
    typeof cfg?.placement?.scale === 'number';
  return ok ? cfg : DEFAULT_CONFIG;
}

export function saveConfig(file, config) {
  writeJsonAtomic(file, config);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/store.test.js`
Expected: PASS — 13 tests

- [ ] **Step 5: 커밋**

```bash
git add store.js tests/store.test.js
git commit -m "feat: 이닝 기록과 설정의 원자적 파일 저장 추가"
```

---

## Task 8: `server.js` (정적 서버 + WebSocket 허브)

**Files:**
- Create: `abs-overlay/server.js`
- Test: `abs-overlay/tests/server.test.js`

**Interfaces:**
- Consumes: `state.js`의 `createState` / `transition` / `toPublic` / `canInput`, `store.js` 전부
- Produces:
  - `startServer({ port, dataDir, configPath, publicDir }) → { port, close() }`
  - 클라이언트로 보내는 메시지: `{ type: 'STATE', state, canInput, innings }`
    - `state`는 `toPublic` 결과, `innings`는 오늘 날짜의 저장된 이닝 번호 배열
  - 클라이언트가 보내는 메시지: `state.js`의 액션 객체 그대로. 단 `REVIEW_ENTER`는 `{ type, inning }`만 보내면 서버가 `pitches`를 파일에서 읽어 채운다

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/server.test.js`:

```js
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

function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => ws.once('message', (raw) => resolve(JSON.parse(raw))));
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

  const [ma, mb] = await Promise.all([
    (a.send(JSON.stringify({ type: 'PITCH_ADD', x: 1.5, z: 0 })), nextMessage(a)),
    nextMessage(b),
  ]);
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
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.deepEqual(cfg.placement, { x: 0.7, y: 0.3, scale: 0.4 });
  ws.close();
  await srv.close();
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/server.test.js`
Expected: FAIL — `Cannot find module '.../server.js'`

- [ ] **Step 3: 최소 구현 작성**

`server.js`:

```js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createState, transition, toPublic, canInput } from './state.js';
import * as store from './store.js';

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

  function snapshot() {
    return JSON.stringify({
      type: 'STATE',
      state: toPublic(state),
      canInput: canInput(state),
      innings: store.listInnings(dataDir, today()),
    });
  }

  function broadcast() {
    const msg = snapshot();
    for (const client of wss.clients) {
      if (client.readyState === WS_OPEN) client.send(msg);
    }
  }

  function applyEffects(effects) {
    for (const e of effects) {
      if (e.type === 'SAVE_INNING') {
        // 저장 실패가 이닝 진행을 막아서는 안 된다.
        try {
          store.saveInning(dataDir, today(), e.inning, e.pitches);
        } catch (err) {
          console.error('이닝 저장 실패:', err.message);
        }
      } else if (e.type === 'SAVE_CONFIG') {
        try {
          store.saveConfig(configPath, { zone: e.zone, placement: e.placement });
        } catch (err) {
          console.error('설정 저장 실패:', err.message);
        }
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
  httpServer.listen(port);

  return {
    get port() {
      return boundPort;
    },
    ready,
    close: () =>
      new Promise((resolve) => {
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
```

`startServer`는 `{ port, ready, close }`를 돌려준다. `port`는 `ready`가 resolve된 뒤에 읽어야 정확하다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/server.test.js`
Expected: PASS — 8 tests

- [ ] **Step 5: 커밋**

```bash
git add server.js tests/server.test.js
git commit -m "feat: 정적 서버와 상태 브로드캐스트 WebSocket 허브 추가"
```

---

## Task 9: 공유 유틸 (`ws-client.js`, `console-status.js`, `confirm.js`, `debounce.js`)

**Files:**
- Create: `abs-overlay/public/ws-client.js`
- Create: `abs-overlay/public/console-status.js`
- Create: `abs-overlay/public/confirm.js`
- Create: `abs-overlay/public/debounce.js`
- Test: `abs-overlay/tests/ws-client.test.js`
- Test: `abs-overlay/tests/console-status.test.js`
- Test: `abs-overlay/tests/confirm.test.js`
- Test: `abs-overlay/tests/debounce.test.js`

**Interfaces:**
- Consumes: 없음 (순수 유틸)
- Produces:
  - `nextDelay(attempt) → number` — `min(500 * 2^attempt, 5000)`
  - `connect(url, { onState, onOpen, onClose }) → { send(action) }` — 끊기면 지수 백오프로 재연결
  - `statusMessage({ state, canInput, connected }) → string | null` — 입력 불가 이유. 가능하면 `null`
  - `shouldExecute(lastPressAt, now, windowMs?) → boolean` — 2단 확인 판정 (기본 3000ms)
  - `debounce(fn, ms) → wrapped` (`wrapped.cancel()` 제공)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/ws-client.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDelay } from '../public/ws-client.js';

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
```

`tests/console-status.test.js`:

```js
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
```

`tests/confirm.test.js`:

```js
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
```

`tests/debounce.test.js`:

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/ws-client.test.js tests/console-status.test.js tests/confirm.test.js tests/debounce.test.js`
Expected: FAIL — 네 모듈 모두 `Cannot find module`

- [ ] **Step 3: 최소 구현 작성**

`public/debounce.js`:

```js
export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}
```

`public/confirm.js`:

```js
export const CONFIRM_WINDOW_MS = 3000;

// 두 번째 누름이 확인 창 안에 들어왔는지 판정한다.
// 모달 없이 버튼 안에서 확인을 받기 위한 것 — 방송 중 모달은
// 포커스를 훔치고 단축키를 먹는다.
export function shouldExecute(lastPressAt, now, windowMs = CONFIRM_WINDOW_MS) {
  if (lastPressAt === null || lastPressAt === undefined) return false;
  return now - lastPressAt <= windowMs;
}
```

`public/console-status.js`:

```js
// 입력이 불가한 이유를 한 줄로 돌려준다. 입력 가능하면 null.
// 우선순위: 연결 > 다시보기 > 이닝 상태.
export function statusMessage({ state, canInput, connected }) {
  if (!connected) return '서버 연결 끊김 — 재연결 중…';
  if (state.review) return `${state.review.inning}회 다시보기 중 — 라이브 복귀`;
  if (state.game.status === 'idle') return '이닝 시작을 눌러주세요';
  if (state.game.status === 'ended') return `${state.game.inning}회 종료됨 — 이닝 시작 또는 다음 이닝`;
  return canInput ? null : '입력할 수 없는 상태입니다';
}
```

`public/ws-client.js`:

```js
export const MAX_DELAY_MS = 5000;

export function nextDelay(attempt) {
  return Math.min(500 * 2 ** attempt, MAX_DELAY_MS);
}

// 끊기면 지수 백오프로 조용히 재연결한다.
// 오버레이는 이 동안 마지막 화면을 그대로 유지한다 —
// 방송에서 화면이 사라지는 것이 최악이기 때문이다.
export function connect(url, { onState, onOpen, onClose } = {}) {
  let ws = null;
  let attempt = 0;
  let closed = false;

  function open() {
    ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      attempt = 0;
      onOpen?.();
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'STATE') onState?.(msg);
    });
    ws.addEventListener('close', () => {
      onClose?.();
      if (closed) return;
      setTimeout(open, nextDelay(attempt));
      attempt += 1;
    });
    ws.addEventListener('error', () => ws.close());
  }

  open();

  return {
    send(action) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(action));
    },
    dispose() {
      closed = true;
      ws?.close();
    },
  };
}
```

`connect`는 브라우저 전용(`WebSocket` 전역)이라 테스트하지 않는다. 테스트는 `nextDelay`만 다룬다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 전체 통과 (신규 15 tests 포함)

- [ ] **Step 5: 커밋**

```bash
git add public/ws-client.js public/console-status.js public/confirm.js public/debounce.js tests/ws-client.test.js tests/console-status.test.js tests/confirm.test.js tests/debounce.test.js
git commit -m "feat: 재연결·상태문구·2단확인·디바운스 유틸 추가"
```

---

## Task 10: 송출 오버레이

**Files:**
- Create: `abs-overlay/public/overlay.html`
- Create: `abs-overlay/public/overlay.js`

**Interfaces:**
- Consumes: `zone.js`의 `zoneRect` / `toPixels`, `ws-client.js`의 `connect`
- Produces: 없음 (말단 화면)

- [ ] **Step 1: `overlay.html` 작성**

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>ABS 오버레이</title>
    <style>
      /* OBS 브라우저 소스는 이 투명 배경을 알파 채널로 인식한다. */
      html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <canvas id="stage"></canvas>
    <script type="module" src="./overlay.js"></script>
  </body>
</html>
```

- [ ] **Step 2: `overlay.js` 작성**

```js
import { zoneRect, toPixels } from './zone.js';
import { connect } from './ws-client.js';

const BASE_W = 1920;
const BASE_H = 1080;
const STRIKE = '#ff4d4f';
const BALL = '#4d9bff';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// 연결이 끊겨도 마지막 상태를 그대로 유지한다. 지우지 않는다.
let snap = null;
let appearAt = new Map(); // id 또는 seq → 등장 시각 (스케일-인용)

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = BASE_W * dpr;
  canvas.height = BASE_H * dpr;
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function shadowed(draw) {
  // 중계 영상의 배경은 흰 유니폼일 수도 밝은 하늘일 수도 있다.
  // 외곽선과 그림자 없이는 요소가 수시로 사라진다.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 6;
  draw();
  ctx.restore();
}

function currentPitches(s) {
  return s.review ? s.review.pitches : s.game.pitches;
}

function keyOf(p) {
  return p.id ?? `seq${p.seq}`;
}

function rectFor(s) {
  const halfH = (BASE_H * s.placement.scale) / 2;
  return zoneRect(BASE_W * s.placement.x, BASE_H * s.placement.y, halfH, s.zone.aspect);
}

function drawZone(rect) {
  shadowed(() => {
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 3;
    ctx.strokeRect(rect.cx - rect.halfW, rect.cy - rect.halfH, rect.halfW * 2, rect.halfH * 2);
  });
}

function drawPitch(p, rect, radius, dim) {
  const { px, py } = toPixels(p.x, p.z, rect);
  shadowed(() => {
    ctx.globalAlpha = dim ? 0.72 : 1;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = p.verdict === 'strike' ? STRIKE : BALL;
    ctx.fill();
    ctx.lineWidth = dim ? 2 : 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(radius * 1.1)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.seq), px, py + 1);
  });
}

function drawLabels(s, rect) {
  const pitches = currentPitches(s);
  const strikes = pitches.filter((p) => p.verdict === 'strike').length;
  const balls = pitches.length - strikes;
  const inning = s.review ? s.review.inning : s.game.inning;

  shadowed(() => {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${inning}회   S ${strikes} · B ${balls}`, rect.cx, rect.cy + rect.halfH + 18);
  });

  if (s.review) {
    shadowed(() => {
      ctx.fillStyle = '#ffd666';
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${s.review.inning}회 다시보기`, 40, 36);
    });
  }
}

function render(now) {
  ctx.clearRect(0, 0, BASE_W, BASE_H);
  if (snap) {
    const s = snap.state;
    const rect = rectFor(s);
    drawZone(rect);
    const pitches = currentPitches(s);
    const baseR = Math.max(10, rect.halfH * 0.13);
    pitches.forEach((p, i) => {
      const last = i === pitches.length - 1;
      // 등장 시 150ms 스케일-인
      const t = Math.min(1, (now - (appearAt.get(keyOf(p)) ?? now)) / 150);
      const grow = 0.6 + 0.4 * t;
      drawPitch(p, rect, baseR * (last ? 1.35 : 1) * grow, !last);
    });
    drawLabels(s, rect);
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

connect(`ws://${location.host}`, {
  onState(msg) {
    const next = new Map();
    for (const p of currentPitches(msg.state)) {
      const k = keyOf(p);
      next.set(k, appearAt.get(k) ?? performance.now());
    }
    appearAt = next;
    snap = msg;
  },
});
```

- [ ] **Step 3: 수동 확인**

Run: `npm start` 후 브라우저에서 `http://localhost:3000/overlay.html` 열기.
Expected: 배경이 흰색(브라우저 기본)으로 보이고 존 사각형과 `1회 S 0 · B 0` 라벨이 그려진다. 콘솔이 아직 없으므로 공은 없다.

`node -e` 로 액션을 하나 보내 공이 그려지는지 확인:

```bash
node -e "
import('ws').then(async ({ default: WebSocket }) => {
  const ws = new WebSocket('ws://127.0.0.1:3000');
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'INNING_START' }));
    ws.send(JSON.stringify({ type: 'PITCH_ADD', x: 0.3, z: -0.5 }));
    ws.send(JSON.stringify({ type: 'PITCH_ADD', x: 1.4, z: 0.2 }));
    setTimeout(() => { ws.close(); process.exit(0); }, 300);
  });
});
"
```

Expected: 빨간 `1`번 공(존 안)과 파란 `2`번 공(존 밖)이 나타나고, 2번이 더 크고 진하다. 라벨이 `1회 S 1 · B 1`로 바뀐다.

- [ ] **Step 4: 커밋**

```bash
git add public/overlay.html public/overlay.js
git commit -m "feat: 투명 배경 송출 오버레이 렌더러 추가"
```

---

## Task 11: 콘솔 — 뷰, 클릭 입력, 상태 문구

**Files:**
- Create: `abs-overlay/public/console.html`
- Create: `abs-overlay/public/console.css`
- Create: `abs-overlay/public/console.js`

**Interfaces:**
- Consumes: `zone.js`, `interaction.js`, `console-status.js`, `ws-client.js`
- Produces: `console.js` 내부 전역 — Task 12·13이 같은 파일을 확장한다
  - `view` — `{ rect, canvas, ctx }` 계산 결과
  - `send(action)` — WS 전송
  - `snap` — 마지막 `STATE` 메시지, `connected` — 연결 여부
  - `selectedId`, `drag` — 콘솔 로컬 편집 상태 (Task 12에서 사용)

- [ ] **Step 1: `console.html` 작성**

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>ABS 콘솔</title>
    <link rel="stylesheet" href="./console.css" />
  </head>
  <body>
    <main>
      <canvas id="stage"></canvas>
      <div id="blocker" hidden><span id="blockerText"></span></div>
      <p id="readout">투구 0 · S 0 · B 0</p>
    </main>
    <aside>
      <h1><span id="inningLabel">1회</span> <span id="statusBadge">IDLE</span></h1>
      <button id="btnStart">이닝 시작</button>
      <button id="btnEnd">이닝 종료</button>
      <button id="btnNext" data-confirm="다음 이닝으로?">다음 이닝</button>

      <h2>다시보기</h2>
      <select id="inningSelect"></select>
      <button id="btnReview">보기</button>
      <button id="btnLive">라이브 복귀</button>

      <h2>편집</h2>
      <button id="btnUndo">되돌리기 ⌃Z</button>
      <button id="btnDelete">선택 삭제</button>
      <button id="btnClear" data-confirm="정말 지울까요?">모두 지우기</button>

      <h2>보정</h2>
      <label><input type="checkbox" id="chkCalib" /> 보정 모드 (C)</label>
      <label>존 종횡비 <input type="range" id="rngAspect" min="0.5" max="2" step="0.01" /></label>
      <label>송출 X <input type="range" id="rngX" min="0" max="1" step="0.005" /></label>
      <label>송출 Y <input type="range" id="rngY" min="0" max="1" step="0.005" /></label>
      <label>송출 크기 <input type="range" id="rngScale" min="0.05" max="0.6" step="0.005" /></label>

      <p id="conn">● 연결 중…</p>
    </aside>
    <script type="module" src="./console.js"></script>
  </body>
</html>
```

- [ ] **Step 2: `console.css` 작성**

```css
:root { color-scheme: dark; }
body {
  margin: 0; display: grid; grid-template-columns: 1fr 260px;
  height: 100vh; background: #14161a; color: #e8eaed;
  font: 14px/1.5 system-ui, sans-serif;
}
main { position: relative; display: grid; place-items: center; }
canvas { background: #1c1f24; border-radius: 8px; cursor: crosshair; }
#blocker {
  position: absolute; inset: 0; display: grid; place-items: center;
  background: rgba(0, 0, 0, 0.66); font-size: 18px; font-weight: 600;
  text-align: center; padding: 0 24px; border-radius: 8px;
}
#readout { position: absolute; bottom: 12px; color: #9aa0a6; }
aside { padding: 16px; border-left: 1px solid #2a2e35; overflow-y: auto; }
aside h1 { font-size: 20px; margin: 0 0 12px; display: flex; gap: 8px; align-items: center; }
aside h2 { font-size: 12px; color: #9aa0a6; margin: 20px 0 6px; text-transform: uppercase; }
aside button, aside select { width: 100%; padding: 9px; margin-bottom: 6px;
  background: #2a2e35; color: inherit; border: 1px solid #3a3f47; border-radius: 6px; cursor: pointer; }
aside button:disabled { opacity: 0.4; cursor: not-allowed; }
aside button.armed { background: #7a2c2c; border-color: #a33; }
aside label { display: block; margin-bottom: 8px; color: #c4c7cc; }
aside input[type="range"] { width: 100%; }
#statusBadge { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #3a3f47; }
#statusBadge.live { background: #1f6f3f; }
#conn { color: #f28b82; }
#conn.ok { color: #81c995; }
```

- [ ] **Step 3: `console.js` 작성 (뷰 + 클릭 입력 + 상태 문구)**

```js
import { zoneRect, toPixels, toNormalized, judge } from './zone.js';
import { hitTest, isDrag } from './interaction.js';
import { statusMessage } from './console-status.js';
import { connect } from './ws-client.js';

const VIEW_W = 720;
const VIEW_H = 720;
const ZONE_HALF_H = VIEW_H / 2 / 2.5; // 클릭 영역은 존의 2.5배
const STRIKE = '#ff4d4f';
const BALL = '#4d9bff';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const blocker = document.getElementById('blocker');
const blockerText = document.getElementById('blockerText');
const readout = document.getElementById('readout');
const conn = document.getElementById('conn');
const inningLabel = document.getElementById('inningLabel');
const statusBadge = document.getElementById('statusBadge');

canvas.width = VIEW_W;
canvas.height = VIEW_H;

export const local = {
  snap: null,
  connected: false,
  calibrate: false,
  selectedId: null,
  drag: null, // { id, px, py }
};

function rect() {
  const aspect = local.snap?.state.zone.aspect ?? 1;
  return zoneRect(VIEW_W / 2, VIEW_H / 2, ZONE_HALF_H, aspect);
}

function pitches() {
  const s = local.snap?.state;
  if (!s) return [];
  return s.review ? s.review.pitches : s.game.pitches;
}

function draw() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  const r = rect();

  // 존 밖 영역 안내
  ctx.strokeStyle = '#2f343c';
  ctx.lineWidth = 1;
  for (let g = 0; g <= VIEW_W; g += 60) {
    ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, VIEW_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(VIEW_W, g); ctx.stroke();
  }

  ctx.strokeStyle = '#e8eaed';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.cx - r.halfW, r.cy - r.halfH, r.halfW * 2, r.halfH * 2);

  const list = pitches();
  list.forEach((p, i) => {
    const dragging = local.drag?.id === p.id;
    if (dragging) drawGhost(p, r);
    const pos = dragging
      ? { px: local.drag.px, py: local.drag.py }
      : toPixels(p.x, p.z, r);
    const verdict = dragging
      ? judge(...Object.values(toNormalized(local.drag.px, local.drag.py, r)))
      : p.verdict;
    drawMarker(pos, p.seq, verdict, i === list.length - 1, p.id === local.selectedId);
  });

  const strikes = list.filter((p) => p.verdict === 'strike').length;
  readout.textContent = `투구 ${list.length} · S ${strikes} · B ${list.length - strikes}`;
}

function drawGhost(p, r) {
  const { px, py } = toPixels(p.x, p.z, r);
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(px, py, 12, 0, Math.PI * 2);
  ctx.fillStyle = p.verdict === 'strike' ? STRIKE : BALL;
  ctx.fill();
  ctx.restore();
}

function drawMarker({ px, py }, seq, verdict, isLast, isSelected) {
  ctx.beginPath();
  ctx.arc(px, py, isLast ? 15 : 12, 0, Math.PI * 2);
  ctx.fillStyle = verdict === 'strike' ? STRIKE : BALL;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(seq), px, py + 1);

  if (isSelected) {
    ctx.beginPath();
    ctx.setLineDash([4, 3]);
    ctx.arc(px, py, 21, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd666';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function refreshChrome() {
  const s = local.snap?.state;
  const msg = s
    ? statusMessage({ state: s, canInput: local.snap.canInput, connected: local.connected })
    : '서버 연결 중…';
  blocker.hidden = msg === null;
  blockerText.textContent = msg ?? '';
  conn.textContent = local.connected ? '● 연결됨' : '● 연결 끊김';
  conn.classList.toggle('ok', local.connected);
  if (s) {
    inningLabel.textContent = `${s.game.inning}회`;
    statusBadge.textContent = s.game.status.toUpperCase();
    statusBadge.classList.toggle('live', s.game.status === 'live');
  }
}

function pointOf(ev) {
  const b = canvas.getBoundingClientRect();
  return { px: ((ev.clientX - b.left) * VIEW_W) / b.width, py: ((ev.clientY - b.top) * VIEW_H) / b.height };
}

const client = connect(`ws://${location.host}`, {
  onState(msg) {
    local.snap = msg;
    if (!msg.state.game.pitches.some((p) => p.id === local.selectedId)) local.selectedId = null;
    refreshChrome();
    draw();
  },
  onOpen() { local.connected = true; refreshChrome(); },
  onClose() { local.connected = false; refreshChrome(); },
});

export function send(action) {
  client.send(action);
}

// 클릭으로 투구 추가 (드래그 처리는 Task 12에서 확장한다)
canvas.addEventListener('click', (ev) => {
  if (local.calibrate || !local.snap?.canInput) return;
  const { px, py } = pointOf(ev);
  const r = rect();
  if (hitTest(pitches(), px, py, r)) return; // 기존 공은 Task 12가 다룬다
  const { x, z } = toNormalized(px, py, r);
  send({ type: 'PITCH_ADD', x, z });
});

export { rect, pitches, draw, refreshChrome, pointOf, canvas, isDrag };
refreshChrome();
draw();
```

- [ ] **Step 4: 수동 확인**

Run: `npm start` 후 `http://localhost:3000/console.html`
Expected:
- `이닝 시작을 눌러주세요` 문구가 캔버스를 덮고 있다 (버튼은 아직 동작하지 않음 — Task 13).
- 브라우저 콘솔에서 아래를 실행하면 덮개가 사라지고 클릭이 먹는다:

```js
// 브라우저 개발자 콘솔에서
new WebSocket(`ws://${location.host}`).onopen = function () { this.send(JSON.stringify({type:'INNING_START'})); };
```

- 존 안을 클릭하면 빨간 `1`, 존 밖을 클릭하면 파란 `2`가 생기고, 오버레이 탭에도 동시에 반영된다.

- [ ] **Step 5: 커밋**

```bash
git add public/console.html public/console.css public/console.js
git commit -m "feat: 콘솔 뷰와 클릭 입력, 입력 불가 안내 추가"
```

---

## Task 12: 콘솔 — 공 선택·드래그·키보드 편집

**Files:**
- Modify: `abs-overlay/public/console.js`

**Interfaces:**
- Consumes: Task 11의 `local` / `rect` / `pitches` / `draw` / `pointOf`, `interaction.js`의 `hitTest` / `isDrag`, `debounce.js`의 `debounce`
- Produces: 없음 (말단 화면)

- [ ] **Step 1: `click` 핸들러를 포인터 이벤트로 교체**

`console.js`에서 기존 `canvas.addEventListener('click', …)` 블록을 삭제하고 아래로 대체한다. `import { debounce } from './debounce.js';`를 상단 import에 추가한다.

```js
let pressStart = null; // { px, py, hitId }

canvas.addEventListener('pointerdown', (ev) => {
  if (local.calibrate || !local.snap?.canInput) return;
  const { px, py } = pointOf(ev);
  const hitId = hitTest(pitches(), px, py, rect());
  pressStart = { px, py, hitId };
  if (hitId) {
    local.selectedId = hitId;
    canvas.setPointerCapture(ev.pointerId);
    draw();
  }
});

canvas.addEventListener('pointermove', (ev) => {
  if (!pressStart?.hitId) return;
  const { px, py } = pointOf(ev);
  if (!isDrag(pressStart.px, pressStart.py, px, py)) return;
  // 드래그 중 좌표는 콘솔 로컬에만 존재한다.
  // 서버로 보내지 않으므로 송출에 새어나갈 수 없다.
  local.drag = { id: pressStart.hitId, px, py };
  draw();
});

canvas.addEventListener('pointerup', (ev) => {
  if (!pressStart) return;
  const { px, py } = pointOf(ev);
  const dragged = pressStart.hitId && isDrag(pressStart.px, pressStart.py, px, py);
  const r = rect();

  if (dragged) {
    const { x, z } = toNormalized(px, py, r);
    send({ type: 'PITCH_MOVE', id: pressStart.hitId, x, z });
  } else if (!pressStart.hitId) {
    const { x, z } = toNormalized(px, py, r);
    send({ type: 'PITCH_ADD', x, z });
  }
  // 기존 공을 클릭만 한 경우: 선택만 유지, 서버 통신 없음

  local.drag = null;
  pressStart = null;
  draw();
});

canvas.addEventListener('pointercancel', () => {
  local.drag = null;
  pressStart = null;
  draw();
});

// 커서 모양으로 무엇이 잡히는지 알린다
canvas.addEventListener('pointermove', (ev) => {
  if (local.drag) { canvas.style.cursor = 'grabbing'; return; }
  if (local.calibrate || !local.snap?.canInput) { canvas.style.cursor = 'default'; return; }
  const { px, py } = pointOf(ev);
  canvas.style.cursor = hitTest(pitches(), px, py, rect()) ? 'grab' : 'crosshair';
});
```

- [ ] **Step 2: 방향키 미세 조정과 키보드 단축키 추가**

`console.js` 끝에 추가:

```js
// 방향키 연타를 한 번의 전송으로 묶는다 → 되돌리기 한 번에 원복된다.
const sendNudge = debounce((action) => send(action), 300);

function selectedPitch() {
  return pitches().find((p) => p.id === local.selectedId) ?? null;
}

window.addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement) return;

  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    send({ type: 'UNDO' });
    return;
  }
  if (ev.key.toLowerCase() === 'c') {
    document.getElementById('chkCalib').click();
    return;
  }
  if (ev.key === 'Escape') {
    local.selectedId = null;
    draw();
    return;
  }
  if (!local.snap?.canInput) return;

  if (/^[1-9]$/.test(ev.key)) {
    const p = pitches().find((q) => q.seq === Number(ev.key));
    if (p) { local.selectedId = p.id; draw(); }
    return;
  }

  const sel = selectedPitch();
  if (!sel) return;

  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    ev.preventDefault();
    send({ type: 'PITCH_DELETE', id: sel.id });
    return;
  }

  const step = ev.shiftKey ? 5 : 1;
  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
  if (!delta) return;
  ev.preventDefault();

  const r = rect();
  const base = nudge?.id === sel.id ? nudge : { id: sel.id, ...toPixels(sel.x, sel.z, r) };
  nudge = { id: sel.id, px: base.px + delta[0], py: base.py + delta[1] };
  local.drag = { ...nudge }; // 미리보기
  draw();

  const { x, z } = toNormalized(nudge.px, nudge.py, r);
  sendNudge({ type: 'PITCH_MOVE', id: sel.id, x, z });
});
```

`nudge` 선언을 `const client = connect(...)` **위로** 옮긴다. `onState` 안에서 참조하기 때문이다:

```js
let nudge = null; // { id, px, py } — 방향키 미세 조정 중인 위치
```

그리고 `connect(...)`의 `onState` 첫 줄에 아래 두 줄을 추가한다. 서버 상태가 도착하면 로컬 미리보기는 확정값으로 대체되므로 비운다:

```js
    nudge = null;
    local.drag = null;
```

- [ ] **Step 3: 수동 확인**

Run: `npm start`, 콘솔에서 이닝을 시작한 뒤:

| 확인 항목 | 기대 결과 |
|---|---|
| 존 경계에 걸친 공을 잡고 밖으로 천천히 드래그 | 고스트가 원위치에 남고, 경계를 넘는 순간 마커 색이 빨강→파랑으로 바뀐다 |
| 드래그 중 오버레이 탭 | 공이 움직이지 않는다 |
| 마우스를 놓은 순간 오버레이 탭 | 공이 새 위치로 한 번에 이동한다 |
| 공을 클릭만 하고 놓기 | 점선 링이 생기고 오버레이는 변하지 않는다 |
| 공 위에서 3px 미만으로 흔들다 놓기 | 새 공이 생기지 않는다 |
| 선택 후 `→` 5번 | 공이 오른쪽으로 5px 이동. `Ctrl+Z` 한 번에 원위치 |
| 선택 후 `Delete` | 공이 사라지고 뒤 번호가 앞으로 당겨진다 |
| `2` 키 | 2번 공이 선택된다 |

- [ ] **Step 4: 커밋**

```bash
git add public/console.js
git commit -m "feat: 공 선택·드래그 편집과 방향키 미세 조정 추가"
```

---

## Task 13: 콘솔 — 이닝 버튼, 2단 확인, 다시보기, 보정 모드

**Files:**
- Modify: `abs-overlay/public/console.js`

**Interfaces:**
- Consumes: Task 9의 `shouldExecute` / `CONFIRM_WINDOW_MS`, Task 11의 `local` / `send` / `refreshChrome` / `draw`
- Produces: 없음 (말단 화면)

- [ ] **Step 1: 2단 확인 버튼 배선 추가**

`console.js` 상단 import에 추가:

```js
import { shouldExecute, CONFIRM_WINDOW_MS } from './confirm.js';
```

`console.js` 끝에 추가:

```js
// data-confirm이 있는 버튼은 2단으로 동작한다.
// 모달을 띄우지 않으므로 포커스와 단축키를 잃지 않는다.
function wireConfirm(el, onConfirm, needsConfirm) {
  const original = el.textContent;
  let lastPressAt = null;
  let timer = null;

  const disarm = () => {
    lastPressAt = null;
    el.textContent = original;
    el.classList.remove('armed');
    if (timer) clearTimeout(timer);
    timer = null;
  };

  el.addEventListener('click', () => {
    if (!needsConfirm()) { onConfirm(); disarm(); return; }
    if (shouldExecute(lastPressAt, Date.now())) { onConfirm(); disarm(); return; }
    lastPressAt = Date.now();
    el.textContent = el.dataset.confirm;
    el.classList.add('armed');
    timer = setTimeout(disarm, CONFIRM_WINDOW_MS);
  });
}

const hasPitches = () => (local.snap?.state.game.pitches.length ?? 0) > 0;

document.getElementById('btnStart').addEventListener('click', () => send({ type: 'INNING_START' }));
document.getElementById('btnEnd').addEventListener('click', () => send({ type: 'INNING_END' }));
wireConfirm(document.getElementById('btnNext'), () => send({ type: 'INNING_NEXT' }), hasPitches);
wireConfirm(document.getElementById('btnClear'), () => send({ type: 'PITCH_CLEAR_ALL' }), hasPitches);

document.getElementById('btnUndo').addEventListener('click', () => send({ type: 'UNDO' }));
document.getElementById('btnDelete').addEventListener('click', () => {
  if (local.selectedId) send({ type: 'PITCH_DELETE', id: local.selectedId });
});
```

- [ ] **Step 2: 다시보기 배선 추가**

`console.js` 끝에 추가:

```js
const inningSelect = document.getElementById('inningSelect');

document.getElementById('btnReview').addEventListener('click', () => {
  const inning = Number(inningSelect.value);
  if (Number.isFinite(inning) && inning > 0) send({ type: 'REVIEW_ENTER', inning });
});
document.getElementById('btnLive').addEventListener('click', () => send({ type: 'REVIEW_EXIT' }));

function refreshInningOptions(innings) {
  const keep = inningSelect.value;
  inningSelect.innerHTML = '';
  if (innings.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = '저장된 이닝 없음';
    opt.value = '';
    inningSelect.append(opt);
    return;
  }
  for (const n of innings) {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = `${n}회`;
    inningSelect.append(opt);
  }
  if (innings.map(String).includes(keep)) inningSelect.value = keep;
}
```

`connect(...)`의 `onState` 안 `refreshChrome()` 호출 직전에 추가:

```js
    refreshInningOptions(msg.innings);
```

- [ ] **Step 3: 보정 모드와 슬라이더 배선 추가**

`console.js` 끝에 추가:

```js
const chkCalib = document.getElementById('chkCalib');
const rngAspect = document.getElementById('rngAspect');
const rngX = document.getElementById('rngX');
const rngY = document.getElementById('rngY');
const rngScale = document.getElementById('rngScale');

chkCalib.addEventListener('change', () => {
  local.calibrate = chkCalib.checked;
  local.selectedId = null;
  refreshChrome();
  draw();
});

rngAspect.addEventListener('input', () => send({ type: 'ZONE_SET', aspect: Number(rngAspect.value) }));

function sendPlacement() {
  send({
    type: 'PLACEMENT_SET',
    x: Number(rngX.value),
    y: Number(rngY.value),
    scale: Number(rngScale.value),
  });
}
for (const el of [rngX, rngY, rngScale]) el.addEventListener('input', sendPlacement);

// 슬라이더는 서버 값이 정본이다. 사용자가 잡고 있지 않을 때만 갱신한다.
function syncSliders(s) {
  const active = document.activeElement;
  const set = (el, v) => { if (el !== active) el.value = String(v); };
  set(rngAspect, s.zone.aspect);
  set(rngX, s.placement.x);
  set(rngY, s.placement.y);
  set(rngScale, s.placement.scale);
}
```

`connect(...)`의 `onState` 안 `refreshChrome()` 직전에 추가:

```js
    syncSliders(msg.state);
```

- [ ] **Step 4: 버튼 활성/비활성 반영**

`refreshChrome` 함수 끝에 추가:

```js
  const st = s?.game.status;
  const reviewing = Boolean(s?.review);
  document.getElementById('btnStart').disabled = !local.connected || reviewing || st === 'live';
  document.getElementById('btnEnd').disabled = !local.connected || reviewing || st !== 'live';
  document.getElementById('btnNext').disabled = !local.connected || reviewing || st !== 'ended';
  document.getElementById('btnLive').disabled = !reviewing;
  document.getElementById('btnReview').disabled = !local.connected || reviewing;
  for (const id of ['btnUndo', 'btnDelete', 'btnClear']) {
    document.getElementById(id).disabled = !local.snap?.canInput;
  }
```

- [ ] **Step 5: 수동 확인**

Run: `npm start`, 콘솔과 오버레이를 나란히 열고:

| 확인 항목 | 기대 결과 |
|---|---|
| `이닝 시작` | 덮개가 사라지고 `LIVE` 배지가 켜진다 |
| 공 3개 찍고 `이닝 종료` | 덮개에 `1회 종료됨 — 이닝 시작 또는 다음 이닝`. 다시보기 목록에 `1회`가 나타난다 |
| `이닝 시작` 다시 | 공 3개가 그대로 남고 입력이 재개된다 |
| `다음 이닝` 1회 클릭 | 버튼이 `다음 이닝으로?`로 바뀌고 붉어진다. 오버레이는 그대로 |
| 4초 기다림 | 버튼이 원래대로 돌아온다 |
| `다음 이닝` 두 번 연속 클릭 | 2회로 넘어가고 오버레이가 비워진다 |
| `1회` 선택 후 `보기` | 오버레이에 1회 공들과 `1회 다시보기` 라벨. 콘솔은 덮개로 잠긴다 |
| `라이브 복귀` | 2회 라이브 상태가 온전히 돌아온다 |
| `보정 모드` 체크 후 캔버스 클릭 | 공이 생기지 않는다 |
| 송출 X/Y/크기 슬라이더 | 오버레이의 존 위치·크기만 변하고 공의 색(판정)은 변하지 않는다 |
| 서버를 `Ctrl+C`로 끈다 | 오버레이는 마지막 화면을 유지, 콘솔은 `서버 연결 끊김 — 재연결 중…` |
| 서버를 다시 켠다 | 양쪽이 자동 재연결되고 존·배치 보정값이 복원된다 |

- [ ] **Step 6: 커밋**

```bash
git add public/console.js
git commit -m "feat: 이닝 조작·2단 확인·다시보기·보정 슬라이더 추가"
```

---

## Task 14: README와 OBS 연동 검증

**Files:**
- Create: `abs-overlay/README.md`

**Interfaces:**
- Consumes: 완성된 애플리케이션
- Produces: 없음

- [ ] **Step 1: `README.md` 작성**

```markdown
# 야구 ABS 존 오버레이

오퍼레이터가 브라우저에서 클릭한 지점을 스트라이크 존 좌표로 변환해 OBS 송출 화면에 오버레이한다.

설계 문서: `../docs/superpowers/specs/2026-09-02-abs-zone-overlay-design.md`

## 실행

```bash
npm install
npm start
```

- 오퍼레이터 콘솔: http://localhost:3000/console.html
- 송출 오버레이: http://localhost:3000/overlay.html

포트를 바꾸려면 `PORT=4000 npm start`.

## OBS 설정

| 항목 | 값 |
|---|---|
| 소스 종류 | 브라우저 |
| URL | `http://localhost:3000/overlay.html` |
| 폭 × 높이 | 1920 × 1080 |
| 보이지 않을 때 소스 종료 | **끄기** |
| 사용자 지정 CSS | 비움 |

첫 실행 시 콘솔에서 `보정 모드`를 켜고 송출 X/Y/크기 슬라이더로 존을 포수 뒤 카메라 앵글의 홈플레이트에 맞춘다. 이 값은 `config.json`에 저장되어 다음 실행에 복원된다.

## 조작

| 동작 | 방법 |
|---|---|
| 투구 기록 | 존 뷰의 빈 곳 클릭 |
| 공 선택 | 공 클릭 |
| 공 이동 | 공을 잡고 드래그 (놓는 순간 송출 반영) |
| 미세 조정 | 선택 후 방향키 (`Shift` 동시: 5px) |
| 공 삭제 | 선택 후 `Delete` |
| 되돌리기 | `Ctrl+Z` |
| 보정 모드 | `C` |

`이닝 종료`·`다음 이닝`·`모두 지우기`에는 단축키가 없다. 오타 한 번에 이닝이 넘어가는 사고를 막기 위한 것이다.

## 저장되는 파일

- `data/<YYYY-MM-DD>.json` — 이닝별 투구 기록. `다시보기`로 다시 송출할 수 있다
- `config.json` — 존 종횡비와 송출 배치 보정값

둘 다 git에 올리지 않는다.

## 테스트

```bash
npm test
```

렌더링과 OBS 합성은 자동 테스트 대상이 아니다. 아래 체크리스트로 수동 확인한다.

## 수동 검증 체크리스트

- [ ] OBS 브라우저 소스에서 배경이 투명하다 (아래 영상이 보인다)
- [ ] 존 테두리·공·라벨이 흰 배경과 밝은 하늘 위에서 모두 읽힌다
- [ ] 공을 드래그하는 동안 OBS 화면의 공이 움직이지 않는다
- [ ] 마우스를 놓는 순간 OBS 화면의 공이 새 위치로 한 번에 이동한다
- [ ] OBS 씬을 전환해 소스를 리로드해도 현재 상태가 그대로 복원된다
- [ ] 서버를 껐다 켜면 양쪽이 자동 재연결되고 보정값이 복원된다
- [ ] 서버가 꺼진 동안 OBS 화면이 지워지지 않는다
- [ ] 다시보기 중 OBS 화면 좌상단에 `N회 다시보기` 라벨이 보인다
```

- [ ] **Step 2: 전체 테스트 실행**

Run: `npm test`
Expected: PASS — 전체 통과

- [ ] **Step 3: 수동 검증 체크리스트 수행**

OBS Studio가 설치된 머신에서 README의 체크리스트를 항목별로 확인한다. 실패 항목이 있으면 해당 태스크로 돌아가 수정하고 다시 검증한다.

작성 환경(Linux ARM, OBS 없음)에서는 브라우저만으로 확인 가능한 항목까지만 수행하고, OBS 항목은 미검증으로 남긴다.

- [ ] **Step 4: 커밋**

```bash
git add README.md
git commit -m "docs: 실행 방법·OBS 설정·수동 검증 체크리스트 추가"
```

---

## 자기 점검 결과

**스펙 커버리지** — 스펙의 각 절을 어느 태스크가 구현하는지:

| 스펙 절 | 태스크 |
|---|---|
| §4 좌표계 | Task 1 |
| §5 상태 모델 | Task 3 (골격), Task 4 (`id`/`seq`), Task 11 (콘솔 로컬 상태) |
| §6 상태 기계 · 전이 표 | Task 3 (이닝), Task 4 (투구), Task 5 (되돌리기), Task 6 (다시보기·보정) |
| §6 입력 가능 조건 | Task 3 (`canInput`), Task 8 (전송), Task 11 (덮개) |
| §7 저장 형식 | Task 7 |
| §8 콘솔 레이아웃·모드 | Task 11, Task 13 |
| §8 상호작용 규칙·드래그 피드백 | Task 2, Task 12 |
| §8 단축키·정밀 조정 | Task 12 |
| §8 2단 확인 | Task 9 (판정), Task 13 (배선) |
| §8 입력 불가 표시 | Task 9 (문구), Task 11 (표시) |
| §9 오버레이 렌더링 | Task 10 |
| §9 OBS 설정 | Task 14 |
| §10 오류 처리 | Task 7 (손상 파일), Task 8 (저장 실패·잘못된 메시지), Task 9 (재연결), Task 10 (마지막 화면 유지) |
| §11 테스트 | Task 1~9의 테스트 단계 |

누락 없음.

**타입 일관성** — 태스크 간에 오가는 이름을 확인했다:

- `zoneRect(cx, cy, halfH, aspect)`는 Task 1에서 정의하고 Task 2·10·11이 같은 인자 순서로 호출한다.
- 공 객체는 라이브에서 `{ id, seq, x, z, verdict }`, 저장·다시보기에서 `{ seq, x, z, verdict }`(`id` 없음)다. Task 10의 `keyOf`와 Task 11의 `hitTest` 호출이 이 차이를 다룬다 — 다시보기 중에는 `canInput`이 거짓이라 히트 테스트 경로에 진입하지 않는다.
- `SAVE_CONFIG` 효과는 Task 6에서 `{ type, zone, placement }`로 정의하고 Task 8이 같은 필드로 읽는다.
- `STATE` 메시지는 Task 8에서 `{ type, state, canInput, innings }`로 정의하고 Task 9(`statusMessage`의 인자), Task 10·11이 같은 필드를 쓴다.

**플레이스홀더** — 없음. 모든 코드 단계에 실제 코드가 들어 있다.

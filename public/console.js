import { zoneRect, toPixels, toNormalized, judge } from './zone.js';
import { hitTest, isDrag, resolvePointerUp } from './interaction.js';
import { statusMessage } from './console-status.js';
import { connect } from './ws-client.js';
import { debounce } from './debounce.js';
import { shouldExecute, CONFIRM_WINDOW_MS } from './confirm.js';

const VIEW_W = 720;
const VIEW_H = 720;
const ZONE_HALF_H = VIEW_H / 2 / 2.5; // 클릭 영역은 존의 2.5배
const STRIKE = '#ff4d4f';
const BALL = '#4d9bff';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const blocker = document.getElementById('blocker');
const blockerText = document.getElementById('blockerText');
const calibBanner = document.getElementById('calibBanner');
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
    let verdict = p.verdict;
    if (dragging) {
      const n = toNormalized(local.drag.px, local.drag.py, r);
      verdict = judge(n.x, n.z);
    }
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
  // 보정 모드는 콘솔 로컬 상태이므로 서버 상태의 순수 함수인 statusMessage가
  // 알 수 없다. 그래서 문구가 여기에 있다.
  calibBanner.hidden = !local.calibrate;
  conn.textContent = local.connected ? '● 연결됨' : '● 연결 끊김';
  conn.classList.toggle('ok', local.connected);
  if (s) {
    inningLabel.textContent = `${s.game.inning}회`;
    statusBadge.textContent = s.game.status.toUpperCase();
    statusBadge.classList.toggle('live', s.game.status === 'live');
  }

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

  // 보정 컨트롤은 보정 모드에서만 만질 수 있다.
  // 라이브 중 실수로 송출 존을 움직이는 사고를 구조적으로 막는다.
  for (const el of [rngAspect, rngX, rngY, rngScale]) {
    el.disabled = !local.calibrate;
  }
}

function pointOf(ev) {
  const b = canvas.getBoundingClientRect();
  return { px: ((ev.clientX - b.left) * VIEW_W) / b.width, py: ((ev.clientY - b.top) * VIEW_H) / b.height };
}

let nudge = null; // { id, px, py } — 방향키 미세 조정 중인 위치

const client = connect(`ws://${location.host}`, {
  onState(msg) {
    nudge = null;
    local.drag = null;
    local.snap = msg;
    if (!msg.state.game.pitches.some((p) => p.id === local.selectedId)) local.selectedId = null;
    refreshInningOptions(msg.innings);
    syncSliders(msg.state);
    refreshChrome();
    draw();
  },
  onOpen() { local.connected = true; refreshChrome(); },
  onClose() { local.connected = false; refreshChrome(); },
});

export function send(action) {
  client.send(action);
}

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
  // 무엇을 보낼지는 순수 함수가 결정한다. null이면 선택만 하고 서버 통신 없음.
  const action = resolvePointerUp(pressStart, px, py);
  const r = rect();

  if (action?.kind === 'move') {
    const n = toNormalized(action.px, action.py, r);
    send({ type: 'PITCH_MOVE', id: action.id, x: n.x, z: n.z });
  } else if (action?.kind === 'add') {
    const n = toNormalized(action.px, action.py, r);
    send({ type: 'PITCH_ADD', x: n.x, z: n.z });
  }

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
  // 수식자 없는 C만 받는다. Ctrl+C(복사)·Ctrl+Shift+C(개발자도구)로
  // 보정 모드가 켜지면 이후 찍는 공이 조용히 사라진다.
  if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.toLowerCase() === 'c') {
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

// disabled 한 겹으로는 부족하다. 키보드 경로(포커스된 슬라이더 + 방향키)와
// 미래의 마크업 변경까지 막으려면 핸들러 자체에 게이트가 있어야 한다.
rngAspect.addEventListener('input', () => {
  if (!local.calibrate) return;
  send({ type: 'ZONE_SET', aspect: Number(rngAspect.value) });
});

function sendPlacement() {
  if (!local.calibrate) return;
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

export { rect, pitches, draw, refreshChrome, pointOf, canvas };
refreshChrome();
draw();

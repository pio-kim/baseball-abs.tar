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

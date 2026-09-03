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

// pointerup에서 무엇을 할지 결정한다. DOM 없이 테스트 가능하도록 순수 함수로 둔다.
//   pressStart: { px, py, hitId }  — pointerdown 시점의 좌표와 그때 잡힌 공의 id (없으면 null)
//   px, py: pointerup 시점의 좌표
// 반환:
//   { kind: 'move', id, px, py } — 기존 공을 임계값 이상 끌었다
//   { kind: 'add', px, py }      — 빈 곳을 눌렀다. 좌표는 **누른 지점**이다
//   null                          — 기존 공을 클릭만 했다 (선택만, 서버 통신 없음)
export function resolvePointerUp(pressStart, px, py) {
  if (pressStart.hitId) {
    if (isDrag(pressStart.px, pressStart.py, px, py)) {
      return { kind: 'move', id: pressStart.hitId, px, py };
    }
    return null;
  }
  return { kind: 'add', px: pressStart.px, py: pressStart.py };
}

// 드래그 중에는 어떤 서버 액션도 만들어지지 않는다.
// 이 함수가 항상 null인 것이 "드래그 중 송출 미반영"의 계약이다.
export function resolvePointerMove() {
  return null;
}

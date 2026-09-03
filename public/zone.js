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

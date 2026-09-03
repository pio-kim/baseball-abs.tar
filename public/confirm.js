export const CONFIRM_WINDOW_MS = 3000;

// 두 번째 누름이 확인 창 안에 들어왔는지 판정한다.
// 모달 없이 버튼 안에서 확인을 받기 위한 것 — 방송 중 모달은
// 포커스를 훔치고 단축키를 먹는다.
export function shouldExecute(lastPressAt, now, windowMs = CONFIRM_WINDOW_MS) {
  if (lastPressAt === null || lastPressAt === undefined) return false;
  return now - lastPressAt <= windowMs;
}

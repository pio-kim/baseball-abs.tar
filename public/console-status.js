// 입력이 불가한 이유를 한 줄로 돌려준다. 입력 가능하면 null.
// 우선순위: 연결 > 다시보기 > 이닝 상태.
export function statusMessage({ state, canInput, connected }) {
  if (!connected) return '서버 연결 끊김 — 재연결 중…';
  if (state.review) return `${state.review.inning}회 다시보기 중 — 라이브 복귀`;
  if (state.game.status === 'idle') return '이닝 시작을 눌러주세요';
  if (state.game.status === 'ended') return `${state.game.inning}회 종료됨 — 이닝 시작 또는 다음 이닝`;
  return canInput ? null : '입력할 수 없는 상태입니다';
}

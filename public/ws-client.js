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
  let reconnectTimer = null;

  function open() {
    if (closed) return;
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
      reconnectTimer = setTimeout(open, nextDelay(attempt));
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
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
    },
  };
}

import { judge } from './public/zone.js';

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

// WS는 누구나 임의 JSON을 보낼 수 있는 표면이다. NaN이 좌표나 종횡비에
// 들어가면 오버레이의 존과 공이 전부 사라진다 — 화면이 사라지는 게 최악이다.
function finite(...values) {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function reseq(pitches) {
  return pitches.map((p, i) => ({ ...p, seq: i + 1 }));
}

// 변경 직전의 pitches를 스냅샷으로 쌓는다.
// 역연산을 구현하는 것보다 단순하고, 데이터가 작아 부담이 없다.
function pushUndo(state) {
  const snap = { pitches: state.game.pitches, nextId: state.nextId };
  return { ...state, undoStack: [...state.undoStack, snap].slice(-UNDO_LIMIT) };
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

    case 'PITCH_ADD': {
      if (!canInput(state)) return warn(state, '입력 가능 상태가 아닙니다');
      if (!finite(action.x, action.z)) return warn(state, '좌표가 숫자가 아닙니다');
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
      if (!finite(action.x, action.z)) return warn(state, '좌표가 숫자가 아닙니다');
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

    case 'REVIEW_ENTER':
      return {
        state: { ...state, review: { inning: action.inning, pitches: action.pitches } },
        effects: [],
      };

    case 'REVIEW_EXIT':
      return { state: { ...state, review: null }, effects: [] };

    case 'ZONE_SET': {
      if (!finite(action.aspect)) return warn(state, '종횡비가 숫자가 아닙니다');
      const zone = { aspect: action.aspect };
      return {
        state: { ...state, zone },
        effects: [{ type: 'SAVE_CONFIG', zone, placement: state.placement }],
      };
    }

    case 'PLACEMENT_SET': {
      if (!finite(action.x, action.y, action.scale)) return warn(state, '배치값이 숫자가 아닙니다');
      const placement = { x: action.x, y: action.y, scale: action.scale };
      return {
        state: { ...state, placement },
        effects: [{ type: 'SAVE_CONFIG', zone: state.zone, placement }],
      };
    }

    default:
      return warn(state, `알 수 없는 액션: ${action.type}`);
  }
}

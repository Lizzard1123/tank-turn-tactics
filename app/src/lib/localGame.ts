import {
  applyEvent, createInitialState,
  type ActionType, type GameConfig, type GameEvent, type GameState, type PlayerSpec,
} from '@ttt/engine';

export interface LocalGameConfig {
  seed?: number;
  board?: number;
  startingHp?: number;
  startingAp?: number;
  baseRange?: number;
  apPerDay?: number;
  upgradeCost?: number;
  apIntervalMinutes?: number | null;
}

const DEFAULT_CONFIG: GameConfig = {
  seed: Date.now(),
  board: 8,
  startingHp: 3,
  startingAp: 4,
  baseRange: 2,
  apPerDay: 1,
  upgradeCost: 2,
  apIntervalMinutes: 0,
};

// Local (test-mode) player. Bots are placed by the engine at start.
const ME_ID = 'me';

function defaultSpecs(): PlayerSpec[] {
  return [
    { id: ME_ID, name: 'You', isBot: false, botDifficulty: null },
    { id: 'bot-1', name: 'Bot 1', isBot: true, botDifficulty: 'easy' },
    { id: 'bot-2', name: 'Bot 2', isBot: true, botDifficulty: 'easy' },
    { id: 'bot-3', name: 'Bot 3', isBot: true, botDifficulty: 'easy' },
  ];
}

export interface LocalGame {
  state: () => GameState;
  subscribe(listener: () => void): () => void;
  startApDrip(intervalMs: number, onTick?: () => void): void;
  stopApDrip(): void;
  apply(type: ActionType, payload: Record<string, unknown>): void;
}

export function createLocalGame(config?: LocalGameConfig): LocalGame {
  const cfg: GameConfig = {
    seed: config?.seed ?? DEFAULT_CONFIG.seed,
    board: config?.board ?? DEFAULT_CONFIG.board,
    startingHp: config?.startingHp ?? DEFAULT_CONFIG.startingHp,
    startingAp: config?.startingAp ?? DEFAULT_CONFIG.startingAp,
    baseRange: config?.baseRange ?? DEFAULT_CONFIG.baseRange,
    apPerDay: config?.apPerDay ?? DEFAULT_CONFIG.apPerDay,
    upgradeCost: config?.upgradeCost ?? DEFAULT_CONFIG.upgradeCost,
    apIntervalMinutes: config?.apIntervalMinutes ?? DEFAULT_CONFIG.apIntervalMinutes,
  };

  let state = createInitialState(cfg, defaultSpecs());
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const notify = () => { for (const listener of listeners) listener(); };

  function apply(type: ActionType, payload: Record<string, unknown>) {
    const event: GameEvent = {
      seq: state.seq + 1,
      type,
      actorId: ME_ID,
      createdAt: new Date().toISOString(),
      payload,
    };
    state = applyEvent(state, event);
    notify();
  }

  // Client-side AP drip: every intervalMs all alive players gain apPerDay AP.
  function startApDrip(intervalMs: number, onTick?: () => void) {
    stopApDrip();
    timer = setInterval(() => {
      const event: GameEvent = {
        seq: state.seq + 1,
        type: 'daily_tick',
        actorId: 'system',
        createdAt: new Date().toISOString(),
        payload: { apGained: cfg.apPerDay },
      };
      state = applyEvent(state, event);
      notify();
      onTick?.();
    }, intervalMs);
  }

  function stopApDrip() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return {
    state: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    startApDrip,
    stopApDrip,
    apply,
  };
}

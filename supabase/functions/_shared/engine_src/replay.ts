import { applyEvent } from './reducer.ts';
import { createInitialState, type PlayerSpec } from './state.ts';
import type { GameConfig, GameEvent, GameState } from './types.ts';

export function replay(config: GameConfig, specs: PlayerSpec[], events: GameEvent[]): GameState {
  let state = createInitialState(config, specs);
  for (const e of events) state = applyEvent(state, e);
  return state;
}

export function applyEvents(state: GameState, events: GameEvent[]): GameState {
  let s = state;
  for (const e of events) s = applyEvent(s, e);
  return s;
}

export function replayToSeq(config: GameConfig, specs: PlayerSpec[], events: GameEvent[], toSeq: number): GameState {
  return replay(config, specs, events.filter(e => e.seq <= toSeq));
}

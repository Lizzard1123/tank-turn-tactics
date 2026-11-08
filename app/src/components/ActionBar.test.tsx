import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActionBar from './ActionBar';
import type { GameState } from '@ttt/engine';

const state = (overrides?: Partial<GameState>): GameState => ({
  seq: 0, day: 1, tickClockMinutes: 0,
  config: { seed: 1, board: 8, startingHp: 3, startingAp: 1, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 },
  players: {
    p1: { id: 'p1', name: 'me', pos: { x: 0, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
    p2: { id: 'p2', name: 'foe', pos: { x: 2, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
  },
  order: ['p1', 'p2'], pendingVotes: [], winner: null, log: [],
  ...overrides,
});

const props = (s: GameState, mode: 'none' | 'move' | 'attack' | 'give_ap', onAction = vi.fn(), onModeChange = vi.fn()) =>
  ({ state: s, me: 'p1', mode, onAction, onModeChange });

describe('ActionBar', () => {
  test('shows AP counter and upgrade cost label', () => {
    render(<ActionBar {...props(state(), 'none')} />);
    expect(screen.getByTestId('ap-counter')).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /upgrade range/i })).toHaveTextContent(/2/);
  });

  test('move enabled with AP; upgrade disabled when too poor', () => {
    const s = state();
    s.players.p1.ap = 1;
    render(<ActionBar {...props(s, 'none')} />);
    expect(screen.getByRole('button', { name: /move/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /upgrade range/i })).toBeDisabled();
  });

  test('move click selects move mode (no immediate action)', () => {
    const onAction = vi.fn();
    const onModeChange = vi.fn();
    render(<ActionBar {...props(state(), 'none', onAction, onModeChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /move/i }));
    expect(onAction).not.toHaveBeenCalled();
    expect(onModeChange).toHaveBeenCalledWith('move');
  });

  test('attack click in none-mode selects attack; in attack-mode acts on target', () => {
    const onAction = vi.fn();
    const onModeChange = vi.fn();
    const { unmount } = render(<ActionBar {...props(state(), 'none', onAction, onModeChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /attack/i }));
    expect(onModeChange).toHaveBeenCalledWith('attack');
    expect(onAction).not.toHaveBeenCalled();
    unmount();

    render(<ActionBar {...props(state(), 'attack', onAction, onModeChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /attack/i }));
    expect(onAction).toHaveBeenCalledWith('attack', { targetId: 'p2' });
  });

  test('attack disabled when no enemy in range', () => {
    const s = state();
    s.players.p2.pos = { x: 7, y: 7 };
    render(<ActionBar {...props(s, 'attack')} />);
    expect(screen.getByRole('button', { name: /attack/i })).toBeDisabled();
  });

  test('give AP acts on target in give mode', () => {
    const onAction = vi.fn();
    render(<ActionBar {...props(state(), 'give_ap', onAction)} />);
    expect(screen.getByRole('button', { name: /give ap/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /give ap/i }));
    expect(onAction).toHaveBeenCalledWith('give_ap', { targetId: 'p2', amount: 1 });
  });

  test('upgrade range fires immediately', () => {
    const onAction = vi.fn();
    const s = state();
    s.players.p1.ap = 5;
    render(<ActionBar {...props(s, 'none', onAction)} />);
    fireEvent.click(screen.getByRole('button', { name: /upgrade range/i }));
    expect(onAction).toHaveBeenCalledWith('upgrade_range', {});
  });
});

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
  order: ['p1', 'p2'], pendingVotes: [], jury: [], winner: null, log: [],
  ...overrides,
});

const props = (s: GameState, mode: 'none' | 'move' | 'attack' | 'give_ap' | 'give_heart', onAction = vi.fn(), onModeChange = vi.fn()) =>
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

  test('attack click only arms the mode — never picks a target or confirms', () => {
    const onAction = vi.fn();
    const onModeChange = vi.fn();
    render(<ActionBar {...props(state(), 'none', onAction, onModeChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /attack/i }));
    expect(onModeChange).toHaveBeenCalledWith('attack');
    expect(onAction).not.toHaveBeenCalled();
  });

  test('clicking the active attack button cancels; onAction is never called', () => {
    const onAction = vi.fn();
    const onModeChange = vi.fn();
    render(<ActionBar {...props(state(), 'attack', onAction, onModeChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /attack/i }));
    expect(onModeChange).toHaveBeenCalledWith('none');
    expect(onAction).not.toHaveBeenCalled();
  });

  test('attack stays enabled in active mode with no enemy in range (so it can toggle off)', () => {
    const s = state();
    s.players.p2.pos = { x: 7, y: 7 };
    render(<ActionBar {...props(s, 'attack')} />);
    expect(screen.getByRole('button', { name: /attack/i })).toBeEnabled();
  });

  test('toggle-off: clicking the active attack button with no target unselects the mode', () => {
    const onAction = vi.fn();
    const onModeChange = vi.fn();
    const s = state();
    s.players.p2.pos = { x: 7, y: 7 }; // nothing in range
    render(<ActionBar {...props(s, 'attack', onAction, onModeChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /attack/i }));
    expect(onModeChange).toHaveBeenCalledWith('none');
    expect(onAction).not.toHaveBeenCalled();
  });

  test('toggle-off: clicking the active move button unselects the mode', () => {
    const onModeChange = vi.fn();
    render(<ActionBar {...props(state(), 'move', vi.fn(), onModeChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /move/i }));
    expect(onModeChange).toHaveBeenCalledWith('none');
  });

  test('toggle-off: clicking the active give AP button with no target unselects the mode', () => {
    const onAction = vi.fn();
    const onModeChange = vi.fn();
    const s = state();
    s.players.p2.pos = { x: 7, y: 7 };
    render(<ActionBar {...props(s, 'give_ap', onAction, onModeChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /give ap/i }));
    expect(onModeChange).toHaveBeenCalledWith('none');
    expect(onAction).not.toHaveBeenCalled();
  });

  test('toggle-off: clicking the active give heart button with no target unselects the mode', () => {
    const onAction = vi.fn();
    const onModeChange = vi.fn();
    const s = state({ config: { ...state().config, heartGifts: true } });
    render(<ActionBar {...props(s, 'give_heart', onAction, onModeChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /give heart/i }));
    expect(onModeChange).toHaveBeenCalledWith('none');
    expect(onAction).not.toHaveBeenCalled();
  });

  test('give AP click only arms the mode — never picks a target or confirms', () => {
    const onAction = vi.fn();
    const onModeChange = vi.fn();
    render(<ActionBar {...props(state(), 'none', onAction, onModeChange)} />);
    expect(screen.getByRole('button', { name: /give ap/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /give ap/i }));
    expect(onModeChange).toHaveBeenCalledWith('give_ap');
    expect(onAction).not.toHaveBeenCalled();
  });

  test('clicking the active give AP button cancels; onAction is never called', () => {
    const onAction = vi.fn();
    const onModeChange = vi.fn();
    render(<ActionBar {...props(state(), 'give_ap', onAction, onModeChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /give ap/i }));
    expect(onModeChange).toHaveBeenCalledWith('none');
    expect(onAction).not.toHaveBeenCalled();
  });

  test('give heart click only arms the mode — even a lone grave is never auto-picked', () => {
    const onAction = vi.fn();
    const onModeChange = vi.fn();
    const s = state({ config: { ...state().config, heartGifts: true, revives: true } });
    s.players.p2.hp = 0; // the only in-range candidate is a grave — still no auto-pick
    render(<ActionBar {...props(s, 'none', onAction, onModeChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /give heart/i }));
    expect(onModeChange).toHaveBeenCalledWith('give_heart');
    expect(onAction).not.toHaveBeenCalled();
  });

  test('upgrade range fires immediately', () => {
    const onAction = vi.fn();
    const s = state();
    s.players.p1.ap = 5;
    render(<ActionBar {...props(s, 'none', onAction)} />);
    fireEvent.click(screen.getByRole('button', { name: /upgrade range/i }));
    expect(onAction).toHaveBeenCalledWith('upgrade_range', {});
  });

  test('give AP with a dead in-range target toggles off instead of acting', () => {
    const onAction = vi.fn();
    const onModeChange = vi.fn();
    const s = state();
    s.players.p2.hp = 0; // dead — give_ap to a grave is rejected server-side
    render(<ActionBar {...props(s, 'give_ap', onAction, onModeChange)} />);
    fireEvent.click(screen.getByRole('button', { name: /give ap/i }));
    expect(onModeChange).toHaveBeenCalledWith('none');
    expect(onAction).not.toHaveBeenCalled();
  });

  // --- jury AP tints: golden the day after a bonus, purple when haunted ---

  test('AP counter is un-tinted on a normal day', () => {
    render(<ActionBar {...props(state(), 'none')} />);
    expect(screen.getByTestId('ap-counter')).not.toHaveAttribute('data-ap-tint');
  });

  test('AP counter goes golden the day the jury bonus landed on me', () => {
    const s = state({ day: 4, haunted: null, lastBonus: [{ id: 'p1', day: 4 } as never] });
    render(<ActionBar {...props(s, 'none')} />);
    expect(screen.getByTestId('ap-counter')).toHaveAttribute('data-ap-tint', 'golden');
  });

  test('golden tint expires the day after (bonus day does not match)', () => {
    const s = state({ day: 5, haunted: null, lastBonus: [{ id: 'p1', day: 4 } as never] });
    render(<ActionBar {...props(s, 'none')} />);
    expect(screen.getByTestId('ap-counter')).not.toHaveAttribute('data-ap-tint');
  });

  test('AP counter goes purple when the jury haunted me', () => {
    const s = state({ day: 4, haunted: 'p1', lastBonus: [] });
    render(<ActionBar {...props(s, 'none')} />);
    expect(screen.getByTestId('ap-counter')).toHaveAttribute('data-ap-tint', 'purple');
  });

  test('haunt beats bonus when both fired the same tick', () => {
    const s = state({ day: 4, haunted: 'p1', lastBonus: [{ id: 'p1', day: 4 } as never] });
    render(<ActionBar {...props(s, 'none')} />);
    expect(screen.getByTestId('ap-counter')).toHaveAttribute('data-ap-tint', 'purple');
  });

  test('someone else\'s bonus or haunt does not tint my counter', () => {
    const s = state({ day: 4, haunted: 'p2', lastBonus: [{ id: 'p2', day: 4 } as never] });
    render(<ActionBar {...props(s, 'none')} />);
    expect(screen.getByTestId('ap-counter')).not.toHaveAttribute('data-ap-tint');
  });

});

describe('Action Points popup', () => {
  test('the counter is a button that opens the info dialog', () => {
    render(<ActionBar {...props(state(), 'none')} />);
    const counter = screen.getByTestId('ap-counter');
    expect(counter.tagName).toBe('BUTTON');
    expect(screen.queryByTestId('ap-info-dialog')).toBeNull();
    fireEvent.click(counter);
    expect(screen.getByTestId('ap-info-dialog')).toBeInTheDocument();
  });

  test('the dialog is titled Action Points with holdings and lifetime total', () => {
    const s = state();
    s.players.p1.ap = 7;
    s.players.p1.apEarned = 19;
    render(<ActionBar {...props(s, 'none')} />);
    fireEvent.click(screen.getByTestId('ap-counter'));
    expect(screen.getByTestId('ap-info-title')).toHaveTextContent('Action Points');
    expect(screen.getByTestId('ap-info-body')).toHaveTextContent('You have 7 AP');
    expect(screen.getByTestId('ap-info-body')).toHaveTextContent('19 have been given out in total');
  });

  test('an untracked legacy player falls back to current ap as the total', () => {
    const s = state();
    s.players.p1.ap = 5;
    delete (s.players.p1 as { apEarned?: number }).apEarned;
    render(<ActionBar {...props(s, 'none')} />);
    fireEvent.click(screen.getByTestId('ap-counter'));
    expect(screen.getByTestId('ap-info-body')).toHaveTextContent('5 have been given out in total');
  });

  test('golden tint explains the jury bonus; purple explains the haunt', () => {
    const golden = state({ lastBonus: [{ id: 'p1', day: 1 }] } as Partial<GameState>);
    render(<ActionBar {...props(golden, 'none')} />);
    fireEvent.click(screen.getByTestId('ap-counter'));
    expect(screen.getByTestId('ap-info-tint')).toHaveTextContent(/awarded you bonus AP/);
  });

  test('purple tint explains the haunt', () => {
    const purple = state({ haunted: 'p1' } as Partial<GameState>);
    render(<ActionBar {...props(purple, 'none')} />);
    fireEvent.click(screen.getByTestId('ap-counter'));
    expect(screen.getByTestId('ap-info-tint')).toHaveTextContent(/haunted you/);
  });

  test('no tint means no explanation line', () => {
    render(<ActionBar {...props(state(), 'none')} />);
    fireEvent.click(screen.getByTestId('ap-counter'));
    expect(screen.queryByTestId('ap-info-tint')).toBeNull();
  });

  test('OK is the only button and dismisses the popup', () => {
    render(<ActionBar {...props(state(), 'none')} />);
    fireEvent.click(screen.getByTestId('ap-counter'));
    const actions = screen.getByTestId('ap-info-dialog').querySelector('.confirm-actions');
    expect(actions?.querySelectorAll('button')).toHaveLength(1);
    expect(screen.getByTestId('ap-info-ok')).toHaveTextContent('OK');
    fireEvent.click(screen.getByTestId('ap-info-ok'));
    expect(screen.queryByTestId('ap-info-dialog')).toBeNull();
  });

  test('clicking the overlay dismisses the popup', () => {
    render(<ActionBar {...props(state(), 'none')} />);
    fireEvent.click(screen.getByTestId('ap-counter'));
    fireEvent.click(screen.getByTestId('ap-info-overlay'));
    expect(screen.queryByTestId('ap-info-dialog')).toBeNull();
  });
});

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Game from './Game';
import * as api from '../lib/api';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, action: vi.fn() };
});

vi.mock('../lib/useGameEvents', () => ({
  useGameEvents: vi.fn(),
}));
import { useGameEvents } from '../lib/useGameEvents';

vi.mock('../components/Board', () => ({
  default: ({ onCellTap }: { onCellTap: (p: { x: number; y: number }) => void }) => (
    <div data-testid="board">
      <button data-testid="tap-legal" onClick={() => onCellTap({ x: 1, y: 0 })}>tap</button>
    </div>
  ),
}));

const STATE = {
  seq: 3, day: 1, tickClockMinutes: 0,
  config: { seed: 1, board: 8, startingHp: 3, startingAp: 1, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 2 },
  players: {
    p1: { id: 'p1', name: 'me', pos: { x: 0, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
    p2: { id: 'p2', name: 'foe', pos: { x: 1, y: 1 }, hp: 3, ap: 1, range: 2, isBot: true, botDifficulty: 'easy' },
  },
  order: ['p1', 'p2'], pendingVotes: [], jury: [], winner: null, log: [{ seq: 1, text: 'game started' }],
};

function setup(hookOverride?: Record<string, unknown>) {
  vi.mocked(useGameEvents).mockReturnValue({
    state: STATE,
    events: [],
    me: 'p1',
    detail: { id: 'g1', name: 'g', mode: 'test', status: 'active', config: STATE.config, createdBy: 'p1', inviteCode: 'i', generation: 1, forkSeq: null },
    loading: false,
    error: null,
    refresh: vi.fn(),
    ...hookOverride,
  } as never);
  return render(
    <MemoryRouter initialEntries={['/game/g1']}>
      <Routes>
        <Route path="/game/:gameId" element={<Game />} />
        <Route path="/game/:gameId/jury" element={<div>JURY PAGE</div>} />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('ttt_token', 'tok-1');
});

describe('Game page', () => {
  test('renders status bar, action bar, feed', () => {
    setup();
    expect(screen.getByTestId('board')).toBeInTheDocument();
    expect(screen.getByTestId('ap-counter')).toBeInTheDocument();
    expect(screen.getByTestId('event-feed')).toBeInTheDocument();
    expect(screen.getByText(/day 1/i)).toBeInTheDocument();
  });

  test('move: select move mode then tap legal cell posts action', async () => {
    vi.mocked(api.action).mockResolvedValue({ ok: true, seq: 4, state: STATE });
    setup();
    fireEvent.click(screen.getByTestId('btn-move'));
    fireEvent.click(screen.getByTestId('tap-legal'));
    await waitFor(() =>
      expect(vi.mocked(api.action)).toHaveBeenCalledWith('tok-1', 'g1', 'move', { to: { x: 1, y: 0 } }),
    );
  });

  test('server failure refetches and shows error, state not corrupted', async () => {
    const refresh = vi.fn();
    vi.mocked(api.action).mockRejectedValue(new Error('server rejected'));
    setup({ refresh });
    // attack p2 who is in range: first click selects attack mode, second commits
    fireEvent.click(screen.getByTestId('btn-attack'));
    fireEvent.click(screen.getByTestId('btn-attack'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/server rejected/i));
    expect(refresh).toHaveBeenCalled();
  });

  test('finished game shows winner banner and dashboard link', () => {
    setup({
      state: { ...STATE, winner: 'p1' },
    });
    expect(screen.getByTestId('winner-banner')).toBeInTheDocument();
    expect(screen.getByText(/back to dashboard/i)).toBeInTheDocument();
  });

  test('dead player routes to jury screen', () => {
    setup({
      state: { ...STATE, players: { ...STATE.players, p1: { ...STATE.players.p1, hp: 0 } } },
    });
    expect(screen.getByText('JURY PAGE')).toBeInTheDocument();
  });
});

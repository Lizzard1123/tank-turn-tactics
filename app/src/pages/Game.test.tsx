import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
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
    history: [],
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
        <Route path="/games" element={<div>GAMES PAGE</div>} />
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

  test('optimistic: board state updates immediately while the request is in flight', async () => {
    // never resolves: the only way AP can drop is the optimistic local apply
    vi.mocked(api.action).mockImplementation(() => new Promise(() => {}));
    setup();
    fireEvent.click(screen.getByTestId('btn-move'));
    fireEvent.click(screen.getByTestId('tap-legal'));
    expect(screen.getByTestId('ap-counter')).toHaveTextContent('0 AP');
  });

  test('optimistic rollback: rejected action returns AP to the authoritative value', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.action).mockRejectedValue(new Error('nope'));
    setup({ refresh });
    fireEvent.click(screen.getByTestId('btn-move'));
    fireEvent.click(screen.getByTestId('tap-legal'));
    await waitFor(() => expect(screen.getByTestId('ap-counter')).toHaveTextContent('1 AP'));
  });

  test('AP countdown keeps ticking through history scrubbing (does not reset)', async () => {
    try {
      vi.useFakeTimers();
      setup({
        history: [
          { seq: 1, type: 'daily_tick', actorId: 'system', createdAt: 't', payload: { apGained: 1, elapsedMinutes: 1 }, generation: 1 },
        ],
      });
      // live state: 2-minute interval → 120s countdown
      expect(screen.getByTestId('ap-timer')).toHaveTextContent(/120/);
      // scrub to the ticked state (its clock says 1 minute elapsed → a buggy
      // displayState-derived countdown would reset to 60)
      fireEvent.click(screen.getByRole('button', { name: /view state after event 1/i }));
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(screen.getByTestId('ap-timer')).toHaveTextContent(/110/);
    } finally {
      vi.useRealTimers();
    }
  });

  test('won game: no AP timer', () => {
    setup({ state: { ...STATE, winner: 'p1' } });
    expect(screen.queryByTestId('ap-timer')).not.toBeInTheDocument();
  });

  test('server-finished game (no winner in state yet): no AP timer', () => {
    setup({ detail: { id: 'g1', name: 'g', mode: 'test', status: 'finished', config: STATE.config, createdBy: 'p1', inviteCode: 'i', generation: 1, forkSeq: null } });
    expect(screen.queryByTestId('ap-timer')).not.toBeInTheDocument();
  });

  test('finished game shows winner banner and games link', () => {
    setup({
      state: { ...STATE, winner: 'p1' },
    });
    expect(screen.getByTestId('winner-banner')).toBeInTheDocument();
    expect(screen.getByText(/back to games/i)).toBeInTheDocument();
  });

  test('dead player routes to jury screen', () => {
    setup({
      state: { ...STATE, players: { ...STATE.players, p1: { ...STATE.players.p1, hp: 0 } } },
    });
    expect(screen.getByText('JURY PAGE')).toBeInTheDocument();
  });

  test('event feed shows the full history and Rewind lives in the entry details (host test game)', async () => {
    vi.mocked(api.action).mockResolvedValue({ ok: true, seq: 4, state: STATE });
    const refresh = vi.fn();
    setup({
      history: [
        { seq: 1, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 1, y: 0 } }, generation: 1 },
        { seq: 2, type: 'move', actorId: 'p2', createdAt: 't', payload: { to: { x: 4, y: 4 } }, generation: 1 },
      ],
      refresh,
    });
    // both events visible in the feed, newest first
    const texts = screen.getAllByRole('listitem').map((li) => li.querySelector('.feed-text')?.textContent);
    expect(texts.length).toBe(2);
    // rewind to the first event from its Details dropdown
    const firstRow = screen.getAllByRole('listitem')[1]; // seq 1 is the second (oldest) row
    fireEvent.click(within(firstRow).getByText(/details/i));
    fireEvent.click(within(firstRow).getByRole('button', { name: /rewind game to here/i }));
    await waitFor(() =>
      expect(vi.mocked(api.action)).toHaveBeenCalledWith('tok-1', 'g1', 'fork', { toSeq: 1 }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  test('no rewind control for non-creators', () => {
    setup({
      detail: { id: 'g1', name: 'g', mode: 'test', status: 'active', config: STATE.config, createdBy: 'other', inviteCode: 'i', generation: 1, forkSeq: null },
      history: [
        { seq: 1, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 1, y: 0 } }, generation: 1 },
      ],
    });
    expect(screen.queryAllByRole('button', { name: /rewind/i })).toHaveLength(0);
  });

  test('View scrubs while keeping later entries visible, Back to live exits', async () => {
    setup({
      history: [
        { seq: 1, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 1, y: 0 } }, generation: 1 },
        { seq: 2, type: 'move', actorId: 'p2', createdAt: 't', payload: { to: { x: 4, y: 4 } }, generation: 1 },
      ],
    });
    fireEvent.click(screen.getAllByRole('button', { name: /view state after event 1/i })[0]);
    expect(screen.queryByTestId('action-bar')).not.toBeInTheDocument();
    // BOTH entries still visible; the later one (seq 2) dimmed as future
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(2);
    expect(items[0].className).toContain('future');
    expect(items[1].className).toContain('active');
    expect(screen.getByTestId('back-to-live')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('back-to-live'));
    expect(screen.getByTestId('action-bar')).toBeInTheDocument();
  });
});

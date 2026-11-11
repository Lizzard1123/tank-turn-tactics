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
  default: ({ onCellTap, lastEvent }: { onCellTap: (p: { x: number; y: number }) => void; lastEvent?: { type: string } | null }) => (
    <div data-testid="board" data-last-event={lastEvent?.type ?? ''}>
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
  test('renders status bar and action bar; full feed is post-game only', () => {
    setup();
    expect(screen.getByTestId('board')).toBeInTheDocument();
    expect(screen.getByTestId('ap-counter')).toBeInTheDocument();
    expect(screen.getByText(/day 1/i)).toBeInTheDocument();
    // during play the full event feed is hidden (post-game only) and the
    // battle log is absent while there are no kill/revive entries yet
    expect(screen.queryByTestId('event-feed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('battle-log')).not.toBeInTheDocument();
  });

  test('live battle log shows only kills/revives during play', () => {
    setup({
      state: {
        ...STATE,
        log: [
          { seq: 1, text: 'game started' },
          { seq: 2, text: 'foe attacked me for 1 damage' },
          { seq: 3, text: 'me attacked foe for 1 damage', kind: 'kill' },
          { seq: 4, text: 'me revived foe with a heart!', kind: 'revive' },
        ],
      },
    });
    const log = screen.getByTestId('battle-log');
    const lines = within(log).getAllByRole('listitem').map((li) => li.textContent);
    expect(lines).toHaveLength(2); // kind-less rows are filtered out
    expect(lines[0]).toMatch(/revived/); // newest first
    expect(lines.some((t) => t?.includes('attacked me'))).toBe(false);
    // full feed stays post-game
    expect(screen.queryByTestId('event-feed')).not.toBeInTheDocument();
  });

  test('random AP schedule shows no countdown', () => {
    setup({
      state: { ...STATE, config: { ...STATE.config, apSchedule: 'random', apPeriodMinutes: 60 } },
    });
    expect(screen.queryByTestId('ap-timer')).not.toBeInTheDocument();
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

  test('AP countdown ticks down from the server lastTickAt without resetting', async () => {
    try {
      vi.useFakeTimers();
      // server granted 10s ago → 110s remain on a 2-minute interval
      const serverTick = new Date(Date.now() - 10_000).toISOString();
      setup({
        detail: { id: 'g1', name: 'g', mode: 'test', status: 'active', config: STATE.config, createdBy: 'p1', inviteCode: 'i', generation: 1, forkSeq: null, lastTickAt: serverTick },
        history: [
          { seq: 1, type: 'daily_tick', actorId: 'system', createdAt: serverTick, payload: { apGained: 1, elapsedMinutes: 1 }, generation: 1 },
        ],
      });
      expect(screen.getByTestId('ap-timer')).toHaveTextContent(/110/);
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(screen.getByTestId('ap-timer')).toHaveTextContent(/100/);
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
      state: { ...STATE, winner: 'p1' }, // full feed is post-game only
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
      state: { ...STATE, winner: 'p1' }, // full feed is post-game only
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
    // scrub exited: feed returns to live mode and the back button is gone.
    // The action bar stays hidden — the game is over (winner set), so
    // post-game has no actions regardless of scrub state.
    expect(screen.queryByTestId('back-to-live')).not.toBeInTheDocument();
    expect(screen.getByTestId('event-feed')).toBeInTheDocument();
  });

  test('View addresses rows by INDEX: with duplicate seqs the clicked (newer) row is highlighted, not its older twin', () => {
    setup({
      state: { ...STATE, winner: 'p1' }, // full feed is post-game only
      history: [
        { seq: 1, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 1, y: 0 } }, generation: 1 },
        { seq: 2, type: 'move', actorId: 'p2', createdAt: 't', payload: { to: { x: 4, y: 4 } }, generation: 1 },
        { seq: 3, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 2, y: 0 } }, generation: 1 },
        { seq: 3, type: 'move', actorId: 'p2', createdAt: 't', payload: { to: { x: 5, y: 5 } }, generation: 2 },
      ],
    });
    const views = screen.getAllByRole('button', { name: /view state after event 3/i });
    expect(views.length).toBe(2);
    // Visible order is newest-first: i=3, i=2, i=1, i=0 — the FIRST "event 3"
    // button belongs to the NEWER duplicate (gen 2, index 3).
    fireEvent.click(views[0]);
    // activeIndex is 3, so items[0] is active; NOTHING is 'future' (no index
    // > 3); the older seq-3 twin (items[1], i=2) must NOT be active.
    const items = screen.getAllByRole('listitem');
    expect(items[0].className).toContain('active');
    expect(items[1].className).not.toContain('active');
    expect(items[1].className).not.toContain('future');
    expect(items[2].className).not.toContain('active');
    expect(items[3].className).not.toContain('active');
  });

  test('replay/scrub feeds the stepped event to Board as lastEvent', () => {
    setup({
      state: { ...STATE, winner: 'p1' }, // full feed is post-game only
      history: [
        { seq: 1, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 1, y: 0 } }, generation: 1 },
        { seq: 2, type: 'attack', actorId: 'p2', createdAt: 't', payload: { targetId: 'p1' }, generation: 1 },
      ],
    });
    fireEvent.click(screen.getAllByRole('button', { name: /view state after event 2/i })[0]);
    expect(screen.getByTestId('board')).toHaveAttribute('data-last-event', 'attack');
    fireEvent.click(screen.getByTestId('back-to-live'));
    expect(screen.getByTestId('board')).toHaveAttribute('data-last-event', 'attack'); // newest event
  });
});

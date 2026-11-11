import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Jury from './Jury';
import * as api from '../lib/api';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, action: vi.fn() };
});

vi.mock('../lib/useGameEvents', () => ({
  useGameEvents: vi.fn(),
}));
import { useGameEvents } from '../lib/useGameEvents';

const STATE: import('@ttt/engine').GameState = {
  seq: 8, day: 2, tickClockMinutes: 0,
  config: { seed: 1, board: 8, startingHp: 3, startingAp: 0, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 2 },
  players: {
    p1: { id: 'p1', name: 'me', pos: { x: 0, y: 0 }, hp: 0, ap: 0, range: 2, isBot: false, botDifficulty: null },
    p2: { id: 'p2', name: 'foe', pos: { x: 4, y: 4 }, hp: 2, ap: 1, range: 2, isBot: false, botDifficulty: null },
    p3: { id: 'p3', name: 'third', pos: { x: 7, y: 0 }, hp: 1, ap: 0, range: 2, isBot: true, botDifficulty: 'hard' },
  },
  order: ['p1', 'p2', 'p3'], pendingVotes: [], jury: ['p1'], winner: null, log: [{ seq: 1, text: 'p1 was eliminated' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('ttt_token', 'tok-1');
});

function setup(state = STATE) {
  vi.mocked(useGameEvents).mockReturnValue({
    state, events: [], me: 'p1',
    detail: { id: 'g1', name: 'g', mode: 'test', status: 'active', config: state.config, createdBy: 'p1', inviteCode: 'i', generation: 1, forkSeq: null },
    loading: false, error: null, refresh: vi.fn(),
  } as never);
  return render(
    <MemoryRouter initialEntries={['/game/g1/jury']}>
      <Routes>
        <Route path="/game/:gameId/jury" element={<Jury />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Jury screen', () => {
  test('shows alive players with vote buttons', () => {
    setup();
    expect(screen.getByText(/you are on the jury/i)).toBeInTheDocument();
    expect(screen.getByTestId('vote-p2')).toBeInTheDocument();
    expect(screen.getByTestId('vote-p3')).toBeInTheDocument();
  });

  test('vote button posts jury_vote with candidateId', async () => {
    vi.mocked(api.action).mockResolvedValue({ ok: true, seq: 9, state: STATE });
    setup();
    fireEvent.click(screen.getByTestId('vote-p2'));
    await waitFor(() =>
      expect(vi.mocked(api.action)).toHaveBeenCalledWith('tok-1', 'g1', 'jury_vote', { candidateId: 'p2' }),
    );
  });

  test('already voted this day disables all vote buttons', () => {
    setup({ ...STATE, pendingVotes: [{ voterId: 'p1', candidateId: 'p3' }] });
    expect(screen.getByTestId('vote-p2')).toBeDisabled();
    expect(screen.getByTestId('vote-p3')).toBeDisabled();
    expect(screen.getByText(/you voted/i)).toBeInTheDocument();
  });

  test('jury spectates: the board renders even with revives on', () => {
    setup({ ...STATE, config: { ...STATE.config, revives: true } });
    expect(screen.getAllByTestId('board').length).toBeGreaterThan(0);
    expect(screen.getByTestId('revive-waiting')).toBeInTheDocument();
  });

  test('revives on hides HP/range stats from jury voters (fog of war)', () => {
    const { container } = setup({ ...STATE, config: { ...STATE.config, revives: true } });
    expect(container.querySelector('[data-testid="card-p2"] .tank-card-stats')).toBeNull();
    // without revives the stats are visible
    const { container: container2 } = setup();
    expect(container2.querySelector('[data-testid="card-p2"] .tank-card-stats')).not.toBeNull();
  });
});

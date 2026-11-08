import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Play from './Play';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  gameJoin: vi.fn(),
  gameGet: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    player: { id: 'p1', name: 'tester' },
    token: 'tok-1',
    isGuest: false,
    signin: vi.fn(), register: vi.fn(), guestSignin: vi.fn(), signout: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_CANONICAL_INVITE_CODE', 'canon12345');
});

const ACTIVE: api.GameDetail = {
  game: {
    id: 'g1', name: 'Canonical', mode: 'play', status: 'active',
    config: { board: 8, startingHp: 3, startingAp: 0, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 },
    createdBy: 'host', inviteCode: 'canon12345', generation: 1, forkSeq: null,
  },
  state: {}, events: [], history: [], members: [], me: 'p1',
};
const LOBBY: api.GameDetail = { ...ACTIVE, game: { ...ACTIVE.game, status: 'lobby' } };

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/play']}>
      <Routes>
        <Route path="/play" element={<Play />} />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
        <Route path="/game/:gameId" element={<div>GAME</div>} />
        <Route path="/lobby/:gameId" element={<div>LOBBY</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Play (canonical game entry)', () => {
  test('joins the canonical game and routes to the active game screen', async () => {
    vi.mocked(api.gameJoin).mockResolvedValue({ gameId: 'g1' });
    vi.mocked(api.gameGet).mockResolvedValue(ACTIVE);
    renderAt();
    expect(await screen.findByText('GAME')).toBeInTheDocument();
    expect(api.gameJoin).toHaveBeenCalledWith('tok-1', 'canon12345');
  });

  test('routes to the lobby while the canonical game has not started', async () => {
    vi.mocked(api.gameJoin).mockResolvedValue({ gameId: 'g1' });
    vi.mocked(api.gameGet).mockResolvedValue(LOBBY);
    renderAt();
    expect(await screen.findByText('LOBBY')).toBeInTheDocument();
  });

  test('without a configured code, falls back to the dashboard', async () => {
    vi.stubEnv('VITE_CANONICAL_INVITE_CODE', '');
    renderAt();
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument();
    expect(api.gameJoin).not.toHaveBeenCalled();
  });

  test('join failure shows an error with a dashboard escape hatch', async () => {
    vi.mocked(api.gameJoin).mockRejectedValue(new Error('game not found'));
    renderAt();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/game not found/);
  });
});

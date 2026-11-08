import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Lobby from './Lobby';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  gameGet: vi.fn(),
  gameCreate: vi.fn(),
  gameStart: vi.fn(),
  gameUpdate: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    player: { id: 'p1', name: 'tester' },
    token: 'tok-1',
    isGuest: true,
    signin: vi.fn(), register: vi.fn(), guestSignin: vi.fn(), signout: vi.fn(),
  }),
}));

beforeEach(() => vi.clearAllMocks());

import type { GameDetail } from '../lib/api';

const LOBBY_GAME: GameDetail = {
  game: {
    id: 'g1', name: 'Bot Arena', mode: 'test', status: 'lobby',
    config: { board: 8, startingHp: 3, startingAp: 0, baseRange: 2, apPerDay: 1, upgradeCost: 2 },
    createdBy: 'p1', inviteCode: 'inv12345', generation: 1, forkSeq: null,
  },
  state: null,
  events: [],
  history: [],
  members: [{ player_id: 'p1', is_bot: false, bot_difficulty: null, joined_at: '' }],
  me: 'p1',
};

function renderAt(url = '/lobby/g1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/lobby/:gameId" element={<Lobby />} />
        <Route path="/game/:gameId" element={<div>GAME PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Lobby (test mode)', () => {
  test('shows invite code and members', async () => {
    vi.mocked(api.gameGet).mockResolvedValue(LOBBY_GAME);
    renderAt();
    expect(await screen.findByText(/inv12345/)).toBeInTheDocument();
    expect(screen.getByText(/tester \(you\)/)).toBeInTheDocument();
  });

  test('config knobs render with current values', async () => {
    vi.mocked(api.gameGet).mockResolvedValue(LOBBY_GAME);
    renderAt();
    await screen.findByRole('heading', { name: /lobby/i });
    expect(screen.getByLabelText(/board size/i)).toHaveValue(8);
    expect(screen.getByLabelText(/starting hp/i)).toHaveValue(3);
  });

  test('bot difficulty rows can be added and removed', async () => {
    vi.mocked(api.gameGet).mockResolvedValue(LOBBY_GAME);
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole('heading', { name: /lobby/i });
    expect(screen.queryAllByLabelText(/bot difficulty/i)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /add bot/i }));
    expect(screen.getAllByLabelText(/bot difficulty/i)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /add bot/i }));
    await user.click(screen.getAllByRole('button', { name: /remove/i })[0]);
    expect(screen.getAllByLabelText(/bot difficulty/i)).toHaveLength(1);
  });

  test('start game persists knobs then navigates to game page', async () => {
    vi.mocked(api.gameGet)
      .mockResolvedValueOnce(LOBBY_GAME)
      .mockResolvedValue({ ...LOBBY_GAME, game: { ...LOBBY_GAME.game, status: 'active' } });
    vi.mocked(api.gameUpdate).mockResolvedValue({ ok: true, config: LOBBY_GAME.game.config });
    vi.mocked(api.gameStart).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole('heading', { name: /lobby/i });
    await user.click(screen.getByRole('button', { name: /add bot/i }));
    await user.click(screen.getByRole('button', { name: /start game/i }));
    expect(api.gameUpdate).toHaveBeenCalledWith('tok-1', 'g1', expect.objectContaining({
      bots: [{ difficulty: 'easy' }],
    }));
    expect(api.gameStart).toHaveBeenCalledWith('tok-1', 'g1');
    expect(await screen.findByText('GAME PAGE')).toBeInTheDocument();
  });

  test('bots from the create flow are preserved on start (not wiped to [])', async () => {
    // regression: knobs initialized from server config must include bots —
    // wiping them made game-start reject with "need at least 2 players"
    const withBots: GameDetail = {
      ...LOBBY_GAME,
      game: { ...LOBBY_GAME.game, config: { ...LOBBY_GAME.game.config, bots: [{ difficulty: 'easy' }, { difficulty: 'medium' }] } },
    };
    vi.mocked(api.gameGet)
      .mockResolvedValueOnce(withBots)
      .mockResolvedValue({ ...withBots, game: { ...withBots.game, status: 'active' } });
    vi.mocked(api.gameUpdate).mockResolvedValue({ ok: true, config: withBots.game.config });
    vi.mocked(api.gameStart).mockResolvedValue({ ok: true });
    renderAt();
    await screen.findByRole('heading', { name: /lobby/i });
    expect(screen.getAllByLabelText(/bot difficulty/i)).toHaveLength(2);
    await userEvent.setup().click(screen.getByRole('button', { name: /start game/i }));
    expect(api.gameUpdate).toHaveBeenCalledWith('tok-1', 'g1', expect.objectContaining({
      bots: [{ difficulty: 'easy' }, { difficulty: 'medium' }],
    }));
  });

  test('active game navigates straight to the game page', async () => {
    vi.mocked(api.gameGet).mockResolvedValue({
      ...LOBBY_GAME,
      game: { ...LOBBY_GAME.game, status: 'active' },
    });
    renderAt();
    expect(await screen.findByText('GAME PAGE')).toBeInTheDocument();
  });
});

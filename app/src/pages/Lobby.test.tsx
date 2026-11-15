import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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

  test('non-host cannot see start button or edit knobs', async () => {
    const notMe: GameDetail = {
      ...LOBBY_GAME,
      game: { ...LOBBY_GAME.game, createdBy: 'p99' },
      me: 'p1',
    };
    vi.mocked(api.gameGet).mockResolvedValue(notMe);
    renderAt();
    await screen.findByRole('heading', { name: /lobby/i });
    expect(screen.queryByRole('button', { name: /start game/i })).not.toBeInTheDocument();
    // Non-host sees "waiting for host" message
    expect(screen.getByText(/waiting for.*host/i)).toBeInTheDocument();
  });

  test('error state renders ErrorScreen', async () => {
    vi.mocked(api.gameGet).mockRejectedValue(new Error('network failure'));
    renderAt();
    expect(await screen.findByText(/network failure/i)).toBeInTheDocument();
  });

  test('renders member list with bot indicators', async () => {
    const withBots: GameDetail = {
      ...LOBBY_GAME,
      members: [
        { player_id: 'p1', is_bot: false, bot_difficulty: null, joined_at: '' },
        { player_id: 'bot1', is_bot: true, bot_difficulty: 'easy', joined_at: '' },
      ],
    };
    vi.mocked(api.gameGet).mockResolvedValue(withBots);
    renderAt();
    await screen.findByRole('heading', { name: /lobby/i });
    expect(screen.getByText(/easy.*bot/)).toBeInTheDocument();
    expect(screen.getByText(/bot1/)).toBeInTheDocument();
    expect(screen.getByText(/tester/i)).toBeInTheDocument();
  });

  test('shows player names section with count', async () => {
    vi.mocked(api.gameGet).mockResolvedValue(LOBBY_GAME);
    renderAt();
    await screen.findByRole('heading', { name: /lobby/i });
    expect(screen.getByText(/players \(\d+\)/i)).toBeInTheDocument();
  });

  // --- schedule shape: only the active shape's fields reach game-update ---

  test('switching the AP schedule reveals only that shape knob set', async () => {
    vi.mocked(api.gameGet).mockResolvedValue(LOBBY_GAME);
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole('heading', { name: /lobby/i });
    // interval is the default: interval knob visible, time/random knobs not
    expect(screen.getByLabelText(/AP interval/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/AP time/i)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Schedule'), 'timeOfDay');
    expect(screen.getByLabelText(/AP time/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/AP interval/i)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Schedule'), 'random');
    expect(screen.getByLabelText(/period length/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/AP time/i)).not.toBeInTheDocument();
  });

  test('start sends ONLY the active schedule shape fields (abandoned shapes omitted)', async () => {
    vi.mocked(api.gameGet)
      .mockResolvedValueOnce(LOBBY_GAME)
      .mockResolvedValue({ ...LOBBY_GAME, game: { ...LOBBY_GAME.game, status: 'active' } });
    vi.mocked(api.gameUpdate).mockResolvedValue({ ok: true, config: LOBBY_GAME.game.config });
    vi.mocked(api.gameStart).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole('heading', { name: /lobby/i });
    await user.selectOptions(screen.getByLabelText('Schedule'), 'random');
    await user.click(screen.getByRole('button', { name: /start game/i }));
    await waitFor(() => expect(api.gameUpdate).toHaveBeenCalled());
    const cfg = vi.mocked(api.gameUpdate).mock.calls[0][2];
    expect(cfg.apSchedule).toBe('random');
    expect(cfg.apPeriodMinutes).toBeDefined();
    expect(cfg.apIntervalMinutes).toBeUndefined();
    expect(cfg.apTimeOfDay).toBeUndefined();
    expect(cfg.apTimezone).toBeUndefined();
  });

  test('timeOfDay shape sends the time and timezone, not interval or period', async () => {
    vi.mocked(api.gameGet)
      .mockResolvedValueOnce(LOBBY_GAME)
      .mockResolvedValue({ ...LOBBY_GAME, game: { ...LOBBY_GAME.game, status: 'active' } });
    vi.mocked(api.gameUpdate).mockResolvedValue({ ok: true, config: LOBBY_GAME.game.config });
    vi.mocked(api.gameStart).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole('heading', { name: /lobby/i });
    await user.selectOptions(screen.getByLabelText('Schedule'), 'timeOfDay');
    await user.click(screen.getByRole('button', { name: /start game/i }));
    await waitFor(() => expect(api.gameUpdate).toHaveBeenCalled());
    const cfg = vi.mocked(api.gameUpdate).mock.calls[0][2];
    expect(cfg.apTimeOfDay).toBe('09:00');
    expect(cfg.apTimezone).toBeDefined();
    expect(cfg.apIntervalMinutes).toBeUndefined();
    expect(cfg.apPeriodMinutes).toBeUndefined();
  });

  // --- rule toggles persist through start ---

  test('rule toggles are sent through game-update on start', async () => {
    vi.mocked(api.gameGet)
      .mockResolvedValueOnce(LOBBY_GAME)
      .mockResolvedValue({ ...LOBBY_GAME, game: { ...LOBBY_GAME.game, status: 'active' } });
    vi.mocked(api.gameUpdate).mockResolvedValue({ ok: true, config: LOBBY_GAME.game.config });
    vi.mocked(api.gameStart).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole('heading', { name: /lobby/i });
    await user.click(screen.getByRole('checkbox', { name: /steal ap on kill/i }));
    await user.click(screen.getByRole('checkbox', { name: /heart gifts/i }));
    await user.click(screen.getByRole('checkbox', { name: /revives/i }));
    await user.click(screen.getByRole('button', { name: /start game/i }));
    await waitFor(() => expect(api.gameUpdate).toHaveBeenCalled());
    const cfg = vi.mocked(api.gameUpdate).mock.calls[0][2];
    expect(cfg.apStealOnKill).toBe(true);
    expect(cfg.heartGifts).toBe(true);
    expect(cfg.revives).toBe(true);
    expect(cfg.juryHaunt).toBe(false);
  });

  // --- hearts: knob reveal + field pruning when disabled ---

  test('heart knobs appear only when heart spawn is enabled, and disabled shape fields are omitted', async () => {
    vi.mocked(api.gameGet)
      .mockResolvedValueOnce(LOBBY_GAME)
      .mockResolvedValue({ ...LOBBY_GAME, game: { ...LOBBY_GAME.game, status: 'active' } });
    vi.mocked(api.gameUpdate).mockResolvedValue({ ok: true, config: LOBBY_GAME.game.config });
    vi.mocked(api.gameStart).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole('heading', { name: /lobby/i });
    expect(screen.queryByLabelText(/spawn schedule/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /spawn collectible hearts/i }));
    expect(screen.getByLabelText(/spawn schedule/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max hearts/i)).toHaveValue(1);
    await user.click(screen.getByRole('button', { name: /start game/i }));
    await waitFor(() => expect(api.gameUpdate).toHaveBeenCalled());
    const cfg = vi.mocked(api.gameUpdate).mock.calls[0][2];
    expect(cfg.heartSpawn).toBe(true);
    expect(cfg.heartSchedule).toBe('interval');
    // timeOfDay/random heart fields pruned for the interval shape
    expect(cfg.heartTimeOfDay).toBeUndefined();
    expect(cfg.heartPeriodMinutes).toBeUndefined();
  });

  // --- start failure keeps you in the lobby with the error ---

  test('failed start shows the error and stays in the lobby', async () => {
    vi.mocked(api.gameGet).mockResolvedValue(LOBBY_GAME);
    vi.mocked(api.gameStart).mockRejectedValue(new Error('need at least 2 players'));
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole('heading', { name: /lobby/i });
    await user.click(screen.getByRole('button', { name: /start game/i }));
    await waitFor(() =>
      expect(screen.getByText(/need at least 2 players/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText('GAME PAGE')).not.toBeInTheDocument();
  });

  // --- lobby poll surfaces joiners without a reload ---

  test('lobby polls every 4s so a joiner appears without a reload', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.gameGet)
        .mockResolvedValueOnce(LOBBY_GAME)
        .mockResolvedValue({
          ...LOBBY_GAME,
          members: [
            { player_id: 'p1', is_bot: false, bot_difficulty: null, joined_at: '' },
            { player_id: 'p2', is_bot: false, bot_difficulty: null, joined_at: '' },
          ],
        });
      renderAt();
      await act(async () => {}); // flush the initial load
      expect(screen.getByText(/tester \(you\)/)).toBeInTheDocument();
      expect(screen.queryByText(/p2/)).not.toBeInTheDocument();
      // the 4s poll fires load(); the new member list renders without a reload
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
      expect(screen.getByText(/p2/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

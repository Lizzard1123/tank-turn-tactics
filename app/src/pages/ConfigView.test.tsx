import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ConfigView from './ConfigView';
import * as api from '../lib/api';

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    token: 'tok-test',
    player: { id: 'p1', name: 'tester' },
    isGuest: true,
    signin: vi.fn(),
    register: vi.fn(),
    guestSignin: vi.fn(),
    signout: vi.fn(),
  }),
}));

vi.mock('../lib/api', () => ({
  gameGet: vi.fn(),
  gameList: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.gameGet).mockResolvedValue(FAKE_DETAIL);
  vi.mocked(api.gameList).mockResolvedValue({ games: FAKE_GAMES });
});

import type { GameConfigPayload, GameDetail, GameSummary } from '../lib/api';

const FAKE_CONFIG: GameConfigPayload = {
  board: 8,
  startingHp: 3,
  startingAp: 1,
  baseRange: 2,
  apPerDay: 1,
  upgradeCost: 2,
  apSchedule: 'interval',
  apIntervalMinutes: 30,
  heartSpawn: true,
  heartSchedule: 'interval',
  heartIntervalMinutes: 60,
  heartPlacement: 'random',
  heartCap: 1,
  apStealOnKill: false,
  heartGifts: true,
  revives: false,
  juryHaunt: false,
};

const FAKE_DETAIL: GameDetail = {
  game: {
    id: 'g1',
    name: 'Test Game',
    mode: 'play',
    status: 'active',
    config: FAKE_CONFIG,
    createdBy: 'p1',
    inviteCode: 'abc123',
    generation: 1,
    forkSeq: null,
  },
  state: null,
  events: [],
  history: [],
  members: [
    { player_id: 'p1', is_bot: false, bot_difficulty: null, joined_at: '' },
    { player_id: 'bot1', is_bot: true, bot_difficulty: 'easy', joined_at: '' },
  ],
  me: 'p1',
};

const FAKE_GAMES: GameSummary[] = [
  { id: 'g1', name: 'Game 1', mode: 'play', status: 'active', playerCount: 2, created_at: '', createdBy: 'p1' },
  { id: 'g2', name: 'Game 2', mode: 'test', status: 'lobby', playerCount: 1, created_at: '', createdBy: 'p1' },
];

function renderConfigView(gameId?: string) {
  const initialEntries = gameId ? [`/config/${gameId}`] : ['/config'];
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/config" element={<ConfigView />} />
        <Route path="/config/:gameId" element={<ConfigView />} />
        <Route path="/games" element={<div>GAMES</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConfigView', () => {
  test('shows loading state initially', async () => {
    vi.mocked(api.gameGet).mockReturnValue(new Promise(() => { /* never resolves */ }));
    renderConfigView('g1');
    expect(await screen.findByText(/loading config/i)).toBeInTheDocument();
  });

  test('shows error state on fetch failure', async () => {
    vi.mocked(api.gameGet).mockRejectedValue(new Error('network failure'));
    renderConfigView('g1');
    expect(await screen.findByText(/network failure/i)).toBeInTheDocument();
  });

  test('shows game list when no gameId', async () => {
    vi.mocked(api.gameList).mockResolvedValue({ games: FAKE_GAMES });
    renderConfigView();
    expect(await screen.findByText(/pick a game/i)).toBeInTheDocument();
    expect(screen.getByText('Game 1')).toBeInTheDocument();
    expect(screen.getByText('Game 2')).toBeInTheDocument();
  });

  test('shows empty state when no games', async () => {
    vi.mocked(api.gameList).mockResolvedValue({ games: [] });
    renderConfigView();
    expect(await screen.findByText(/no games yet/i)).toBeInTheDocument();
  });

  test('renders game config with all basic fields', async () => {
    vi.mocked(api.gameGet).mockResolvedValue(FAKE_DETAIL);
    renderConfigView('g1');
    expect(await screen.findByText('Game config')).toBeInTheDocument();
    expect(await screen.findByText(/Test Game/)).toBeInTheDocument();
    expect(await screen.findByText(/play/)).toBeInTheDocument();
    expect(await screen.findByText(/active/)).toBeInTheDocument();
    expect(screen.getByText(/8×8/)).toBeInTheDocument(); // board 8x8
    expect(screen.getByText(/Upgrade cost/)).toBeInTheDocument();
  });

  test('shows member counts for players and bots', async () => {
    vi.mocked(api.gameGet).mockResolvedValue(FAKE_DETAIL);
    renderConfigView('g1');
    expect(await screen.findByText(/players/i)).toBeInTheDocument();
  });

  test('renders AP schedule as interval', async () => {
    const detail: GameDetail = {
      ...FAKE_DETAIL,
      game: {
        ...FAKE_DETAIL.game,
        config: { ...FAKE_CONFIG, apSchedule: 'interval', apIntervalMinutes: 45 },
      },
    };
    vi.mocked(api.gameGet).mockResolvedValue(detail);
    renderConfigView('g1');
    expect(await screen.findByText('AP schedule')).toBeInTheDocument();
    expect(screen.getByText(/45 min/i)).toBeInTheDocument();
  });

  test('renders AP schedule as timeOfDay', async () => {
    const detail: GameDetail = {
      ...FAKE_DETAIL,
      game: {
        ...FAKE_DETAIL.game,
        config: { ...FAKE_CONFIG, apSchedule: 'timeOfDay', apTimeOfDay: '09:00', apTimezone: 'America/New_York' },
      },
    };
    vi.mocked(api.gameGet).mockResolvedValue(detail);
    renderConfigView('g1');
    expect(await screen.findByText(/daily at a fixed time/i)).toBeInTheDocument();
    expect(await screen.findByText(/09:00/i)).toBeInTheDocument();
  });

  test('renders AP schedule as random', async () => {
    const detail: GameDetail = {
      ...FAKE_DETAIL,
      game: {
        ...FAKE_DETAIL.game,
        config: { ...FAKE_CONFIG, apSchedule: 'random', apPeriodMinutes: 30 },
      },
    };
    vi.mocked(api.gameGet).mockResolvedValue(detail);
    renderConfigView('g1');
    expect(await screen.findByText(/random time/i)).toBeInTheDocument();
    expect(await screen.findByText(/30 min/i)).toBeInTheDocument();
  });

  test('renders hearts config section', async () => {
    vi.mocked(api.gameGet).mockResolvedValue(FAKE_DETAIL);
    renderConfigView('g1');
    expect(await screen.findByText('Hearts')).toBeInTheDocument();
    expect(screen.getByText(/board spawns/i)).toBeInTheDocument();
  });

  test('renders rules config section', async () => {
    vi.mocked(api.gameGet).mockResolvedValue(FAKE_DETAIL);
    renderConfigView('g1');
    expect(await screen.findByText('Rules')).toBeInTheDocument();
    expect(screen.getByText(/heart gifts/i)).toBeInTheDocument();
    expect(screen.getByText(/revives/i)).toBeInTheDocument();
    expect(screen.getByText(/jury haunt/i)).toBeInTheDocument();
  });

  test('copy JSON button renders and shows copied state', async () => {
    vi.mocked(api.gameGet).mockResolvedValue(FAKE_DETAIL);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    renderConfigView('g1');
    const btn = await screen.findByText('Copy JSON');
    expect(btn).toBeInTheDocument();
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  test('back to games link renders', async () => {
    vi.mocked(api.gameGet).mockResolvedValue(FAKE_DETAIL);
    renderConfigView('g1');
    const link = await screen.findByText(/← games/i);
    expect(link).toHaveAttribute('href', '/games');
  });

  test('shows player names on/off', async () => {
    const detail: GameDetail = {
      ...FAKE_DETAIL,
      game: {
        ...FAKE_DETAIL.game,
        config: { ...FAKE_CONFIG, showPlayerNames: false },
      },
    };
    vi.mocked(api.gameGet).mockResolvedValue(detail);
    renderConfigView('g1');
    expect(await screen.findByText(/player names/i)).toBeInTheDocument();
  });

  test('shows player names on when not set', async () => {
    vi.mocked(api.gameGet).mockResolvedValue(FAKE_DETAIL);
    renderConfigView('g1');
    expect(await screen.findByText(/player names/i)).toBeInTheDocument();
  });
});

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Jury from './Jury';
import type { GameState } from '@ttt/engine';

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
  action: vi.fn(),
  gameGet: vi.fn(),
}));

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    channel: vi.fn(),
    removeChannel: vi.fn(),
    realtime: { setAuth: vi.fn() },
  },
}));

vi.mock('../lib/useGameEvents', () => ({
  useGameEvents: vi.fn(),
}));

import { useGameEvents } from '../lib/useGameEvents';

beforeEach(() => {
  vi.resetAllMocks();
});

const BASE_STATE: GameState = {
  seq: 1,
  day: 1,
  tickClockMinutes: 0,
  config: {
    seed: 1,
    board: 8,
    startingHp: 3,
    startingAp: 0,
    baseRange: 2,
    apPerDay: 1,
    upgradeCost: 2,
    apIntervalMinutes: 0,
    revives: false,
    juryHaunt: false,
  },
  players: {
    p1: { id: 'p1', name: 'me', pos: { x: 0, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
    p2: { id: 'p2', name: 'foe', pos: { x: 3, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
  },
  order: ['p1', 'p2'],
  pendingVotes: [],
  jury: [],
  winner: null,
  log: [],
};

function mockEvents(state: GameState, me: string) {
  (useGameEvents as ReturnType<typeof vi.fn>).mockReturnValue({
    state,
    me,
    avatars: {},
    refresh: vi.fn(),
  });
}

describe('Jury', () => {
  test('shows loading while state is null', async () => {
    mockEvents(null as never, '');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
          <Route path="/game/:gameId" element={<div>GAME</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/loading jury/i)).toBeInTheDocument();
  });

  test('shows error when state exists but me is missing', async () => {
    const state: GameState = {
      ...BASE_STATE,
      players: {
        p1: { ...BASE_STATE.players.p1, hp: 0 },
      },
    };
    mockEvents(state, '');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const el = await screen.findByText(/not on the jury/i);
    expect(el).toBeInTheDocument();
  });

  test('renders board component', async () => {
    const state: GameState = {
      ...BASE_STATE,
      players: {
        p1: { ...BASE_STATE.players.p1, hp: 0 },
        p2: { ...BASE_STATE.players.p2, hp: 0 },
      },
    };
    mockEvents(state, 'p1');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('board')).toBeInTheDocument();
  });

  test('renders alive players section', async () => {
    const state: GameState = {
      ...BASE_STATE,
      players: {
        p1: { ...BASE_STATE.players.p1, hp: 0 },
        p2: { ...BASE_STATE.players.p2, hp: 3 },
      },
    };
    mockEvents(state, 'p1');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/alive players/i)).toBeInTheDocument();
    expect(await screen.findByTestId('card-p2')).toBeInTheDocument();
  });

  test('renders vote buttons for alive players', async () => {
    const state: GameState = {
      ...BASE_STATE,
      players: {
        p1: { ...BASE_STATE.players.p1, hp: 0 },
        p2: { ...BASE_STATE.players.p2, hp: 3 },
      },
    };
    mockEvents(state, 'p1');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('vote-p2')).toBeInTheDocument();
  });

  test('vote button is enabled when not yet voted', async () => {
    const state: GameState = {
      ...BASE_STATE,
      players: {
        p1: { ...BASE_STATE.players.p1, hp: 0 },
        p2: { ...BASE_STATE.players.p2, hp: 3 },
      },
      pendingVotes: [],
    };
    mockEvents(state, 'p1');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const btn = await screen.findByTestId('vote-p2');
    expect(btn).toBeEnabled();
  });

  test('shows voted banner after voting', async () => {
    const state: GameState = {
      ...BASE_STATE,
      players: {
        p1: { ...BASE_STATE.players.p1, hp: 0 },
        p2: { ...BASE_STATE.players.p2, hp: 3 },
      },
      pendingVotes: [{ voterId: 'p1', candidateId: 'p2' }],
    };
    mockEvents(state, 'p1');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/you voted for/i)).toBeInTheDocument();
  });

  test('vote button disabled after voting', async () => {
    const state: GameState = {
      ...BASE_STATE,
      players: {
        p1: { ...BASE_STATE.players.p1, hp: 0 },
        p2: { ...BASE_STATE.players.p2, hp: 3 },
      },
      pendingVotes: [{ voterId: 'p1', candidateId: 'p2' }],
    };
    mockEvents(state, 'p1');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const btn = screen.getByTestId('vote-p2');
    expect(btn).toBeDisabled();
  });

  test('renders haunt banner when juryHaunt is on', async () => {
    const state: GameState = {
      ...BASE_STATE,
      config: { ...BASE_STATE.config, juryHaunt: true },
      haunted: 'p2',
    };
    state.players.p1 = { ...BASE_STATE.players.p1, hp: 0 };
    state.players.p2 = { ...BASE_STATE.players.p2, hp: 0 };
    mockEvents(state, 'p1');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/haunted/i)).toBeInTheDocument();
  });

  test('shows no-haunt message when not haunted', async () => {
    const state: GameState = {
      ...BASE_STATE,
      config: { ...BASE_STATE.config, juryHaunt: true },
      haunted: null,
    };
    state.players.p1 = { ...BASE_STATE.players.p1, hp: 0 };
    state.players.p2 = { ...BASE_STATE.players.p2, hp: 0 };
    mockEvents(state, 'p1');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/most-voted/i)).toBeInTheDocument();
  });

  test('shows revive waiting banner when revives on', async () => {
    const state: GameState = {
      ...BASE_STATE,
      config: { ...BASE_STATE.config, revives: true },
    };
    state.players.p1 = { ...BASE_STATE.players.p1, hp: 0 };
    state.players.p2 = { ...BASE_STATE.players.p2, hp: 0 };
    mockEvents(state, 'p1');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/waiting for a heart/i)).toBeInTheDocument();
  });

  test('shows event feed when revives off', async () => {
    const state: GameState = {
      ...BASE_STATE,
      config: { ...BASE_STATE.config, revives: false },
      log: [
        { seq: 1, text: 'p1 moved' },
        { seq: 2, text: 'p2 attacked' },
      ],
    };
    state.players.p1 = { ...BASE_STATE.players.p1, hp: 0 };
    mockEvents(state, 'p1');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/events/i)).toBeInTheDocument();
  });

  test('renders back to games link', async () => {
    const state: GameState = {
      ...BASE_STATE,
      players: {
        p1: { ...BASE_STATE.players.p1, hp: 0 },
        p2: { ...BASE_STATE.players.p2, hp: 0 },
      },
    };
    mockEvents(state, 'p1');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const link = await screen.findByText(/← back/i);
    expect(link).toHaveAttribute('href', '/games');
  });

  test('renders day counter', async () => {
    const state: GameState = {
      ...BASE_STATE,
      players: {
        p1: { ...BASE_STATE.players.p1, hp: 0 },
        p2: { ...BASE_STATE.players.p2, hp: 0 },
      },
    };
    mockEvents(state, 'p1');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/day 1/i)).toBeInTheDocument();
  });

  test('renders jury mode badge', async () => {
    const state: GameState = {
      ...BASE_STATE,
      players: {
        p1: { ...BASE_STATE.players.p1, hp: 0 },
        p2: { ...BASE_STATE.players.p2, hp: 0 },
      },
    };
    mockEvents(state, 'p1');
    render(
      <MemoryRouter initialEntries={['/jury/g1']}>
        <Routes>
          <Route path="/jury/:gameId" element={<Jury />} />
          <Route path="/games" element={<div>GAMES</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('JURY')).toBeInTheDocument();
  });
});

import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TestMode from './TestMode';
import Game from './Game';
import { LocalGameProvider } from '../lib/localGameContext';
import * as api from '../lib/api';

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    player: { id: 'me', name: 'guest-abc' },
    token: null,
    isGuest: true,
    guestSignin: vi.fn().mockResolvedValue('tok-local'),
    signin: vi.fn(),
    register: vi.fn(),
    signout: vi.fn(),
  }),
}));

// Test Mode must not touch the database: assert gameCreate is never called.
vi.mock('../lib/api', () => ({
  gameCreate: vi.fn(),
}));

// Mock the supabase client so no real network/auth calls are made.
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn(),
      getUser: vi.fn(),
      signInAnonymously: vi.fn(),
    },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

test('guest sign-in starts a local game (no DB game) and the 30s AP drip increments AP', async () => {
  vi.useFakeTimers();
  render(
    <LocalGameProvider>
      <MemoryRouter initialEntries={['/test']}>
        <Routes>
          <Route path="/test" element={<TestMode />} />
          <Route path="/game/:gameId" element={<Game />} />
        </Routes>
      </MemoryRouter>
    </LocalGameProvider>,
  );

  // flush the async guest sign-in, context update and navigation
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  // no database game was created
  expect(vi.mocked(api.gameCreate)).not.toHaveBeenCalled();

  // local game mounted with default starting AP = 4
  expect(screen.getByTestId('board')).toBeInTheDocument();
  expect(screen.getByTestId('ap-counter')).toHaveTextContent('4 AP');

  // advance one 30s drip tick: every alive player gains 1 AP
  act(() => {
    vi.advanceTimersByTime(30_000);
  });
  expect(screen.getByTestId('ap-counter')).toHaveTextContent('5 AP');
});

test('event feed View scrubs the board and Replay animates back to live', async () => {
  vi.useFakeTimers();
  render(
    <LocalGameProvider>
      <MemoryRouter initialEntries={['/test']}>
        <Routes>
          <Route path="/test" element={<TestMode />} />
          <Route path="/game/:gameId" element={<Game />} />
        </Routes>
      </MemoryRouter>
    </LocalGameProvider>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  // one drip tick so the history has exactly one event (AP 4 -> 5)
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(screen.getByTestId('ap-counter')).toHaveTextContent('5 AP');

  // clicking View on that event enters scrub mode: ActionBar hidden,
  // replay progress shows in the feed
  fireEvent.click(screen.getByRole('button', { name: /view state after event 1/i }));
  expect(screen.queryByTestId('action-bar')).not.toBeInTheDocument();
  expect(screen.getByTestId('back-to-live')).toBeInTheDocument();

  // "Replay from here" animates: one 1s step replays the remaining event
  // and exits scrub back to live
  fireEvent.click(screen.getByTestId('replay-btn'));
  expect(screen.getByTestId('stop-replay-btn')).toBeInTheDocument();
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.queryByTestId('stop-replay-btn')).not.toBeInTheDocument();
  expect(screen.getByTestId('action-bar')).toBeInTheDocument();
  expect(screen.getByTestId('ap-counter')).toHaveTextContent('5 AP');
});

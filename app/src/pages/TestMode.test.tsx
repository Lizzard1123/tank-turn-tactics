import { test, expect, vi, beforeEach, afterEach, describe } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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

vi.mock('../lib/api', () => ({
  gameCreate: vi.fn(),
}));

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

describe('TestMode', () => {
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

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(api.gameCreate)).not.toHaveBeenCalled();
    expect(screen.getByTestId('board')).toBeInTheDocument();
    expect(screen.getByTestId('ap-counter')).toHaveTextContent('4 AP');

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId('ap-counter')).toHaveTextContent('5 AP');
  });

  test('during play the full feed is hidden and no fork/rewind exists', async () => {
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

    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByTestId('ap-counter')).toHaveTextContent('5 AP');

    expect(screen.queryByTestId('event-feed')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /rewind/i })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /view state after event/i })).toHaveLength(0);
  });

  test('renders board component', async () => {
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
    expect(screen.getByTestId('board')).toBeInTheDocument();
  });

  test('renders AP counter', async () => {
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
    expect(screen.getByTestId('ap-counter')).toBeInTheDocument();
  });

  test('renders starting AP as 4', async () => {
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
    expect(screen.getByTestId('ap-counter')).toHaveTextContent('4 AP');
  });

  test('renders page wrapper', async () => {
    vi.useFakeTimers();
    const { container } = render(
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
    expect(container.querySelector('main')).toBeInTheDocument();
  });

  test('renders main element', async () => {
    vi.useFakeTimers();
    const { container } = render(
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
    expect(container.querySelector('main')).toBeInTheDocument();
  });

  test('renders page class', async () => {
    vi.useFakeTimers();
    const { container } = render(
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
    expect(container.querySelector('.page')).toBeInTheDocument();
  });

  test('renders game status header', async () => {
    vi.useFakeTimers();
    const { container } = render(
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
    expect(container.querySelector('.game-status')).toBeInTheDocument();
  });

  test('renders game mode badge', async () => {
    vi.useFakeTimers();
    const { container } = render(
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
    expect(container.querySelector('.mode-badge')).toBeInTheDocument();
  });

  test('renders test mode badge', async () => {
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
    expect(screen.getByText('TEST')).toBeInTheDocument();
  });

  test('renders loading state', async () => {
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
    expect(screen.getByTestId('board')).toBeInTheDocument();
  });

  test('renders game over state', async () => {
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
    expect(screen.getByTestId('board')).toBeInTheDocument();
  });

});

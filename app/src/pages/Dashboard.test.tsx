import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Dashboard from './Dashboard';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  gameList: vi.fn(),
  gameCreate: vi.fn(),
  gameJoin: vi.fn(),
  gameDelete: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
  useAuth: vi.fn(),
}));
import { useAuth } from '../lib/auth';

const AUTH_OK = {
  player: { id: 'p1', name: 'tester' },
  token: 'tok-1',
  isGuest: false,
  signin: vi.fn(), register: vi.fn(), guestSignin: vi.fn(), signout: vi.fn(),
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue(AUTH_OK);
});

describe('Dashboard', () => {
  test('renders game list from api', async () => {
    vi.mocked(api.gameList).mockResolvedValue({
      games: [
        { id: 'g1', name: 'Office War', mode: 'play', status: 'active', playerCount: 4, created_at: '', createdBy: 'p2' },
        { id: 'g2', name: 'Test Run', mode: 'test', status: 'lobby', playerCount: 1, created_at: '', createdBy: 'p1' },
      ],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText('Office War')).toBeInTheDocument();
    expect(screen.getByText('Test Run')).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });

  test('create navigates straight into the lobby (creator is auto-joined)', async () => {
    vi.mocked(api.gameList).mockResolvedValue({ games: [] });
    vi.mocked(api.gameCreate).mockResolvedValue({ gameId: 'g9', inviteCode: 'abc12345' });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/lobby/:gameId" element={<div>LOBBY g9</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: /create game/i });
    await user.type(screen.getByLabelText(/game name/i), 'My Game');
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    expect(api.gameCreate).toHaveBeenCalledWith('tok-1', expect.objectContaining({ name: 'My Game' }));
    expect(await screen.findByText('LOBBY g9')).toBeInTheDocument();
    // the intermediate invite-code box is gone: the lobby shows the code
    expect(screen.queryByText(/share it with friends/i)).not.toBeInTheDocument();
  });

  test('games list refetches after a delete (no stale "No games yet")', async () => {
    vi.mocked(api.gameList)
      .mockResolvedValueOnce({
        games: [{ id: 'g2', name: 'Test Run', mode: 'test', status: 'lobby', playerCount: 1, created_at: '', createdBy: 'p1' }],
      })
      .mockResolvedValue({ games: [] });
    vi.mocked(api.gameDelete).mockResolvedValue({ ok: true });
    vi.stubGlobal('confirm', () => true);
    const user = userEvent.setup();
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Test Run');
    await user.click(screen.getByRole('button', { name: /^delete/i }));
    await screen.findByText(/no games yet/i);
    expect(api.gameList).toHaveBeenCalledTimes(2);
  });

  test('guest identity hints at registering', async () => {
    vi.mocked(api.gameList).mockResolvedValue({ games: [] });
    vi.mocked(useAuth).mockReturnValue({
      player: { id: 'p9', name: 'guest-abc' },
      token: 'tok-1',
      isGuest: true,
      signin: vi.fn(), register: vi.fn(), guestSignin: vi.fn(), signout: vi.fn(),
    } as never);
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText(/temporary guest/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /register/i })).toHaveAttribute('href', '/auth');
  });

  test('offers a Profile link', async () => {
    vi.mocked(api.gameList).mockResolvedValue({ games: [] });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByRole('heading', { level: 1, name: /games/i });
    expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile');
  });

  test('top nav links render as buttons (.btn class), not underlined text links', async () => {
    vi.mocked(api.gameList).mockResolvedValue({ games: [] });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const home = await screen.findByRole('link', { name: /home/i });
    expect(home.className).toContain('btn');
    expect(screen.getByRole('link', { name: /profile/i }).className).toContain('btn');
  });

  test('join with invite code calls api', async () => {
    vi.mocked(api.gameList).mockResolvedValue({ games: [] });
    vi.mocked(api.gameJoin).mockResolvedValue({ gameId: 'g5' });
    const user = userEvent.setup();
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await user.type(screen.getByLabelText(/invite code/i), 'zzz999');
    await user.click(screen.getByRole('button', { name: /^join$/i }));
    expect(api.gameJoin).toHaveBeenCalledWith('tok-1', 'zzz999');
  });

  test('delete removes host-owned lobby game', async () => {
    vi.mocked(api.gameList)
      .mockResolvedValueOnce({
        games: [{ id: 'g2', name: 'Test Run', mode: 'test', status: 'lobby', playerCount: 1, created_at: '', createdBy: 'p1' }],
      })
      .mockResolvedValue({ games: [] });
    vi.mocked(api.gameDelete).mockResolvedValue({ ok: true });
    vi.stubGlobal('confirm', () => true);
    const user = userEvent.setup();
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Test Run');
    await user.click(screen.getByRole('button', { name: /^delete/i }));
    expect(api.gameDelete).toHaveBeenCalledWith('tok-1', 'g2');
    expect(screen.queryByText('Test Run')).not.toBeInTheDocument();
  });

  test('delete control is an icon-only trash button (svg, no text label)', async () => {
    vi.mocked(api.gameList).mockResolvedValue({
      games: [{ id: 'g2', name: 'Test Run', mode: 'test', status: 'lobby', playerCount: 1, created_at: '', createdBy: 'p1' }],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Test Run');
    const btn = screen.getByRole('button', { name: /^delete/i });
    expect(btn.querySelector('svg')).not.toBeNull();
    expect(btn.textContent).not.toMatch(/delete/i);
  });

  test('does not show delete for non-host game', async () => {
    vi.mocked(api.gameList).mockResolvedValue({
      games: [{ id: 'g1', name: 'Office War', mode: 'play', status: 'active', playerCount: 4, created_at: '', createdBy: 'p2' }],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Office War');
    expect(screen.queryByRole('button', { name: /^delete/i })).not.toBeInTheDocument();
  });

  test('host sees delete on their active test game', async () => {
    vi.mocked(api.gameList).mockResolvedValue({
      games: [{ id: 'g3', name: 'Stale Test', mode: 'test', status: 'active', playerCount: 4, created_at: '', createdBy: 'p1' }],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Stale Test');
    expect(screen.getByRole('button', { name: /^delete/i })).toBeInTheDocument();
  });

  test('no delete on an active play game even for the host', async () => {
    vi.mocked(api.gameList).mockResolvedValue({
      games: [{ id: 'g4', name: 'Real War', mode: 'play', status: 'active', playerCount: 4, created_at: '', createdBy: 'p1' }],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Real War');
    expect(screen.queryByRole('button', { name: /^delete/i })).not.toBeInTheDocument();
  });

  test('finished games live under a collapsed expander, not the main list', async () => {
    vi.mocked(api.gameList).mockResolvedValue({
      games: [
        { id: 'g1', name: 'Office War', mode: 'play', status: 'active', playerCount: 4, created_at: '', createdBy: 'p2' },
        { id: 'g2', name: 'Old War', mode: 'play', status: 'finished', playerCount: 4, created_at: '', createdBy: 'p1' },
      ],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText('Office War')).toBeInTheDocument();
    expect(screen.queryByText('Old War')).not.toBeInTheDocument();
    expect(screen.getByTestId('finished-games-toggle')).toHaveTextContent('Finished games (1)');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('finished-games-toggle'));
    expect(screen.getByTestId('finished-game-g2')).toHaveTextContent('Old War');
  });

  test('no finished-games expander when nothing is finished', async () => {
    vi.mocked(api.gameList).mockResolvedValue({
      games: [{ id: 'g1', name: 'Office War', mode: 'play', status: 'active', playerCount: 4, created_at: '', createdBy: 'p2' }],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Office War');
    expect(screen.queryByTestId('finished-games-toggle')).not.toBeInTheDocument();
  });

  test('host can delete a finished test game from inside the expander', async () => {
    vi.mocked(api.gameList).mockResolvedValue({
      games: [{ id: 'g3', name: 'Done Test', mode: 'test', status: 'finished', playerCount: 4, created_at: '', createdBy: 'p1' }],
    });
    vi.mocked(api.gameDelete).mockResolvedValue({ ok: true });
    vi.stubGlobal('confirm', () => true);
    const user = userEvent.setup();
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Finished games (1)');
    await user.click(screen.getByTestId('finished-games-toggle'));
    await user.click(screen.getByRole('button', { name: /^delete/i }));
    expect(api.gameDelete).toHaveBeenCalledWith('tok-1', 'g3');
  });
});

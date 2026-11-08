import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  gameList: vi.fn(),
  gameCreate: vi.fn(),
  gameJoin: vi.fn(),
  gameDelete: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    player: { id: 'p1', name: 'tester' },
    token: 'tok-1',
    isGuest: false,
    signin: vi.fn(), register: vi.fn(), guestSignin: vi.fn(), signout: vi.fn(),
  }),
}));

beforeEach(() => vi.clearAllMocks());

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

  test('create form submits payload and shows invite code', async () => {
    vi.mocked(api.gameList).mockResolvedValue({ games: [] });
    vi.mocked(api.gameCreate).mockResolvedValue({ gameId: 'g9', inviteCode: 'abc12345' });
    const user = userEvent.setup();
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByRole('heading', { name: /create game/i });
    await user.type(screen.getByLabelText(/game name/i), 'My Game');
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    expect(await screen.findByText(/abc12345/)).toBeInTheDocument();
    expect(api.gameCreate).toHaveBeenCalledWith('tok-1', expect.objectContaining({ name: 'My Game' }));
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
    vi.mocked(api.gameList).mockResolvedValue({
      games: [{ id: 'g2', name: 'Test Run', mode: 'test', status: 'lobby', playerCount: 1, created_at: '', createdBy: 'p1' }],
    });
    vi.mocked(api.gameDelete).mockResolvedValue({ ok: true });
    vi.stubGlobal('confirm', () => true);
    const user = userEvent.setup();
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Test Run');
    await user.click(screen.getByRole('button', { name: /^Delete$/i }));
    expect(api.gameDelete).toHaveBeenCalledWith('tok-1', 'g2');
    expect(screen.queryByText('Test Run')).not.toBeInTheDocument();
  });

  test('does not show delete for non-host game', async () => {
    vi.mocked(api.gameList).mockResolvedValue({
      games: [{ id: 'g1', name: 'Office War', mode: 'play', status: 'active', playerCount: 4, created_at: '', createdBy: 'p2' }],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('Office War');
    expect(screen.queryByRole('button', { name: /^Delete$/i })).not.toBeInTheDocument();
  });
});

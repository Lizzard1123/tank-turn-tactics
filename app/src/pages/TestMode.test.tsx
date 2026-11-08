import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TestMode from './TestMode';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  gameCreate: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    player: { id: 'p1', name: 'guest-abc' },
    token: 'tok-1',
    isGuest: true,
    signin: vi.fn(), register: vi.fn(), guestSignin: vi.fn(), signout: vi.fn(),
  }),
}));

beforeEach(() => vi.clearAllMocks());

describe('TestMode', () => {
  test('creates a test-mode game with default bots and routes to lobby', async () => {
    vi.mocked(api.gameCreate).mockResolvedValue({ gameId: 'g7', inviteCode: 'xyz' });
    render(
      <MemoryRouter initialEntries={['/test']}>
        <Routes>
          <Route path="/test" element={<TestMode />} />
          <Route path="/lobby/:gameId" element={<div>LOBBY PAGE</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('LOBBY PAGE');
    expect(api.gameCreate).toHaveBeenCalledWith('tok-1', expect.objectContaining({
      mode: 'test',
      name: expect.stringMatching(/^Test game/),
      config: expect.objectContaining({
        board: 8,
        apIntervalMinutes: 2,
        bots: [{ difficulty: 'easy' }, { difficulty: 'easy' }, { difficulty: 'easy' }],
      }),
    }));
  });

  test('shows error if create fails', async () => {
    vi.mocked(api.gameCreate).mockRejectedValue(new Error('create failed'));
    render(
      <MemoryRouter initialEntries={['/test']}>
        <Routes>
          <Route path="/test" element={<TestMode />} />
          <Route path="/lobby/:gameId" element={<div>LOBBY PAGE</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('create failed'));
  });
});

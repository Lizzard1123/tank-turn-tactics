import { test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from './Landing';
import { useAuth } from '../lib/auth';

vi.mock('../lib/auth', () => ({
  useAuth: vi.fn().mockReturnValue({
    player: null, token: null, isGuest: false,
    signin: vi.fn(), register: vi.fn(), guestSignin: vi.fn(), signout: vi.fn(),
  }),
}));

test('renders the core menu items for signed-out visitors', () => {
  render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(screen.getByTestId('btn-play')).toHaveTextContent('Play');
  expect(screen.getByTestId('btn-instructions')).toHaveTextContent('Instructions');
  expect(screen.getByTestId('btn-test')).toHaveTextContent('Test Mode');
  expect(screen.queryByTestId('btn-dashboard')).not.toBeInTheDocument();
  expect(screen.queryByTestId('btn-profile')).not.toBeInTheDocument();
});

test('signed-in visitors also get Profile (no Dashboard button)', () => {
  vi.mocked(useAuth).mockReturnValue({
    player: { id: 'p1', name: 'tester' }, token: 't', isGuest: false,
    signin: vi.fn(), register: vi.fn(), guestSignin: vi.fn(), signout: vi.fn(),
  });
  render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(screen.queryByTestId('btn-dashboard')).not.toBeInTheDocument();
  expect(screen.getByTestId('btn-profile')).toBeInTheDocument();
});

test('main menu has no Dashboard button (Play is the way in)', () => {
  vi.mocked(useAuth).mockReturnValue({
    player: { id: 'p1', name: 'tester' }, token: 't', isGuest: false,
    signin: vi.fn(), register: vi.fn(), guestSignin: vi.fn(), signout: vi.fn(),
  });
  render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(screen.queryByTestId('btn-dashboard')).not.toBeInTheDocument();
  expect(screen.getByTestId('btn-play')).toBeInTheDocument();
});

import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TankCard from './TankCard';
import type { PlayerState } from '@ttt/engine';

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1', name: 'Alice', pos: { x: 0, y: 0 }, hp: 3, ap: 1, range: 2,
    isBot: false, botDifficulty: null, ...overrides,
  };
}

describe('TankCard', () => {
  test('renders name and hp for all players', () => {
    render(<TankCard player={player()} isMe={false} />);
    expect(screen.getByTestId('card-p1')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // hp
  });

  test('shows skull icon for dead player', () => {
    render(<TankCard player={player({ hp: 0 })} isMe={false} />);
    expect(screen.getByTestId('card-p1')).toBeInTheDocument();
  });

  test('shows robot icon and name for bot', () => {
    render(<TankCard player={player({ id: 'bot-1', name: 'Hard Bot', isBot: true, botDifficulty: 'hard' })} isMe={false} />);
    expect(screen.getByText('Hard Bot')).toBeInTheDocument();
  });

  test('self card renders name with (you) suffix and hp + range', () => {
    render(<TankCard player={player({ id: 'me', name: 'You' })} isMe={true} />);
    expect(screen.getByText('You (you)')).toBeInTheDocument();
    const stats = screen.getByTestId('card-me');
    expect(stats.textContent).toContain('3'); // hp
    expect(stats.textContent).toContain('2'); // range (self only)
  });
});

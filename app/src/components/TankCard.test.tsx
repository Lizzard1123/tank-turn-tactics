import { describe, test, expect, vi } from 'vitest';
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
    const { container } = render(<TankCard player={player()} isMe={false} />);
    expect(screen.getByTestId('card-p1')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(container.textContent).toContain('3');
  });

  test('shows skull icon for dead player', () => {
    const { container } = render(<TankCard player={player({ hp: 0 })} isMe={false} />);
    expect(screen.getByTestId('card-p1')).toBeInTheDocument();
    expect(container.textContent).toContain('0');
  });

  test('shows robot icon and name for bot', () => {
    render(<TankCard player={player({ id: 'bot-1', name: 'Hard Bot', isBot: true, botDifficulty: 'hard' })} isMe={false} />);
    expect(screen.getByText('Hard Bot')).toBeInTheDocument();
  });

  test('self card renders name with (you) suffix', () => {
    render(<TankCard player={player({ id: 'me', name: 'You' })} isMe={true} />);
    expect(screen.getByText('You (you)')).toBeInTheDocument();
  });

  test('card calls onTap when clicked', () => {
    const onTap = vi.fn();
    const { container } = render(<TankCard player={player()} isMe={false} onTap={onTap} />);
    const button = container.querySelector('button')!;
    button.click();
    expect(onTap).toHaveBeenCalled();
  });

  test('card hides stats when hideStats true', () => {
    const { container } = render(<TankCard player={player()} isMe={false} hideStats />);
    expect(container.querySelector('.tank-card-stats')).not.toBeInTheDocument();
  });

  test('card shows stats when hideStats false', () => {
    const { container } = render(<TankCard player={player()} isMe={false} hideStats={false} />);
    expect(container.querySelector('.tank-card-stats')).toBeInTheDocument();
  });
});

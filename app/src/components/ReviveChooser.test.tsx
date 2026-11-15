import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReviveChooser from './ReviveChooser';
import type { GameState } from '@ttt/engine';

const players = {
  a: { id: 'a', name: 'Ann', pos: { x: 1, y: 1 }, hp: 0, ap: 0, range: 2, isBot: false, botDifficulty: null },
  b: { id: 'b', name: 'Bob', pos: { x: 1, y: 1 }, hp: 0, ap: 0, range: 2, isBot: false, botDifficulty: null },
  c: { id: 'c', name: 'Cid', pos: { x: 1, y: 1 }, hp: 0, ap: 0, range: 2, isBot: false, botDifficulty: null },
} as unknown as GameState['players'];

describe('ReviveChooser', () => {
  test('renders nothing when deadIds is null', () => {
    render(<ReviveChooser deadIds={null} players={players} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('revive-chooser')).not.toBeInTheDocument();
  });

  test('lists one option per grave, pick routes the chosen id', () => {
    const onPick = vi.fn();
    render(<ReviveChooser deadIds={['a', 'b']} players={players} onPick={onPick} onClose={vi.fn()} />);
    expect(screen.getByText('WHO GETS REVIVED?')).toBeInTheDocument();
    expect(screen.getByTestId('revive-option-a')).toHaveTextContent('Ann');
    expect(screen.getByTestId('revive-option-b')).toHaveTextContent('Bob');
    fireEvent.click(screen.getByTestId('revive-option-b'));
    expect(onPick).toHaveBeenCalledWith('b');
  });

  test('cancel and backdrop close without picking', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<ReviveChooser deadIds={['a', 'b', 'c']} players={players} onPick={onPick} onClose={onClose} />);
    expect(screen.getByTestId('revive-option-c')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('revive-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('revive-chooser'));
    expect(onClose).toHaveBeenCalledTimes(2);
    // clicking inside the dialog does not close
    fireEvent.click(screen.getByText('WHO GETS REVIVED?'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

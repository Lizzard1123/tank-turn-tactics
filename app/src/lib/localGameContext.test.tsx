import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocalGameProvider, useLocalGame, useLocalGameState } from './localGameContext';
import { createLocalGame } from './localGame';
import type { LocalGame } from './localGame';
import type { GameState } from '@ttt/engine';

function TestComponent() {
  const { game, setGame } = useLocalGame();
  return (
    <div>
      <div data-testid="game-exists">{game ? 'yes' : 'no'}</div>
      <div data-testid="game-null">{game === null ? 'true' : 'false'}</div>
      <button onClick={() => {
        const g = createLocalGame({ startingAp: 4 });
        setGame(g);
      }}>
        set game
      </button>
    </div>
  );
}

function StateComponent() {
  const state = useLocalGameState();
  return (
    <div>
      <div data-testid="state-seq">{state?.seq ?? 'none'}</div>
      <div data-testid="state-null">{state === null ? 'true' : 'false'}</div>
    </div>
  );
}

describe('LocalGameProvider', () => {
  test('provides null game by default', () => {
    render(
      <LocalGameProvider>
        <TestComponent />
      </LocalGameProvider>,
    );
    expect(screen.getByTestId('game-exists')).toHaveTextContent('no');
    expect(screen.getByTestId('game-null')).toHaveTextContent('true');
  });

  test('useLocalGameState returns null when no game', () => {
    render(
      <LocalGameProvider>
        <StateComponent />
      </LocalGameProvider>,
    );
    expect(screen.getByTestId('state-null')).toHaveTextContent('true');
    expect(screen.getByTestId('state-seq')).toHaveTextContent('none');
  });

  test('setGame button is present', () => {
    render(
      <LocalGameProvider>
        <TestComponent />
      </LocalGameProvider>,
    );
    expect(screen.getByText('set game')).toBeInTheDocument();
  });
});

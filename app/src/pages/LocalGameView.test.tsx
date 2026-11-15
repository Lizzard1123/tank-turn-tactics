import { describe, test, expect } from 'vitest';
import { useEffect } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Game from './Game';
import { LocalGameProvider, useLocalGame } from '../lib/localGameContext';
import { createLocalGame, type LocalGame } from '../lib/localGame';

// LocalGameView (the /game/local branch) runs against the REAL in-memory
// engine via LocalGameProvider. These tests drive its full action flow —
// confirm gate, toggle-off, upgrade confirm, cancel — through the actual
// engine, not a mock.
//
// The /game/local route needs a game in the provider; this boot mounts the
// game (no AP drip — real timers would leak) and exposes it so the test can
// compute legal target squares from the true spawn positions.
let gameRef: LocalGame | null = null;

// NOTE: LocalGameView's callbacks live after its null-game early return, so
// mounting <Game> while the provider game is null trips the rules of hooks.
// The app never does that (TestMode sets the game before navigating), and
// this harness gates the same way: routes render only once a game exists.
function Harness() {
  const { setGame, game } = useLocalGame();
  useEffect(() => {
    if (!gameRef) {
      gameRef = createLocalGame({ startingAp: 4 });
      setGame(gameRef);
    }
  }, [setGame]);
  if (!game) return null;
  return (
    <>
      <Probe />
      <Routes>
        <Route path="/game/:gameId" element={<Game />} />
      </Routes>
    </>
  );
}

function Probe() {
  const { game } = useLocalGame();
  if (game) gameRef = game;
  return null;
}

function renderLocal() {
  gameRef = null;
  return render(
    <LocalGameProvider>
      <MemoryRouter initialEntries={['/game/local']}>
        <Harness />
      </MemoryRouter>
    </LocalGameProvider>,
  );
}

const ap = () => screen.getByTestId('ap-counter').textContent;

/** the square one step right of the local player, guaranteed on the board */
function legalMoveTarget(): { x: number; y: number } {
  const me = gameRef!.state().players.me;
  const n = gameRef!.state().config.board;
  expect(n).toBeGreaterThan(me.pos.x + 1);
  return { x: me.pos.x + 1, y: me.pos.y };
}

describe('LocalGameView — confirm-gated actions against the real engine', () => {
  test('move waits behind the confirm dialog; Yes applies it (AP drops), No never does', () => {
    renderLocal();
    const before = ap();
    expect(before).toBe('4 AP');

    fireEvent.click(screen.getByTestId('btn-move'));
    const to = legalMoveTarget();
    fireEvent.click(screen.getByTestId(`cell-${to.x}-${to.y}`));

    // the dialog shows directional wording; nothing applied yet
    expect(screen.getByTestId('confirm-message')).toHaveTextContent(/^move (up|down|left|right)$/);
    expect(ap()).toBe('4 AP');
    expect(gameRef!.state().players.me.pos).not.toEqual(to);

    // No cancels: state untouched, dialog gone
    fireEvent.click(screen.getByTestId('confirm-no'));
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(ap()).toBe('4 AP');

    // now confirm: the mode survived the cancel, so tapping the cell again
    // re-prompts — Yes applies the move and AP drops
    fireEvent.click(screen.getByTestId(`cell-${to.x}-${to.y}`));
    fireEvent.click(screen.getByTestId('confirm-yes'));
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(gameRef!.state().players.me.pos).toEqual(to);
    expect(ap()).toBe('3 AP');
  });

  test('cancel keeps the mode active: a second target tap re-prompts', () => {
    renderLocal();
    fireEvent.click(screen.getByTestId('btn-move'));
    const to = legalMoveTarget();
    fireEvent.click(screen.getByTestId(`cell-${to.x}-${to.y}`));
    fireEvent.click(screen.getByTestId('confirm-no'));
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    // mode is still 'move' — tapping again re-prompts (no re-selection needed)
    fireEvent.click(screen.getByTestId(`cell-${to.x}-${to.y}`));
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
  });

  test('clicking the active mode button toggles it off without acting', () => {
    renderLocal();
    fireEvent.click(screen.getByTestId('btn-move'));
    expect(screen.getByTestId('btn-move')).toHaveClass('active');
    fireEvent.click(screen.getByTestId('btn-move'));
    expect(screen.getByTestId('btn-move')).not.toHaveClass('active');
    // mode off: a cell tap does nothing at all
    const to = legalMoveTarget();
    fireEvent.click(screen.getByTestId(`cell-${to.x}-${to.y}`));
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(ap()).toBe('4 AP');
  });

  test('upgrade range confirms with the CURRENT range and applies on Yes', () => {
    renderLocal();
    expect(gameRef!.state().players.me.range).toBe(2);
    fireEvent.click(screen.getByTestId('btn-upgrade'));
    expect(screen.getByTestId('confirm-message')).toHaveTextContent('upgrade range from 2 to 3');
    expect(ap()).toBe('4 AP'); // not spent until confirmed
    fireEvent.click(screen.getByTestId('confirm-yes'));
    expect(gameRef!.state().players.me.range).toBe(3);
    expect(ap()).toBe('2 AP'); // 4 - upgradeCost(2)
  });

  test('upgrade range cancel leaves AP and range untouched', () => {
    renderLocal();
    fireEvent.click(screen.getByTestId('btn-upgrade'));
    fireEvent.click(screen.getByTestId('confirm-no'));
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(gameRef!.state().players.me.range).toBe(2);
    expect(ap()).toBe('4 AP');
  });

  test('a pending dialog blocks a second action from queuing behind it', () => {
    renderLocal();
    fireEvent.click(screen.getByTestId('btn-upgrade'));
    // another action request while the dialog is open must be ignored
    fireEvent.click(screen.getByTestId('btn-upgrade'));
    expect(screen.getAllByTestId('confirm-dialog')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('confirm-yes'));
    expect(gameRef!.state().players.me.range).toBe(3);
    expect(ap()).toBe('2 AP'); // exactly ONE upgrade applied
  });
});

import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Board from './Board';
import type { GameState } from '@ttt/engine';

const state = (overrides?: Partial<GameState>): GameState => ({
  seq: 0, day: 1, tickClockMinutes: 0,
  config: { seed: 1, board: 4, startingHp: 3, startingAp: 1, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0 },
  players: {
    p1: { id: 'p1', name: 'me', pos: { x: 0, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
    p2: { id: 'p2', name: 'foe', pos: { x: 2, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
  },
  order: ['p1', 'p2'], pendingVotes: [], jury: [], winner: null, log: [],
  ...overrides,
});

describe('Board', () => {
  test('renders board² cells', () => {
    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}} />);
    expect(screen.getByTestId('board')).toBeInTheDocument();
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 4; y++)
        expect(screen.getByTestId(`cell-${x}-${y}`)).toBeInTheDocument();
  });

  test('own tank is marked and enemy tank visible', () => {
    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}} />);
    expect(screen.getByTestId('tank-p1')).toHaveClass('own');
    expect(screen.getByTestId('tank-p2')).not.toHaveClass('own');
  });

  test('range overlay squares for own tank (manhattan ≤ 2, 4x4 board)', () => {
    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}} />);
    // p1 at (0,0) range 2: in-range cells with manhattan dist ≤2 and >0
    const expected = ['cell-1-0', 'cell-2-0', 'cell-0-1', 'cell-0-2', 'cell-1-1'];
    for (const id of expected) expect(screen.getByTestId(id)).toHaveClass('in-range');
    expect(screen.getByTestId('cell-3-0')).not.toHaveClass('in-range');
  });

  test('move mode highlights legal orthogonal destinations', () => {
    render(<Board state={state()} selectedMode="move" me="p1" onCellTap={() => {}} />);
    expect(screen.getByTestId('cell-1-0')).toHaveClass('legal');
    expect(screen.getByTestId('cell-0-1')).toHaveClass('legal');
    // (2,0) is occupied by p2, not a legal move destination
    expect(screen.getByTestId('cell-2-0')).not.toHaveClass('legal');
  });

  test('attack mode highlights tanks in range', () => {
    render(<Board state={state()} selectedMode="attack" me="p1" onCellTap={() => {}} />);
    expect(screen.getByTestId('cell-2-0')).toHaveClass('legal'); // p2 in range
  });

  test('onCellTap fires with tapped position', () => {
    const onTap = vi.fn();
    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={onTap} />);
    fireEvent.click(screen.getByTestId('cell-2-1'));
    expect(onTap).toHaveBeenCalledWith({ x: 2, y: 1 });
  });

  test('renders avatar image for players with one, generated flag for others', () => {
    render(
      <Board
        state={state()} selectedMode="none" me="p1"
        avatars={{ p1: 'https://example.com/a.jpg' }}
        onCellTap={() => {}}
      />,
    );
    // p1 has an avatar: full-square image
    expect(screen.getByTestId('tank-image-p1')).toHaveAttribute('href', 'https://example.com/a.jpg');
    // p2 has no avatar: falls back to a generated flag image (not a letter)
    expect(screen.getByTestId('tank-image-p2')).toBeInTheDocument();
    expect(screen.queryByTestId('tank-avatar-p2')).not.toBeInTheDocument();
    expect(screen.queryByText('F')).not.toBeInTheDocument();
  });

  test('renders ONE horizontal HP bar per occupied square, width proportional to HP', () => {
    const damaged = state({
      players: {
        p1: { id: 'p1', name: 'me', pos: { x: 0, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
        p2: { id: 'p2', name: 'foe', pos: { x: 2, y: 0 }, hp: 1, ap: 1, range: 2, isBot: false, botDifficulty: null },
      },
    });
    render(<Board state={damaged} selectedMode="none" me="p1" onCellTap={() => {}} />);
    const full = screen.getByTestId('life-bar-p1');
    const hurt = screen.getByTestId('life-bar-p2');
    // horizontal bar: width >> height
    expect(Number(full.getAttribute('height'))).toBeLessThan(Number(full.getAttribute('width')));
    // hp 3/3 vs hp 1/3 → p2's bar is one third of p1's width
    expect(Number(hurt.getAttribute('width'))).toBeCloseTo(Number(full.getAttribute('width')) / 3, 5);
  });

  test('no HP bar for zero-HP tanks', () => {
    const dead = state({
      players: {
        p1: { id: 'p1', name: 'me', pos: { x: 0, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
        p2: { id: 'p2', name: 'foe', pos: { x: 2, y: 0 }, hp: 0, ap: 1, range: 2, isBot: false, botDifficulty: null },
      },
    });
    render(<Board state={dead} selectedMode="none" me="p1" onCellTap={() => {}} />);
    expect(screen.queryByTestId('life-bar-p2')).not.toBeInTheDocument();
  });
});

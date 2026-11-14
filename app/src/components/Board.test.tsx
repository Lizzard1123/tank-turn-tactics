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

const attackEvent = () => ({
  seq: 1, type: 'attack' as const, actorId: 'p1', createdAt: 't',
  payload: { targetId: 'p2' },
});

// React resolves onAnimationEnd to a vendor-prefixed native event name when the
// environment lacks AnimationEvent (jsdom: 'webkitAnimationEnd'; real browsers
// resolve it to 'animationend'). Fire the prefixed variant so the React handler
// runs under jsdom.
const fireFxAnimationEnd = (el: Element) => {
  fireEvent(el, new Event('webkitAnimationEnd', { bubbles: true }));
};

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

  test('tank element PERSISTS across a move and its transform updates (slide, not remount)', () => {
    const { container, rerender } = render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}} />);
    const before = container.querySelector('[data-testid="tank-p1"]')!;
    rerender(<Board state={state({ players: { ...state().players, p1: { ...state().players.p1, pos: { x: 1, y: 0 } } } })} selectedMode="none" me="p1" onCellTap={() => {}} />);
    const after = container.querySelector('[data-testid="tank-p1"]')!;
    expect(after).toBe(before); // same DOM node — CSS transition can animate it
    expect(after.getAttribute('style')).toContain('translate(40px');
  });

  test('dead tanks are not rendered (visual only — cells still behave)', () => {
    const dead = state({ players: { ...state().players, p2: { ...state().players.p2, hp: 0 } } });
    render(<Board state={dead} selectedMode="none" me="p1" onCellTap={() => {}} />);
    expect(screen.queryByTestId('tank-p2')).not.toBeInTheDocument();
    expect(screen.getByTestId('tank-p1')).toBeInTheDocument();
  });

  test('tank transform reflects its position', () => {
    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}} />);
    // jsdom normalizes "translate(0px, 0px)" to "translate(0px)", so assert
    // on the x-offset prefix (holds verbatim in browsers too).
    expect(screen.getByTestId('tank-p1').getAttribute('style')).toContain('translate(0px');
    expect(screen.getByTestId('tank-p2').getAttribute('style')).toContain('translate(80px');
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

  test('attack event spawns a red bullet fx (even at a now-dead target)', () => {
    render(<Board state={state({ players: { ...state().players, p2: { ...state().players.p2, hp: 0 } } })}
                  selectedMode="none" me="p1" onCellTap={() => {}} lastEvent={attackEvent()} />);
    const fx = screen.getByTestId('fx-attack');
    expect(fx.querySelector('circle')).not.toBeNull();
    expect(fx.querySelector('circle')!.getAttribute('fill')).toBe('#e33');
  });

  test('give_ap event spawns a green bullet fx', () => {
    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}}
      lastEvent={{ seq: 2, type: 'give_ap', actorId: 'p1', createdAt: 't', payload: { targetId: 'p2', amount: 1 } }} />);
    expect(screen.getByTestId('fx-give_ap').querySelector('circle')!.getAttribute('fill')).toBe('#3c3');
  });

  test('upgrade_range event spawns a pulse ring on the actor', () => {
    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}}
      lastEvent={{ seq: 3, type: 'upgrade_range', actorId: 'p1', createdAt: 't', payload: {} }} />);
    expect(screen.getByTestId('fx-pulse')).toBeInTheDocument();
  });

  test('opponent action fx still renders (not gated to the local player)', () => {
    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}}
      lastEvent={{ seq: 1, type: 'attack', actorId: 'p2', createdAt: 't', payload: { targetId: 'p1' } } } />);
    expect(screen.getByTestId('fx-attack')).toBeInTheDocument();
  });

  test('masked attack (hidden actor) renders no fx', () => {
    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}}
      lastEvent={{ seq: 1, type: 'attack', actorId: 'hidden', createdAt: 't', payload: { targetId: 'p1', anon: true } } } />);
    expect(screen.queryByTestId('fx-attack')).not.toBeInTheDocument();
  });

  test('opponent action fx still renders (not gated to the local player)', () => {
    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}}
      lastEvent={{ seq: 1, type: 'attack', actorId: 'p2', createdAt: 't', payload: { targetId: 'p1' } } } />);
    expect(screen.getByTestId('fx-attack')).toBeInTheDocument();
  });

  test('masked attack (hidden actor) renders no fx', () => {
    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}}
      lastEvent={{ seq: 1, type: 'attack', actorId: 'hidden', createdAt: 't', payload: { targetId: 'p1', anon: true } } } />);
    expect(screen.queryByTestId('fx-attack')).not.toBeInTheDocument();
  });

  test('move events spawn no fx; fx is removed on animationend', () => {
    const { rerender } = render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}}
      lastEvent={{ seq: 4, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 1, y: 0 } } }} />);
    expect(screen.queryByTestId('fx-move')).not.toBeInTheDocument();
    rerender(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}} lastEvent={attackEvent()} />);
    fireFxAnimationEnd(screen.getByTestId('fx-attack'));
    expect(screen.queryByTestId('fx-attack')).not.toBeInTheDocument();
  });

  test('missing actor/target position renders no fx', () => {
    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}}
      lastEvent={{ seq: 5, type: 'attack', actorId: 'ghost', createdAt: 't', payload: { targetId: 'p2' } }} />);
    expect(screen.queryByTestId('fx-attack')).not.toBeInTheDocument();
  });

  test('fx geometry: bullet layer translates to the actor cell center; delta lands on the target cell', () => {
    const attack = render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}} lastEvent={attackEvent()} />);
    const fx = screen.getByTestId('fx-attack');
    // the translated bullet layer sits inside the fx layer, positioned at the
    // actor cell CENTER: p1 at (0,0) → 0*40 + 40/2 = 20px
    const bulletLayer = fx.querySelector('g');
    expect(bulletLayer).not.toBeNull();
    expect(bulletLayer!.getAttribute('style')).toContain('translate(20px, 20px)');
    // bullet flies the (to − from) delta: p2 at (2,0) → +80px x, +0px y
    const bullet = fx.querySelector('.fx-bullet') as SVGElement;
    expect(bullet.style.getPropertyValue('--fx-dx')).toBe('80px');
    expect(bullet.style.getPropertyValue('--fx-dy')).toBe('0px');
    attack.unmount();

    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}}
      lastEvent={{ seq: 7, type: 'give_ap', actorId: 'p1', createdAt: 't', payload: { targetId: 'p2', amount: 1 } }} />);
    const giveFx = screen.getByTestId('fx-give_ap');
    expect(giveFx.querySelector('g')!.getAttribute('style')).toContain('translate(20px, 20px)');
    expect((giveFx.querySelector('.fx-bullet') as SVGElement).style.getPropertyValue('--fx-dx')).toBe('80px');
  });
});

describe('Board — new rules', () => {
  test('dead players render gravestones with their name, alive render tanks', () => {
    render(<Board state={state({
      players: {
        p1: { id: 'p1', name: 'me', pos: { x: 0, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
        p2: { id: 'p2', name: 'foe', pos: { x: 2, y: 0 }, hp: 0, ap: 1, range: 2, isBot: false, botDifficulty: null },
      },
    })} selectedMode="none" me="p1" onCellTap={() => {}} />);
    expect(screen.getByTestId('grave-p2')).toBeInTheDocument();
    expect(screen.getByTestId('grave-p2')).toHaveTextContent('foe');
    expect(screen.queryByTestId('tank-p2')).not.toBeInTheDocument();
    expect(screen.getByTestId('tank-p1')).toBeInTheDocument();
  });

  test('board hearts render one tile per heart on the board', () => {
    render(<Board state={state({ hearts: [{ x: 3, y: 3, seq: 1 }, { x: 0, y: 1, seq: 2 }] })} selectedMode="none" me="p1" onCellTap={() => {}} />);
    expect(screen.getAllByTestId('heart-tile')).toHaveLength(2);
  });

  test('legacy single-heart snapshots still render a heart tile', () => {
    render(<Board state={state({ hearts: undefined, heart: { x: 3, y: 3, seq: 1 } } as never)} selectedMode="none" me="p1" onCellTap={() => {}} />);
    expect(screen.getByTestId('heart-tile')).toBeInTheDocument();
  });

  test('no heart tile without a board heart', () => {
    render(<Board state={state({ hearts: [] })} selectedMode="none" me="p1" onCellTap={() => {}} />);
    expect(screen.queryByTestId('heart-tile')).not.toBeInTheDocument();
  });

  test('give_heart mode highlights an under-max ally in range', () => {
    render(<Board state={state({
      config: { seed: 1, board: 4, startingHp: 3, startingAp: 1, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0, heartGifts: true },
      players: {
        p1: { id: 'p1', name: 'me', pos: { x: 0, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
        p2: { id: 'p2', name: 'foe', pos: { x: 1, y: 0 }, hp: 2, ap: 1, range: 2, isBot: false, botDifficulty: null },
      },
    })} selectedMode="give_heart" me="p1" onCellTap={() => {}} />);
    expect(screen.getByTestId('cell-1-0')).toHaveClass('legal');
  });

  test('give_heart mode rejects full-hp allies and graves when revives are off', () => {
    render(<Board state={state({
      config: { seed: 1, board: 4, startingHp: 3, startingAp: 1, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0, heartGifts: true, revives: false },
      players: {
        p1: { id: 'p1', name: 'me', pos: { x: 0, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
        p2: { id: 'p2', name: 'foe', pos: { x: 1, y: 0 }, hp: 0, ap: 1, range: 2, isBot: false, botDifficulty: null },
      },
    })} selectedMode="give_heart" me="p1" onCellTap={() => {}} />);
    expect(screen.getByTestId('cell-1-0')).not.toHaveClass('legal');
  });

  test('give_heart mode highlights a grave when revives are on', () => {
    render(<Board state={state({
      config: { seed: 1, board: 4, startingHp: 3, startingAp: 1, baseRange: 2, apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0, heartGifts: true, revives: true },
      players: {
        p1: { id: 'p1', name: 'me', pos: { x: 0, y: 0 }, hp: 3, ap: 1, range: 2, isBot: false, botDifficulty: null },
        p2: { id: 'p2', name: 'foe', pos: { x: 1, y: 0 }, hp: 0, ap: 1, range: 2, isBot: false, botDifficulty: null },
      },
    })} selectedMode="give_heart" me="p1" onCellTap={() => {}} />);
    expect(screen.getByTestId('cell-1-0')).toHaveClass('legal');
  });

  test('tank name plates render by default and hide when showPlayerNames is off', () => {
    render(<Board state={state()} selectedMode="none" me="p1" onCellTap={() => {}} />);
    expect(screen.getByText('me')).toBeInTheDocument();
    expect(screen.getByText('foe')).toBeInTheDocument();

    render(<Board state={state({ config: { ...state().config, showPlayerNames: false } })} selectedMode="none" me="p1" onCellTap={() => {}} />);
    // both boards are mounted; scope the assertion to the second
    const boards = screen.getAllByTestId('board');
    const hidden = boards[1];
    expect(hidden.textContent).not.toContain('foe');
  });
});

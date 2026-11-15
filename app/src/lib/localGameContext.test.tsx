import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalGameProvider, useLocalGame, useLocalGameState } from './localGameContext';
import { createLocalGame } from './localGame';

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
      <div data-testid="state-hp">{state?.players?.p1?.hp ?? 'none'}</div>
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

  test('setGame provides game to consumers', async () => {
    function Consumer() {
      const { game } = useLocalGame();
      const seq = game != null ? game.state().seq : 'null';
      return <div data-testid="game-seq">{seq}</div>;
    }
    function Mounter() {
      const { setGame } = useLocalGame();
      return (
        <>
          <Consumer />
          <button onClick={() => setGame(createLocalGame({ startingAp: 5 }))}>
            set
          </button>
        </>
      );
    }
    const user = userEvent.setup();
    render(
      <LocalGameProvider>
        <Mounter />
      </LocalGameProvider>,
    );
    expect(screen.getByTestId('game-seq')).toHaveTextContent('null');
    await user.click(screen.getByText('set'));
    expect(await screen.findByTestId('game-seq')).toHaveTextContent('0');
  });

  test('useLocalGameState reacts to game state changes', async () => {
    function StateMount() {
      const { setGame } = useLocalGame();
      return (
        <>
          <StateComponent />
          <button onClick={() => {
            const g = createLocalGame({ startingAp: 3 });
            setGame(g);
          }}>
            init
          </button>
        </>
      );
    }
    render(
      <LocalGameProvider>
        <StateMount />
      </LocalGameProvider>,
    );
    expect(screen.getByTestId('state-seq')).toHaveTextContent('none');
    const initBtn = await screen.findByText('init');
    initBtn.click();
    expect(await screen.findByTestId('state-seq')).toHaveTextContent('0');
  });

  test('game survives re-render (state persistence)', () => {
    function ReRenderer() {
      const { game } = useLocalGame();
      const seq = game != null ? game.state().seq : 'null';
      return <div data-testid="game-seq">{seq}</div>;
    }
    function Mounter() {
      const { setGame } = useLocalGame();
      return (
        <>
          <ReRenderer />
          <button onClick={() => setGame(createLocalGame({ startingAp: 7 }))}>
            set
          </button>
        </>
      );
    }
    const { rerender } = render(
      <LocalGameProvider>
        <Mounter />
      </LocalGameProvider>,
    );
    rerender(
      <LocalGameProvider>
        <Mounter />
      </LocalGameProvider>,
    );
    expect(screen.getByTestId('game-seq')).toHaveTextContent('null');
  });

  test('multiple consumers share the same game', () => {
    function ConsumerA() {
      const { game } = useLocalGame();
      const seq = game != null ? game.state().seq : 'null';
      return <div data-testid="a-seq">{seq}</div>;
    }
    function ConsumerB() {
      const { game } = useLocalGame();
      const seq = game != null ? game.state().seq : 'null';
      return <div data-testid="b-seq">{seq}</div>;
    }
    function Mounter() {
      const { setGame } = useLocalGame();
      return (
        <>
          <ConsumerA />
          <ConsumerB />
          <button onClick={() => setGame(createLocalGame({ startingAp: 2 }))}>
            set
          </button>
        </>
      );
    }
    render(
      <LocalGameProvider>
        <Mounter />
      </LocalGameProvider>,
    );
    expect(screen.getByTestId('a-seq')).toHaveTextContent('null');
    expect(screen.getByTestId('b-seq')).toHaveTextContent('null');
  });
});

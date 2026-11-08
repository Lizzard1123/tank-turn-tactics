import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LocalGame } from './localGame';
import type { GameState } from '@ttt/engine';

interface LocalGameContextValue {
  game: LocalGame | null;
  setGame: (game: LocalGame) => void;
}

const LocalGameContext = createContext<LocalGameContextValue>({ game: null, setGame: () => {} });

// Persists across route navigation so TestMode can publish the local game and
// Game can consume it after navigating to /game/local.
export function LocalGameProvider({ children }: { children: ReactNode }) {
  const [game, setGame] = useState<LocalGame | null>(null);
  return (
    <LocalGameContext.Provider value={{ game, setGame }}>
      {children}
    </LocalGameContext.Provider>
  );
}

export function useLocalGame() {
  return useContext(LocalGameContext);
}

// Hook consumers use to re-render whenever the local game state mutates
// (either through a player action or the client-side AP drip).
export function useLocalGameState(): GameState | null {
  const { game } = useLocalGame();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!game) return;
    const unsub = game.subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, [game]);
  return game ? game.state() : null;
}

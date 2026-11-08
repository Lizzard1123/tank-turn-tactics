import { describe, it, expect } from 'vitest';
import type { GameState, GameEvent } from '../src/types';

describe('engine scaffold', () => {
  it('imports types without error', () => {
    const e: GameEvent | null = null;
    expect(e).toBeNull();
  });
});

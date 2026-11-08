import { mulberry32, hashSeed } from './rng';
import { inRange, manhattan } from './geom';
import type { ActionType, GameState, Vec } from './types';

export interface BotAction { type: ActionType; payload: Record<string, unknown> }

type Difficulty = 'easy' | 'medium' | 'hard';

const ACT_PROB: Record<Difficulty, number> = { easy: 0.4, medium: 0.8, hard: 0.95 };

function legalMoves(s: GameState, botId: string): Vec[] {
  const bot = s.players[botId];
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  const moves: Vec[] = [];
  for (const [dx, dy] of dirs) {
    const to = { x: bot.pos.x + dx, y: bot.pos.y + dy };
    if (to.x < 0 || to.y < 0 || to.x >= s.config.board || to.y >= s.config.board) continue;
    if (Object.values(s.players).some(p => p.pos.x === to.x && p.pos.y === to.y)) continue;
    moves.push(to);
  }
  return moves;
}

function targetsInRange(s: GameState, botId: string): string[] {
  const bot = s.players[botId];
  return Object.values(s.players)
    .filter(p => p.id !== botId && p.hp > 0 && inRange(bot.pos, p.pos, bot.range))
    .map(p => p.id);
}

export function planBotAction(state: GameState, botId: string): BotAction | null {
  const bot = state.players[botId];
  if (!bot || !bot.isBot || bot.hp <= 0) return null;
  const diff: Difficulty = bot.botDifficulty ?? 'easy';
  if (bot.ap <= 0) return null;

  const rand = mulberry32(hashSeed(`${state.config.seed}:${state.seq}:${botId}`));
  if (rand() > ACT_PROB[diff]) return null;

  const targets = targetsInRange(state, botId);
  const moves = legalMoves(state, botId);

  if (diff === 'easy') {
    if (targets.length > 0 && rand() < 0.5) return { type: 'attack', payload: { targetId: targets[Math.floor(rand() * targets.length)] } };
    if (moves.length > 0) return { type: 'move', payload: { to: moves[Math.floor(rand() * moves.length)] } };
    return null;
  }

  if (diff === 'medium') {
    if (targets.length > 0) return { type: 'attack', payload: { targetId: targets[Math.floor(rand() * targets.length)] } };
    if (bot.ap >= state.config.upgradeCost && rand() < 0.3) return { type: 'upgrade_range', payload: {} };
    if (moves.length > 0) return { type: 'move', payload: { to: moves[Math.floor(rand() * moves.length)] } };
    return null;
  }

  // hard
  if (targets.length > 0) {
    // attack lowest-HP in range
    let best = targets[0], bestHp = state.players[targets[0]].hp;
    for (const t of targets) {
      if (state.players[t].hp < bestHp) { best = t; bestHp = state.players[t].hp; }
    }
    return { type: 'attack', payload: { targetId: best } };
  }
  if (bot.ap > 4 && targets.length > 0) return { type: 'give_ap', payload: { targetId: targets[0] } };
  if (bot.ap >= state.config.upgradeCost) return { type: 'upgrade_range', payload: {} };
  // move toward nearest player
  if (moves.length > 0) {
    const enemies = Object.values(state.players).filter(p => p.id !== botId && p.hp > 0);
    if (enemies.length > 0) {
      let best = moves[0], bestD = Infinity;
      for (const m of moves) {
        const d = Math.min(...enemies.map(e => manhattan(m, e.pos)));
        if (d < bestD) { bestD = d; best = m; }
      }
      return { type: 'move', payload: { to: best } };
    }
    return { type: 'move', payload: { to: moves[Math.floor(rand() * moves.length)] } };
  }
  return null;
}

import { EngineError } from './errors';
import { inRange, occupantAt } from './geom';
import type { GameEvent, GameState, PlayerState, Vec } from './types';

const requiredAp = (type: string, config: GameState['config']) =>
  type === 'upgrade_range' ? config.upgradeCost : 1;

function assertAlive(s: GameState, id: string): PlayerState {
  const p = s.players[id];
  if (!p) throw new EngineError('unknown player');
  if (p.hp <= 0) throw new EngineError('player is dead');
  return p;
}

function logLine(s: GameState, actorId: string, type: string, payload: Record<string, unknown>): string {
  const name = (id: string) => s.players[id]?.name ?? id;
  switch (type) {
    case 'move': {
      const to = payload.to as Vec;
      return `${name(actorId)} moved to (${to.x},${to.y})`;
    }
    case 'attack': {
      const targetId = payload.targetId as string;
      return `${name(actorId)} attacked ${name(targetId)} for 1 damage`;
    }
    case 'give_ap': {
      const targetId = payload.targetId as string;
      return `${name(actorId)} gave ${name(targetId)} 1 AP`;
    }
    case 'upgrade_range':
      return `${name(actorId)} upgraded range to ${s.players[actorId].range + 1}`;
    case 'daily_tick':
      return `Day ${s.day + 1}: all alive players gain ${payload.apGained ?? 1} AP`;
    case 'jury_vote': {
      const candidateId = payload.candidateId as string;
      return `Jury member ${name(actorId)} voted for ${name(candidateId)}`;
    }
    case 'fork':
      return `Game forked/rewound to event ${payload.toSeq}`;
    case 'bot_action':
      return `${name(actorId)} acted (bot)`;
    default:
      return `${actorId} did ${type}`;
  }
}

function applyAction(s: GameState, actorId: string, type: string, payload: Record<string, unknown>): GameState {
  const actor = assertAlive(s, actorId);
  const cost = requiredAp(type, s.config);
  if (actor.ap < cost) throw new EngineError('not enough AP');
  switch (type) {
    case 'move': {
      const to = payload.to as Vec;
      const dx = Math.abs(to.x - actor.pos.x), dy = Math.abs(to.y - actor.pos.y);
      if (dx + dy !== 1) throw new EngineError('move must be 1 orthogonal square');
      if (to.x < 0 || to.y < 0 || to.x >= s.config.board || to.y >= s.config.board) throw new EngineError('outside board');
      if (occupantAt(s.players, to)) throw new EngineError('cell occupied');
      return { ...s, players: { ...s.players, [actorId]: { ...actor, pos: to, ap: actor.ap - 1 } } };
    }
    case 'attack': {
      const targetId = payload.targetId as string;
      if (targetId === actorId) throw new EngineError('cannot attack self');
      const target = assertAlive(s, targetId);
      if (!inRange(actor.pos, target.pos, actor.range)) throw new EngineError('target out of range');
      const hp = target.hp - 1;
      const players = { ...s.players, [actorId]: { ...actor, ap: actor.ap - 1 },
        [target.id]: { ...target, hp } };
      let jury = s.jury, winner = s.winner;
      if (hp <= 0) {
        jury = [...s.jury, target.id];
        const alive = Object.values(players).filter(p => p.hp > 0);
        if (alive.length === 1) winner = alive[0].id;
      }
      return { ...s, players, jury, winner };
    }
    case 'give_ap': {
      const targetId = payload.targetId as string;
      const target = assertAlive(s, targetId);
      if (!inRange(actor.pos, target.pos, actor.range)) throw new EngineError('target out of range');
      return { ...s, players: { ...s.players,
        [actorId]: { ...actor, ap: actor.ap - 1 },
        [target.id]: { ...target, ap: target.ap + 1 } } };
    }
    case 'upgrade_range': {
      return { ...s, players: { ...s.players,
        [actorId]: { ...actor, ap: actor.ap - s.config.upgradeCost, range: actor.range + 1 } } };
    }
    default: throw new EngineError(`unknown action ${type}`);
  }
}

export function applyEvent(state: GameState, event: GameEvent): GameState {
  if (event.seq !== state.seq + 1) throw new EngineError(`seq gap: expected ${state.seq + 1}, got ${event.seq}`);
  let s = state;

  if (event.type === 'bot_action') {
    const actor = s.players[event.actorId];
    if (!actor || !actor.isBot) throw new EngineError('bot_action actor must be a bot');
    const inner = event.payload.inner as { type: string; payload: Record<string, unknown> } | undefined;
    if (!inner) throw new EngineError('bot_action requires inner action');
    s = applyAction(s, event.actorId, inner.type, inner.payload ?? {});
  } else if (event.type === 'daily_tick' || event.type === 'jury_vote' || event.type === 'fork') {
    // Implemented in Task A5 / A6 — reach here only if tests demand; for now:
    if (event.type === 'fork') {
      // log-only; no state change (defense-in-depth per plan A6)
    } else {
      throw new EngineError(`event type ${event.type} not yet implemented`);
    }
  } else {
    s = applyAction(s, event.actorId, event.type, event.payload);
  }

  const entry = { seq: event.seq, text: logLine(s, event.actorId, event.type, event.payload) };
  return { ...s, seq: event.seq, log: [...s.log, entry] };
}

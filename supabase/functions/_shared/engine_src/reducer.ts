import { EngineError } from './errors.ts';
import { inRange, occupantAt } from './geom.ts';
import type { GameEvent, GameState, PlayerState, Vec } from './types.ts';

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
    case 'daily_tick': {
      const day = s.day + 1;
      const bonus = countBonusVotes(s.pendingVotes);
      const names = Object.keys(bonus).length
        ? ` (+1 jury AP to ${Object.keys(bonus).map(name).join(', ')})` : '';
      return `Day ${day}: all alive players gain ${payload.apGained ?? 1} AP${names}`;
    }
    case 'jury_vote': {
      const candidateId = payload.candidateId as string;
      return `Jury member ${name(actorId)} voted for ${name(candidateId)}`;
    }
    case 'fork':
      return `Game forked/rewound to event ${payload.toSeq}`;
    case 'bot_action':
      return `${name(actorId)} acted (bot)`;
    case 'join': {
      const joined = payload.playerId as string;
      const at = s.players[joined]?.pos;
      return at ? `${payload.name ?? joined} joined the war at (${at.x},${at.y})` : `${joined} joined the war`;
    }
    default:
      return `${actorId} did ${type}`;
  }
}

function countBonusVotes(votes: { voterId: string; candidateId: string }[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const v of votes) tally[v.candidateId] = (tally[v.candidateId] ?? 0) + 1;
  return Object.fromEntries(Object.entries(tally).filter(([, n]) => n >= 3));
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
  } else if (event.type === 'daily_tick') {
    const apGained = (event.payload.apGained as number) ?? s.config.apPerDay;
    const players = { ...s.players };
    for (const p of Object.values(players)) {
      if (p.hp > 0) players[p.id] = { ...p, ap: p.ap + apGained };
    }
    // jury bonus: candidates with >= 3 pending votes get +1
    const bonus = countBonusVotes(s.pendingVotes);
    for (const [candidateId] of Object.entries(bonus)) {
      const p = players[candidateId];
      if (p && p.hp > 0) players[candidateId] = { ...p, ap: p.ap + 1 };
    }
    const elapsed = (event.payload.elapsedMinutes as number) ?? 0;
    s = { ...s, day: s.day + 1, tickClockMinutes: s.tickClockMinutes + elapsed,
      players, pendingVotes: [] };
  } else if (event.type === 'jury_vote') {
    const voter = s.players[event.actorId];
    if (!voter) throw new EngineError('unknown player');
    if (voter.hp > 0) throw new EngineError('alive players cannot vote');
    const candidateId = event.payload.candidateId as string;
    if (!s.players[candidateId]) throw new EngineError('unknown candidate');
    if (s.pendingVotes.some(v => v.voterId === event.actorId)) throw new EngineError('already voted this day');
    s = { ...s, pendingVotes: [...s.pendingVotes, { voterId: event.actorId, candidateId }] };
  } else if (event.type === 'join') {
    // mid-game late join: spawn on the first free cell (row-major scan —
    // deterministic, so replays reconstruct the same position)
    const playerId = event.payload.playerId as string;
    const name = (event.payload.name as string) ?? playerId;
    if (s.players[playerId]) throw new EngineError(`player ${playerId} already in game`);
    let spawn: Vec | null = null;
    outer: for (let y = 0; y < s.config.board; y++) {
      for (let x = 0; x < s.config.board; x++) {
        if (!occupantAt(s.players, { x, y })) { spawn = { x, y }; break outer; }
      }
    }
    if (!spawn) throw new EngineError('board is full, cannot join');
    const player: PlayerState = {
      id: playerId, name, pos: spawn,
      hp: s.config.startingHp, ap: s.config.startingAp, range: s.config.baseRange,
      isBot: false, botDifficulty: null,
    };
    s = { ...s, players: { ...s.players, [playerId]: player },
      order: [...s.order, playerId] };
  } else if (event.type === 'fork') {
    // log-only; no state change (defense-in-depth: fork is realized by the
    // caller replaying a truncated event list, not by mutating state here)
  } else {
    s = applyAction(s, event.actorId, event.type, event.payload);
  }

  const entry = { seq: event.seq, text: logLine(s, event.actorId, event.type, event.payload) };
  return { ...s, seq: event.seq, log: [...s.log, entry] };
}

import { EngineError } from './errors';
import { inRange, occupantAt } from './geom';
import type { GameEvent, GameState, LogKind, PlayerId, PlayerState, Vec } from './types';

const requiredAp = (type: string, config: GameState['config']) => {
  if (type === 'upgrade_range') return config.upgradeCost;
  if (type === 'give_heart') return 0; // costs 1 of the giver's HP instead
  return 1;
};

function assertAlive(s: GameState, id: string): PlayerState {
  const p = s.players[id];
  if (!p) throw new EngineError('unknown player');
  if (p.hp <= 0) throw new EngineError('player is dead');
  return p;
}

function logLine(
  s: GameState, pre: GameState, actorId: string, type: string, payload: Record<string, unknown>,
): { text: string; kind?: LogKind } {
  const name = (id: string) => s.players[id]?.name ?? id;
  switch (type) {
    case 'move': {
      const to = payload.to as Vec;
      const base = `${name(actorId)} moved to (${to.x},${to.y})`;
      const claimed = (pre.hearts ?? (pre.heart ? [pre.heart] : [])).some(
        (h) => h.x === to.x && h.y === to.y,
      );
      if (!claimed) return { text: base };
      // at full hp the heart converts to +2 AP instead of healing
      if ((pre.players[actorId]?.hp ?? 0) >= s.config.startingHp)
        return { text: `${base} and found a heart (+2 AP)` };
      const before = pre.players[actorId]?.hp ?? 0;
      const gained = Math.min(before + 1, s.config.startingHp) - before;
      return { text: `${base} and found a heart (+${gained} hp)` };
    }
    case 'attack': {
      const targetId = payload.targetId as string;
      const killed = (pre.players[targetId]?.hp ?? 1) - 1 <= 0;
      if (payload.anon === true) {
        return { text: `Someone attacked ${name(targetId)} for 1 damage`, kind: killed ? 'kill' : undefined };
      }
      return { text: `${name(actorId)} attacked ${name(targetId)} for 1 damage`, kind: killed ? 'kill' : undefined };
    }
    case 'give_ap': {
      const targetId = payload.targetId as string;
      return { text: `${name(actorId)} gave ${name(targetId)} 1 AP` };
    }
    case 'give_heart': {
      const targetId = payload.targetId as string;
      const revived = (pre.players[targetId]?.hp ?? 1) <= 0;
      return revived
        ? { text: `${name(actorId)} revived ${name(targetId)} with a heart!`, kind: 'revive' }
        : { text: `${name(actorId)} gave ${name(targetId)} a heart` };
    }
    case 'upgrade_range':
      return { text: `${name(actorId)} upgraded range to ${s.players[actorId].range + 1}` };
    case 'daily_tick': {
      const day = s.day + 1;
      const bonus = countBonusVotes(s.pendingVotes);
      const names = Object.keys(bonus).length
        ? ` (+1 jury AP to ${Object.keys(bonus).map(name).join(', ')})` : '';
      const hauntNote = s.haunted && s.players[s.haunted]?.hp > 0
        ? `, ${name(s.haunted)} is haunted (no AP)` : '';
      return { text: `Day ${day}: all alive players gain ${payload.apGained ?? 1} AP${names}${hauntNote}` };
    }
    case 'jury_vote': {
      const candidateId = payload.candidateId as string;
      return { text: `Jury member ${name(actorId)} voted for ${name(candidateId)}` };
    }
    case 'fork':
      return { text: `Game forked/rewound to event ${payload.toSeq}` };
    case 'bot_action': {
      // unwrap kills so the live battle log shows bot final blows too
      const inner = payload.inner as { type: string; payload: { targetId?: string } } | undefined;
      const targetId = inner?.type === 'attack' ? inner.payload?.targetId : undefined;
      const killed = !!targetId && ((pre.players[targetId]?.hp ?? 1) - 1 <= 0);
      return { text: `${name(actorId)} acted (bot)`, kind: killed ? 'kill' : undefined };
    }
    case 'join': {
      const joined = payload.playerId as string;
      const at = s.players[joined]?.pos;
      return { text: at ? `${payload.name ?? joined} joined the war at (${at.x},${at.y})` : `${joined} joined the war` };
    }
    case 'heart_spawn': {
      const at = payload as unknown as Vec;
      return { text: `A heart appeared at (${at.x},${at.y})`, kind: 'heart_spawn' };
    }
    default:
      return { text: `${actorId} did ${type}` };
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
      // stepping onto a heart claims it: +1 hp, OR — at full hp — the heart
      // converts to +2 AP instead (never wasted)
      let players = { ...s.players, [actorId]: { ...actor, pos: to, ap: actor.ap - 1 } };
      const hearts = s.hearts ?? (s.heart ? [s.heart] : []);
      if (hearts.some((h) => h.x === to.x && h.y === to.y)) {
        players[actorId] = players[actorId].hp >= s.config.startingHp
          ? { ...players[actorId], ap: players[actorId].ap + 2 }
          : { ...players[actorId], hp: players[actorId].hp + 1 };
      }
      const remaining = hearts.filter((h) => !(h.x === to.x && h.y === to.y));
      return { ...s, players, hearts: remaining, heart: null };
    }
    case 'attack': {
      const targetId = payload.targetId as string;
      if (targetId === actorId) throw new EngineError('cannot attack self');
      const target = assertAlive(s, targetId);
      if (!inRange(actor.pos, target.pos, actor.range)) throw new EngineError('target out of range');
      const hp = target.hp - 1;
      let jury = s.jury, winner = s.winner;
      // AP steal on kill: the killer loots the victim's stash on the final
      // blow. Only then is the victim's AP zeroed (looted, not destroyed).
      const killed = hp <= 0;
      const steal = killed && s.config.apStealOnKill ? target.ap : 0;
      const players = { ...s.players,
        [actorId]: { ...actor, ap: actor.ap - 1 + steal },
        [target.id]: { ...target, hp, ap: steal > 0 ? 0 : target.ap } };
      if (killed) {
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
    case 'give_heart': {
      // costs 1 of the GIVER's hp (never the last one), not AP
      const targetId = payload.targetId as string;
      if (targetId === actorId) throw new EngineError('cannot gift yourself');
      const target = s.players[targetId];
      if (!target) throw new EngineError('unknown player');
      if (!inRange(actor.pos, target.pos, actor.range)) throw new EngineError('target out of range');
      if (actor.hp < 2) throw new EngineError('need at least 2 hp to give a heart');
      if (target.hp > 0) {
        if (target.hp >= s.config.startingHp) throw new EngineError('target at max hp');
        return { ...s, players: { ...s.players,
          [actorId]: { ...actor, hp: actor.hp - 1 },
          [target.id]: { ...target, hp: target.hp + 1 } } };
      }
      // revive: dead target returns at 1 hp / 0 AP and leaves the jury.
      // Revive keeps the target's position — and a heart may have spawned on
      // their grave while they were dead — so a heart under their feet is
      // claimed on the spot (+1 hp, or +2 AP if the revive alone maxed them).
      if (!s.config.revives) throw new EngineError('revives are disabled');
      const graveHearts = s.hearts ?? (s.heart ? [s.heart] : []);
      const underFeet = graveHearts.find(
        (h) => h.x === target.pos.x && h.y === target.pos.y,
      );
      let revived: PlayerState = { ...target, hp: 1, ap: 0 };
      if (underFeet) {
        revived = revived.hp >= s.config.startingHp
          ? { ...revived, ap: revived.ap + 2 }
          : { ...revived, hp: revived.hp + 1 };
      }
      return { ...s,
        players: { ...s.players,
          [actorId]: { ...actor, hp: actor.hp - 1 },
          [target.id]: revived },
        jury: s.jury.filter(id => id !== targetId),
        hearts: underFeet
          ? graveHearts.filter((h) => h !== underFeet)
          : graveHearts,
        heart: null };
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
    // jury haunt: the strictly-most-voted candidate (>0 votes; a tie haunts
    // nobody) loses this tick's drip. Jury bonus AP is unaffected.
    let lastHaunted: PlayerId | null = null;
    if (s.config.juryHaunt && s.pendingVotes.length > 0) {
      const tally: Record<string, number> = {};
      for (const v of s.pendingVotes) tally[v.candidateId] = (tally[v.candidateId] ?? 0) + 1;
      let bestId: string | null = null, bestN = 0, tie = false;
      for (const [id, n] of Object.entries(tally)) {
        if (n > bestN) { bestN = n; bestId = id; tie = false; }
        else if (n === bestN) tie = true;
      }
      if (bestId && !tie) lastHaunted = bestId;
    }
    const players = { ...s.players };
    for (const p of Object.values(players)) {
      if (p.hp > 0 && p.id !== lastHaunted) players[p.id] = { ...p, ap: p.ap + apGained };
    }
    // jury bonus: candidates with >= 3 pending votes get +1
    const bonus = countBonusVotes(s.pendingVotes);
    for (const [candidateId] of Object.entries(bonus)) {
      const p = players[candidateId];
      if (p && p.hp > 0) players[candidateId] = { ...p, ap: p.ap + 1 };
    }
    const elapsed = (event.payload.elapsedMinutes as number) ?? 0;
    s = { ...s, day: s.day + 1, tickClockMinutes: s.tickClockMinutes + elapsed,
      players, pendingVotes: [], haunted: lastHaunted };
  } else if (event.type === 'heart_spawn') {
    // system-only event (the tick function mints it): place another board
    // heart (the tick enforces the config's heart cap). The square must be
    // free of ALIVE players (graves are ok) and not already a heart.
    const at = event.payload as unknown as Vec;
    if (typeof at.x !== 'number' || typeof at.y !== 'number'
      || at.x < 0 || at.y < 0 || at.x >= s.config.board || at.y >= s.config.board) {
      throw new EngineError('heart_spawn outside board');
    }
    if (occupantAt(s.players, at)) throw new EngineError('heart_spawn on an occupied square');
    const hearts = s.hearts ?? (s.heart ? [s.heart] : []);
    if (hearts.some((h) => h.x === at.x && h.y === at.y)) throw new EngineError('heart_spawn on a heart square');
    s = { ...s, hearts: [...hearts, { x: at.x, y: at.y, seq: event.seq }], heart: null };
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
    // Idempotent: if the player is already in the state (e.g. from createInitialState
    // during history scrubbing), treat as no-op so the scrubbing loop does not break.
    if (s.players[playerId]) {
      const entry = { seq: event.seq, text: `${name} joined the war` };
      return { ...s, seq: event.seq, log: [...s.log, entry] };
    }
    let spawn: Vec | null = null;
    const joinHearts = s.hearts ?? (s.heart ? [s.heart] : []);
    outer: for (let y = 0; y < s.config.board; y++) {
      for (let x = 0; x < s.config.board; x++) {
        // hearts count as taken: spawning onto one would leave it unclaimed
        // under an alive player (claims only trigger on move)
        if (!occupantAt(s.players, { x, y })
          && !joinHearts.some((h) => h.x === x && h.y === y)) {
          spawn = { x, y }; break outer;
        }
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
  } else if (event.type === 'attack' && event.payload.anon === true) {
    // Masked attack (server-scrubbed replays only — the action endpoint strips
    // `anon` from client payloads): the target takes 1 damage exactly like a
    // real attack, but the attacker's identity is withheld, so the actor id is
    // never asserted and no AP is charged to anyone. Replayed states therefore
    // show the real attacker's ap inflated by their hidden attacks — ap is
    // never displayed for other players, and a higher ap can only loosen
    // later replay validation, never fail it. Victim-side state (hp, steal
    // zeroing, jury, winner) stays exact.
    const targetId = event.payload.targetId as string;
    const target = assertAlive(s, targetId);
    const hp = target.hp - 1;
    let jury = s.jury, winner = s.winner;
    const killed = hp <= 0;
    const steal = killed && s.config.apStealOnKill ? target.ap : 0;
    const players = { ...s.players,
      [target.id]: { ...target, hp, ap: steal > 0 ? 0 : target.ap } };
    if (killed) {
      jury = [...s.jury, target.id];
      const alive = Object.values(players).filter(p => p.hp > 0);
      if (alive.length === 1) winner = alive[0].id;
    }
    s = { ...s, players, jury, winner };
  } else {
    s = applyAction(s, event.actorId, event.type, event.payload);
  }

  const line = logLine(s, state, event.actorId, event.type, event.payload);
  const entry: { seq: number; text: string; kind?: LogKind } = { seq: event.seq, text: line.text };
  if (line.kind) entry.kind = line.kind;
  return { ...s, seq: event.seq, log: [...s.log, entry] };
}

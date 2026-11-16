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

// Lifetime AP accounting for the "Action Points" info popup: call on the
// player object whose `ap` ALREADY includes the gain. Baseline for snapshots
// predating the field is the pre-gain ap (everything so far counts as
// granted); fresh games seed apEarned = startingAp, so the count is exact.
function gainAp(p: PlayerState, gain: number): PlayerState {
  return { ...p, apEarned: (p.apEarned ?? p.ap - gain) + gain };
}

function logLine(
  s: GameState, pre: GameState, actorId: string, type: string, payload: Record<string, unknown>,
): { text: string; kind?: LogKind } | null {
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
      // final kills read differently: "dealt the final blow", not a damage line
      if (killed) {
        return payload.anon === true
          ? { text: `Someone dealt the final blow to ${name(targetId)}`, kind: 'kill' }
          : { text: `${name(actorId)} dealt the final blow to ${name(targetId)}`, kind: 'kill' };
      }
      if (payload.anon === true) {
        return { text: `Someone attacked ${name(targetId)} for 1 damage`, kind: undefined };
      }
      return { text: `${name(actorId)} attacked ${name(targetId)} for 1 damage`, kind: undefined };
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
      // logLine runs on the POST-action state: `range` is already the new
      // value (one upgrade: 2 -> 3), so no +1 here — that logged 4 for a
      // single upgrade (off by one).
      return { text: `${name(actorId)} upgraded range to ${s.players[actorId].range}` };
    case 'daily_tick':
      // public day line only — jury business (who was haunted / awarded) is
      // recorded separately as a dead-viewer-only `jury_result` event, so a
      // living player's log never carries jury information.
      return { text: `Day ${s.day}: all alive players gain ${payload.apGained ?? 1} AP` };
    case 'jury_vote':
      // votes are never logged: the jury's ballot is nobody's business but
      // the dead's — only the OUTCOME (jury_result) becomes log-visible.
      return null;
    case 'jury_result': {
      // system-only event (minted by the tick right after the daily_tick that
      // consumed pending votes). Dead viewers only — the masked wire form
      // (`{ redacted: true }`) produces no log line at all.
      if (payload.redacted === true) return null;
      const parts: string[] = [];
      const haunted = (payload.haunted as string[] | undefined) ?? [];
      const awarded = (payload.awarded as string[] | undefined) ?? [];
      if (haunted.length) parts.push(`The jury haunted ${haunted.map(name).join(', ')}`);
      if (awarded.length) parts.push(`The jury awarded ${awarded.map(name).join(', ')} bonus AP`);
      if (parts.length === 0) parts.push('The jury failed to reach a decision');
      return { text: parts.join('. '), kind: 'jury' };
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

// Return the single most-voted candidate with a CLEAR majority (no tie for
// most votes) and 3+ votes — at most one bonus AP is awarded per day.
// Returns null when there is a tie, or when no candidate reaches 3 votes.
function findBonusWinner(votes: { voterId: string; candidateId: string }[]): { id: string; n: number } | null {
  const tally: Record<string, number> = {};
  for (const v of votes) tally[v.candidateId] = (tally[v.candidateId] ?? 0) + 1;
  let bestId: string | null = null, bestN = 0, tie = false;
  for (const [id, n] of Object.entries(tally)) {
    if (n > bestN) { bestN = n; bestId = id; tie = false; }
    else if (n === bestN) tie = true;
  }
  if (bestId && !tie && bestN >= 3) return { id: bestId, n: bestN };
  return null;
}

function applyAction(s: GameState, actorId: string, type: string, payload: Record<string, unknown>, trusted = false): GameState {
  const actor = assertAlive(s, actorId);
  const cost = requiredAp(type, s.config);
  // `trusted` (server-scrubbed replays only): the server validated every
  // event against the canonical state before sending it, and a scrubbed
  // timeline carries stale private fields — redacted upgrades leave a stale
  // range, redacted gifts leave short AP — so re-validating them here would
  // reject events the canonical timeline accepted. AP and range checks are
  // skipped; public-field checks (adjacency, occupancy, hp, aliveness)
  // still run, since hp and positions are never scrubbed.
  if (!trusted && actor.ap < cost) throw new EngineError('not enough AP');
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
          ? gainAp({ ...players[actorId], ap: players[actorId].ap + 2 }, 2)
          : { ...players[actorId], hp: players[actorId].hp + 1 };
      }
      const remaining = hearts.filter((h) => !(h.x === to.x && h.y === to.y));
      return { ...s, players, hearts: remaining, heart: null };
    }
    case 'attack': {
      const targetId = payload.targetId as string;
      if (targetId === actorId) throw new EngineError('cannot attack self');
      const target = assertAlive(s, targetId);
      if (!trusted && !inRange(actor.pos, target.pos, actor.range)) throw new EngineError('target out of range');
      const hp = target.hp - 1;
      let jury = s.jury, winner = s.winner;
      // AP steal on kill: the killer loots the victim's stash on the final
      // blow. Only then is the victim's AP zeroed (looted, not destroyed).
      const killed = hp <= 0;
      const steal = killed && s.config.apStealOnKill ? target.ap : 0;
      const players = { ...s.players,
        [actorId]: gainAp({ ...actor, ap: actor.ap - 1 + steal }, steal),
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
      if (!trusted && !inRange(actor.pos, target.pos, actor.range)) throw new EngineError('target out of range');
      return { ...s, players: { ...s.players,
        [actorId]: { ...actor, ap: actor.ap - 1 },
        [target.id]: gainAp({ ...target, ap: target.ap + 1 }, 1) } };
    }
    case 'give_heart': {
      // costs 1 of the GIVER's hp (never the last one), not AP
      const targetId = payload.targetId as string;
      if (targetId === actorId) throw new EngineError('cannot gift yourself');
      const target = s.players[targetId];
      if (!target) throw new EngineError('unknown player');
      if (!trusted && !inRange(actor.pos, target.pos, actor.range)) throw new EngineError('target out of range');
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
          ? gainAp({ ...revived, ap: revived.ap + 2 }, 2)
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

export function applyEvent(state: GameState, event: GameEvent, trusted = false): GameState {
  if (event.seq !== state.seq + 1) throw new EngineError(`seq gap: expected ${state.seq + 1}, got ${event.seq}`);
  let s = state;

  // Universal scrubbed no-op (server-scrubbed replays only): maskEvents
  // rewrites events a viewer is not entitled to into an anonymous `{ type:
  // 'redacted' }` form that keeps the seq chain intact while carrying no
  // actor, no payload and no log line — not even WHICH kind of private event
  // it was. The action endpoint strips `redacted` from client payloads, so
  // this branch can never be triggered by a client-submitted event.
  if ((event.payload as { redacted?: boolean } | null)?.redacted === true) {
    return { ...s, seq: event.seq };
  }

  if (event.type === 'bot_action') {
    const actor = s.players[event.actorId];
    if (!actor || !actor.isBot) throw new EngineError('bot_action actor must be a bot');
    const inner = event.payload.inner as { type: string; payload: Record<string, unknown> } | undefined;
    if (!inner) throw new EngineError('bot_action requires inner action');
    s = applyAction(s, event.actorId, inner.type, inner.payload ?? {}, trusted);
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
      if (p.hp > 0 && p.id !== lastHaunted)
        players[p.id] = gainAp({ ...p, ap: p.ap + apGained }, apGained);
    }
    // jury bonus: the most-voted candidate (clear majority, no ties) with 3+
    // votes gets +1 AP — at most one bonus per day.
    const bonusWinner = findBonusWinner(s.pendingVotes);
    const nextDay = s.day + 1;
    if (bonusWinner && players[bonusWinner.id] && players[bonusWinner.id].hp > 0) {
      players[bonusWinner.id] = gainAp({ ...players[bonusWinner.id], ap: players[bonusWinner.id].ap + 1 }, 1);
    }
    const elapsed = (event.payload.elapsedMinutes as number) ?? 0;
    s = { ...s, day: nextDay, tickClockMinutes: s.tickClockMinutes + elapsed,
      players, pendingVotes: [], haunted: lastHaunted,
      // remembered for the "golden AP icon the day after chosen" UI
      lastBonus: bonusWinner
        ? [{ id: bonusWinner.id, day: nextDay }]
        : [] };
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
  } else if (event.type === 'jury_result') {
    // system-only event (the tick function mints it right after the
    // daily_tick that consumed this day's jury votes). No state change —
    // `haunted`/`lastBonus` were already set by the daily_tick itself; this
    // event exists so the OUTCOME has its own log entry (kind 'jury', dead
    // viewers only) and its own scrubber row.
  } else if (event.type === 'jury_vote') {
    const voter = s.players[event.actorId];
    if (!voter) throw new EngineError('unknown player');
    if (voter.hp > 0) throw new EngineError('alive players cannot vote');
    const candidateId = event.payload.candidateId as string;
    if (!s.players[candidateId]) throw new EngineError('unknown candidate');
    // a juror may CHANGE their vote for the day: re-voting replaces their
    // earlier ballot (still exactly one vote per juror per day)
    const others = s.pendingVotes.filter(v => v.voterId !== event.actorId);
    s = { ...s, pendingVotes: [...others, { voterId: event.actorId, candidateId }] };
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
      apEarned: s.config.startingAp,
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
    s = applyAction(s, event.actorId, event.type, event.payload, trusted);
  }

  const line = logLine(s, state, event.actorId, event.type, event.payload);
  // a null line (jury_vote, redacted jury_result) appends no log entry —
  // the event still advances seq/state exactly the same.
  if (!line) return { ...s, seq: event.seq };
  const entry: { seq: number; text: string; kind?: LogKind } = { seq: event.seq, text: line.text };
  if (line.kind) entry.kind = line.kind;
  return { ...s, seq: event.seq, log: [...s.log, entry] };
}

// The jury outcome event the tick mints immediately after a daily_tick that
// consumed this day's pending votes: WHO was haunted / awarded bonus AP, or
// that the jury failed to reach a decision. A pure function of the pre- and
// post-tick states, so the tick edge function and the dev-lab driver mint
// byte-identical events. Returns null when no votes were pending.
export function juryResultEvent(
  pre: GameState, post: GameState, seq: number, createdAt: string,
): GameEvent | null {
  if (pre.pendingVotes.length === 0) return null;
  const payload: Record<string, unknown> = {};
  if (post.haunted) payload.haunted = [post.haunted];
  const awarded = (post.lastBonus ?? []).map((b) => b.id);
  if (awarded.length) payload.awarded = awarded;
  if (!payload.haunted && !payload.awarded) payload.failed = true;
  return { seq, type: 'jury_result', actorId: 'system', createdAt, payload };
}

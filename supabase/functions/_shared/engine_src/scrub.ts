import type { GameEvent, GameState, LogEntry, PlayerId } from './types.ts';

// Server-side secrecy scrubbing. The wire must never carry information the
// viewer is not entitled to: the RNG seed (it predicts every future heart
// spawn and random-schedule AP grant), other players' AP (private per the
// rules — the UI shows hp/range only), and the identity of attackers except
// their victim's most recent damage ("you have to guess who shot them unless
// it is the last hit"). Everything here is pure and shared by the edge
// functions; the client receives only scrubbed data, so a devtools poke
// yields exactly what the UI shows.
//
// actor id used on masked attack events. Not a real player id — the engine's
// masked-attack branch never asserts it (no AP is charged to anyone), and the
// board's fx lookups miss it, so no beam can draw the attacker.
export const HIDDEN_ACTOR = 'hidden';

export interface AttackMask {
  /** attack event seqs whose actor must be hidden (all but each victim's last) */
  masked: Set<number>;
  /** attack event seq -> victim id, for rewriting log text */
  victimBySeq: Map<number, PlayerId>;
  /** upgrade_range seqs — range progression is private to the upgrader */
  upgrades: Set<number>;
}

// Which human attacks must be masked for a canonical timeline: every
// top-level `attack` event (bots attack via `bot_action` wrappers and stay
// public) EXCEPT the victim's most recent one. Kills are always the last
// hit, so kill-kind log lines render identically before and after masking.
// Upgrade seqs are collected alongside: the state scrub zeroes everyone
// else's range, but an unmasked upgrade event (actor + "upgraded range to N"
// log line) would hand out the whole progression anyway.
export function attackMask(canonical: GameEvent[]): AttackMask {
  const seqsByVictim = new Map<PlayerId, number[]>();
  const victimBySeq = new Map<number, PlayerId>();
  const upgrades = new Set<number>();
  for (const e of canonical) {
    if (e.type === 'upgrade_range') { upgrades.add(e.seq); continue; }
    if (e.type !== 'attack') continue;
    const targetId = (e.payload as { targetId?: string }).targetId;
    if (!targetId) continue;
    const list = seqsByVictim.get(targetId) ?? [];
    list.push(e.seq);
    seqsByVictim.set(targetId, list);
    victimBySeq.set(e.seq, targetId);
  }
  const masked = new Set<number>();
  for (const seqs of seqsByVictim.values()) {
    for (let i = 0; i < seqs.length - 1; i++) masked.add(seqs[i]);
  }
  return { masked, victimBySeq, upgrades };
}

// Transform events for one viewer: hidden attacks lose their actor entirely
// (the engine replays them via the `anon` branch — identity never on the
// wire). The attacker always sees their own attacks unmasked. For LIVING
// viewers the jury's business and everyone's range progression are no-ops
// too: ballots and outcomes scrub to an empty form (actor included — who
// voted is as secret as how), and upgrades scrub so range stays private.
// Dead viewers (jury members) keep the real ballots and outcomes: they cast
// the votes, so they must see how they landed. `juryEntitled` is the
// viewer's dead status — pass `(state.players[me]?.hp ?? 1) <= 0`.
export function maskEvents(events: GameEvent[], me: PlayerId, mask: AttackMask, juryEntitled = false): GameEvent[] {
  return events.map((e) => {
    // ballots AND outcomes are the jury's business: living viewers get
    // no-op forms with the actor hidden — even the fact that a given
    // player voted stays off the wire
    if ((e.type === 'jury_result' || e.type === 'jury_vote') && !juryEntitled) {
      return { ...e, actorId: HIDDEN_ACTOR, payload: { redacted: true } };
    }
    // range progression is private: a living viewer's scrubber must not be
    // able to rebuild who upgraded when (own upgrades stay real)
    if (e.type === 'upgrade_range' && mask.upgrades.has(e.seq) && e.actorId !== me) {
      return { ...e, actorId: HIDDEN_ACTOR, payload: { redacted: true } };
    }
    if (e.type !== 'attack' || !mask.masked.has(e.seq) || e.actorId === me) return e;
    const targetId = (e.payload as { targetId?: string }).targetId ?? mask.victimBySeq.get(e.seq);
    return { ...e, actorId: HIDDEN_ACTOR, payload: { targetId, anon: true } };
  });
}

// Rewrite log lines the same way, keeping kind (masked attacks are never
// kills, but a defensive kind pass-through costs nothing). Own attack and
// own upgrade lines stay attributed to the viewer. jury outcome lines
// (kind 'jury') stay for dead viewers (jury members) and are stripped for
// living ones.
export function maskLog(
  log: LogEntry[],
  actorBySeq: Map<number, PlayerId>,
  me: PlayerId,
  mask: AttackMask,
  targetName: (id: PlayerId) => string,
  juryEntitled = false,
): LogEntry[] {
  return log.flatMap((entry) => {
    // jury business is dead-viewer-only: outcome entries (kind 'jury') and
    // legacy per-vote lines never reach a LIVING player's log
    if (!juryEntitled && (entry.kind === 'jury' || /^Jury member /.test(entry.text))) return [];
    // upgrades mask to an actor-less, value-less line (range is private)
    if (mask.upgrades.has(entry.seq) && actorBySeq.get(entry.seq) !== me) {
      return [{ ...entry, text: 'Someone upgraded their range' }];
    }
    // legacy daily_tick lines embedded the jury outcome in the day line
    const text = entry.text
      .replace(/ \(\+1 jury AP to [^)]*\)/, '')
      .replace(/, .+ is haunted \(no AP\)$/, '');
    if (!mask.masked.has(entry.seq)) return [{ ...entry, text }];
    if (actorBySeq.get(entry.seq) === me) return [{ ...entry, text }];
    const targetId = mask.victimBySeq.get(entry.seq) ?? '';
    // final blows mask to the same "dealt the final blow" wording (the kind
    // marker stays; only the actor name is hidden)
    if (entry.kind === 'kill') {
      return [{ ...entry, text: `Someone dealt the final blow to ${targetName(targetId)}` }];
    }
    return [{ ...entry, text: `Someone attacked ${targetName(targetId)} for 1 damage` }];
  });
}

// The actor's map of actor ids per event seq (used by maskLog callers to
// decide "is this MY attack / MY upgrade"). Collected for EVERY event so
// upgrade lines can be self-attributed too; attacks are the ones whose
// actor is ever rewritten.
export function attackActors(canonical: GameEvent[]): Map<number, PlayerId> {
  const out = new Map<number, PlayerId>();
  for (const e of canonical) out.set(e.seq, e.actorId);
  return out;
}

// Jury outcome entitlement: the dead ARE the jury. A dead viewer casts the
// votes, so they see how they landed (haunt / bonus / fizzle). Living
// players never do — for them the outcome is redacted end to end.
export function juryEntitled(state: GameState, viewerId: PlayerId): boolean {
  return (state.players[viewerId]?.hp ?? 1) <= 0;
}

// Full-log reveal for eliminated viewers: a dead player in a revives-off
// game cannot come back, so attacker anonymity protects nothing anymore —
// they get the complete, unmasked event log (and event stream). With
// revives ON the mask stays: the dead may return to fight with that intel.
export function viewerLogReveal(state: GameState, viewerId: PlayerId): boolean {
  return (state.players[viewerId]?.hp ?? 1) <= 0 && !state.config.revives;
}

// Remove the seed and everyone else's AP from a state going on the wire.
// The client never reads either (its scrubber replays from the server-sent
// `initial` state, and TankCard deliberately shows hp/range only), so zeroing
// them is display-invisible — and makes the JSON honest instead of merely
// unobserved.
//
// Jury business is dead-viewer-only here too: a LIVING viewer's state carries
// no ballots (pendingVotes) and no outcome aimed at anyone else. The viewer's
// OWN tint entitlement survives — a haunted player may know they are haunted
// (the purple AP counter explains a missing drip), and a bonused player keeps
// their golden row — but never who voted, never the other targets.
export function scrubState(state: GameState, me: PlayerId): GameState {
  const players: GameState['players'] = {};
  for (const [id, p] of Object.entries(state.players)) {
    // -1 sentinel (not 0): a scrubbed field must never be mistaken for a real
    // zero. Others' ap and range are private — the UI renders neither for
    // non-self players (jury cards show hp only; Board uses own range only).
    players[id] = id === me ? p : { ...p, ap: -1, range: -1, apEarned: -1 };
  }
  const jury = juryEntitled(state, me);
  return {
    ...state,
    config: { ...state.config, seed: 0 },
    players,
    pendingVotes: jury ? state.pendingVotes : [],
    haunted: jury || state.haunted === me ? state.haunted : null,
    lastBonus: jury
      ? (state.lastBonus ?? [])
      : (state.lastBonus ?? []).filter((b) => b.id === me),
  };
}

// Same for a bare config payload (game.config echoes).
export function scrubConfig<T extends { seed?: number }>(config: T): T {
  return { ...config, seed: 0 };
}

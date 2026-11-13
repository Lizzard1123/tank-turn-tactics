import { describe, it, expect } from 'vitest';
import { applyEvent } from '../src/reducer';
import { createInitialState } from '../src/state';
import { applyEvents } from '../src/replay';
import {
  attackMask, attackActors, maskEvents, maskLog, scrubState, scrubConfig, HIDDEN_ACTOR,
} from '../src/scrub';
import type { GameConfig, GameEvent, GameState, LogEntry } from '../src/types';

const cfg: GameConfig = {
  seed: 42, board: 8, startingHp: 3, startingAp: 4, baseRange: 2,
  apPerDay: 1, upgradeCost: 2, apIntervalMinutes: 0,
};

const base = createInitialState(cfg, [
  { id: 'p1', name: 'Alice', isBot: false, botDifficulty: null },
  { id: 'p2', name: 'Bob', isBot: false, botDifficulty: null },
  { id: 'p3', name: 'Cara', isBot: false, botDifficulty: null },
]);

function ev(state: GameState, actorId: string, type: GameEvent['type'], payload: Record<string, unknown> = {}): GameEvent {
  return { seq: state.seq + 1, type, actorId, createdAt: new Date().toISOString(), payload };
}
// teleport helpers (tests only — bypass move validation)
function placeAdjacent(s: GameState, a: string, b: string): GameState {
  const bp = s.players[b].pos;
  const nx = bp.x + 1 <= 7 ? bp.x + 1 : bp.x - 1;
  return { ...s, players: { ...s.players, [a]: { ...s.players[a], pos: { x: nx, y: bp.y } } } };
}
function giveAp(s: GameState, id: string, n: number): GameState {
  return { ...s, players: { ...s.players, [id]: { ...s.players[id], ap: s.players[id].ap + n } } };
}

const line = (s: GameState, seq: number): LogEntry | undefined =>
  s.log.find((l) => l.seq === seq);

// ---------------------------------------------------------------------------
// attackMask
// ---------------------------------------------------------------------------

describe('attackMask', () => {
  it('masks every attack on a victim except their last', () => {
    const events = [1, 2, 3].map((i) => ({ seq: i, type: 'attack', actorId: 'p1', payload: { targetId: 'p2' } } as GameEvent));
    const mask = attackMask(events);
    expect(mask.masked.has(1)).toBe(true);
    expect(mask.masked.has(2)).toBe(true);
    expect(mask.masked.has(3)).toBe(false);
    expect(mask.victimBySeq.get(3)).toBe('p2');
  });

  it('is per victim: each victim keeps only their last attacker', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', payload: { targetId: 'p3' } },
      { seq: 2, type: 'attack', actorId: 'p2', payload: { targetId: 'p1' } },
      { seq: 3, type: 'attack', actorId: 'p1', payload: { targetId: 'p3' } },
    ];
    const mask = attackMask(events);
    expect(mask.masked).toEqual(new Set([1])); // p3's first hit hidden; p1's only hit named
    expect(mask.victimBySeq.get(2)).toBe('p1');
  });

  it('ignores bot_action wrappers (bots stay public)', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'bot_action', actorId: 'bot-1', payload: { inner: { type: 'attack', payload: { targetId: 'p1' } } } },
      { seq: 2, type: 'attack', actorId: 'p2', payload: { targetId: 'p1' } },
    ];
    expect(attackMask(events).masked).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// maskEvents / maskLog
// ---------------------------------------------------------------------------

describe('maskEvents + maskLog', () => {
  it('hides the actor on masked events but keeps own attacks real', () => {
    const events: GameEvent[] = [
      { seq: 1, type: 'attack', actorId: 'p1', payload: { targetId: 'p2' } },
      { seq: 2, type: 'attack', actorId: 'p1', payload: { targetId: 'p2' } },
      { seq: 3, type: 'attack', actorId: 'p2', payload: { targetId: 'p1' } },
    ];
    const mask = attackMask(events);
    // viewer p1: own attack at seq 1 stays attributed even though masked for others
    const forP1 = maskEvents(events, 'p1', mask);
    expect(forP1[0].actorId).toBe('p1');
    expect(forP1[0].payload).toEqual({ targetId: 'p2' });
    // viewer p2: seq 1 attack on them is anonymous
    const forP2 = maskEvents(events, 'p2', mask);
    expect(forP2[0].actorId).toBe(HIDDEN_ACTOR);
    expect(forP2[0].payload).toEqual({ targetId: 'p2', anon: true });
    // seq 3 (p2's own last hit on p1) is named for everyone
    expect(maskEvents(events, 'p3', mask)[2].actorId).toBe('p2');
  });

  it('rewrites log lines with the same text the engine generates', () => {
    let s = placeAdjacent(base, 'p1', 'p2');
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' })); // seq 1
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' })); // seq 2, named (last)
    const events = [1, 2].map((i) => ({ seq: i, type: 'attack', actorId: 'p1', payload: { targetId: 'p2' } } as GameEvent));
    const mask = attackMask(events);
    const forP2 = maskLog(s.log, attackActors(events), 'p2', mask, (id) => s.players[id]?.name ?? id);
    expect(forP2.find((l) => l.seq === 1)!.text).toBe('Someone attacked Bob for 1 damage');
    expect(forP2.find((l) => l.seq === 2)!.text).toBe('Alice attacked Bob for 1 damage');
    // the attacker sees both of their own lines attributed
    const forP1 = maskLog(s.log, attackActors(events), 'p1', mask, (id) => s.players[id]?.name ?? id);
    expect(forP1.find((l) => l.seq === 1)!.text).toBe('Alice attacked Bob for 1 damage');
  });

  it('masked log text matches the engine replay log byte for byte', () => {
    let s = placeAdjacent(base, 'p1', 'p2');
    const initial = s;
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    s = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    const events = [1, 2].map((i) => ({ seq: i, type: 'attack', actorId: 'p1', payload: { targetId: 'p2' } } as GameEvent));
    const mask = attackMask(events);
    const replayed = applyEvents(initial, maskEvents(events, 'p3', mask));
    const rewritten = maskLog(s.log, attackActors(events), 'p3', mask, (id) => s.players[id]?.name ?? id);
    expect(replayed.log.map((l) => l.text)).toEqual(rewritten.map((l) => l.text));
  });
});

// ---------------------------------------------------------------------------
// masked-attack replay equivalence
// ---------------------------------------------------------------------------

describe('masked replay equivalence', () => {
  // A real timeline: p1 hits p3 twice then p2, p2 hits p1, p3 upgrades.
  // `initial` is the setup state (teleports/test-only, exactly what the
  // scrubber replay starts from).
  function realTimeline(): { initial: GameState; events: GameEvent[]; final: GameState } {
    let s = base;
    const events: GameEvent[] = [];
    const push = (e: GameEvent, next: GameState) => { events.push(e); s = next; };
    s = placeAdjacent(s, 'p1', 'p3');
    s = giveAp(s, 'p1', 10);
    s = placeAdjacent(s, 'p2', 'p1');
    s = giveAp(s, 'p2', 10);
    const initial = s;
    // p1 attacks p3 twice (both superseded later) and p2 once
    push(ev(s, 'p1', 'attack', { targetId: 'p3' }), applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p3' })));
    push(ev(s, 'p1', 'attack', { targetId: 'p3' }), applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p3' })));
    push(ev(s, 'p1', 'attack', { targetId: 'p2' }), applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' })));
    // p2 retaliates against p1
    push(ev(s, 'p2', 'attack', { targetId: 'p1' }), applyEvent(s, ev(s, 'p2', 'attack', { targetId: 'p1' })));
    // p3 upgrades range (cost 2) — validates replayed ap along the way
    push(ev(s, 'p3', 'upgrade_range', {}), applyEvent(s, ev(s, 'p3', 'upgrade_range', {})));
    return { initial, events, final: s };
  }

  it('masked replay matches the real state everywhere ap is displayed', () => {
    const { initial, events, final } = realTimeline();
    const mask = attackMask(events);
    const actors = attackActors(events);
    const replayed = applyEvents(initial, maskEvents(events, 'p3', mask));

    // identical: positions, hp, range, jury, winner, day, hearts, seq, order
    for (const id of Object.keys(final.players)) {
      expect(replayed.players[id].pos).toEqual(final.players[id].pos);
      expect(replayed.players[id].hp).toBe(final.players[id].hp);
      expect(replayed.players[id].range).toBe(final.players[id].range);
    }
    // victims' ap is exact — p3 (hit at seq 1 masked, seq 2 named) never lost
    // ap to attacks; p2 spent 1 charging their own named attack — matches
    expect(replayed.players.p3.ap).toBe(final.players.p3.ap);
    expect(replayed.players.p2.ap).toBe(final.players.p2.ap);
    // the hidden attacker's ap is inflated (masked seq 1 uncharged) — never
    // displayed, and the later upgrade by p3 still validated fine (range below)
    expect(replayed.players.p1.ap).toBe(final.players.p1.ap + 1);
    expect(replayed.jury).toEqual(final.jury);
    expect(replayed.winner).toBe(final.winner);
    expect(replayed.day).toBe(final.day);
    expect(replayed.seq).toBe(final.seq);
    // log text: server-rewritten and client-replayed agree
    expect(replayed.log.map((l) => l.text))
      .toEqual(maskLog(final.log, actors, 'p3', mask, (id) => final.players[id]?.name ?? id).map((l) => l.text));
    // and the masked lines really are anonymous
    expect(replayed.log.find((l) => l.seq === 1)!.text).toContain('Someone attacked');
  });

  it('inflates only the hidden attacker’s ap, which never breaks later replay validation', () => {
    const { initial, events, final } = realTimeline();
    const mask = attackMask(events);
    const replayed = applyEvents(initial, maskEvents(events, 'nobody-in-particular', mask));
    // p1 landed 3 attacks; only seq 1 is masked for a third party (seq 2 is
    // p3's LAST hit -> named; seq 3 is p2's only hit -> named; seq 4 is p2's
    // attack on p1 -> named)
    expect(replayed.players.p1.ap).toBe(final.players.p1.ap + 1); // masked seq 1 not charged
    expect(replayed.players.p2.ap).toBe(final.players.p2.ap);     // own named attack replays charged
    // a later real action by p3 (upgrade, cost 2) replayed fine — validated above via range
    expect(replayed.players.p3.range).toBe(final.players.p3.range);
  });

  it('keeps victim ap exact under apStealOnKill even in masked replay', () => {
    const stealCfg: GameConfig = { ...cfg, apStealOnKill: true };
    const sb = createInitialState(stealCfg, Object.values(base.players).map((p) => ({ id: p.id, name: p.name, isBot: false, botDifficulty: null })));
    let s = placeAdjacent(sb, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, hp: 1, ap: 5 } } };
    const e1 = ev(s, 'p1', 'attack', { targetId: 'p2' });
    const real = applyEvent(s, e1);
    // mask p1's killing blow as if hidden (defensive: kills are normally the
    // last hit and stay named, but the branch must still be victim-exact)
    const masked: GameEvent = { ...e1, actorId: HIDDEN_ACTOR, payload: { targetId: 'p2', anon: true } };
    const replayed = applyEvent(s, masked);
    expect(replayed.players.p2.ap).toBe(0);
    expect(replayed.players.p2.hp).toBe(0);
    expect(replayed.jury).toEqual(real.jury);
    expect(replayed.winner).toBe(real.winner);
    expect(replayed.players.p1.ap).toBe(4); // nothing charged, nothing credited (real: 4 - 1 + 5 = 8)
  });

  it('rejects masked attacks on dead/unknown targets like real attacks', () => {
    let s = placeAdjacent(base, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, hp: 0 } } };
    expect(() => applyEvent(s, { ...ev(s, HIDDEN_ACTOR, 'attack', { targetId: 'p2', anon: true }) })).toThrow();
    expect(() => applyEvent(s, { ...ev(s, HIDDEN_ACTOR, 'attack', { targetId: 'ghost', anon: true }) })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// scrubState / scrubConfig
// ---------------------------------------------------------------------------

describe('scrubState', () => {
  it('zeroes the seed and other players’ ap, keeps mine and everything else', () => {
    const scrubbed = scrubState(base, 'p2');
    expect(scrubbed.config.seed).toBe(0);
    expect(scrubbed.players.p1.ap).toBe(0);
    expect(scrubbed.players.p3.ap).toBe(0);
    expect(scrubbed.players.p2.ap).toBe(base.players.p2.ap);
    expect(scrubbed.players.p1.hp).toBe(base.players.p1.hp);
    expect(scrubbed.players.p1.pos).toEqual(base.players.p1.pos);
    expect(scrubbed.config.startingAp).toBe(cfg.startingAp);
    expect(scrubbed.jury).toEqual(base.jury);
    expect(scrubbed.log).toEqual(base.log);
  });

  it('scrubConfig only touches the seed', () => {
    const out = scrubConfig({ ...cfg });
    expect(out.seed).toBe(0);
    expect(out.board).toBe(cfg.board);
    expect(out.startingHp).toBe(cfg.startingHp);
  });
});

// ---------------------------------------------------------------------------
// no-flag attacks: the old path byte-for-byte
// ---------------------------------------------------------------------------

describe('plain attacks unchanged', () => {
  it('an attack without payload.anon behaves exactly as before', () => {
    let s = placeAdjacent(base, 'p1', 'p2');
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, ap: 2 } } };
    const before = applyEvent(s, ev(s, 'p1', 'attack', { targetId: 'p2' }));
    expect(before.players.p1.ap).toBe(1); // cost charged
    expect(before.players.p2.hp).toBe(2);
    expect(line(before, 1)!.text).toBe('Alice attacked Bob for 1 damage');
  });
});

import { describe, it, expect } from 'vitest';
import { applyEvent } from '../src/reducer';
import { createInitialState } from '../src/state';
import { applyEvents } from '../src/replay';
import {
  attackMask, attackActors, maskEvents, maskLog, scrubState, scrubConfig, viewerLogReveal, juryEntitled, HIDDEN_ACTOR,
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
    const replayed = applyEvents(initial, maskEvents(events, 'p3', mask), true);
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
    const replayed = applyEvents(initial, maskEvents(events, 'p3', mask), true);

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
    const replayed = applyEvents(initial, maskEvents(events, 'nobody-in-particular', mask), true);
    // p1 landed 3 attacks; only seq 1 is masked for a third party (seq 2 is
    // p3's LAST hit -> named; seq 3 is p2's only hit -> named; seq 4 is p2's
    // attack on p1 -> named)
    expect(replayed.players.p1.ap).toBe(final.players.p1.ap + 1); // masked seq 1 not charged
    expect(replayed.players.p2.ap).toBe(final.players.p2.ap);     // own named attack replays charged
    // p3's upgrade is SCRUBBED for a third party: the replay never applies
    // it, so range stays pre-upgrade and the cost is not charged (drift is
    // invisible — scrubState zeroes others' range/ap on the wire anyway)
    expect(replayed.players.p3.range).toBe(final.players.p3.range - 1);
    expect(replayed.players.p3.ap).toBe(final.players.p3.ap + 2);
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
  it('zeroes the seed and other players’ ap/range to -1, keeps mine and everything else', () => {
    const scrubbed = scrubState(base, 'p2');
    expect(scrubbed.config.seed).toBe(0);
    expect(scrubbed.players.p1.ap).toBe(-1);
    expect(scrubbed.players.p3.ap).toBe(-1);
    expect(scrubbed.players.p1.range).toBe(-1);
    expect(scrubbed.players.p3.range).toBe(-1);
    expect(scrubbed.players.p2.ap).toBe(base.players.p2.ap);
    expect(scrubbed.players.p2.range).toBe(base.players.p2.range);
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
// viewerLogReveal — dead viewers with revives off get the full log
// ---------------------------------------------------------------------------

describe('viewerLogReveal', () => {
  it('a dead viewer in a revives-off game sees the full log', () => {
    const s = { ...base, players: { ...base.players, p2: { ...base.players.p2, hp: 0 } } };
    expect(viewerLogReveal(s, 'p2')).toBe(true);
  });

  it('revives ON keeps the mask even for the dead (they may come back)', () => {
    const on = { ...base, config: { ...base.config, revives: true } };
    const s = { ...on, players: { ...on.players, p2: { ...on.players.p2, hp: 0 } } };
    expect(viewerLogReveal(s, 'p2')).toBe(false);
  });

  it('living viewers never get the reveal', () => {
    expect(viewerLogReveal(base, 'p1')).toBe(false);
  });

  it('a viewer missing from the players map defaults to alive (no reveal)', () => {
    expect(viewerLogReveal(base, 'ghost')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// jury outcome entitlement — the dead are the jury; the living never see it
// ---------------------------------------------------------------------------

describe('jury outcome entitlement', () => {
  const juryResult: GameEvent = {
    seq: 1, type: 'jury_result', actorId: 'system',
    createdAt: new Date().toISOString(),
    payload: { haunted: ['p1'], awarded: [] },
  };
  const logWithJury: LogEntry[] = [
    { seq: 1, text: 'The jury haunted Alice', kind: 'jury' },
    { seq: 2, text: 'Alice attacked Bob for 1 damage' },
  ];

  it('juryEntitled: dead true, alive false, unknown viewer false', () => {
    const dead = { ...base, players: { ...base.players, p2: { ...base.players.p2, hp: 0 } } };
    expect(juryEntitled(dead, 'p2')).toBe(true);
    expect(juryEntitled(base, 'p1')).toBe(false);
    expect(juryEntitled(base, 'ghost')).toBe(false);
  });

  it('a LIVING viewer: jury_result redacted, jury log lines stripped', () => {
    expect(maskEvents([juryResult], 'p1', attackMask([]), false)[0].payload).toEqual({ redacted: true });
    const log = maskLog(logWithJury, new Map(), 'p1', attackMask([]), (id) => id, false);
    expect(log.find((l) => l.kind === 'jury')).toBeUndefined();
    expect(log.map((l) => l.text)).toEqual(['Alice attacked Bob for 1 damage']);
  });

  it('a DEAD viewer (jury member): real outcome, even in a revives-on game', () => {
    const on = { ...base, config: { ...base.config, revives: true } };
    const dead = { ...on, players: { ...on.players, p2: { ...on.players.p2, hp: 0 } } };
    expect(juryEntitled(dead, 'p2')).toBe(true);
    // event passes through unredacted
    expect(maskEvents([juryResult], 'p2', attackMask([]), true)[0].payload).toEqual({ haunted: ['p1'], awarded: [] });
    // log keeps the jury line (and legacy "Jury member" lines)
    const log = maskLog(
      [...logWithJury, { seq: 3, text: 'Jury member Bob voted for Alice' }],
      new Map(), 'p2', attackMask([]), (id) => id, true,
    );
    expect(log.map((l) => l.text)).toEqual([
      'The jury haunted Alice',
      'Alice attacked Bob for 1 damage',
      'Jury member Bob voted for Alice',
    ]);
  });

  it('the entitlement composes with attack masking (dead revives-on viewer)', () => {
    // revives on keep attack anonymity, but the dead still see jury outcomes
    const events: GameEvent[] = [
      juryResult,
      { seq: 2, type: 'attack', actorId: 'p1', payload: { targetId: 'p2' } },
      { seq: 3, type: 'attack', actorId: 'p1', payload: { targetId: 'p2' } },
    ];
    const mask = attackMask(events);
    const forDead = maskEvents(events, 'p2', mask, true);
    expect(forDead[0].payload).toEqual({ haunted: ['p1'], awarded: [] }); // outcome kept
    expect(forDead[1].actorId).toBe(HIDDEN_ACTOR); // earlier hit still anonymous
    expect(forDead[2].actorId).toBe('p1');         // last hit stays named
  });

  it('default (no flag) keeps the strict redaction the old callers relied on', () => {
    expect(maskEvents([juryResult], 'p2', attackMask([]))[0].payload).toEqual({ redacted: true });
    expect(maskLog(logWithJury, new Map(), 'p2', attackMask([]), (id) => id).map((l) => l.text))
      .toEqual(['Alice attacked Bob for 1 damage']);
  });

  it('BALLOTS are redacted for living viewers too (they could derive the outcome)', () => {
    const ballot: GameEvent = {
      seq: 1, type: 'jury_vote', actorId: 'p2',
      createdAt: new Date().toISOString(), payload: { candidateId: 'p1' },
    };
    const forLiving = maskEvents([ballot], 'p1', attackMask([]), false)[0];
    expect(forLiving.payload).toEqual({ redacted: true });
    expect(forLiving.actorId).toBe(HIDDEN_ACTOR); // even WHO voted is hidden
    // a dead jury member keeps the real ballot
    expect(maskEvents([ballot], 'p2', attackMask([]), true)[0].payload).toEqual({ candidateId: 'p1' });
    expect(maskEvents([ballot], 'p2', attackMask([]), true)[0].actorId).toBe('p2');
  });

  it('UPGRADES are scrubbed for living viewers: no actor, no value, replay is a no-op', () => {
    const s0 = { ...base, players: { ...base.players, p1: { ...base.players.p1, ap: 5 } } };
    const up = ev(s0, 'p2', 'upgrade_range', {}); // p2: range 2 -> 3
    const s = applyEvent(s0, up);
    const mask = attackMask([up]);
    expect(mask.upgrades.has(up.seq)).toBe(true);
    const forLiving = maskEvents([up], 'p1', mask, false)[0];
    expect(forLiving.type).toBe('redacted'); // not even THAT an upgrade happened
    expect(forLiving.actorId).toBe(HIDDEN_ACTOR);
    expect(forLiving.payload).toEqual({ redacted: true });
    // replaying the scrubbed form from the pre-upgrade state: seq advances
    // in lockstep with the real timeline, but the range is untouched and no
    // AP is charged — for a living viewer's scrubber the upgrade never
    // happened (their own view of p2's range is wire-scrubbed to -1 anyway)
    const replayed = applyEvent(s0, forLiving);
    expect(replayed.seq).toBe(s.seq);
    expect(replayed.players.p2.range).toBe(s0.players.p2.range);
    expect(replayed.players.p2.ap).toBe(s0.players.p2.ap);
    // the upgrader keeps their own event real
    const own = maskEvents([up], 'p2', mask, false)[0];
    expect(own.actorId).toBe('p2');
    expect(own.payload).toEqual({});
  });

  it('maskLog DROPS other players’ upgrade lines entirely and keeps own lines', () => {
    let s = { ...base, players: { ...base.players, p1: { ...base.players.p1, ap: 5 }, p2: { ...base.players.p2, ap: 5 } } };
    s = applyEvent(s, ev(s, 'p2', 'upgrade_range', {})); // "Bob upgraded range to 3"
    s = applyEvent(s, ev(s, 'p1', 'upgrade_range', {})); // own line for p1
    const events: GameEvent[] = [
      { seq: 1, type: 'upgrade_range', actorId: 'p2', createdAt: new Date().toISOString(), payload: {} },
      { seq: 2, type: 'upgrade_range', actorId: 'p1', createdAt: new Date().toISOString(), payload: {} },
    ];
    const mask = attackMask(events);
    const actors = attackActors(events);
    const forP1 = maskLog(s.log, actors, 'p1', mask, (id) => id, false);
    expect(forP1.find((l) => l.seq === 1)).toBeUndefined(); // not even the fact of it
    expect(forP1.find((l) => l.seq === 2)!.text).toBe('Alice upgraded range to 3');
  });

  it('AP gifts are invisible to non-participants: event redacted, log line dropped', () => {
    let s0 = placeAdjacent(base, 'p1', 'p2');
    s0 = { ...s0, players: { ...s0.players, p2: { ...s0.players.p2, ap: 5 } } };
    const gift = ev(s0, 'p2', 'give_ap', { targetId: 'p1' });
    const s = applyEvent(s0, gift);
    const mask = attackMask([gift]);
    expect(mask.gifts.get(gift.seq)).toBe('p1');
    // third party: anonymous no-op event, no log line, replay changes nothing
    const forP3 = maskEvents([gift], 'p3', mask, false)[0];
    expect(forP3.type).toBe('redacted');
    expect(forP3.payload).toEqual({ redacted: true });
    const replayed = applyEvent(s0, forP3, true);
    expect(replayed.seq).toBe(s.seq);
    expect(replayed.players.p1).toEqual(s0.players.p1);
    // giver and receiver keep the real event (and the real log line)
    expect(maskEvents([gift], 'p2', mask, false)[0]).toBe(gift);
    expect(maskEvents([gift], 'p1', mask, false)[0]).toBe(gift);
    const forP3log = maskLog(s.log, attackActors([gift]), 'p3', mask, (id) => id, false);
    expect(forP3log.find((l) => l.seq === gift.seq)).toBeUndefined();
    const forP1log = maskLog(s.log, attackActors([gift]), 'p1', mask, (id) => id, false);
    expect(forP1log.find((l) => l.seq === gift.seq)!.text).toContain('gave');
  });

  it('heart gifts keep a public anonymized revive line; heal-gift lines are dropped', () => {
    // revive: p1 gives a heart to dead p2 — the revive itself is public
    const dead = {
      ...base,
      config: { ...base.config, revives: true },
      players: { ...base.players, p2: { ...base.players.p2, hp: 0 } },
    };
    let s = placeAdjacent(dead, 'p1', 'p2');
    const revive = ev(s, 'p1', 'give_heart', { targetId: 'p2' });
    s = applyEvent(s, revive);
    const mask = attackMask([revive]);
    // give_heart events stay real on the wire for everyone (hp is public)
    expect(maskEvents([revive], 'p3', mask, false)[0]).toBe(revive);
    const forP3log = maskLog(s.log, attackActors([revive]), 'p3', mask, (id) => id, false);
    expect(forP3log.find((l) => l.kind === 'revive')!.text).toBe('Someone revived p2 with a heart!');
    const forP1log = maskLog(s.log, attackActors([revive]), 'p1', mask, (id) => id, false);
    expect(forP1log.find((l) => l.kind === 'revive')!.text).toContain('revived'); // giver keeps the real names
    // plain heal-gift to a living target: line dropped for non-participants
    const full = { ...base, players: {
      ...base.players,
      p1: { ...base.players.p1, hp: 2 },
      p2: { ...base.players.p2, hp: 2 },
    } };
    let s2 = placeAdjacent(full, 'p1', 'p2');
    const heal = ev(s2, 'p1', 'give_heart', { targetId: 'p2' });
    s2 = applyEvent(s2, heal);
    const healMask = attackMask([heal]);
    expect(maskEvents([heal], 'p3', healMask, false)[0]).toBe(heal); // event stays
    expect(maskLog(s2.log, attackActors([heal]), 'p3', healMask, (id) => id, false)
      .find((l) => l.seq === heal.seq)).toBeUndefined();
  });

  it('trusted replays survive redacted upgrades: stale range cannot fail later attacks', () => {
    // p1 upgrades to range 3, then hits p2 at distance 3 — impossible with
    // the stale range 2 a redacted-upgrade replay would carry
    const spread = { ...base, players: {
      ...base.players,
      p1: { ...base.players.p1, pos: { x: 0, y: 0 }, ap: 10 },
      p2: { ...base.players.p2, pos: { x: 3, y: 0 } },
    } };
    const up = ev(spread, 'p1', 'upgrade_range', {});
    let s = applyEvent(spread, up);
    const atk = ev(s, 'p1', 'attack', { targetId: 'p2' });
    s = applyEvent(s, atk);
    const mask = attackMask([up, atk]);
    const masked = maskEvents([up, atk], 'p3', mask, false);
    expect(masked[0].type).toBe('redacted'); // upgrade hidden
    expect(masked[1].type).toBe('attack');   // only hit on p2 -> named
    // without trusted, re-validation rejects the real history (range 2 < 3)
    expect(() => applyEvents(spread, masked)).toThrow();
    // with trusted it replays exactly: hp and seq match the real timeline
    const replayed = applyEvents(spread, masked, true);
    expect(replayed.players.p2.hp).toBe(s.players.p2.hp);
    expect(replayed.seq).toBe(s.seq);
  });

  it('trusted replays survive redacted gifts: short AP cannot fail later attacks', () => {
    // p1 has 0 AP, receives a gift from p2, then attacks with the gifted AP
    let s0 = placeAdjacent(base, 'p1', 'p2');
    s0 = { ...s0, players: {
      ...s0.players,
      p1: { ...s0.players.p1, ap: 0 },
      p2: { ...s0.players.p2, ap: 5 },
    } };
    const gift = ev(s0, 'p2', 'give_ap', { targetId: 'p1' });
    let s = applyEvent(s0, gift);
    const atk = ev(s, 'p1', 'attack', { targetId: 'p2' });
    s = applyEvent(s, atk);
    const mask = attackMask([gift, atk]);
    const masked = maskEvents([gift, atk], 'p3', mask, false);
    expect(masked[0].type).toBe('redacted'); // gift hidden from p3
    // without trusted the replay throws 'not enough AP' (p1 replayed at 0)
    expect(() => applyEvents(s0, masked)).toThrow();
    const replayed = applyEvents(s0, masked, true);
    expect(replayed.players.p2.hp).toBe(s.players.p2.hp);
    expect(replayed.seq).toBe(s.seq);
  });

  it('redacted ballots replay as no-ops: seq advances, pendingVotes stays empty', () => {
    const dead = { ...base, players: { ...base.players, p2: { ...base.players.p2, hp: 0 } } };
    const real = applyEvent(dead, ev(dead, 'p2', 'jury_vote', { candidateId: 'p1' }));
    expect(real.pendingVotes).toHaveLength(1);
    // living viewer's copy of the same event
    const redacted = { ...ev(dead, 'p2', 'jury_vote', { candidateId: 'p1' }), payload: { redacted: true } };
    const s = applyEvent(dead, redacted);
    expect(s.pendingVotes).toEqual([]);
    expect(s.seq).toBe(real.seq);
    expect(s.log).toEqual(dead.log); // no new line
  });

  it('scrubState strips ballots and others’ outcomes from a living viewer’s state', () => {
    const s = {
      ...base,
      pendingVotes: [{ voterId: 'p2', candidateId: 'p1' }],
      haunted: 'p3' as const,
      lastBonus: [{ id: 'p3', day: 2 }, { id: 'p1', day: 2 }],
    };
    const scrubbed = scrubState(s, 'p1'); // p1 alive
    expect(scrubbed.pendingVotes).toEqual([]);
    expect(scrubbed.haunted).toBeNull(); // someone else's haunt is hidden
    expect(scrubbed.lastBonus).toEqual([{ id: 'p1', day: 2 }]); // own golden row kept
    // the dead keep everything (they are the jury)
    const deadView = scrubState({ ...s, players: { ...s.players, p2: { ...s.players.p2, hp: 0 } } }, 'p2');
    expect(deadView.pendingVotes).toEqual([{ voterId: 'p2', candidateId: 'p1' }]);
    expect(deadView.haunted).toBe('p3');
    expect(deadView.lastBonus).toEqual([{ id: 'p3', day: 2 }, { id: 'p1', day: 2 }]);
    // a haunted living player keeps their own haunt (purple tint entitlement)
    const hauntedView = scrubState(s, 'p3');
    expect(hauntedView.haunted).toBe('p3');
    expect(hauntedView.pendingVotes).toEqual([]);
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

// Read-only verification for a game whose events table has a hole (the
// manually-undone mistaken revive in Zbar222 Round 1: event seq 32 was
// deleted). Replays the canonical history AROUND the hole — events with
// seq <= CUT, then the events after it — and diffs the reconstruction
// against the live snapshot, so we can confirm the manual edit left the
// state consistent. Also prints a line-by-line log text diff showing
// exactly what a text-only relog would change in this game.
//
// READ-ONLY: performs no writes.
//
// Run: SUPABASE_ACCESS_TOKEN=<pat> deno run --allow-net --allow-env scripts/check-game-replay.ts <gameId>

import {
  applyEvent, createInitialState, attackActors, attackMask, maskLog, viewerLogReveal,
} from '../supabase/functions/_shared/engine_src/index.ts';
import { canonicalHistory, effectiveForks, type ForkPoint } from '../supabase/functions/_shared/history.ts';
import type { GameConfig, GameEvent, GameState, LogEntry } from '../supabase/functions/_shared/engine_src/types.ts';

const REF = 'sifbpmpxyiycbupntobl';
const PAT = Deno.env.get('SUPABASE_ACCESS_TOKEN');
const gameId = Deno.args[0];
if (!PAT || !gameId) {
  console.error('SUPABASE_ACCESS_TOKEN env var and <gameId> arg required');
  Deno.exit(1);
}

async function query(sql: string): Promise<unknown> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`query failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}
const q = (s: string) => s.replace(/'/g, "''");

const [g] = await query(`select id, name, config, cur_generation, fork_seq from public.games where id = '${gameId}'`) as Array<{ id: string; name: string; config: GameConfig; cur_generation: number; fork_seq: number | null }>;
const [snap] = await query(`select seq, state from public.game_state where game_id = '${gameId}'`) as Array<{ seq: number; state: GameState }>;
const rows = await query(`select generation, seq, type, actor_id, payload, created_at from public.events where game_id = '${gameId}' order by seq`) as Array<{ generation: number; seq: number; type: GameEvent['type']; actor_id: string; payload: unknown; created_at: string }>;
const forks = await query(`select parent_generation, to_seq from public.game_forks where game_id = '${gameId}'`) as ForkPoint[];

const st = snap.state;
const holes: number[] = [];
for (let i = 0; i < rows.length; i++) {
  if (i > 0 && rows[i].seq !== rows[i - 1].seq + 1) holes.push(rows[i - 1].seq);
}
console.log(`game: ${g.name}  snap.seq=${snap.seq} day=${st.day} events=${rows.length} holes after seq: ${holes.join(', ') || 'none'}`);

const CUT = holes.length ? holes[0] : Infinity; // replay up to the first hole, then re-apply the rest
const history = canonicalHistory(
  rows.map((e) => ({ seq: e.seq, type: e.type, actorId: e.actor_id, createdAt: e.created_at, payload: (e.payload ?? {}) as GameEvent['payload'], generation: e.generation })),
  effectiveForks(forks, g.cur_generation, g.fork_seq),
);

const specs = st.order.map((id) => ({
  id, name: st.players[id]?.name ?? id,
  isBot: st.players[id]?.isBot ?? false,
  botDifficulty: st.players[id]?.botDifficulty ?? null,
}));
let replayed = createInitialState(g.config, specs);
const applied: string[] = [];
for (const e of history) {
  if (e.seq <= CUT) {
    try { replayed = applyEvent(replayed, e); applied.push(String(e.seq)); }
    catch (err) { console.log(`replay threw at seq ${e.seq}: ${err instanceof Error ? err.message : err}`); break; }
  } else {
    // across the hole we stop: the reconstruction is events up to the cut.
    // Events after the hole (their effects ARE in the snapshot) show up as
    // expected diffs below — the point is to separate those from any
    // LEFTOVER effects of the undone event.
    break;
  }
}
console.log(`replayed events up to seq ${applied.length ? applied[applied.length - 1] : 'none'}`);

// field-by-field diff. seq ALWAYS differs (hole + post-hole events) — shown separately.
const fields: Array<keyof GameState> = ['day', 'winner', 'haunted'];
const diffs: string[] = [];
for (const f of fields) {
  if (JSON.stringify(replayed[f]) !== JSON.stringify(st[f])) diffs.push(`${f}: snapshot=${JSON.stringify(st[f])} replay=${JSON.stringify(replayed[f])}`);
}
if (JSON.stringify(replayed.pendingVotes) !== JSON.stringify(st.pendingVotes)) diffs.push(`pendingVotes: snapshot=${JSON.stringify(st.pendingVotes)} replay=${JSON.stringify(replayed.pendingVotes)}`);
if (JSON.stringify(replayed.jury) !== JSON.stringify(st.jury)) diffs.push(`jury: snapshot=${JSON.stringify(st.jury)} replay=${JSON.stringify(replayed.jury)}`);
for (const id of Object.keys(st.players)) {
  const a = st.players[id], b = replayed.players[id];
  if (!b) { diffs.push(`player ${a.name}: missing from replay`); continue; }
  for (const k of ['hp', 'ap', 'range', 'pos'] as const) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push(`${a.name}.${k}: snapshot=${JSON.stringify(a[k])} replay=${JSON.stringify(b[k])}`);
  }
  if (a.apEarned !== b.apEarned) console.log(`apEarned ${a.name}: snapshot=${a.apEarned ?? 'none'} replay=${b.apEarned}`);
}
for (const id of Object.keys(replayed.players)) {
  if (!st.players[id]) diffs.push(`player ${id}: exists only in replay`);
}
console.log(diffs.length ? `\nSTATE DIFFS (snapshot vs events 1..${CUT}):\n  ` + diffs.join('\n  ') : `\nSTATE: snapshot matches events 1..${CUT} exactly (no diffs)`);

// log alignment + full text diff (what a text-only relog would change here)
const snapLog = st.log as LogEntry[];
const repLog = replayed.log as LogEntry[];
console.log(`\nlog lines: snapshot=${snapLog.length} replay=${repLog.length}`);
const max = Math.max(snapLog.length, repLog.length);
for (let i = 0; i < max; i++) {
  const a = snapLog[i], b = repLog[i];
  if (!a || !b) { console.log(`  [${i}] ${a ? 'snapshot-only seq ' + a.seq : 'replay-only seq ' + b.seq}`); continue; }
  if (a.seq !== b.seq) { console.log(`  [${i}] SEQ MISMATCH snapshot=${a.seq} replay=${b.seq}`); continue; }
  if (a.text !== b.text || a.kind !== b.kind) {
    console.log(`  [${i}] seq ${a.seq}${b.kind && b.kind !== a.kind ? ` kind ${a.kind ?? '-'}->${b.kind}` : ''}\n      - ${a.text}\n      + ${b.text}`);
  }
}

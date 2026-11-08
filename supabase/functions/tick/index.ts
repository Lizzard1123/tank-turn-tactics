import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { applyEvent, planBotAction, type GameEvent, type GameState } from '../_shared/engine.ts';

// AP distribution flow (test mode):
//   - game-start seeds last_tick_at = null, so the first tick invocation fires
//     immediately (dueForTick returns true on a null last_tick_at).
//   - thereafter a tick is due once ap_interval_minutes has elapsed.
//   - each tick appends a daily_tick event that gives config.apPerDay AP to every
//     alive player (engine reducer, daily_tick branch), then last_tick_at is
//     persisted below after tickGame returns.
// Note: AP only flows when this function is actually invoked on a schedule
// (pg_cron / cron trigger); that wiring is out of scope here. With no scheduled
// invocations, no AP distributes — that is an ops/configuration gap, not a code gap.
function dueForTick(game: { mode: string; daily_ap_time: string; ap_interval_minutes: number | null; last_tick_at: string | null }): boolean {
  const now = new Date();
  if (game.mode === 'play') {
    const [h, m] = game.daily_ap_time.split(':').map(Number);
    if (!game.last_tick_at) return now.getUTCHours() === h;
    return now.getUTCHours() === h && now.getUTCMinutes() >= m;
  }
  const interval = (game.ap_interval_minutes ?? 2) * 60_000;
  if (!game.last_tick_at) return true;
  return now.getTime() - new Date(game.last_tick_at).getTime() >= interval;
}

async function tickGame(gameId: string): Promise<number> {
  const a = admin();
  const { data: game } = await a.from('games').select('*').eq('id', gameId).single();
  if (!game || game.status !== 'active') return 0;

  const { data: snap } = await a.from('game_state').select('seq, state').eq('game_id', gameId).single();
  if (!snap) return 0;
  let state: GameState = snap.state;

  let appended = 0;

  // 1. AP drip (only if not already ticked for this slot — checked by caller)
  const apGained = (state.config as { apPerDay?: number }).apPerDay ?? 1;
  const drip: GameEvent = {
    seq: state.seq + 1, type: 'daily_tick', actorId: 'system',
    createdAt: new Date().toISOString(), payload: { apGained, elapsedMinutes: game.mode === 'test' ? (game.ap_interval_minutes ?? 2) : 1440 },
  };
  state = applyEvent(state, drip);
  await a.from('events').insert({
    game_id: gameId, generation: game.cur_generation, seq: drip.seq,
    type: drip.type, actor_id: drip.actorId, payload: drip.payload, created_at: drip.createdAt,
  });
  appended++;

  // 2. bot pass: each bot plans one action (loop until no bot wants to act)
  const botIds = Object.values(state.players).filter(p => p.isBot && p.hp > 0).map(p => p.id);
  for (let pass = 0; pass < 8; pass++) {
    let acted = 0;
    for (const botId of botIds) {
      const action = planBotAction(state, botId);
      if (!action) continue;
      const ev: GameEvent = {
        seq: state.seq + 1, type: 'bot_action', actorId: botId,
        createdAt: new Date().toISOString(), payload: { inner: action },
      };
      try {
        state = applyEvent(state, ev);
      } catch {
        continue; // bot tried something illegal (e.g. race); skip it
      }
      await a.from('events').insert({
        game_id: gameId, generation: game.cur_generation, seq: ev.seq,
        type: ev.type, actor_id: ev.actorId, payload: ev.payload, created_at: ev.createdAt,
      });
      acted++;
      appended++;
    }
    if (acted === 0) break;
  }

  await a.from('game_state').upsert({
    game_id: gameId, seq: state.seq, state, updated_at: new Date().toISOString(),
  });

  if (state.winner) {
    await a.from('games').update({ status: 'finished' }).eq('id', gameId);
  }
  return appended;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  // cron secret check (set CRON_SECRET; empty means local dev = open)
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const auth = req.headers.get('Authorization') ?? '';
    if (auth !== `Bearer ${cronSecret}`) return json({ error: 'unauthorized' }, 401);
  }

  try {
    const a = admin();
    const { data: activeGames } = await a.from('games')
      .select('id, mode, daily_ap_time, ap_interval_minutes, last_tick_at')
      .eq('status', 'active');

    let total = 0;
    const ticked: string[] = [];
    for (const game of activeGames ?? []) {
      if (dueForTick(game)) {
        const n = await tickGame(game.id);
        if (n > 0) {
          await a.from('games').update({ last_tick_at: new Date().toISOString() }).eq('id', game.id);
          total += n;
          ticked.push(game.id);
        }
      }
    }
    return json({ ok: true, ticked, eventsAppended: total });
  } catch (e) {
    return json({ error: `tick failed: ${e instanceof Error ? e.message : 'unknown'}` }, 500);
  }
});

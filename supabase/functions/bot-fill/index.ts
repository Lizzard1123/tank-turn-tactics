import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { applyEvent, planBotAction, type GameEvent, type GameState } from '../_shared/engine.ts';

/**
 * Bot pass for active games that have living bots. Callable directly (tests)
 * or from tick after a drip. Idempotent: bots only act when planBotAction
 * returns a legal action; illegal plans are skipped.
 */
async function botPass(gameId: string): Promise<number> {
  const a = admin();
  const { data: game } = await a.from('games').select('*').eq('id', gameId).single();
  if (!game || game.status !== 'active') return 0;

  const { data: snap } = await a.from('game_state').select('seq, state').eq('game_id', gameId).single();
  if (!snap) return 0;
  let state: GameState = snap.state;

  const botIds = Object.values(state.players).filter(p => p.isBot && p.hp > 0).map(p => p.id);
  if (botIds.length === 0) return 0;

  let appended = 0;
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
        continue;
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

  if (appended > 0) {
    await a.from('game_state').upsert({
      game_id: gameId, seq: state.seq, state, updated_at: new Date().toISOString(),
    });
    if (state.winner) await a.from('games').update({ status: 'finished' }).eq('id', gameId);
  }
  return appended;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const auth = req.headers.get('Authorization') ?? '';
    if (auth !== `Bearer ${cronSecret}`) return json({ error: 'unauthorized' }, 401);
  }
  try {
    const body = await req.json().catch(() => ({}));
    if (body.gameId) {
      const n = await botPass(body.gameId);
      return json({ ok: true, eventsAppended: n });
    }
    const a = admin();
    const { data: activeGames } = await a.from('games').select('id').eq('status', 'active');
    let total = 0;
    for (const g of activeGames ?? []) total += await botPass(g.id);
    return json({ ok: true, eventsAppended: total });
  } catch (e) {
    return json({ error: `bot-fill failed: ${e instanceof Error ? e.message : 'unknown'}` }, 500);
  }
});

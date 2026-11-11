import { corsHeaders, json } from '../_shared/cors.ts';
import { admin } from '../_shared/client.ts';
import { getPlayer } from '../_shared/auth.ts';
import { createInitialState, type GameConfig, type GameState } from '../_shared/engine.ts';

const BOT_NAMES: Record<string, string> = { easy: 'Easy Bot', medium: 'Medium Bot', hard: 'Hard Bot' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const a = admin();
    const me = await getPlayer(a, req);
    if (!me) return json({ error: 'unauthorized' }, 401);

    const { gameId } = await req.json();
    if (!gameId) return json({ error: 'gameId required' }, 400);

    const { data: game } = await a.from('games').select('*').eq('id', gameId).single();
    if (!game) return json({ error: 'game not found' }, 404);
    if (game.created_by !== me.id) return json({ error: 'only the host can start' }, 403);
    if (game.status !== 'lobby') return json({ error: 'game already started' }, 409);

    const { data: members } = await a.from('game_players')
      .select('player_id, is_bot, bot_difficulty').eq('game_id', gameId);
    const humans = (members ?? []).filter(m => !m.is_bot);

    const config = game.config as GameConfig & { bots?: { difficulty: string }[] };
    const bots = config.bots ?? [];
    const total = humans.length + bots.length;
    if (total > config.board * config.board)
      return json({ error: `too many players (${total}) for board ${config.board}x${config.board}` }, 400);
    if (total < 2) return json({ error: 'need at least 2 players (add bots or invite friends)' }, 400);

    const specs = [
      ...humans.map(m => ({ id: m.player_id as string, name: '', isBot: false, botDifficulty: null as null })),
      ...bots.map((b, i) => ({
        id: `bot-${i + 1}`,
        name: `${BOT_NAMES[b.difficulty] ?? 'Bot'} ${i + 1}`,
        isBot: true,
        botDifficulty: b.difficulty as 'easy' | 'medium' | 'hard',
      })),
    ];
    // fetch human names
    const { data: playerRows } = await a.from('players').select('id, name').in('id', humans.map(h => h.player_id));
    const nameById = new Map((playerRows ?? []).map(p => [p.id, p.name]));
    for (const s of specs) if (!s.isBot) s.name = nameById.get(s.id) ?? 'Unknown';

    const state: GameState = createInitialState(config, specs);

    // materialize initial state (no seed event needed: placement is
    // deterministic from config.seed)
    const { error: stateErr } = await a.from('game_state').upsert({
      game_id: gameId, seq: 0, state, updated_at: new Date().toISOString(),
    });
    if (stateErr) return json({ error: 'state initialization failed' }, 500);

    // persist bot memberships so game-get can list them
    if (bots.length > 0) {
      await a.from('game_players').upsert(
        bots.map((b, i) => ({
          game_id: gameId, player_id: `bot-${i + 1}`, is_bot: true, bot_difficulty: b.difficulty,
        })),
      );
    }

    const { error: statusErr } = await a.from('games')
      .update({
        status: 'active',
        // play mode: day clock starts now; test mode: due for an immediate tick
        last_tick_at: game.mode === 'play' ? new Date().toISOString() : null,
      }).eq('id', gameId);
    if (statusErr) return json({ error: 'start failed' }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: `bad request: ${e instanceof Error ? e.message : 'unknown'}` }, 400);
  }
});

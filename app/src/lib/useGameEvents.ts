import { useCallback, useEffect, useRef, useState } from 'react';
import { applyEvents, normalizeHeartState, type GameEvent, type GameState, type PlayerId } from '@ttt/engine';
import { gameGet, type GameDetail } from './api';
import { supabase } from './supabaseClient';

export interface UseGameEvents {
  state: GameState | null;
  events: GameEvent[];                       // authoritative tail
  history: Array<GameEvent & { generation?: number }>; // full record for the scrubber
  me: PlayerId | null;
  detail: GameDetail['game'] | null;
  avatars?: Record<string, string>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// One row of the per-member realtime table (migration 0016): this viewer's
// own pre-scrubbed state, the masked new events, and a small patch of game
// fields (AP schedule cursors / status).
interface PlayerActivityRow {
  game_id: string;
  player_id: string;
  seq: number;
  state: GameState | null;
  events?: Array<GameEvent & { generation?: number }>;
  game_patch?: Record<string, unknown>;
}

// Server-authoritative load + client replay of the tail. Realtime no longer
// triggers a refetch: each commit writes one `player_activity` row per
// member, pre-scrubbed server-side for that member, and postgres_changes
// delivers only the viewer's own row (the table's RLS policy filters
// player_id = auth.uid()). The row is applied DIRECTLY — no refetch — which
// removes a full game-get from every opponent action's round trip. The 4s
// poller stays as the reconciler (socket loss, scrubber-history re-masking,
// and any detail fields the row does not carry).
export function useGameEvents(gameId: string | undefined): UseGameEvents {
  const [detail, setDetail] = useState<GameDetail['game'] | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string> | undefined>(undefined);
  const [state, setState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [history, setHistory] = useState<Array<GameEvent & { generation?: number }>>([]);
  const [me, setMe] = useState<PlayerId | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  // latest values for the socket handler and the stale-response guard
  const stateRef = useRef<GameState | null>(null);
  stateRef.current = state;
  const meRef = useRef<PlayerId | null>(null);
  meRef.current = me;

  const refresh = useCallback(async () => {
    if (!gameId) return;
    try {
      const token = localStorage.getItem('ttt_token');
      if (!token) throw new Error('not signed in');
      const d = await gameGet(token, gameId);
      if (!aliveRef.current) return;
      const base = normalizeHeartState(d.state as GameState);
      // Stale-response guard: a refetch that raced a direct-apply (its fetch
      // started before the commit it lost to) must not drag the board
      // backwards. Equal seqs still apply — a fresh authoritative copy also
      // re-masks the scrubber history the realtime path can only append to.
      const current = stateRef.current;
      if (current && base.seq < current.seq) return;
      // game-get ALREADY replays the tail onto the snapshot before returning
      // (`state` is the merged, authoritative state), so re-applying the tail
      // here double-applied event N onto a state with seq N — the "seq gap:
      // expected N+1, got N" errors on every refresh that landed while a tail
      // existed. Replay only events ahead of the snapshot (none with the
      // current server, but correct if it ever ships raw snapshots again).
      const tail = d.events as GameEvent[];
      const future = tail.filter((e) => e.seq > base.seq);
      const merged = future.length > 0 ? applyEvents(base, future) : base;
      setDetail(d.game);
      setAvatars(d.avatars);
      setState(merged);
      setEvents(tail);
      setHistory(d.history as Array<GameEvent & { generation?: number }>);
      setMe(d.me as PlayerId);
      setError(null);
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : 'failed to load game');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [gameId]);

  // one fetch at a time — a realtime burst plus the poller must not stack
  const inFlight = useRef(false);
  const refreshThrottled = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await refresh();
    } finally {
      inFlight.current = false;
    }
  }, [refresh]);

  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    void refresh();
    return () => { aliveRef.current = false; };
  }, [refresh]);

  // realtime: apply this viewer's own player_activity row directly.
  // postgres_changes applies the table RLS with the connection's JWT, so the
  // session token is attached before subscribing and only rows whose
  // player_id matches the session arrive.
  useEffect(() => {
    if (!gameId) return;
    const token = localStorage.getItem('ttt_token');
    if (token) supabase.realtime.setAuth(token);
    const applyRow = (msg: { new: unknown }) => {
      const row = msg.new as PlayerActivityRow | null;
      if (!row || row.game_id !== gameId || !row.state) return;
      if (meRef.current && row.player_id !== meRef.current) return; // RLS should make this unreachable
      const current = stateRef.current;
      if (current && row.seq <= current.seq) return; // stale / out-of-order
      const s = normalizeHeartState(row.state);
      setState(s);
      // advance the scrubber history (board fx reads the newest entry) —
      // events ride masked for this viewer, never re-hiding anything it was
      // previously entitled to see
      const evs = row.events ?? [];
      if (evs.length > 0) {
        setHistory((prev) => {
          const last = prev.length > 0 ? prev[prev.length - 1].seq : -1;
          const fresh = evs.filter((e) => e.seq > last);
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }
      // keep the AP countdown / status in sync without a refetch
      const patch = row.game_patch;
      if (patch && Object.keys(patch).length > 0) {
        setDetail((prev) => (prev ? { ...prev, ...(patch as object) } : prev));
      }
      setError(null);
    };
    const channel = supabase
      .channel(`state:${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'player_activity', filter: `game_id=eq.${gameId}` },
        (msg: { new: unknown }) => applyRow(msg),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [gameId]);

  // polling fallback: reconciles anything realtime misses (a dropped socket,
  // masking that must be recomputed over the full history, detail fields the
  // per-member row does not carry). Poll on a short cadence while the tab is
  // visible and the game is still live.
  const finished = detail?.status === 'finished' || !!state?.winner;
  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshThrottled();
    }, 4000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshThrottled(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [finished, refreshThrottled]);

  return { state, events, history, me, detail, avatars, loading, error, refresh };
}

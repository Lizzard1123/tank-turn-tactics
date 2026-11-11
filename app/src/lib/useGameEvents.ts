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

// Server-authoritative load + client replay of the tail, with a realtime
// subscription on the events table that triggers a refetch.
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

  const refresh = useCallback(async () => {
    if (!gameId) return;
    try {
      const token = localStorage.getItem('ttt_token');
      if (!token) throw new Error('not signed in');
      const d = await gameGet(token, gameId);
      if (!aliveRef.current) return;
      const base = normalizeHeartState(d.state as GameState);
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

  // realtime: any INSERT on this game's events triggers a refetch+replay.
  // postgres_changes applies events-table RLS with the connection's JWT, so
  // the session token is attached before subscribing.
  useEffect(() => {
    if (!gameId) return;
    const token = localStorage.getItem('ttt_token');
    if (token) supabase.realtime.setAuth(token);
    const channel = supabase
      .channel(`events:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events', filter: `game_id=eq.${gameId}` },
        () => { void refreshThrottled(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [gameId, refreshThrottled]);

  // polling fallback: the tick's AP drip only reaches the client through a
  // refetch, and a silently-dead realtime socket would otherwise leave the
  // AP display frozen until the player's next action. Poll on a short cadence
  // while the tab is visible and the game is still live.
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyEvents, type GameEvent, type GameState, type PlayerId } from '@ttt/engine';
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
      const base = d.state as GameState;
      // replay the tail events onto the server snapshot
      const tail = d.events as GameEvent[];
      const merged = tail.length > 0 ? applyEvents({ ...base, seq: base.seq }, tail) : base;
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
        () => { void refresh(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [gameId, refresh]);

  return { state, events, history, me, detail, avatars, loading, error, refresh };
}

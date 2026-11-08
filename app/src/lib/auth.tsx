import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabaseClient';

export interface PlayerInfo { id: string; name: string }

interface AuthState {
  player: PlayerInfo | null;
  token: string | null;
  isGuest: boolean;
  signin: (name: string, password: string) => Promise<void>;
  register: (name: string, password: string) => Promise<void>;
  guestSignin: () => Promise<string>; // resolves with the session token
  signout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = 'ttt_token';
const PLAYER_KEY = 'ttt_player';

// Players sign in by NAME. GoTrue authenticates by email, so the name maps
// to a deterministic synthetic address. Name uniqueness is checked before
// signup (players.name is unique; the mirroring trigger enforces it again).
function nameToEmail(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'player';
  return `${slug}@players.tank-turn.game`;
}

function randomName(): string {
  return `guest-${Math.random().toString(36).slice(2, 8)}`;
}

function mirrorSession(token: string | null, player: PlayerInfo | null) {
  if (token && player) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(PLAYER_KEY, JSON.stringify(player));
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PLAYER_KEY);
  }
}

async function playerForSession(): Promise<{ token: string; player: PlayerInfo } | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const uid = session.user.id;
  const { data, error } = await supabase
    .from('players').select('id, name').eq('id', uid).single();
  if (error || !data) return null;
  return { token: session.access_token, player: data };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ token: string; player: PlayerInfo } | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // restore any persisted session, then track GoTrue state (sign-in/out,
    // silent token refreshes all mirror into our localStorage keys)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setIsGuest(false);
        mirrorSession(null, null);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        const s = await playerForSession();
        const anon = (await supabase.auth.getUser()).data.user?.is_anonymous ?? false;
        setIsGuest(anon);
        setSession(s);
        mirrorSession(s?.token ?? null, s?.player ?? null);
      }
      setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const value: AuthState = {
    player: session?.player ?? null,
    token: session?.token ?? null,
    isGuest,
    async signin(name, password) {
      const { error } = await supabase.auth.signInWithPassword({
        email: nameToEmail(name), password,
      });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'wrong name or password' : error.message);
      // session state lands via onAuthStateChange
    },
    async register(name, password) {
      const clean = name.trim();
      if (clean.length < 2 || clean.length > 24) throw new Error('name must be 2-24 chars');
      const { data: taken } = await supabase.rpc('player_name_taken', { p_name: clean });
      if (taken) throw new Error('name taken');
      const { error } = await supabase.auth.signUp({
        email: nameToEmail(clean),
        password,
        options: { data: { name: clean } },
      });
      if (error) {
        // duplicate synthetic email == the name is registered
        throw new Error(/already registered|already exists/i.test(error.message) ? 'name taken' : error.message);
      }
    },
    async guestSignin() {
      const existing = await playerForSession();
      if (existing && isGuest) return existing.token; // reuse the current guest session
      const name = randomName();
      const { error } = await supabase.auth.signInAnonymously({
        options: { data: { name } },
      });
      if (error) throw new Error(error.message);
      const s = await playerForSession();
      if (!s) throw new Error('guest sign-in failed');
      return s.token;
    },
    async signout() {
      await supabase.auth.signOut();
    },
  };

  if (!ready) return null; // don't flash the signed-out UI before restore
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

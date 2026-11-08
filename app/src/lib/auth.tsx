import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as api from './api';

interface AuthState {
  player: api.PlayerInfo | null;
  token: string | null;
  isGuest: boolean;
  signin: (name: string, password: string) => Promise<void>;
  register: (name: string, password: string) => Promise<void>;
  guestSignin: () => Promise<string>; // resolves with the session token
  signout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = 'ttt_token';
const PLAYER_KEY = 'ttt_player';
const GUEST_KEY = 'ttt_guest';

function loadSession(): { token: string; player: api.PlayerInfo } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const playerRaw = localStorage.getItem(PLAYER_KEY);
    if (token && playerRaw) return { token, player: JSON.parse(playerRaw) };
  } catch {
    // corrupt storage — fall through to null
  }
  return null;
}

function storeSession(token: string, player: api.PlayerInfo) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(PLAYER_KEY, JSON.stringify(player));
}

function randomName(): string {
  return `guest-${Math.random().toString(36).slice(2, 8)}`;
}

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(loadSession);
  const [isGuest, setIsGuest] = useState(() => localStorage.getItem(GUEST_KEY) === '1');

  useEffect(() => {
    if (!session) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(PLAYER_KEY);
    }
  }, [session]);

  const value: AuthState = {
    player: session?.player ?? null,
    token: session?.token ?? null,
    isGuest,
    async signin(name, password) {
      const res = await api.signin(name, password);
      storeSession(res.token, res.player);
      localStorage.removeItem(GUEST_KEY);
      setIsGuest(false);
      setSession({ token: res.token, player: res.player });
    },
    async register(name, password) {
      const res = await api.register(name, password);
      storeSession(res.token, res.player);
      localStorage.removeItem(GUEST_KEY);
      setIsGuest(false);
      setSession({ token: res.token, player: res.player });
    },
    async guestSignin() {
      if (session && isGuest) return session.token; // reuse existing guest session
      const res = await api.register(randomName(), randomPassword());
      storeSession(res.token, res.player);
      localStorage.setItem(GUEST_KEY, '1');
      setIsGuest(true);
      setSession({ token: res.token, player: res.player });
      return res.token;
    },
    signout() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(PLAYER_KEY);
      localStorage.removeItem(GUEST_KEY);
      setIsGuest(false);
      setSession(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Local dev fallback: the supabase CLI's local stack.
const BASE = SUPABASE_URL ?? 'http://localhost:54321';
const KEY = ANON_KEY ?? 'anon-placeholder-key-not-used-by-edge-functions';

export interface PlayerInfo { id: string; name: string }
export interface AuthResponse { token: string; player: PlayerInfo }

export interface GameSummary {
  id: string;
  name: string;
  mode: 'play' | 'test';
  status: 'lobby' | 'active' | 'finished';
  playerCount: number;
  created_at: string;
}

export interface GameConfigPayload {
  seed?: number;
  board: number;
  startingHp: number;
  startingAp: number;
  baseRange: number;
  apPerDay: number;
  upgradeCost: number;
  apIntervalMinutes?: number;
  bots?: { difficulty: 'easy' | 'medium' | 'hard' }[];
}

export interface GameCreateInput {
  name: string;
  mode: 'play' | 'test';
  config: GameConfigPayload;
  dailyApTime?: string;
}

async function fn<T>(path: string, body?: unknown, token?: string, method = 'POST'): Promise<T> {
  const res = await fetch(`${BASE}/functions/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `request failed (${res.status})`);
  return data as T;
}

export function register(name: string, password: string): Promise<AuthResponse> {
  return fn<AuthResponse>('register', { name, password });
}

export function signin(name: string, password: string): Promise<AuthResponse> {
  return fn<AuthResponse>('signin', { name, password });
}

// --- authenticated calls (token passed explicitly so this module stays framework-free) ---

export function gameList(token: string): Promise<{ games: GameSummary[] }> {
  return fn<{ games: GameSummary[] }>('game-list', undefined, token, 'GET');
}

export function gameCreate(token: string, input: GameCreateInput): Promise<{ gameId: string; inviteCode: string }> {
  return fn<{ gameId: string; inviteCode: string }>('game-create', input, token);
}

export function gameJoin(token: string, inviteCode: string): Promise<{ gameId: string }> {
  return fn<{ gameId: string }>('game-join', { inviteCode }, token);
}

export interface GameMember {
  player_id: string;
  is_bot: boolean;
  bot_difficulty: 'easy' | 'medium' | 'hard' | null;
  joined_at: string;
}

export interface GameDetail {
  game: {
    id: string; name: string; mode: 'play' | 'test';
    status: 'lobby' | 'active' | 'finished';
    config: GameConfigPayload; createdBy: string;
    inviteCode: string; generation: number; forkSeq: number | null;
  };
  state: unknown | null;
  events: unknown[];
  history: unknown[];
  members: GameMember[];
  me: string;
}

export function gameGet(token: string, gameId: string): Promise<GameDetail> {
  return fn<GameDetail>(`game-get?gameId=${encodeURIComponent(gameId)}`, undefined, token, 'GET');
}

export function gameStart(token: string, gameId: string): Promise<{ ok: true }> {
  return fn<{ ok: true }>('game-start', { gameId }, token);
}

export function gameUpdate(
  token: string,
  gameId: string,
  config: Partial<GameConfigPayload>,
): Promise<{ ok: true; config: GameConfigPayload }> {
  return fn<{ ok: true; config: GameConfigPayload }>('game-update', { gameId, config }, token);
}

export interface ActionResponse {
  ok: true;
  seq: number;
  state: unknown;
}

export function action(
  token: string,
  gameId: string,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<ActionResponse> {
  return fn<ActionResponse>('action', { gameId, type, payload }, token);
}

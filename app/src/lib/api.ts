const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Local dev fallback: the supabase CLI's local stack (127.0.0.1 — `localhost`
// can resolve to ::1 in browsers and miss the local stack). The local
// gateway rejects requests with an invalid apikey header BEFORE our function
// runs, so the response carries no CORS headers — use the standard local
// anon key (paired with the CLI's default demo JWT secret). Production
// builds set VITE_SUPABASE_ANON_KEY via CI secrets.
const BASE = SUPABASE_URL ?? 'http://127.0.0.1:54321';
const KEY = ANON_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export interface PlayerInfo { id: string; name: string }

export interface GameSummary {
  id: string;
  name: string;
  mode: 'play' | 'test';
  status: 'lobby' | 'active' | 'finished';
  playerCount: number;
  created_at: string;
  createdBy: string;
}

export type ScheduleMode = 'interval' | 'timeOfDay' | 'random';

export interface GameConfigPayload {
  seed?: number;
  board: number;
  startingHp: number;
  startingAp: number;
  baseRange: number;
  apPerDay: number;
  upgradeCost: number;
  apIntervalMinutes?: number;
  // AP schedule shape (absent = legacy: apTimeOfDay ? timeOfDay : interval)
  apSchedule?: ScheduleMode;
  apPeriodMinutes?: number;
  apTimeOfDay?: string;
  apTimezone?: string;
  // new-rule toggles (all default off)
  apStealOnKill?: boolean;
  heartGifts?: boolean;
  revives?: boolean;
  juryHaunt?: boolean;
  // heart spawns: own schedule + placement, independent of the AP schedule
  heartSpawn?: boolean;
  heartSchedule?: ScheduleMode;
  heartIntervalMinutes?: number;
  heartTimeOfDay?: string;
  heartTimezone?: string;
  heartPeriodMinutes?: number;
  heartSpawnDelayMinutes?: number;
  heartPlacement?: 'random' | 'smart';
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
      // the gateway 401s requests without an Authorization header — and that
      // response carries no CORS headers, so the browser reports a network
      // error. Anonymous calls present the anon key.
      Authorization: `Bearer ${token ?? KEY}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `request failed (${res.status})`);
  return data as T;
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
    /** server AP schedule: interval base (ISO) and/or daily wall-clock slot */
    lastTickAt?: string | null;
    dailyApTime?: string | null;
  };
  state: unknown | null;
  events: unknown[];
  history: unknown[];
  members: GameMember[];
  avatars?: Record<string, string>;
  me: string;
}

export function gameGet(token: string, gameId: string): Promise<GameDetail> {
  return fn<GameDetail>(`game-get?gameId=${encodeURIComponent(gameId)}`, undefined, token, 'GET');
}

export function gameStart(token: string, gameId: string): Promise<{ ok: true }> {
  return fn<{ ok: true }>('game-start', { gameId }, token);
}

export function gameDelete(token: string, gameId: string): Promise<{ ok: true }> {
  return fn<{ ok: true }>('game-delete', { gameId }, token, 'DELETE');
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

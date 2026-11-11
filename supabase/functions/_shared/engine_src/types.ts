export type PlayerId = string; // uuid or "bot-1"

export interface Vec { x: number; y: number }

export interface PlayerState {
  id: PlayerId;
  name: string;
  pos: Vec;
  hp: number;
  ap: number;
  range: number;
  isBot: boolean;
  botDifficulty: 'easy' | 'medium' | 'hard' | null;
}

export interface JuryVote { voterId: PlayerId; candidateId: PlayerId }

export interface GameState {
  seq: number;              // last applied event seq (0 = initial)
  day: number;              // 1-based
  tickClockMinutes: number; // minutes of "game time" elapsed (test mode)
  config: GameConfig;
  players: Record<PlayerId, PlayerState>;
  order: PlayerId[];        // stable display order
  jury: PlayerId[];         // dead players, in death order
  pendingVotes: JuryVote[]; // this day's jury votes (cleared on tick)
  winner: PlayerId | null;
  log: LogEntry[];
  // unclaimed board heart (event-sourced via heart_spawn; absent in old
  // snapshots = no heart). seq = the spawning event's seq, for rng keying.
  heart?: { x: number; y: number; seq: number } | null;
  // player the most recent tick haunted (juryHaunt) — log/UI hint.
  haunted?: PlayerId | null;
}

export interface LogEntry { seq: number; text: string; kind?: LogKind }

// Markers for the live battle log: during play the feed shows only these
// kinds (final blows and revives); post-game shows everything.
export type LogKind = 'kill' | 'revive' | 'heart_spawn';

export interface GameConfig {
  seed: number;
  board: number;            // board x board grid
  startingHp: number;       // default 3
  startingAp: number;       // default 0
  baseRange: number;        // default 2
  apPerDay: number;         // default 1
  upgradeCost: number;      // default 2 AP per +1 range
  apIntervalMinutes: number;// test-mode AP drip; 0 = daily (server-managed)
  allowLateJoin?: boolean;  // permit joining after game-start (canonical game)
  // AP-at-time schedule (play mode): grant AP daily at a fixed local time.
  // Same underlying tick mechanics as the interval drip — the tick function
  // computes whether the slot is due, one code path for both.
  apTimeOfDay?: string;     // "HH:mm" local wall-clock, e.g. "12:00"
  apTimezone?: string;      // IANA tz, e.g. "America/New_York"

  // --- optional rule toggles (absent/false = classic behavior) ---
  apStealOnKill?: boolean;  // killer gains the victim's AP on the killing blow
  heartGifts?: boolean;     // players can give 1 hp to in-range players
  revives?: boolean;        // a heart given to a dead player revives them (1 hp, 0 AP)
  juryHaunt?: boolean;      // most-voted player gets no AP drip on the next tick

  // --- AP schedule: three mutually exclusive modes ---
  // 'interval'  = fixed period from game start (apIntervalMinutes)
  // 'timeOfDay' = fixed wall-clock time daily (apTimeOfDay/apTimezone)
  // 'random'    = one grant at a random minute inside each apPeriodMinutes
  //               period; the offset derives from the game seed per period,
  //               so the server tracks no extra state. No public countdown.
  apSchedule?: 'interval' | 'timeOfDay' | 'random';
  apPeriodMinutes?: number; // 'random' mode period length, 1..1440

  // --- board hearts: spawn + pickup ---
  heartSpawn?: boolean;     // hearts appear on the board per heartSchedule
  heartSchedule?: 'interval' | 'timeOfDay' | 'random';
  heartIntervalMinutes?: number; // 'interval' mode, minutes between spawns
  heartTimeOfDay?: string;       // 'timeOfDay' mode, "HH:mm"
  heartTimezone?: string;        // IANA tz, defaults 'UTC'
  heartPeriodMinutes?: number;   // 'random' mode period length, 1..1440
  heartPlacement?: 'random' | 'smart'; // smart = distance-field maximization
}

export type ActionType =
  | 'move' | 'attack' | 'give_ap' | 'give_heart' | 'upgrade_range'
  | 'daily_tick' | 'jury_vote' | 'fork' | 'bot_action' | 'join'
  | 'heart_spawn';

export interface GameEvent {
  seq: number;
  type: ActionType;
  actorId: PlayerId | 'system';
  createdAt: string;        // ISO timestamp (informational; not in reducer logic)
  payload: Record<string, unknown>;
}

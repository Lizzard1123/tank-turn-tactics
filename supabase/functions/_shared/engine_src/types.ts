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
}

export interface LogEntry { seq: number; text: string }

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
}

export type ActionType =
  | 'move' | 'attack' | 'give_ap' | 'upgrade_range'
  | 'daily_tick' | 'jury_vote' | 'fork' | 'bot_action' | 'join';

export interface GameEvent {
  seq: number;
  type: ActionType;
  actorId: PlayerId | 'system';
  createdAt: string;        // ISO timestamp (informational; not in reducer logic)
  payload: Record<string, unknown>;
}

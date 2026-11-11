import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { gameGet, gameList, type GameConfigPayload, type GameDetail, type GameSummary } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Icon, clipboardSvg } from '../lib/icons';
import { ErrorBlock, LoadingBlock } from '../components/Status';

// Read-only view of a game's EFFECTIVE server config — what the tick loop
// actually enforces (lobby knobs are only authoritative once the host saves
// them; this page shows the stored source of truth).
export default function ConfigView() {
  const { gameId } = useParams<{ gameId?: string }>();
  const { token } = useAuth();
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    if (!gameId) {
      // no game chosen: list the player's games to pick one
      gameList(token)
        .then((r) => setGames(r.games))
        .catch((e) => setError(e instanceof Error ? e.message : 'failed to load games'));
      return;
    }
    gameGet(token, gameId)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load game'));
  }, [token, gameId]);

  const cfg = detail?.game.config as GameConfigPayload | undefined;
  const apSchedule = cfg?.apSchedule ?? (cfg?.apTimeOfDay ? 'timeOfDay' : 'interval');
  const scheduleLabel: Record<string, string> = {
    interval: 'Fixed interval',
    timeOfDay: 'Daily at a fixed time',
    random: 'Random time within a period',
  };

  function copyConfig() {
    if (!cfg) return;
    void navigator.clipboard.writeText(JSON.stringify(cfg, null, 2))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => {});
  }

  // Short timezone label for schedule rows: "America/New_York" → "EST/EDT"
  // (whichever is in effect today). Zones without an abbreviation fall back
  // to the IANA id; UTC stays "UTC".
  function tzShort(tz: string | undefined): string {
    if (!tz || tz === 'UTC') return 'UTC';
    try {
      const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value;
      return name && !/^GMT/.test(name) ? name : tz;
    } catch {
      return tz;
    }
  }

  return (
    <main className="page">
      <p className="row" style={{ justifyContent: 'space-between' }}>
        <Link to="/games" className="link-button btn">← Games</Link>
        {cfg && (
          <button type="button" className="link-button btn" onClick={copyConfig} data-testid="copy-config">
            <Icon html={clipboardSvg} width={14} height={14} /> {copied ? 'Copied!' : 'Copy JSON'}
          </button>
        )}
      </p>
      <h1>Game config</h1>
      {error && <ErrorBlock message={error} />}

      {!gameId && (
        <section className="card" aria-label="Pick a game">
          <h2>Pick a game</h2>
          {games === null && !error && <LoadingBlock label="Loading games…" />}
          {games?.length === 0 && <p>No games yet — create one first.</p>}
          <ul className="game-list">
            {games?.map((g) => (
              <li key={g.id}>
                <Link className="game-link" to={`/config/${g.id}`}>
                  <span className="game-name">{g.name}</span>
                  <span className="game-meta">{g.mode} · {g.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {gameId && !detail && !error && <LoadingBlock label="Loading config…" />}

      {detail && cfg && (
        <>
          <p className="subtitle">{detail.game.name} · {detail.game.mode} · {detail.game.status}</p>

          <section className="card" aria-label="Basics">
            <h2>Basics</h2>
            <div className="config-grid">
              <span>Board</span><span>{cfg.board}×{cfg.board}</span>
              <span>Starting HP</span><span>{cfg.startingHp}</span>
              <span>Starting AP</span><span>{cfg.startingAp}</span>
              <span>Base range</span><span>{cfg.baseRange}</span>
              <span>AP per day</span><span>{cfg.apPerDay}</span>
              <span>Upgrade cost</span><span>{cfg.upgradeCost}</span>
              <span>Players / bots</span>
              <span>{detail.members.filter((m) => !m.is_bot).length} / {detail.members.filter((m) => m.is_bot).length}</span>
            </div>
          </section>

          <section className="card" aria-label="AP schedule">
            <h2>AP schedule</h2>
            <div className="config-grid">
              <span>Schedule</span><span>{scheduleLabel[apSchedule]}</span>
              {apSchedule === 'interval' && (
                <>
                  <span>Interval</span><span>{cfg.apIntervalMinutes ?? 0} min</span>
                </>
              )}
              {apSchedule === 'timeOfDay' && (
                <>
                  <span>Time of day</span><span>{cfg.apTimeOfDay} ({tzShort(cfg.apTimezone)})</span>
                </>
              )}
              {apSchedule === 'random' && (
                <>
                  <span>Period</span><span>{cfg.apPeriodMinutes} min</span>
                  <span>Countdown</span><span>hidden (secret random minute)</span>
                </>
              )}
            </div>
          </section>

          <section className="card" aria-label="Hearts">
            <h2>Hearts</h2>
            <div className="config-grid">
              <span>Board spawns</span><span>{cfg.heartSpawn ? 'on' : 'off'}</span>
              {cfg.heartSpawn && (
                <>
                  <span>Schedule</span><span>{scheduleLabel[cfg.heartSchedule ?? 'interval']}</span>
                  {(cfg.heartSchedule ?? 'interval') === 'interval' && (
                    <><span>Interval</span><span>{cfg.heartIntervalMinutes ?? 60} min</span></>
                  )}
                  {(cfg.heartSchedule) === 'timeOfDay' && (
                    <><span>Time of day</span><span>{cfg.heartTimeOfDay} ({tzShort(cfg.heartTimezone)})</span></>
                  )}
                  {(cfg.heartSchedule) === 'random' && (
                    <><span>Period</span><span>{cfg.heartPeriodMinutes} min</span></>
                  )}
                  <span>Placement</span><span>{cfg.heartPlacement ?? 'random'}</span>
                  <span>Spawn delay</span>
                  <span>{cfg.heartSpawnDelayMinutes ? `${cfg.heartSpawnDelayMinutes} min` : 'none'}</span>
                </>
              )}
            </div>
          </section>

          <section className="card" aria-label="Rules">
            <h2>Rules</h2>
            <div className="config-grid">
              <span>Steal AP on kill</span><span>{cfg.apStealOnKill ? 'on' : 'off'}</span>
              <span>Heart gifts</span><span>{cfg.heartGifts ? 'on' : 'off'}</span>
              <span>Revives</span><span>{cfg.revives ? 'on' : 'off'}</span>
              <span>Jury haunt</span><span>{cfg.juryHaunt ? 'on' : 'off'}</span>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

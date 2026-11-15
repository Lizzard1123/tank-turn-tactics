import { useEffect, useRef, useState } from 'react';
import type { GameState } from '@ttt/engine';
import type { GameDetail } from './api';

// Countdown format: "1d 8h 32m 5s", largest nonzero units first, seconds
// always shown (so a sub-minute timer still ticks visibly).
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (d > 0 || h > 0) parts.push(`${h}h`);
  if (d > 0 || h > 0 || m > 0) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

// Shared AP countdown hook (used by the game screen and the jury screen).
//
// AP countdown: derived from the SERVER schedule, never a client guess.
//   - interval games: base is detail.lastTickAt (the server's actual last
//     grant; null = game just started, base is status-change time). Refresh-
//     proof: every refetch recomputes from the same server timestamp, so the
//     countdown cannot reset or stay at 0 — it lands back on the true value.
//   - time-of-day games: target is the next apTimeOfDay slot in the
//     schedule's timezone; the countdown shows time until that slot.
// A won game (winner in state) or a server-marked finished game hides it.
// 'random' schedules have no public countdown at all — the grant minute is
// secret (derived from the seed), so there is nothing to count down to.
export function useApCountdown(
  state: GameState | null,
  detail: GameDetail['game'] | null,
): number | null {
  const gameFinished = !!state?.winner || detail?.status === 'finished';
  const lastTickAt = detail?.lastTickAt ?? null;
  const sched = state?.config as {
    apIntervalMinutes?: number; apTimeOfDay?: string; apTimezone?: string;
    apSchedule?: 'interval' | 'timeOfDay' | 'random';
  } | undefined;
  const apScheduleMode = sched?.apSchedule ?? (sched?.apTimeOfDay ? 'timeOfDay' : 'interval');
  const apIntervalMinutes = sched?.apIntervalMinutes ?? 0;
  const apTimeOfDay = sched?.apTimeOfDay;
  const apTimezone = sched?.apTimezone;

  // when this client first saw the game active — fallback base for the AP
  // countdown before the server's first tick exists (lastTickAt is null)
  const gameStartedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (detail?.status === 'active' && gameStartedAtRef.current === null) {
      gameStartedAtRef.current = Date.now();
    }
  }, [detail?.status]);
  const gameStartedAt = gameStartedAtRef.current;

  const [apRemaining, setApRemaining] = useState<number | null>(null);
  // grant-hold flag: true once the countdown reaches a grant boundary; cleared
  // when a refetch brings a new server lastTickAt (the grant was confirmed).
  const grantPendingRef = useRef(false);
  useEffect(() => { grantPendingRef.current = false; }, [lastTickAt]);
  useEffect(() => {
    if (gameFinished || apScheduleMode === 'random' || (!apIntervalMinutes && !apTimeOfDay)) {
      setApRemaining(null);
      return;
    }
    const compute = (): number | null => {
      const now = Date.now();
      if (apTimeOfDay) {
        // next slot at/after now, in the schedule's timezone (UTC fallback).
        // tz→UTC conversion iterates to convergence — the naive "tz wallclock
        // minus UTC wallclock" offset breaks when the tz's calendar date
        // differs from UTC's (evening US time read the offset as +19h instead
        // of −5h and pushed the countdown a full day out: "1d 8h" to a 3pm
        // slot that was really ~19h away).
        const [h, m] = apTimeOfDay.split(':').map(Number);
        const tz = apTimezone || 'UTC';
        const fmt = new Intl.DateTimeFormat('en-GB', {
          timeZone: tz, year: 'numeric', month: '2-digit',
          day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        });
        const partsOf = (d: Date) => {
          const p = fmt.formatToParts(d);
          const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
          return { y: get('year'), mo: get('month'), day: get('day'), hh: get('hour') % 24, mi: get('minute') };
        };
        // UTC instant whose wall clock in tz reads (tz-today + dayOffset) at
        // HH:MM. Guess UTC-first, then correct by the wallclock error — two
        // iterations converge except across a DST edge, where three land it.
        const np = partsOf(new Date(now));
        const zonedToUtc = (dayOffset: number): number => {
          const targetUTC = Date.UTC(np.y, np.mo - 1, np.day + dayOffset, h, m);
          let g = targetUTC;
          for (let i = 0; i < 3; i++) {
            const w = partsOf(new Date(g));
            g += targetUTC - Date.UTC(w.y, w.mo - 1, w.day, w.hh, w.mi);
          }
          return g;
        };
        const today = zonedToUtc(0);
        const target = today > now ? today : zonedToUtc(1);
        return Math.max(0, Math.round((target - now) / 1000));
      }
      // interval: base = last server tick. With none yet, the server grants
      // immediately on its next cron fire, so the first countdown runs to the
      // top of the minute — not gameStart + interval (cron owns the phase).
      if (!lastTickAt) {
        if (!gameStartedAt) return null;
        return Math.round((60_000 - (now % 60_000)) / 1000);
      }
      const base = new Date(lastTickAt).getTime();
      const intervalSeconds = apIntervalMinutes * 60;
      const elapsed = Math.floor((now - base) / 1000);
      // grant boundary: hold at 0 until the server confirms the grant (a
      // refetch brings a new lastTickAt and resets the hold) — no rollover on
      // guesswork while the actual drip may be seconds late (cron jitter).
      if (grantPendingRef.current) return 0;
      if (elapsed >= intervalSeconds && elapsed % intervalSeconds === 0) {
        grantPendingRef.current = true;
        return 0;
      }
      return Math.max(0, intervalSeconds - (elapsed % intervalSeconds));
    };
    setApRemaining(compute());
    const id = setInterval(() => setApRemaining(compute()), 1000);
    return () => clearInterval(id);
  }, [gameFinished, apScheduleMode, apIntervalMinutes, apTimeOfDay, apTimezone, lastTickAt, gameStartedAt]);

  return apRemaining;
}

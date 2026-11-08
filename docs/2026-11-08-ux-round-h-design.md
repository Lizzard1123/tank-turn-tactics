# UX Round H — Dashboard rework, profile rename, AP timer fix, board animations

Date: 2026-11-08
Status: approved in chat (user picked animation language: slide / red bullet / green bullet)

## Intent

Nine pieces of playtest feedback from 2026-11-08, one batch:

1. Finished games must not appear in "Your games".
2. Dashboard must not be a button on the main menu (Play leads there).
3. The AP timer must stop on a finished game.
4. Finished games live in a collapsible expander section.
5. ~~Profile must allow changing your name~~ — DROPPED by user
   ("nevermind i see how this was working"); replaced by: guests
   (anonymous sign-ins) must not join invite-code games.
6. Play and Dashboard land in the same spot; drop Dashboard as a concept.
7. "View" on an event must show the board for THAT event (seq-collision bug).
8. Replay must visibly animate what happened.
9. Game animations: move slides, attack fires a red bullet, give AP a green bullet.
10. Navigation links ("← Home"/"Profile" atop the games page, "Back to
    dashboard" on Profile/Game exit) render as real buttons consistent
    with the site.

## Decisions made with the user

- Animation language (user's words): move = slide, attack = red bullet,
  give AP = green bullet. Upgrade range: pulse ring on own tank (my call).
- Finished games: collapsible details expander on the games page; hosted
  finished games keep their delete button inside it (my call, told to user).
- Timeline corruption fix: server + client (user chose the full fix).
- Dead tanks: HIDDEN from the board (user's call). Visual only — the
  engine still counts them as cell-blocking obstacles; move legality is
  untouched, so a tile can look empty yet refuse a move. Accepted.
- Name change: dropped entirely. In its place: guests cannot join
  shared invite-code games (user's mid-design pivot).

## Design

### A. Dashboard → "Games" page (no separate concept)

- Landing menu loses the Dashboard item; Play stays and is the way in.
- `/dashboard` keeps working (Exit links, deep-links) but renders the same
  component as `/play`-adjacent flow: header reads "Games", not
  "Dashboard"; no "Dashboard" branding anywhere.
- Routing: add `/games` as the canonical route (alias `/dashboard` → same
  component). Exit links point to `/games`.

### B. Finished games expander

- `game-list` already returns status; split client-side: active statuses
  (`lobby`, `active`) render as today; everything else (`finished`) goes
  under `<details className="finished-games">` with summary
  `Finished games (n)` — hidden entirely when n = 0.
- Delete buttons (hosted test/lobby games) work inside the expander too.
- data-testid: `finished-games-toggle`, `finished-game-<id>`.

### C. AP timer stops on finished games

- `Game.tsx` (both views): when `state.winner` is set, the timer element
  is not rendered and the countdown interval does not run. Test-mode local
  drip: once winner is set, stop `startApDrip` ticks (guard in the
  interval callback; engine's applyEvent on a won game throws anyway —
  catch and stop).
- Banner already shows the winner; no change there.

### D. Guests cannot join invite-code games

- Guests are anonymous GoTrue sessions (`signInAnonymously`, auth.tsx);
  their JWT carries `is_anonymous: true`.
- Server gate in `game-join`: resolve the JWT's `is_anonymous` claim
  (extend `_shared/auth.ts` getPlayer to expose it, or decode in
  game-join) and reject with a clear error before any membership write:
  `register to join shared games` (403). Covers lobby join AND late join.
- Client: guest sessions hide/disable the Join form on the games page and
  the invite deep-link path (`?join=CODE`) redirects guests to register
  first (same message).
- Play.tsx's canonical-game auto-join relies on game-join too — if a
  guest clicks Play, they hit the same gate; Play.tsx should surface the
  register prompt instead of a generic failure.
- NOT a name-change feature (dropped).

### E. Scrubber "View" wrong board (seq collisions)

- Root cause: `viewEvent(seq)` finds events BY SEQ (`history.findIndex(e => e.seq === seq)`).
  After a second rewind to before an earlier rewind's cut, seqs repeat
  across generations; findIndex picks the FIRST (oldest) duplicate and the
  board shows another event's state. Worse: with duplicate seqs present
  the engine's seq-gap check makes replay truncate mid-history (client
  `catch { break }`) and the SERVER's fork rebuild 500s.
- Fix, two layers:
  - Server (`_shared/history.ts`): make fork cuts CUMULATIVE — every
    earlier generation is cut at the latest applicable to_seq so canonical
    history never emits duplicate seqs (redeploy game-get + action).
  - Client: pass the INDEX through the feed. EventFeed's onView/onFork
    work by index; Game.tsx stops converting seq→index. activeSeq
    highlighting becomes activeIndex; feed row keys switch to index.
    onFork still sends a seq to the server (map index→history[index].seq
    at the call site).
- Jury view (log-only, passes null) needs the prop rename only.

### F. Board animations (move slide, bullets, pulse)

Board refactor: tanks become a keyed overlay layer.

- Cell grid stays. Occupants render as `<g class="tank" data-player=ID>`
  positioned via `transform: translate(x*CELL, y*CELL)`, keyed by player
  id (React key = id), so a position change MOVES the element (CSS
  transition on transform animates the slide) instead of remounting it.
- Events-driven animation: Game.tsx passes `lastEvent` (the newest applied
  event, or the event being replayed) to Board. Board derives effects:
  - `move`: transform transition (300ms ease) = the slide.
  - `attack` (seq even animation): red dot (`circle r=5 fill=#e33`) that
    translates from actor cell center to target cell center over ~250ms,
    then a brief victim flash (CSS animation, red outline) — driven by a
    short-lived element with a CSS keyframe; removed on animationend.
  - `give_ap`: same path, green dot (#3c3).
  - `upgrade_range`: expanding dashed circle pulse around the actor.
- Board stays presentational; the animation lifetime is `key={seq}` on an
  effects layer + CSS transitions; no timers in React beyond cleanup.
- Replay integration: replay steps feed `lastEvent` per step, so replay
  shows slides/bullets one event at a time (this is item 8).
- HP bar updates ride along naturally (same re-render).
- Dead tanks: HIDDEN (user's call) — the tank layer skips occupants with
  hp <= 0. Visual only: the engine still treats corpse tiles as blocked,
  so movement legality is unchanged.

### C2. AP timer stops on finished games — mechanics

- DbGameView: gate the timer render AND the countdown effect on
  `state?.winner || detail?.status === 'finished'`.
- Local test game: `daily_tick` bypasses the winner guard in the engine,
  so the drip would keep granting AP forever. Stop it via
  `game.stopApDrip()` from a `state.winner` effect in LocalGameView (the
  drip lives in localGame.ts, started by TestMode.tsx).

### G. Button-styled nav links

- `.link-button` keeps link semantics but gains button styling consistent
  with `.card button` (define a `.btn`-like class reuse). Apply to:
  Dashboard top links (← Home, Profile), Profile's "Back to dashboard",
  Game header's "Exit".

## Non-goals

- Server changes are limited to: the cumulative-cut fix in
  `_shared/history.ts` (redeploy game-get + action) and the guest gate in
  `game-join`. No new event types; no bot changes; no fork semantics
  change beyond cumulative cuts; no name-change feature.

## Testing

- Component tests: Dashboard split (finished hidden in expander; toggle
  reveals), timer stops on winner, guest join gate (client side).
- Board tests: tank keyed by id (element persists across a move), move
  applies transform, attack spawns red bullet element, give_ap green,
  dead tank not rendered.
- History helper tests: cumulative cuts — a fork-to-before-earlier-fork
  produces NO duplicate seqs; regression for existing cases.
- View-by-index regression test: history with duplicate seqs (simulated
  double fork) → View the older event → correct board.
- Engine untouched; live smoke: replay animates, guest join rejected.

export interface FeedEntry {
  seq: number;
  text: string;
  /** optional metadata — read-only views (Jury) pass log-only entries */
  type?: string;
  actorId?: string;
  createdAt?: string;
}

interface EventFeedProps {
  entries: FeedEntry[];
  /** INDEX (in `entries`, 0-based chronological) of the event the board is
      scrubbed to, or null when live. Indices, not seqs: duplicate seqs must
      still highlight exactly one row. */
  activeIndex: number | null;
  live: boolean;
  replaying: boolean;
  /** interactive history controls (recap toolbar + View buttons); read-only
      views (Jury) omit them. Callbacks receive the row's INDEX in `entries`,
      not the display (reversed) position and not the seq. */
  onView?: (index: number) => void;
  onReplay?: () => void;
  onStop?: () => void;
  /** test-mode hosts can rewind the actual game to any event */
  onFork?: (index: number) => void;
  canFork?: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown time' : d.toLocaleString();
}

// The war diary — the single history surface. The FULL event list always
// renders; the board's viewed event is highlighted and the events that come
// after it stay visible but dimmed. Controls (replay / back to live) live in
// the card header; per-event metadata lives in a Details dropdown.
export default function EventFeed({
  entries, activeIndex, live, replaying, onView, onReplay, onStop, onFork, canFork = false,
}: EventFeedProps) {
  // The plan's contract: always the FULL list (this feed is the only history
  // surface — there is no scrubber to reach older events through). Rows keep
  // their chronological index so duplicate seqs stay individually
  // addressable.
  const visible = entries.map((e, i) => ({ e, i })).reverse();
  // replaying implies a scrub position; null (unreachable here) falls back to
  // 1 like the old Math.max floor did
  const replayPosition = activeIndex === null ? 1 : activeIndex + 1;
  const interactive = !!(onView || onReplay || onStop);
  return (
    <>
      {interactive && (
        <div className="feed-toolbar">
          {!live && !replaying && (
            <button type="button" className="link-button" data-testid="back-to-live" onClick={() => onStop?.()}>
              ← Back to live
            </button>
          )}
          {replaying && (
            <>
              <span className="feed-progress">Replaying event {replayPosition} of {entries.length}</span>
              <button type="button" className="link-button" data-testid="stop-replay-btn" onClick={() => onStop?.()}>
                Stop replay
              </button>
            </>
          )}
          {!replaying && onReplay && (
            <button type="button" className="link-button" data-testid="replay-btn" onClick={onReplay}>
              ▶ Replay from here
            </button>
          )}
        </div>
      )}
      <ul className="event-feed" data-testid="event-feed">
        {visible.map(({ e, i }) => {
          const cls = [
            'feed-row',
            i === activeIndex ? 'active' : '',
            !live && activeIndex !== null && i > activeIndex ? 'future' : '',
          ].filter(Boolean).join(' ');
          return (
            <li key={i} className={cls}>
              <div className="feed-main">
                <span className="feed-text">{e.text}</span>
                {onView && (
                  <button
                    type="button"
                    className="link-button feed-view"
                    aria-label={`View state after event ${e.seq}`}
                    onClick={() => onView(i)}
                  >
                    View
                  </button>
                )}
              </div>
              {(e.createdAt || e.type || e.actorId) && (
                <details className="feed-details">
                  <summary>Details</summary>
                  <dl>
                    {e.createdAt && (
                      <>
                        <dt>Time</dt>
                        <dd><time dateTime={e.createdAt}>{formatTime(e.createdAt)}</time></dd>
                      </>
                    )}
                    <dt>Seq</dt>
                    <dd>#{e.seq}</dd>
                    {e.actorId && (<><dt>Actor</dt><dd>{e.actorId}</dd></>)}
                    {e.type && (<><dt>Type</dt><dd>{e.type}</dd></>)}
                  </dl>
                  {canFork && onFork && (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onFork(i)}
                    >
                      Rewind game to here
                    </button>
                  )}
                </details>
              )}
            </li>
          );
        })}
        {visible.length === 0 && <li className="empty">No events yet</li>}
      </ul>
    </>
  );
}

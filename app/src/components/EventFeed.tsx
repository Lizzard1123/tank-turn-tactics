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
  /** seq of the event the board is scrubbed to, or null when live */
  activeSeq: number | null;
  live: boolean;
  replaying: boolean;
  /** interactive history controls (recap toolbar + View buttons); read-only
      views (Jury) omit them */
  onView?: (seq: number) => void;
  onReplay?: () => void;
  onStop?: () => void;
  /** test-mode hosts can rewind the actual game to any event */
  onFork?: (seq: number) => void;
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
  entries, activeSeq, live, replaying, onView, onReplay, onStop, onFork, canFork = false,
}: EventFeedProps) {
  const visible = entries.slice(-50).reverse();
  const activePos = activeSeq === null ? -1 : entries.findIndex((e) => e.seq === activeSeq);
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
              <span className="feed-progress">Replaying event {Math.max(activePos + 1, 1)} of {entries.length}</span>
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
        {visible.map((e) => {
          const cls = [
            'feed-row',
            e.seq === activeSeq ? 'active' : '',
            !live && activeSeq !== null && e.seq > activeSeq ? 'future' : '',
          ].filter(Boolean).join(' ');
          return (
            <li key={e.seq} className={cls}>
              <div className="feed-main">
                <span className="feed-text">{e.text}</span>
                {onView && (
                  <button
                    type="button"
                    className="link-button feed-view"
                    aria-label={`View state after event ${e.seq}`}
                    onClick={() => onView(e.seq)}
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
                      onClick={() => onFork(e.seq)}
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

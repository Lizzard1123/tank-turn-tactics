import type { LogEntry } from '@ttt/engine';

interface EventFeedProps {
  log: readonly LogEntry[];
  // When provided, each entry gets a "View state" button that shows the
  // board as it was right after that event (history scrub / recap).
  onView?: (seq: number) => void;
}

// Latest-first event log.
export default function EventFeed({ log, onView }: EventFeedProps) {
  return (
    <ul className="event-feed" data-testid="event-feed">
      {log.slice(-30).reverse().map((e) => (
        <li key={e.seq} className={onView ? 'feed-row' : undefined}>
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
        </li>
      ))}
      {log.length === 0 && <li className="empty">No events yet</li>}
    </ul>
  );
}

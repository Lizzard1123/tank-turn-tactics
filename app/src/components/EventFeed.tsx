import type { LogEntry } from '@ttt/engine';

interface EventFeedProps {
  log: readonly LogEntry[];
}

// Latest-first event log.
export default function EventFeed({ log }: EventFeedProps) {
  return (
    <ul className="event-feed" data-testid="event-feed">
      {log.slice(-30).reverse().map((e) => (
        <li key={e.seq}>{e.text}</li>
      ))}
      {log.length === 0 && <li className="empty">No events yet</li>}
    </ul>
  );
}

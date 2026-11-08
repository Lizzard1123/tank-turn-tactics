interface EventFeedProps {
  log: readonly string[];
}

// Latest-first event log.
export default function EventFeed({ log }: EventFeedProps) {
  return (
    <ul className="event-feed" data-testid="event-feed">
      {log.slice(-30).reverse().map((line, i) => (
        <li key={`${log.length - i}-${line}`}>{line}</li>
      ))}
      {log.length === 0 && <li className="empty">No events yet</li>}
    </ul>
  );
}

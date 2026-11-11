// Shared loading / error screens in the field-operations design system —
// stamped cards instead of bare text on the page background.
// - Loading / ErrorScreen: full-page wrappers (route-level states)
// - LoadingBlock / ErrorBlock: in-flow blocks for pages that render
//   surrounding chrome (nav actions, back links) around the state

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="status-screen" role="status" aria-live="polite" data-testid="loading-screen">
      <div className="status-spinner" aria-hidden="true" />
      <p className="status-label">{label}</p>
    </div>
  );
}

export function ErrorBlock({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="status-screen status-error" role="alert" data-testid="error-screen">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true" className="status-mark">
        <circle cx="17" cy="17" r="14" fill="none" stroke="currentColor" strokeWidth="3" />
        <line x1="11" y1="11" x2="23" y2="23" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <line x1="23" y1="11" x2="11" y2="23" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <p className="status-label">{message}</p>
      {hint && <p className="status-hint">{hint}</p>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <main className="page">
      <LoadingBlock label={label} />
    </main>
  );
}

export function ErrorScreen({ message, hint }: { message: string; hint?: string }) {
  return (
    <main className="page">
      <ErrorBlock message={message} hint={hint} />
    </main>
  );
}

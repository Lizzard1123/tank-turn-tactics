import { useState } from 'react';

// Live battle log, collapsed by default so the game page fits on a phone
// screen without scrolling. Only final blows and revives appear (the caller
// filters). The WHOLE card is the toggle — title click condenses it up/down;
// there is no nested button inside.
export default function BattleLog({ lines }: { lines: { seq: number; text: string; kind: string }[] }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);
  return (
    <section
      className={`card battle-card${open ? ' battle-open' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label="Battle log"
      data-testid="battle-log"
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <div className="battle-head">
        <h2>Battle log</h2>
        <span className="battle-chevron" data-testid="battle-chevron">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <ul className="battle-log">
          {lines.map((l) => (
            <li key={l.seq} className={`battle-line kind-${l.kind}`}>{l.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BattleLog from './BattleLog';

const LINES = [
  { seq: 2, text: 'me dealt the final blow to foe', kind: 'kill' },
  { seq: 1, text: 'me revived foe with a heart!', kind: 'revive' },
];

// The WHOLE card is the toggle — title click condenses it up/down. No
// nested button exists inside the card.
describe('BattleLog', () => {
  test('renders only the header when closed (default)', () => {
    render(<BattleLog lines={LINES} />);
    expect(screen.getByTestId('battle-log')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.getByTestId('battle-log')).toHaveAttribute('aria-expanded', 'false');
  });

  test('clicking anywhere on the card opens the log; chevron flips', () => {
    render(<BattleLog lines={LINES} />);
    expect(screen.getByTestId('battle-chevron')).toHaveTextContent('▸');
    fireEvent.click(screen.getByTestId('battle-log'));
    expect(screen.getByTestId('battle-chevron')).toHaveTextContent('▾');
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['me dealt the final blow to foe', 'me revived foe with a heart!']);
  });

  test('no nested button: the card is the single interactive element', () => {
    render(<BattleLog lines={LINES} />);
    expect(screen.getByTestId('battle-log').querySelectorAll('button')).toHaveLength(0);
    expect(screen.getByTestId('battle-log')).toHaveAttribute('role', 'button');
    expect(screen.getByTestId('battle-log')).toHaveAttribute('tabindex', '0');
  });

  test('keyboard activation toggles too (Enter)', () => {
    render(<BattleLog lines={LINES} />);
    fireEvent.keyDown(screen.getByTestId('battle-log'), { key: 'Enter' });
    expect(screen.getByTestId('battle-chevron')).toHaveTextContent('▾');
    fireEvent.keyDown(screen.getByTestId('battle-log'), { key: 'Escape' });
    expect(screen.getByTestId('battle-chevron')).toHaveTextContent('▾'); // not a toggle key
  });

  test('second click closes the log again', () => {
    render(<BattleLog lines={LINES} />);
    fireEvent.click(screen.getByTestId('battle-log'));
    fireEvent.click(screen.getByTestId('battle-log'));
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});

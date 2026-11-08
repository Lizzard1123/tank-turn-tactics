import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventFeed from './EventFeed';

const log = [
  { seq: 1, text: 'Alpha moved east.' },
  { seq: 2, text: 'Bravo attacked Alpha.' },
  { seq: 3, text: 'Charlie joined the Jury.' },
];

describe('EventFeed', () => {
  test('renders entries newest-first', () => {
    render(<EventFeed log={log} />);
    const items = screen.getAllByRole('listitem').filter((li) => !li.className.includes('empty'));
    expect(items.map((li) => li.textContent)).toEqual([log[2].text, log[1].text, log[0].text]);
  });

  test('no view buttons without onView', () => {
    render(<EventFeed log={log} />);
    expect(screen.queryByRole('button', { name: /^view state$/i })).not.toBeInTheDocument();
  });

  test('view button per entry calls onView with its seq', async () => {
    const onView = vi.fn();
    const user = userEvent.setup();
    render(<EventFeed log={log} onView={onView} />);
    const buttons = screen.getAllByRole('button', { name: /view state after event/i });
    expect(buttons.length).toBe(3);
    // newest entry (seq 3) is the first row
    await user.click(buttons[0]);
    expect(onView).toHaveBeenCalledWith(3);
  });
});

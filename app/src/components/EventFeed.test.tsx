import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventFeed, { type FeedEntry } from './EventFeed';

const entries: FeedEntry[] = [
  { seq: 1, type: 'move', actorId: 'a', createdAt: '2026-11-08T10:00:00Z', text: 'Alpha moved east.' },
  { seq: 2, type: 'attack', actorId: 'b', createdAt: '2026-11-08T10:01:00Z', text: 'Bravo attacked Alpha.' },
  { seq: 3, type: 'jury_vote', actorId: 'c', createdAt: '2026-11-08T10:02:00Z', text: 'Charlie joined the Jury.' },
];

function base(overrides: Partial<Parameters<typeof EventFeed>[0]> = {}) {
  return {
    entries, activeIndex: null, live: true,
    onView: vi.fn(), onReplay: vi.fn(), onStop: vi.fn(), replaying: false,
    ...overrides,
  };
}

describe('EventFeed', () => {
  test('renders the FULL entry list newest-first, with timestamps in a Details dropdown', () => {
    render(<EventFeed {...base()} />);
    const items = screen.getAllByRole('listitem').filter((li) => !li.className.includes('empty'));
    const texts = items.map((li) => li.querySelector('.feed-text')?.textContent);
    expect(texts).toEqual([entries[2].text, entries[1].text, entries[0].text]);
    // every entry carries its timestamp as a machine-readable <time>
    for (const e of entries) {
      expect(document.querySelector(`time[datetime="${e.createdAt}"]`)).not.toBeNull();
    }
  });

  test('while scrubbed the later events stay visible (dimmed) and the viewed event is highlighted', () => {
    render(<EventFeed {...base({ activeIndex: 1, live: false })} />); // seq 2 = index 1
    const items = screen.getAllByRole('listitem').filter((li) => !li.className.includes('empty'));
    expect(items[0].className).toContain('future'); // seq 3 is after the viewed event
    expect(items[1].className).toContain('active'); // seq 2 is the viewed event
    expect(items[2].className).not.toContain('active');
  });

  test('toolbar: live offers Replay from here; scrubbed offers Back to live', async () => {
    const user = userEvent.setup();
    const onReplay = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(<EventFeed {...base({ onReplay, onStop })} />);
    expect(screen.getByTestId('replay-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('back-to-live')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('replay-btn'));
    expect(onReplay).toHaveBeenCalled();

    rerender(<EventFeed {...base({ activeIndex: 0, live: false, onReplay, onStop })} />);
    expect(screen.getByTestId('back-to-live')).toBeInTheDocument();
    await user.click(screen.getByTestId('back-to-live'));
    expect(onStop).toHaveBeenCalled();
  });

  test('while replaying, Stop replay replaces the replay button', () => {
    render(<EventFeed {...base({ activeIndex: 0, live: false, replaying: true })} />);
    expect(screen.getByTestId('stop-replay-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('replay-btn')).not.toBeInTheDocument();
  });

  test('no rewind control (fork removed — both modes behave the same)', () => {
    render(<EventFeed {...base({})} />);
    expect(screen.queryAllByRole('button', { name: /rewind/i })).toHaveLength(0);
  });

  test('view button per entry calls onView with its index', async () => {
    const onView = vi.fn();
    const user = userEvent.setup();
    render(<EventFeed {...base({ onView })} />);
    const buttons = screen.getAllByRole('button', { name: /view state after event/i });
    expect(buttons.length).toBe(3);
    await user.click(buttons[0]); // newest entry (seq 3, index 2)
    expect(onView).toHaveBeenCalledWith(2);
  });
});

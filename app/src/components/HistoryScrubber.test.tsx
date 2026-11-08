import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HistoryScrubber from './HistoryScrubber';

const events = [
  { seq: 1, type: 'move' as const, actorId: 'me', createdAt: '', payload: {} },
  { seq: 2, type: 'attack' as const, actorId: 'me', createdAt: '', payload: {} },
];

function renderScrubber(overrides: Partial<Parameters<typeof HistoryScrubber>[0]> = {}) {
  const props = {
    events,
    canFork: false,
    onFork: vi.fn(),
    onExit: vi.fn(),
    onScrub: vi.fn(),
    position: 0,
    ...overrides,
  };
  render(<HistoryScrubber {...props} />);
  return props;
}

describe('HistoryScrubber', () => {
  test('slider position and readout follow the position prop (parent-controlled)', () => {
    renderScrubber({ position: 1 });
    const slider = screen.getByRole('slider', { name: /history position/i }) as HTMLInputElement;
    expect(slider.value).toBe('1');
    expect(screen.getByText(/replaying event 1 of 2/i)).toBeInTheDocument();
  });

  test('renders replay button when onReplay given', async () => {
    const props = renderScrubber({ onReplay: vi.fn() });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /replay from here/i }));
    expect(props.onReplay).toHaveBeenCalled();
  });

  test('while replaying, button becomes Stop and calls onStop', async () => {
    const props = renderScrubber({ onReplay: vi.fn(), replaying: true, onStop: vi.fn() });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /stop replay/i }));
    expect(props.onStop).toHaveBeenCalled();
  });

  test('no replay button when onReplay absent (existing behavior)', () => {
    renderScrubber();
    expect(screen.queryByRole('button', { name: /replay/i })).not.toBeInTheDocument();
  });
});

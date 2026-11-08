import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HistoryScrubber from './HistoryScrubber';
import type { GameEvent } from '@ttt/engine';

const EVENTS: GameEvent[] = [
  { seq: 1, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 1, y: 0 } } },
  { seq: 2, type: 'move', actorId: 'p2', createdAt: 't', payload: { to: { x: 4, y: 0 } } },
  { seq: 3, type: 'move', actorId: 'p1', createdAt: 't', payload: { to: { x: 2, y: 0 } } },
];

describe('HistoryScrubber', () => {
  test('slider goes from 0 to events.length and reports seq on change', () => {
    const onScrub = vi.fn();
    render(<HistoryScrubber events={EVENTS} canFork onFork={() => {}} onExit={() => {}} onScrub={onScrub} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe(String(EVENTS.length));
    fireEvent.change(slider, { target: { value: '2' } });
    expect(onScrub).toHaveBeenCalledWith(2);
  });

  test('shows current scrub position', () => {
    render(<HistoryScrubber events={EVENTS} canFork onFork={() => {}} onExit={() => {}} onScrub={() => {}} />);
    expect(screen.getByText(/replaying/i)).toBeInTheDocument();
  });

  test('rewind button calls onFork with slider value, hidden without canFork', () => {
    const onFork = vi.fn();
    render(<HistoryScrubber events={EVENTS} canFork onFork={onFork} onExit={() => {}} onScrub={() => {}} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /rewind/i }));
    expect(onFork).toHaveBeenCalledWith(1);
  });

  test('exit button calls onExit', () => {
    const onExit = vi.fn();
    render(<HistoryScrubber events={EVENTS} canFork={false} onFork={() => {}} onExit={onExit} onScrub={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /back to live/i }));
    expect(onExit).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /rewind/i })).not.toBeInTheDocument();
  });
});

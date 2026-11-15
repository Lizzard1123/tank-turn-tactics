import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from './ConfirmDialog';

describe('ConfirmDialog', () => {
  test('renders nothing when action is null', () => {
    render(<ConfirmDialog action={null} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByTestId('confirm-overlay')).not.toBeInTheDocument();
  });

  test('shows CONFIRM title and the semantic action subtext', () => {
    render(<ConfirmDialog action="move up" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId('confirm-title')).toHaveTextContent('CONFIRM');
    expect(screen.getByTestId('confirm-message')).toHaveTextContent('move up');
  });

  test('Yes calls onConfirm, No calls onCancel', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog action="attack foe" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('confirm-yes'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('confirm-no'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('clicking the overlay backdrop cancels; clicks inside the dialog do not', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog action="give AP to foe" onConfirm={onConfirm} onCancel={onCancel} />);
    // click inside the dialog body (the title element) — no cancel
    fireEvent.click(screen.getByTestId('confirm-title'));
    expect(onCancel).not.toHaveBeenCalled();
    // click the backdrop (the overlay, outside the dialog) — cancels
    fireEvent.click(screen.getByTestId('confirm-overlay'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

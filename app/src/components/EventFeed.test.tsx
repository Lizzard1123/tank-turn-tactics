import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EventFeed from './EventFeed';

describe('EventFeed', () => {
  test('renders latest-first', () => {
    render(<EventFeed log={[{ seq: 1, text: 'a moved' }, { seq: 2, text: 'b attacked' }]} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('b attacked');
    expect(items[1]).toHaveTextContent('a moved');
  });

  test('empty log shows placeholder', () => {
    render(<EventFeed log={[]} />);
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
  });
});

import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from './Landing';

test('renders three menu items', () => {
  render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(screen.getByTestId('btn-play')).toHaveTextContent('Play');
  expect(screen.getByTestId('btn-instructions')).toHaveTextContent('Instructions');
  expect(screen.getByTestId('btn-test')).toHaveTextContent('Test Mode');
});

import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Instructions from './Instructions';

describe('Instructions', () => {
  test('shows rules sections and back link', () => {
    render(<MemoryRouter><Instructions /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /stats/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /actions/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /the jury/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back/i })).toBeInTheDocument();
  });
});

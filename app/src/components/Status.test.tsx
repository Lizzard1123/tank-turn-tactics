import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingBlock, ErrorBlock, Loading, ErrorScreen } from './Status';

describe('LoadingBlock', () => {
  it('renders with default label', () => {
    render(<LoadingBlock />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders with custom label', () => {
    render(<LoadingBlock label="Connecting…" />);
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });

  it('has role status', () => {
    const { container } = render(<LoadingBlock />);
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('has aria-live polite', () => {
    const { container } = render(<LoadingBlock />);
    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });
});

describe('ErrorBlock', () => {
  it('renders error message', () => {
    render(<ErrorBlock message="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders optional hint', () => {
    render(<ErrorBlock message="Error" hint="Try refreshing" />);
    expect(screen.getByText('Try refreshing')).toBeInTheDocument();
  });

  it('does not render hint when absent', () => {
    render(<ErrorBlock message="Error" />);
    expect(screen.queryByText('Try refreshing')).not.toBeInTheDocument();
  });

  it('has role alert', () => {
    const { container } = render(<ErrorBlock message="Error" />);
    expect(container.querySelector('[role="alert"]')).toBeInTheDocument();
  });

  it('has error screen class', () => {
    const { container } = render(<ErrorBlock message="Error" />);
    expect(container.querySelector('.status-error')).toBeInTheDocument();
  });
});

describe('Loading', () => {
  it('renders main page wrapper', () => {
    const { container } = render(<Loading />);
    expect(container.querySelector('main')).toBeInTheDocument();
  });

  it('renders loading block', () => {
    render(<Loading />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
  });
});

describe('ErrorScreen', () => {
  it('renders main page wrapper', () => {
    const { container } = render(<ErrorScreen message="Error" />);
    expect(container.querySelector('main')).toBeInTheDocument();
  });

  it('renders error block', () => {
    render(<ErrorScreen message="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('passes hint to error block', () => {
    render(<ErrorScreen message="Error" hint="Try again" />);
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });
});

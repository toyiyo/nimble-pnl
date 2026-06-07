import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';

function Boom(): JSX.Element {
  throw new Error('chunk load failed');
}

describe('RouteErrorBoundary', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('renders children when there is no error', () => {
    render(<RouteErrorBoundary><div>safe child</div></RouteErrorBoundary>);
    expect(screen.getByText('safe child')).toBeInTheDocument();
  });

  it('shows a recoverable alert and calls onReload when the child throws', () => {
    const onReload = vi.fn();
    render(
      <RouteErrorBoundary onReload={onReload}>
        <Boom />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reload page/i }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

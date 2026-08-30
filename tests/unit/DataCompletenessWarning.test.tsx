import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DataCompletenessWarning } from '@/components/DataCompletenessWarning';

describe('DataCompletenessWarning', () => {
  it('renders the message in a status panel', () => {
    // <output> carries the implicit "status" role; getByRole resolves it.
    const { getByRole } = render(
      <DataCompletenessWarning message="Some rows hit the fetch limit." />
    );
    const panel = getByRole('status');
    expect(panel.textContent).toContain('Some rows hit the fetch limit.');
  });

  it('hides the icon from screen readers', () => {
    const { container } = render(
      <DataCompletenessWarning message="Some rows hit the fetch limit." />
    );
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders nothing for an empty message', () => {
    const { container } = render(<DataCompletenessWarning message="" />);
    expect(container.firstChild).toBeNull();
  });
});

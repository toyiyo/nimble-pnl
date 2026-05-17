import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { BulkActionBar } from '@/components/bulk-edit/BulkActionBar';

describe('BulkActionBar — mobile clearance', () => {
  it('sits above the MobileTabBar on mobile (bottom-20), reverts at sm+', () => {
    const { container } = render(
      <BulkActionBar
        selectedCount={3}
        onClose={() => {}}
        actions={[{ label: 'Delete', onClick: () => {} }]}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/\bbottom-20\b/);
    expect(root.className).toMatch(/\bsm:bottom-6\b/);
  });

  it('uses tighter padding on mobile, normal at sm+', () => {
    const { container } = render(
      <BulkActionBar
        selectedCount={3}
        onClose={() => {}}
        actions={[{ label: 'Delete', onClick: () => {} }]}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/\bpx-4\b/);
    expect(root.className).toMatch(/\bpy-3\b/);
    expect(root.className).toMatch(/\bsm:px-6\b/);
    expect(root.className).toMatch(/\bsm:py-4\b/);
  });

  it('hides the vertical divider on mobile', () => {
    const { container } = render(
      <BulkActionBar
        selectedCount={3}
        onClose={() => {}}
        actions={[{ label: 'Delete', onClick: () => {} }]}
      />,
    );
    const divider = container.querySelector('.bg-border.flex-shrink-0');
    expect(divider).not.toBeNull();
    expect(divider?.className).toMatch(/\bhidden\b/);
    expect(divider?.className).toMatch(/\bsm:block\b/);
  });
});

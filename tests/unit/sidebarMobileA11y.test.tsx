/**
 * Regression test for a Radix "DialogContent requires a DialogTitle" console
 * error on mobile: the sidebar's mobile Sheet (which renders a Radix Dialog
 * under the hood) had no title/description, so screen readers announced it
 * with no accessible name and Radix warned in the console.
 *
 * Mounts SidebarProvider + Sidebar with useIsMobile forced to true, opens the
 * mobile sheet via setOpenMobile(true), and asserts the resulting dialog has
 * both an accessible name (SheetTitle) and an accessible description
 * (SheetDescription) — the fix adds both, and Radix warns if either is
 * missing, so the guard must fail if either is removed later.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar, SidebarProvider, useSidebar } from '@/components/ui/sidebar';

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => true,
}));

function OpenMobileSidebarOnMount() {
  const { setOpenMobile } = useSidebar();

  React.useEffect(() => {
    setOpenMobile(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

describe('mobile sidebar accessibility', () => {
  it('gives the mobile sheet dialog an accessible name and description', () => {
    render(
      <SidebarProvider>
        <OpenMobileSidebarOnMount />
        <Sidebar>
          <div>Sidebar content</div>
        </Sidebar>
      </SidebarProvider>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName(/navigation/i);
    expect(dialog).toHaveAccessibleDescription(/navigation/i);
  });
});

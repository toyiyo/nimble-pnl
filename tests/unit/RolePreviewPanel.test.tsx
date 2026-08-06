import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RolePreviewPanel } from '../../src/components/roles/RolePreviewPanel';
import type { AreaKey, AreaLevel } from '../../src/lib/permissions/areas';

/**
 * Phase 4 task 9e (roles-and-areas plan, 2026-07-29): RolePreviewPanel.tsx —
 * the sticky "What they'll see" preview column, extracted out of
 * RoleEditor.tsx (task 9d) into its own component per the plan's file list
 * ("`src/components/roles/RolePreviewPanel.tsx` (new) — sticky preview: prose
 * summary including the 'can't' half, the rendered sidebar with
 * struck-through unreachable items / `READ ONLY` / `OPENS HERE`, and the
 * grant counter.").
 *
 * This file tests only the *rendering* of `buildRolePreview`'s output
 * (`src/lib/permissions/preview.ts`, task 9b) — the derivation itself
 * (prose wording, nav grouping, landing-item selection) is already
 * exhaustively unit tested in `tests/unit/preview.test.ts` and is not
 * re-tested here. The Weekend Supervisor grants fixture below is the same
 * one that file and the design doc's own worked example use, so the exact
 * sentence asserted here is not invented.
 */

describe('RolePreviewPanel', () => {
  it('renders the "no areas yet" summary when nothing is granted', () => {
    render(<RolePreviewPanel grants={{}} flags={[]} />);
    expect(screen.getByText(/no areas yet/i)).toBeInTheDocument();
    expect(screen.getByText(/sign in and see nothing/i)).toBeInTheDocument();
  });

  it('renders the prose summary, including the per-group "can\'t fully reach" half', () => {
    // Post menu-mirror re-cut (Task 5 Step 2): the "can" half reads each
    // granted row's own hint/manageHint off AREA_DEFINITIONS (no more PHRASE
    // map), and the "can't" half is a per-sidebar-group page count instead
    // of the four retired bundle categories.
    const grants: Partial<Record<AreaKey, AreaLevel>> = {
      reports: 'view',
      sales: 'view',
      scheduling: 'manage',
      employees: 'view',
    };
    render(<RolePreviewPanel grants={grants} flags={[]} roleName="Weekend Supervisor" />);
    expect(
      screen.getByText(
        "Weekend Supervisor can Ticket-level sales from your POS; publish and edit schedules; " +
          "Saved reports and P&L trends; and Roster, jobs, wage assignments. " +
          "Can't fully reach Main: 1 of 6 pages, Operations: 1 of 5 pages, Inventory: 1 of 6 pages, " +
          "Accounting: 0 of 12 pages, Admin: 1 of 4 pages, or costs and margins."
      )
    ).toBeInTheDocument();
  });

  it('defaults the role name to "This role" when none is given', () => {
    render(<RolePreviewPanel grants={{ payroll: 'view' }} flags={[]} />);
    expect(screen.getByText(/^This role can/)).toBeInTheDocument();
  });

  it('shows the grant counter as "0 granted" with no grants and updates when areas are granted', () => {
    const { rerender } = render(<RolePreviewPanel grants={{}} flags={[]} />);
    expect(screen.getByText(/^0 granted$/i)).toBeInTheDocument();

    rerender(<RolePreviewPanel grants={{ inventory: 'manage' }} flags={[]} />);
    const counter = screen.getByText(/^\d+\s+granted$/i);
    expect(counter).not.toHaveTextContent(/^0 granted$/i);
  });

  it('omits pages the role cannot reach, rather than decorating them', () => {
    render(<RolePreviewPanel grants={{ invoices: 'manage' }} flags={[]} flavor="platform" />);

    expect(screen.getByText('Invoices')).toBeInTheDocument();
    // Banking rode in the same `books` bundle before the re-cut.
    expect(screen.queryByText('Banks')).not.toBeInTheDocument();
  });

  it('groups the preview by sidebar group, not by the retired bands', () => {
    render(<RolePreviewPanel grants={{ invoices: 'manage', tips: 'view' }} flags={[]} flavor="platform" />);

    expect(screen.getByText('Accounting')).toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.queryByText('Money & Books')).not.toBeInTheDocument();
  });

  it('marks a view-level area READ ONLY and does not mark a manage-level area READ ONLY', () => {
    const { rerender } = render(<RolePreviewPanel grants={{ inventory: 'view' }} flags={[]} />);
    expect(screen.getByText(/read only/i)).toBeInTheDocument();

    rerender(<RolePreviewPanel grants={{ inventory: 'manage' }} flags={[]} />);
    expect(screen.queryByText(/read only/i)).not.toBeInTheDocument();
  });

  it('marks the single highest-priority granted area OPENS HERE', () => {
    // AREA_PRIORITY (areas.ts): inventory outranks scheduling.
    render(<RolePreviewPanel grants={{ scheduling: 'view', inventory: 'manage' }} flags={[]} />);
    expect(screen.getByText(/opens here/i)).toBeInTheDocument();
  });

  it('renders inside a sticky aside so it stays in view alongside a long form', () => {
    const { container } = render(<RolePreviewPanel grants={{}} flags={[]} />);
    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    expect(aside).toHaveClass('lg:sticky');
  });
});

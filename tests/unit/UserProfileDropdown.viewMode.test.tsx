/**
 * UserProfileDropdown view-mode wiring (Phase 4 task 10):
 *  `<ViewModeSwitch />` is mounted at the top of the dropdown content — the
 *  desktop entry point (design doc: "Insert `<ViewModeSwitch />` at top of
 *  the dropdown (desktop entry point — matches prototype)").
 *
 * See docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { UserProfileDropdown } from '@/components/UserProfileDropdown';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  viewMode: 'admin' as 'admin' | 'work',
  canUseWorkView: true,
  enterWorkMode: vi.fn(),
  exitWorkMode: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'owner@example.com' },
    signOut: vi.fn(),
  }),
}));

vi.mock('@/contexts/ViewModeContext', () => ({
  useViewMode: () => ({
    viewMode: mocks.viewMode,
    canUseWorkView: mocks.canUseWorkView,
    enterWorkMode: mocks.enterWorkMode,
    exitWorkMode: mocks.exitWorkMode,
  }),
}));

function renderDropdown() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <UserProfileDropdown />
    </MemoryRouter>,
  );
}

describe('UserProfileDropdown – view-mode wiring', () => {
  beforeEach(() => {
    mocks.viewMode = 'admin';
    mocks.canUseWorkView = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders ViewModeSwitch at the top of the dropdown content when eligible', async () => {
    const user = userEvent.setup();
    renderDropdown();

    await user.click(screen.getByRole('button', { name: /owner/i }));

    const group = screen.getByRole('group', { name: /view mode/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^admin$/i, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /my work/i })).toBeInTheDocument();

    // Persona card sits directly under the account header (email line), and
    // above the Settings/Team/Sign Out items — "top of content" per the
    // design doc's mock-exact layout section.
    const menu = screen.getByRole('menu');
    const allNodes = Array.from(menu.querySelectorAll('*'));
    const groupIndex = allNodes.indexOf(group);
    const emailIndex = allNodes.indexOf(screen.getByText('owner@example.com'));
    const settingsIndex = allNodes.indexOf(screen.getByText('Settings'));
    expect(groupIndex).toBeGreaterThan(emailIndex);
    expect(groupIndex).toBeLessThan(settingsIndex);
  });

  it('omits ViewModeSwitch entirely when ineligible', async () => {
    mocks.canUseWorkView = false;
    const user = userEvent.setup();
    renderDropdown();

    await user.click(screen.getByRole('button', { name: /owner/i }));

    expect(screen.queryByRole('group', { name: /view mode/i })).not.toBeInTheDocument();
  });

  it('leaves no stray empty wrapper element when ineligible', async () => {
    // ViewModeSwitch itself renders null when ineligible. The dropdown must
    // not keep a leftover wrapper `<div>` (e.g. one still carrying padding)
    // around that empty render — it should contribute nothing to the DOM.
    mocks.canUseWorkView = false;
    const user = userEvent.setup();
    renderDropdown();

    await user.click(screen.getByRole('button', { name: /owner/i }));

    const menu = screen.getByRole('menu');
    // `role="separator"` divs are deliberate structural elements (rendered
    // by `DropdownMenuSeparator`) and are legitimately empty — exclude
    // those, we only care about a purposeless leftover wrapper `<div>`.
    const emptyDivs = Array.from(menu.querySelectorAll('div')).filter(
      (el) =>
        el.childElementCount === 0 &&
        el.textContent === '' &&
        el.getAttribute('role') !== 'separator'
    );
    expect(emptyDivs).toHaveLength(0);
  });

  it('clicking "My Work" in the dropdown calls enterWorkMode', async () => {
    const user = userEvent.setup();
    renderDropdown();

    await user.click(screen.getByRole('button', { name: /owner/i }));
    await user.click(screen.getByRole('button', { name: /my work/i }));

    expect(mocks.enterWorkMode).toHaveBeenCalledTimes(1);
  });
});

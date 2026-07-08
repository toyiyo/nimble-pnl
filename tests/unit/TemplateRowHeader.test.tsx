import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { TemplateRowHeader } from '@/components/scheduling/ShiftPlanner/TemplateRowHeader';
import type { ShiftTemplate } from '@/types/scheduling';

const baseTemplate: ShiftTemplate = {
  id: 'tmpl-1',
  restaurant_id: 'rest-1',
  name: 'Morning Line',
  days: [1, 2, 3, 4, 5],
  start_time: '08:00',
  end_time: '16:00',
  break_duration: 30,
  position: 'Cook',
  capacity: 1,
  area: 'Kitchen',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const hiddenTemplate: ShiftTemplate = {
  ...baseTemplate,
  id: 'tmpl-2',
  is_active: false,
  updated_at: '2026-01-02T00:00:00Z',
};

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Actions for/i }));
}

describe('TemplateRowHeader', () => {
  describe('active template menu', () => {
    it('renders "Hide template" (not Delete) with a "keeps shifts" hint', async () => {
      const user = userEvent.setup();
      render(
        <TemplateRowHeader
          template={baseTemplate}
          onEdit={vi.fn()}
          onHide={vi.fn()}
          onRestore={vi.fn()}
        />
      );
      await openMenu(user);

      expect(screen.getByRole('menuitem', { name: /Hide template/i })).toBeInTheDocument();
      expect(screen.getByText('keeps shifts')).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /^Delete$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /Restore template/i })).not.toBeInTheDocument();
    });

    it('calls onHide with the full template when "Hide template" is clicked', async () => {
      const user = userEvent.setup();
      const onHide = vi.fn();
      render(
        <TemplateRowHeader
          template={baseTemplate}
          onEdit={vi.fn()}
          onHide={onHide}
          onRestore={vi.fn()}
        />
      );
      await openMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /Hide template/i }));

      expect(onHide).toHaveBeenCalledTimes(1);
      expect(onHide).toHaveBeenCalledWith(baseTemplate);
    });

    it('calls onEdit with the template when Edit is clicked', async () => {
      const user = userEvent.setup();
      const onEdit = vi.fn();
      render(
        <TemplateRowHeader
          template={baseTemplate}
          onEdit={onEdit}
          onHide={vi.fn()}
          onRestore={vi.fn()}
        />
      );
      await openMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /^Edit$/i }));

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit).toHaveBeenCalledWith(baseTemplate);
    });

    it('does not render a "Hidden" badge for an active template', () => {
      render(
        <TemplateRowHeader
          template={baseTemplate}
          onEdit={vi.fn()}
          onHide={vi.fn()}
          onRestore={vi.fn()}
        />
      );
      expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    });
  });

  describe('hidden (ghost) template menu', () => {
    it('renders "Restore template" instead of "Hide template"/"Delete"', async () => {
      const user = userEvent.setup();
      render(
        <TemplateRowHeader
          template={hiddenTemplate}
          onEdit={vi.fn()}
          onHide={vi.fn()}
          onRestore={vi.fn()}
        />
      );
      await openMenu(user);

      expect(screen.getByRole('menuitem', { name: /Restore template/i })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /Hide template/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /^Delete$/i })).not.toBeInTheDocument();
    });

    it('calls onRestore with the template id when "Restore template" is clicked', async () => {
      const user = userEvent.setup();
      const onRestore = vi.fn();
      render(
        <TemplateRowHeader
          template={hiddenTemplate}
          onEdit={vi.fn()}
          onHide={vi.fn()}
          onRestore={onRestore}
        />
      );
      await openMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /Restore template/i }));

      expect(onRestore).toHaveBeenCalledTimes(1);
      expect(onRestore).toHaveBeenCalledWith(hiddenTemplate.id);
    });

    it('renders a "Hidden" badge (desktop) with an aria-hidden icon', () => {
      render(
        <TemplateRowHeader
          template={hiddenTemplate}
          onEdit={vi.fn()}
          onHide={vi.fn()}
          onRestore={vi.fn()}
        />
      );
      // Desktop and mobile badges both render in jsdom (Tailwind responsive
      // classes aren't evaluated), so there are two "Hidden" nodes; the
      // desktop one (with the icon) must carry an aria-hidden icon sibling.
      const badges = screen.getAllByText('Hidden');
      expect(badges.length).toBeGreaterThanOrEqual(1);
      const badgeWithIcon = badges.find((el) => el.parentElement?.querySelector('svg'));
      expect(badgeWithIcon).toBeDefined();
      const icon = badgeWithIcon!.parentElement!.querySelector('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('memo comparator', () => {
    it('treats is_active flip as a required re-render even if updated_at is identical', () => {
      // Regression guard for the design-doc requirement: the memo comparator
      // must include is_active because Undo/restore round-trips can race
      // the updated_at timestamp.
      const sameTimestamp = '2026-01-05T00:00:00Z';
      const active = { ...baseTemplate, updated_at: sameTimestamp, is_active: true };
      const hidden = { ...baseTemplate, updated_at: sameTimestamp, is_active: false };

      const { rerender } = render(
        <TemplateRowHeader template={active} onEdit={vi.fn()} onHide={vi.fn()} onRestore={vi.fn()} />
      );
      expect(screen.queryByText('Hidden')).not.toBeInTheDocument();

      rerender(
        <TemplateRowHeader template={hidden} onEdit={vi.fn()} onHide={vi.fn()} onRestore={vi.fn()} />
      );
      expect(screen.getAllByText('Hidden').length).toBeGreaterThanOrEqual(1);
    });
  });
});

/**
 * "Today" column highlight for DroppableDayCell.
 *
 * Design: docs/superpowers/specs/2026-07-19-schedule-calendar-readability-design.md
 * §1 "Today" highlight (desktop grid) — body column raises the tint to
 * `bg-primary/[0.06]` and brackets the column with inset ±1px
 * `hsl(var(--primary)/.28)` left/right hairlines so the today column reads as
 * one continuous vertical band from header to last row.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { DroppableDayCell } from '@/components/scheduling/DroppableDayCell';

const renderCell = (isToday: boolean) => {
  const { container } = render(
    <DndContext>
      <table>
        <tbody>
          <tr>
            <DroppableDayCell employeeId="e1" day="2026-07-19" isToday={isToday} isHighlighted={false}>
              <div>shift</div>
            </DroppableDayCell>
          </tr>
        </tbody>
      </table>
    </DndContext>
  );
  return container.querySelector('td')!;
};

describe('DroppableDayCell today highlight', () => {
  it('applies the raised bg-primary/[0.06] tint on the today column', () => {
    const td = renderCell(true);
    expect(td).toHaveClass('bg-primary/[0.06]');
  });

  it('brackets the today column with inset primary/.28 side hairlines', () => {
    const td = renderCell(true);
    expect(td).toHaveClass('shadow-[inset_1px_0_0_hsl(var(--primary)/0.28),inset_-1px_0_0_hsl(var(--primary)/0.28)]');
  });

  it('does not apply the old flat bg-primary/5 tint for today (superseded by the raised tint)', () => {
    const td = renderCell(true);
    expect(td.className).not.toMatch(/(?:^|\s)bg-primary\/5(?:\s|$)/);
  });

  it('stays position:relative so abspos/sr-only descendants remain clipped (PR #585 guard)', () => {
    const td = renderCell(true);
    expect(td).toHaveClass('relative');
  });

  it('applies none of the today classes on non-today cells', () => {
    const td = renderCell(false);
    expect(td).not.toHaveClass('bg-primary/[0.06]');
    expect(td.className).not.toMatch(/shadow-\[inset_1px_0_0_hsl\(var\(--primary\)/);
  });
});

/**
 * Containment regression test for DroppableDayCell.
 *
 * Bug history: Tailwind `sr-only` is position:absolute. An absolutely
 * positioned element is clipped by an overflow ancestor ONLY if that
 * ancestor is also its containing block (i.e. positioned). The schedule
 * grid renders sr-only time-off markers inside day cells; when the cell
 * <td> was unpositioned, the spans escaped the grid's overflow-x-auto
 * scroller and inflated documentElement.scrollWidth to ~951px on a 375px
 * viewport, so phones zoomed out and the page looked squeezed left.
 *
 * jsdom has no layout engine, so this test pins the structural invariant:
 * walking up from the sr-only span, the nearest ancestor carrying a
 * positioning class must be the <td> itself — the cell is the containing
 * block that keeps abspos descendants inside the scroller.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { DroppableDayCell } from '@/components/scheduling/DroppableDayCell';

const POSITIONING_CLASSES = new Set(['relative', 'absolute', 'sticky', 'fixed']);

const hasPositioningClass = (el: Element) =>
  el.className
    .toString()
    .split(/\s+/)
    .some((cls) => POSITIONING_CLASSES.has(cls));

describe('DroppableDayCell containment', () => {
  it('the <td> is the nearest positioned ancestor of sr-only descendants', () => {
    const { container } = render(
      <DndContext>
        <table>
          <tbody>
            <tr>
              <DroppableDayCell
                employeeId="e1"
                day="2026-07-01"
                isToday={false}
                isHighlighted={false}
              >
                {/* Mirrors the production off-day markup in Scheduling.tsx */}
                <div className="space-y-1 min-h-[48px]">
                  <span className="sr-only">Approved time off</span>
                </div>
              </DroppableDayCell>
            </tr>
          </tbody>
        </table>
      </DndContext>
    );

    const srOnly = container.querySelector('span.sr-only');
    expect(srOnly).not.toBeNull();

    let ancestor: Element | null = srOnly!.parentElement;
    while (ancestor && !hasPositioningClass(ancestor)) {
      ancestor = ancestor.parentElement;
    }

    expect(ancestor).not.toBeNull();
    expect(ancestor!.tagName).toBe('TD');
  });
});

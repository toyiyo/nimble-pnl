/**
 * Unit tests for `resolveLaneContext` — the pure helper extracted from
 * `ShiftTimelineTab`'s `createDraft` memo to replace a nested ternary (OCR
 * rule: no nested ternaries). Maps a lane's grouping key to `position` or
 * `area` depending on the active `groupBy` mode, or both-null when there's
 * no lane context (gap-click entry point).
 */
import { describe, it, expect } from 'vitest';
import { resolveLaneContext } from '@/components/scheduling/ShiftTimeline/ShiftTimelineTab';

describe('resolveLaneContext', () => {
  it('maps the lane key to `position` when grouped by position', () => {
    expect(resolveLaneContext('Server', 'position')).toEqual({ position: 'Server', area: null });
  });

  it('maps the lane key to `area` when grouped by area', () => {
    expect(resolveLaneContext('Bar', 'area')).toEqual({ position: null, area: 'Bar' });
  });

  it('returns both null when laneKey is null (gap-click, no lane context)', () => {
    expect(resolveLaneContext(null, 'area')).toEqual({ position: null, area: null });
    expect(resolveLaneContext(null, 'position')).toEqual({ position: null, area: null });
  });

  it('treats an empty-string lane key (unassigned lane) as a real key, not null', () => {
    expect(resolveLaneContext('', 'position')).toEqual({ position: '', area: null });
  });
});

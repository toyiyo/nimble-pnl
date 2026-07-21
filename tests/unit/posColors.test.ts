import { describe, it, expect } from 'vitest';
import { POS_COLOR, posColor, posLabel } from '@/lib/posColors';
import type { POSSystemType } from '@/types/pos';

const ALL_POS_SYSTEMS: POSSystemType[] = [
  'square',
  'toast',
  'clover',
  'resy',
  'shift4',
  'revel',
  'focus',
  'manual',
  'manual_upload',
];

describe('POS_COLOR registry', () => {
  it('has an entry for every POSSystemType', () => {
    for (const sys of ALL_POS_SYSTEMS) {
      expect(POS_COLOR[sys]).toBeTruthy();
    }
  });

  it('maps the design-approved chart tokens', () => {
    expect(POS_COLOR.toast).toBe('hsl(var(--chart-4))');
    expect(POS_COLOR.square).toBe('hsl(var(--chart-3))');
    expect(POS_COLOR.clover).toBe('hsl(var(--chart-1))');
    expect(POS_COLOR.revel).toBe('hsl(var(--chart-2))');
    expect(POS_COLOR.shift4).toBe('hsl(var(--chart-5))');
  });

  it('groups manual, manual_upload, resy, and focus (no dedicated chart token) under the muted-foreground token', () => {
    expect(POS_COLOR.manual).toBe('hsl(var(--muted-foreground))');
    expect(POS_COLOR.manual_upload).toBe('hsl(var(--muted-foreground))');
    expect(POS_COLOR.resy).toBe('hsl(var(--muted-foreground))');
    expect(POS_COLOR.focus).toBe('hsl(var(--muted-foreground))');
  });
});

describe('posColor', () => {
  it('returns the registry color for every known POS system', () => {
    for (const sys of ALL_POS_SYSTEMS) {
      expect(posColor(sys)).toBe(POS_COLOR[sys]);
    }
  });

  it('falls back to muted-foreground for an unknown/malformed value', () => {
    expect(posColor('not_a_real_pos' as POSSystemType)).toBe('hsl(var(--muted-foreground))');
    expect(posColor(undefined as unknown as POSSystemType)).toBe('hsl(var(--muted-foreground))');
    expect(posColor(null as unknown as POSSystemType)).toBe('hsl(var(--muted-foreground))');
  });

  it('is stable across repeated calls', () => {
    expect(posColor('toast')).toBe(posColor('toast'));
  });
});

describe('posLabel', () => {
  it('returns a human-readable display name for every known POS system', () => {
    expect(posLabel('square')).toBe('Square');
    expect(posLabel('toast')).toBe('Toast');
    expect(posLabel('clover')).toBe('Clover');
    expect(posLabel('resy')).toBe('Resy');
    expect(posLabel('shift4')).toBe('Shift4');
    expect(posLabel('revel')).toBe('Revel');
    expect(posLabel('focus')).toBe('Focus');
    expect(posLabel('manual')).toBe('Manual');
    expect(posLabel('manual_upload')).toBe('Manual');
  });

  it('falls back to a generic label for an unknown/malformed value', () => {
    expect(posLabel('not_a_real_pos' as POSSystemType)).toBe('Other');
    expect(posLabel(undefined as unknown as POSSystemType)).toBe('Other');
  });

  it('is stable across repeated calls', () => {
    expect(posLabel('square')).toBe(posLabel('square'));
  });
});

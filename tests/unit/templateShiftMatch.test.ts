import { describe, it, expect } from 'vitest';
import {
  slotKeyForShift,
  type MatchShift,
  type MatchTemplate,
} from '../../supabase/functions/_shared/templateShiftMatch';

const CHI = 'America/Chicago';

// 2026-12-05 is a Saturday (dow 6). 17:00-23:00 CST = 23:00Z-05:00Z.
const tpl = (id: string, over: Partial<MatchTemplate> = {}): MatchTemplate => ({
  id,
  days: [0, 1, 2, 3, 4, 5, 6],
  start_time: '17:00:00',
  end_time: '23:00:00',
  position: 'Server',
  area: null,
  is_active: true,
  ...over,
});

const shift = (over: Partial<MatchShift> = {}): MatchShift => ({
  employee_id: 'e1',
  start_time: '2026-12-05T23:00:00Z',
  end_time: '2026-12-06T05:00:00Z',
  status: 'scheduled',
  position: 'Server',
  shift_template_id: null,
  ...over,
});

describe('slotKeyForShift', () => {
  it('keys a linked shift to its template and the local date', () => {
    expect(slotKeyForShift(shift({ shift_template_id: 't1' }), [tpl('t1')], null, CHI))
      .toBe('t1|2026-12-05');
  });

  it('gives null for a linked shift whose template is not in the list, with no time fallback', () => {
    expect(slotKeyForShift(shift({ shift_template_id: 'gone' }), [tpl('t1')], null, CHI)).toBeNull();
  });

  it('gives null for a cancelled shift', () => {
    expect(slotKeyForShift(shift({ status: 'cancelled' }), [tpl('t1')], null, CHI)).toBeNull();
  });

  it('matches a legacy shift on local time, shift position and day', () => {
    expect(slotKeyForShift(shift(), [tpl('t1')], null, CHI)).toBe('t1|2026-12-05');
  });

  it('does not match a legacy shift with no position', () => {
    expect(slotKeyForShift(shift({ position: null }), [tpl('t1', { position: null })], null, CHI)).toBeNull();
  });

  it('does not match a legacy shift with another position', () => {
    expect(slotKeyForShift(shift({ position: 'Cook' }), [tpl('t1')], null, CHI)).toBeNull();
  });

  it('does not match a legacy shift on a day that the template does not run', () => {
    expect(slotKeyForShift(shift(), [tpl('t1', { days: [1, 2, 3] })], null, CHI)).toBeNull();
  });

  it('does not match a legacy shift with another end time', () => {
    expect(slotKeyForShift(shift({ end_time: '2026-12-06T04:00:00Z' }), [tpl('t1')], null, CHI)).toBeNull();
  });

  it('ignores inactive templates in the legacy branch', () => {
    expect(slotKeyForShift(shift(), [tpl('t1', { is_active: false })], null, CHI)).toBeNull();
  });

  it('keeps a linked shift on an inactive template', () => {
    expect(slotKeyForShift(shift({ shift_template_id: 't1' }), [tpl('t1', { is_active: false })], null, CHI))
      .toBe('t1|2026-12-05');
  });

  it('prefers the same-area template over a template with no area', () => {
    const list = [tpl('any'), tpl('bar', { area: 'Bar' })];
    expect(slotKeyForShift(shift(), list, 'Bar', CHI)).toBe('bar|2026-12-05');
  });

  it('does not match a template of another area', () => {
    expect(slotKeyForShift(shift(), [tpl('bar', { area: 'Bar' })], 'Patio', CHI)).toBeNull();
  });

  it('matches when the employee has no area', () => {
    expect(slotKeyForShift(shift(), [tpl('bar', { area: 'Bar' })], null, CHI)).toBe('bar|2026-12-05');
  });

  it('takes the first candidate in input order when two templates fit', () => {
    expect(slotKeyForShift(shift(), [tpl('a'), tpl('b')], null, CHI)).toBe('a|2026-12-05');
  });

  it('keeps the local time match across the fall-back change (2026-11-01, Sunday)', () => {
    // 09:00-15:00 CST on 2026-11-01 = 15:00Z-21:00Z.
    const s = shift({ start_time: '2026-11-01T15:00:00Z', end_time: '2026-11-01T21:00:00Z' });
    expect(slotKeyForShift(s, [tpl('t1', { start_time: '09:00:00', end_time: '15:00:00' })], null, CHI))
      .toBe('t1|2026-11-01');
  });

  it('keeps the local time match across the spring-forward change (2027-03-14, Sunday)', () => {
    // 09:00-15:00 CDT on 2027-03-14 = 14:00Z-20:00Z.
    const s = shift({ start_time: '2027-03-14T14:00:00Z', end_time: '2027-03-14T20:00:00Z' });
    expect(slotKeyForShift(s, [tpl('t1', { start_time: '09:00:00', end_time: '15:00:00' })], null, CHI))
      .toBe('t1|2027-03-14');
  });
});

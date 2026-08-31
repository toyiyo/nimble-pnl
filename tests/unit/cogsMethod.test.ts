import { describe, it, expect } from 'vitest';
import { normalizeCOGSMethod } from '@/lib/cogsMethod';

describe('normalizeCOGSMethod', () => {
  it('keeps inventory as inventory', () => {
    expect(normalizeCOGSMethod('inventory')).toBe('inventory');
  });

  it('keeps financials as financials', () => {
    expect(normalizeCOGSMethod('financials')).toBe('financials');
  });

  it('maps the removed combined method to inventory', () => {
    expect(normalizeCOGSMethod('combined')).toBe('inventory');
  });

  it('maps null to inventory', () => {
    expect(normalizeCOGSMethod(null)).toBe('inventory');
  });

  it('maps undefined to inventory', () => {
    expect(normalizeCOGSMethod(undefined)).toBe('inventory');
  });

  it('maps an unknown value to inventory', () => {
    expect(normalizeCOGSMethod('garbage')).toBe('inventory');
  });
});

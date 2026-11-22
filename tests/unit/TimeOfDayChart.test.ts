import { describe, it, expect } from 'vitest';

import { buildHourlyPriorAriaLabel } from '@/components/pos-sales/TimeOfDayChart';

describe('buildHourlyPriorAriaLabel', () => {
  it('returns the base label when there is no prior series', () => {
    expect(buildHourlyPriorAriaLabel('Peak at 6 PM.', false, 1)).toBe('Peak at 6 PM.');
  });

  it('says the prior series is dashed', () => {
    expect(buildHourlyPriorAriaLabel('Peak at 6 PM.', true, 1)).toBe('Peak at 6 PM. Previous period shown dashed.');
  });

  it('says the prior series is scaled when the factor is not 1', () => {
    expect(buildHourlyPriorAriaLabel('Peak at 6 PM.', true, 31 / 30)).toBe(
      'Peak at 6 PM. Previous period shown dashed. The previous period is scaled to the days of this period.',
    );
  });
});

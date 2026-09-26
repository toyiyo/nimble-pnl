import { describe, it, expect } from 'vitest';
import { periodStatusMessage } from '@/utils/periodAnnouncement';

describe('periodStatusMessage', () => {
  it('announces the load while the period still fetches', () => {
    expect(periodStatusMessage(true, null, 'This Month')).toBe(
      'Loading This Month…',
    );
  });

  it('announces failure after a failed fetch, not success', () => {
    expect(periodStatusMessage(false, new Error('network down'), 'This Month')).toBe(
      'Failed to update the dashboard for This Month',
    );
  });

  it('announces success once the fetch ends without an error', () => {
    expect(periodStatusMessage(false, null, 'This Month')).toBe(
      'Dashboard updated for This Month',
    );
  });
});

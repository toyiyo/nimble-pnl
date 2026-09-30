import { describe, it, expect } from 'vitest';
import { DASHBOARD_SECTIONS } from '@/components/dashboard/dashboardSections';

describe('DASHBOARD_SECTIONS', () => {
  it('has 13 sections', () => {
    expect(DASHBOARD_SECTIONS).toHaveLength(13);
  });

  it('has the ids and labels from the design, in order', () => {
    expect(DASHBOARD_SECTIONS.map((section) => section.id)).toEqual([
      'dash-today',
      'dash-attention',
      'dash-sales-vs-break-even',
      'dash-labor-cost',
      'dash-performance-overview',
      'dash-cashflow',
      'dash-monthly-performance',
      'dash-revenue-mix',
      'dash-banking',
      'dash-expenses',
      'dash-labor-efficiency',
      'dash-operations-health',
      'dash-quick-actions',
    ]);
    expect(DASHBOARD_SECTIONS.map((section) => section.label)).toEqual([
      'Today',
      'Attention',
      'Sales vs break-even',
      'Labor cost',
      'Performance Overview',
      'Cashflow',
      'Monthly Performance',
      'Revenue Mix',
      'Banking',
      'Expenses',
      'Labor efficiency',
      'Operations Health',
      'Quick Actions',
    ]);
  });

  it('has a unique id for each section', () => {
    const ids = DASHBOARD_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

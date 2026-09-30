/**
 * The ordered list of dashboard sections for the section rail and chip
 * row (design doc section 4.8). Each `id` matches the `id` attribute on
 * that section's wrapper element, for example `id="dash-cashflow"`.
 */
export interface DashboardSection {
  id: string;
  label: string;
}

export const DASHBOARD_SECTIONS: DashboardSection[] = [
  { id: 'dash-today', label: 'Today' },
  { id: 'dash-attention', label: 'Attention' },
  { id: 'dash-sales-vs-break-even', label: 'Sales vs Break-Even' },
  { id: 'dash-labor-cost', label: 'Labor cost' },
  { id: 'dash-smart-alerts', label: 'Smart Alerts' },
  { id: 'dash-performance-overview', label: 'Performance Overview' },
  { id: 'dash-cashflow', label: 'Cashflow' },
  { id: 'dash-monthly-performance', label: 'Monthly Performance' },
  { id: 'dash-revenue-mix', label: 'Revenue Mix' },
  { id: 'dash-banking', label: 'Banking' },
  { id: 'dash-expenses', label: 'Expenses' },
  { id: 'dash-labor-efficiency', label: 'Labor efficiency' },
  { id: 'dash-operations-health', label: 'Operations Health' },
  { id: 'dash-quick-actions', label: 'Quick Actions' },
];

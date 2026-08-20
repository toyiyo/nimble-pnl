import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// The Scheduling page showed the "Shift Trades" tab and its approval queue
// to every viewer, regardless of role — a chef with only `view:scheduling`
// could open it and reach approve/reject controls the server now also
// blocks via RLS (design §3). This gates both the tab trigger and its
// panel behind `isResolved && hasCapability('edit:scheduling')`, the same
// capability the server checks (docs/superpowers/specs/
// 2026-08-20-trade-approval-area-grant-design.md §3).

const hasCapabilityMock = vi.fn();
let isResolvedMock = true;
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasCapability: hasCapabilityMock,
    isResolved: isResolvedMock,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'r1',
      role: 'manager',
      restaurant: { timezone: 'America/Chicago' },
    },
    loading: false,
  }),
}));

vi.mock('@/components/subscription', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useRestaurantClock', () => ({
  useRestaurantClock: () => ({ today: '2026-08-20' }),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: [], loading: false, error: null }),
}));

vi.mock('@/hooks/useShifts', () => ({
  useShifts: () => ({ shifts: [], loading: false, error: null }),
  useDeleteShift: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useDeleteShiftSeries: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useUpdateShiftSeries: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useSeriesInfo: () => ({ seriesCount: 0, lockedCount: 0 }),
}));

vi.mock('@/hooks/useShiftTrades', () => ({
  useShiftTrades: () => ({ trades: [] }),
}));

vi.mock('@/hooks/useTimeOffRequests', () => ({
  useTimeOffRequests: () => ({ timeOffRequests: [] }),
}));

vi.mock('@/pages/SchedulingTimeOffTabBadge', () => ({
  TimeOffTabBadge: () => null,
}));

vi.mock('@/pages/SchedulingDayHeaderContent', () => ({
  ScheduleDayHeaderContent: () => null,
  TODAY_HEADER_CAP_RULE_CLASS: '',
}));

vi.mock('@/pages/SchedulingTimeOffCellContent', () => ({
  SchedulingTimeOffCellContent: () => null,
}));

vi.mock('@/pages/SchedulingWeeklyAvailabilityChip', () => ({
  WeeklyAvailabilityChip: () => null,
}));

vi.mock('@/pages/SchedulingShiftCard', () => ({
  ShiftCard: () => null,
  getShiftStatusClass: () => '',
}));

vi.mock('@/components/schedule/TradeRequestDialog', () => ({
  TradeRequestDialog: () => null,
}));

vi.mock('@/components/scheduling/WeekScheduleMobile', () => ({
  WeekScheduleMobile: () => null,
}));

vi.mock('@/hooks/useSchedulePublish', () => ({
  usePublishSchedule: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useUnpublishSchedule: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useWeekPublicationStatus: () => ({ publication: null, isPublished: false, loading: false }),
}));

vi.mock('@/hooks/usePublishedShiftGuard', () => ({
  usePublishedShiftGuard: () => ({
    guardShiftChange: vi.fn((_opts: unknown, commit: () => void) => commit()),
    notifyAfterDeferredCommit: vi.fn(),
    dialog: null,
  }),
}));

vi.mock('@/hooks/useScheduleChangeLogs', () => ({
  useScheduleChangeLogs: () => ({ changeLogs: [], loading: false }),
}));

vi.mock('@/hooks/useScheduledLaborCosts', () => ({
  useScheduledLaborCosts: () => ({ breakdown: [] }),
}));

vi.mock('@/hooks/useEmployeeLaborCosts', () => ({
  useEmployeeLaborCosts: () => ({}),
}));

vi.mock('@/components/EmployeeDialog', () => ({
  EmployeeDialog: () => null,
}));

vi.mock('@/hooks/useEmployeePositions', () => ({
  useEmployeePositions: () => ({ positions: [], isLoading: false }),
}));

vi.mock('@/hooks/useEmployeeAreas', () => ({
  useEmployeeAreas: () => ({ areas: [] }),
}));

vi.mock('@/hooks/useAvailability', () => ({
  useEmployeeAvailability: () => ({ availability: [] }),
  useAvailabilityExceptions: () => ({ exceptions: [] }),
}));

vi.mock('@/components/ShiftDialog', () => ({
  ShiftDialog: () => null,
}));

vi.mock('@/components/TimeOffRequestDialog', () => ({
  TimeOffRequestDialog: () => null,
}));

vi.mock('@/components/TimeOffList', () => ({
  TimeOffList: () => null,
}));

vi.mock('@/components/AvailabilityDialog', () => ({
  AvailabilityDialog: () => null,
}));

vi.mock('@/components/AvailabilityExceptionDialog', () => ({
  AvailabilityExceptionDialog: () => null,
}));

vi.mock('@/components/ScheduleStatusBadge', () => ({
  ScheduleStatusBadge: () => null,
}));

vi.mock('@/components/PublishScheduleDialog', () => ({
  PublishScheduleDialog: () => null,
}));

vi.mock('@/components/scheduling/BroadcastOpenShiftsDialog', () => ({
  BroadcastOpenShiftsDialog: () => null,
}));

vi.mock('@/components/ChangeLogDialog', () => ({
  ChangeLogDialog: () => null,
}));

vi.mock('@/components/schedule/TradeApprovalQueue', () => ({
  TradeApprovalQueue: () => <div data-testid="trade-approval-queue" />,
}));

vi.mock('@/components/scheduling/ScheduleMetricsRibbon', () => ({
  ScheduleMetricsRibbon: () => null,
}));

vi.mock('@/hooks/useScheduleLaborBudget', () => ({
  useScheduleLaborBudget: () => ({}),
}));

vi.mock('@/components/scheduling/ScheduleExportDialog', () => ({
  ScheduleExportDialog: () => null,
}));

vi.mock('@/components/scheduling/ShiftPlanner', () => ({
  ShiftPlannerTab: () => null,
}));

vi.mock('@/components/scheduling/ShiftImportSheet', () => ({
  ShiftImportSheet: () => null,
}));

vi.mock('@/components/scheduling/ShiftPlanner/CopyWeekDialog', () => ({
  CopyWeekDialog: () => null,
}));

vi.mock('@/components/scheduling/ShiftPlanner/AvailabilityConflictDialog', () => ({
  AvailabilityConflictDialog: () => null,
}));

vi.mock('@/components/scheduling/TeamAvailabilityGrid', () => ({
  TeamAvailabilityGrid: () => null,
}));

vi.mock('@/components/scheduling/DeleteAvailabilityDialog', () => ({
  DeleteAvailabilityDialog: () => null,
}));

vi.mock('@/components/scheduling/useShiftCopyDnd', () => ({
  useShiftCopyDnd: () => ({
    sensors: [],
    activeDragShift: null,
    highlightedCellId: null,
    conflictDialog: { open: false, data: null },
    handleDragStart: vi.fn(),
    handleDragEnd: vi.fn(),
    handleDragCancel: vi.fn(),
  }),
}));

vi.mock('@/components/scheduling/DraggableShiftCard', () => ({
  DraggableShiftCard: () => null,
}));

vi.mock('@/components/scheduling/DroppableDayCell', () => ({
  DroppableDayCell: () => null,
}));

vi.mock('@/components/scheduling/ShiftDragOverlay', () => ({
  ShiftDragOverlay: () => null,
}));

vi.mock('@/hooks/useCopyWeekShifts', () => ({
  useCopyWeekShifts: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useSharedWeek', () => ({
  useSharedWeek: () => ({ weekStart: new Date('2026-08-17T00:00:00'), setWeekStart: vi.fn() }),
}));

vi.mock('@/hooks/useShiftTemplates', () => ({
  useShiftTemplates: () => ({ templates: [] }),
  templateAppliesToDay: () => false,
}));

vi.mock('@/hooks/useStaffingSettings', () => ({
  useStaffingSettings: () => ({ effectiveSettings: {} }),
}));

vi.mock('@/components/scheduling/RecurringShiftActionDialog', () => ({
  RecurringShiftActionDialog: () => null,
  RecurringActionType: {},
}));

vi.mock('@/components/bulk-edit/BulkActionBar', () => ({
  BulkActionBar: () => null,
}));

vi.mock('@/components/scheduling/BulkEditShiftsDialog', () => ({
  BulkEditShiftsDialog: () => null,
}));

vi.mock('@/hooks/useBulkShiftActions', () => ({
  useBulkShiftActions: () => ({ bulkDelete: vi.fn(), bulkEdit: vi.fn() }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import Scheduling from '@/pages/Scheduling';

describe('Scheduling page — Shift Trades tab capability gate', () => {
  beforeEach(() => {
    hasCapabilityMock.mockReset();
    isResolvedMock = true;
  });

  it('shows the Shift Trades tab with edit:scheduling resolved', () => {
    isResolvedMock = true;
    hasCapabilityMock.mockImplementation((cap: string) => cap === 'edit:scheduling');

    render(<Scheduling />);

    expect(screen.getByRole('tab', { name: /shift trades/i })).toBeInTheDocument();
  });

  it('hides the Shift Trades tab with only view:scheduling', () => {
    isResolvedMock = true;
    hasCapabilityMock.mockImplementation((cap: string) => cap === 'view:scheduling');

    render(<Scheduling />);

    expect(screen.queryByRole('tab', { name: /shift trades/i })).not.toBeInTheDocument();
  });

  it('hides the Shift Trades tab while capabilities are still resolving', () => {
    isResolvedMock = false;
    hasCapabilityMock.mockImplementation(() => true);

    render(<Scheduling />);

    expect(screen.queryByRole('tab', { name: /shift trades/i })).not.toBeInTheDocument();
  });
});

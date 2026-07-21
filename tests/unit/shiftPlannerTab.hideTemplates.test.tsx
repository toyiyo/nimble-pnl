/**
 * Task 8 — ShiftPlannerTab: state, derivation, toggle pill, handlers.
 *
 * Covers:
 *  - useShiftTemplates is fetched with { status: 'all' }
 *  - activeTemplates (not the full/all list) feed the "No shift templates yet"
 *    empty state and the templates-array-driven math (positions, areas)
 *  - The "Hidden (n)" toggle pill renders only when hiddenTemplates.length > 0,
 *    reflects aria-pressed, and toggles showHidden on click
 *  - displayTemplates passed to TemplateGrid via partitionTemplatesForDisplay
 *    (active-first; hidden included only when showHidden is true)
 *  - hiddenLaneByDay is computed via collectHiddenLane and passed to TemplateGrid
 *    only when showHidden is false
 *  - handleHideTemplate computes a real keptShiftCount from gridData (not the
 *    task-7 placeholder 0) and calls hideTemplate with { id, name, keptShiftCount }
 *  - handleRestoreTemplate calls restoreTemplate(id)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ShiftPlannerTab } from '@/components/scheduling/ShiftPlanner/ShiftPlannerTab';
import type { ShiftTemplate, Shift } from '@/types/scheduling';

// ─── Mock all heavy hook / component dependencies ─────────────────────────────

// vi.mock factories are hoisted above regular top-level consts, so any shared
// mock state referenced inside a factory must be declared via vi.hoisted to
// avoid a TDZ/module-initialization failure.
const {
  mockShifts,
  mockHideTemplate,
  mockRestoreTemplate,
  mockDeleteTemplate,
  mockUseShiftTemplates,
  mockIsMobile,
  mockImpact,
} = vi.hoisted(() => ({
  mockShifts: [] as Shift[],
  // Both mutations are `mutateAsync` in the real hook, so the wiring code is
  // free to chain `.then()`/`.catch()` off them; mock the same shape.
  mockHideTemplate: vi.fn(() => Promise.resolve()),
  mockRestoreTemplate: vi.fn(),
  mockDeleteTemplate: vi.fn(() => Promise.resolve()),
  mockUseShiftTemplates: vi.fn(),
  mockIsMobile: vi.fn(() => false),
  mockImpact: vi.fn(),
}));

vi.mock('@/hooks/useShiftPlanner', async () => {
  const actual = await vi.importActual('@/hooks/useShiftPlanner') as Record<string, unknown>;
  return {
    ...actual,
    useShiftPlanner: () => ({
      weekStart: new Date('2026-07-06T00:00:00Z'),
      weekEnd: new Date('2026-07-12T23:59:59Z'),
      weekDays: [
        '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09',
        '2026-07-10', '2026-07-11', '2026-07-12',
      ],
      goToNextWeek: vi.fn(),
      goToPrevWeek: vi.fn(),
      goToToday: vi.fn(),
      shifts: mockShifts,
      employees: [{ id: 'e1', restaurant_id: 'r1', name: 'Ann', position: 'Server', area: 'Front', is_active: true }],
      isLoading: false,
      error: null,
      validateAndCreate: vi.fn(),
      forceCreate: vi.fn(),
      deleteShift: vi.fn(),
      validationResult: null,
      clearValidation: vi.fn(),
      totalHours: 0,
    }),
  };
});

vi.mock('@/hooks/useShiftTemplates', async () => {
  const actual = await vi.importActual('@/hooks/useShiftTemplates') as Record<string, unknown>;
  return {
    ...actual,
    useShiftTemplates: (...args: unknown[]) => mockUseShiftTemplates(...args),
  };
});

// DeleteTemplateDialog owns its own useTemplateDeletionImpact read; stub it so
// the dialog renders fully (low-impact by default) without touching supabase.
vi.mock('@/hooks/useTemplateDeletionImpact', () => ({
  useTemplateDeletionImpact: (...args: unknown[]) => mockImpact(...args),
}));

vi.mock('@/hooks/useAvailability', () => ({
  useEmployeeAvailability: () => ({ availability: [], loading: false }),
  useAvailabilityExceptions: () => ({ exceptions: [], loading: false }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant: { id: 'r1', name: 'Test Restaurant', timezone: 'America/Chicago' },
    },
  }),
}));

vi.mock('@/hooks/usePlannerShiftsIndex', async () => {
  const actual = await vi.importActual('@/hooks/usePlannerShiftsIndex') as Record<string, unknown>;
  return {
    ...actual,
    usePlannerShiftsIndex: () => ({
      coverageByDay: new Map(),
      overviewDays: [],
      shiftsByEmployee: new Map(),
    }),
  };
});

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mockIsMobile(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/useGenerateSchedule', async () => {
  const actual = await vi.importActual('@/hooks/useGenerateSchedule') as Record<string, unknown>;
  return {
    ...actual,
    useGenerateSchedule: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
  };
});

vi.mock('@/hooks/useWeekStaffingSuggestions', () => ({
  useWeekStaffingSuggestions: () => ({
    daySuggestions: new Map(),
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/components/scheduling/ShiftPlanner/StaffingOverlay', () => ({
  StaffingOverlay: () => <div data-testid="staffing-overlay" />,
}));

vi.mock('@/components/scheduling/ShiftPlanner/GenerateScheduleDialog', () => ({
  GenerateScheduleDialog: () => null,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<ShiftTemplate> & { id: string }): ShiftTemplate {
  return {
    restaurant_id: 'r1',
    name: 'Morning Server',
    days: [0, 1, 2, 3, 4, 5, 6],
    start_time: '09:00:00',
    end_time: '17:00:00',
    break_duration: 0,
    position: 'Server',
    capacity: 1,
    area: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeShift(overrides: Partial<Shift> & { id: string; shift_template_id: string }): Shift {
  return {
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-07-06T15:00:00Z',
    end_time: '2026-07-06T23:00:00Z',
    break_duration: 0,
    position: 'Server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    employee: { id: 'e1', name: 'Ann', position: 'Server', area: 'Front' } as Shift['employee'],
    ...overrides,
  } as Shift;
}

const DEFAULT_PROPS = {
  restaurantId: 'r1',
  weekStart: new Date('2026-07-06T00:00:00Z'),
  onWeekStartChange: vi.fn(),
} as const;

function renderTab(props = DEFAULT_PROPS) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <ShiftPlannerTab {...props} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ShiftPlannerTab — hide/restore templates (task 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShifts.length = 0;
    mockIsMobile.mockReturnValue(false);
    mockImpact.mockReturnValue({
      pendingClaims: { count: 0, names: [] },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 0,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseShiftTemplates.mockReturnValue({
      templates: [],
      loading: false,
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      hideTemplate: mockHideTemplate,
      restoreTemplate: mockRestoreTemplate,
      deleteTemplate: mockDeleteTemplate,
      isHiding: false,
      isDeleting: false,
    });
  });

  it('fetches templates with status: "all"', () => {
    renderTab();
    expect(mockUseShiftTemplates).toHaveBeenCalledWith('r1', { status: 'all' });
  });

  it('does not render the Hidden toggle pill when there are no hidden templates', () => {
    mockUseShiftTemplates.mockReturnValue({
      templates: [makeTemplate({ id: 't1' })],
      loading: false,
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      hideTemplate: mockHideTemplate,
      restoreTemplate: mockRestoreTemplate,
    });
    renderTab();
    expect(screen.queryByRole('button', { name: /hidden/i })).not.toBeInTheDocument();
  });

  it('renders the Hidden (n) toggle pill with the hidden count when hidden templates exist', () => {
    mockUseShiftTemplates.mockReturnValue({
      templates: [
        makeTemplate({ id: 't1', is_active: true }),
        makeTemplate({ id: 't2', is_active: false }),
        makeTemplate({ id: 't3', is_active: false }),
      ],
      loading: false,
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      hideTemplate: mockHideTemplate,
      restoreTemplate: mockRestoreTemplate,
    });
    renderTab();
    const pill = screen.getByRole('button', { name: /hidden/i });
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent('2');
    expect(pill).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles aria-pressed and shows hidden rows when the pill is clicked', () => {
    mockUseShiftTemplates.mockReturnValue({
      templates: [
        makeTemplate({ id: 't1', is_active: true, name: 'Active Slot' }),
        makeTemplate({ id: 't2', is_active: false, name: 'Ghost Slot' }),
      ],
      loading: false,
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      hideTemplate: mockHideTemplate,
      restoreTemplate: mockRestoreTemplate,
    });
    renderTab();

    // Hidden template's row is not rendered before toggling
    expect(screen.queryByText('Ghost Slot')).not.toBeInTheDocument();

    const pill = screen.getByRole('button', { name: /hidden/i });
    fireEvent.click(pill);

    expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Ghost Slot')).toBeInTheDocument();
  });

  it('does not show the "no templates" empty state when a hidden template exists (all-hidden case)', () => {
    mockUseShiftTemplates.mockReturnValue({
      templates: [makeTemplate({ id: 't1', is_active: false })],
      loading: false,
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      hideTemplate: mockHideTemplate,
      restoreTemplate: mockRestoreTemplate,
    });
    renderTab();
    // A hidden template exists (even with no shifts this week) and showHidden
    // defaults to false, so displayTemplates is empty — but the grid must NOT
    // fall back to the "no templates" empty state, since that would bypass the
    // "From hidden templates" lane whenever every template is hidden. The empty
    // state is reserved for the true zero-templates case.
    expect(screen.queryByText(/no shift templates yet/i)).not.toBeInTheDocument();
  });

  it('shows the "From hidden templates" lane (not the empty state) when every template is hidden and has shifts this week', () => {
    mockShifts.length = 0;
    mockShifts.push(makeShift({ id: 's1', shift_template_id: 't1' }));
    mockUseShiftTemplates.mockReturnValue({
      templates: [makeTemplate({ id: 't1', is_active: false })],
      loading: false,
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      hideTemplate: mockHideTemplate,
      restoreTemplate: mockRestoreTemplate,
    });
    renderTab();
    expect(screen.queryByText(/no shift templates yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/from hidden templates/i)).toBeInTheDocument();
  });

  it('computes a real keptShiftCount and calls hideTemplate with id/name/keptShiftCount', async () => {
    const user = userEvent.setup();
    mockShifts.length = 0;
    mockShifts.push(
      makeShift({ id: 's1', shift_template_id: 't1' }),
      makeShift({ id: 's2', shift_template_id: 't1', start_time: '2026-07-07T15:00:00Z', end_time: '2026-07-07T23:00:00Z' }),
    );
    mockUseShiftTemplates.mockReturnValue({
      templates: [makeTemplate({ id: 't1', name: 'Morning Server', is_active: true })],
      loading: false,
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      hideTemplate: mockHideTemplate,
      restoreTemplate: mockRestoreTemplate,
    });
    renderTab();

    // Open the row's actions menu and click "Hide template"
    await user.click(screen.getByRole('button', { name: /actions for morning server/i }));
    await user.click(await screen.findByRole('menuitem', { name: /hide template/i }));

    expect(mockHideTemplate).toHaveBeenCalledWith({
      id: 't1',
      name: 'Morning Server',
      keptShiftCount: 2,
    });

    mockShifts.length = 0;
  });

  it('calls restoreTemplate(id) when Restore template is clicked on a hidden row (showHidden on)', async () => {
    const user = userEvent.setup();
    mockUseShiftTemplates.mockReturnValue({
      templates: [makeTemplate({ id: 't2', name: 'Ghost Slot', is_active: false })],
      loading: false,
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      hideTemplate: mockHideTemplate,
      restoreTemplate: mockRestoreTemplate,
    });
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: /hidden/i }));
    await user.click(screen.getByRole('button', { name: /actions for ghost slot/i }));
    await user.click(await screen.findByRole('menuitem', { name: /restore template/i }));

    expect(mockRestoreTemplate).toHaveBeenCalledWith('t2');
  });
});

// ─── Delete wiring (T5) ────────────────────────────────────────────────────────
// ShiftPlannerTab owns a single DeleteTemplateDialog instance (Single Dialog
// Pattern) keyed on `templateToDelete`. Opening it from either an active or a
// hidden row must work; confirming calls deleteTemplate; the dialog's own
// "Hide template" button must reuse the existing handleHideTemplate flow.
describe('ShiftPlannerTab — delete template wiring (T5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShifts.length = 0;
    mockIsMobile.mockReturnValue(false);
    mockImpact.mockReturnValue({
      pendingClaims: { count: 0, names: [] },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 0,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseShiftTemplates.mockReturnValue({
      templates: [makeTemplate({ id: 't1', name: 'Morning Server', is_active: true })],
      loading: false,
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      hideTemplate: mockHideTemplate,
      restoreTemplate: mockRestoreTemplate,
      deleteTemplate: mockDeleteTemplate,
      isHiding: false,
      isDeleting: false,
    });
  });

  it('opens the DeleteTemplateDialog for an active template when "Delete template…" is clicked', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: /actions for morning server/i }));
    await user.click(await screen.findByRole('menuitem', { name: /delete template/i }));

    expect(
      screen.getByRole('heading', { name: /delete "morning server"\?/i }),
    ).toBeInTheDocument();
  });

  it('opens the DeleteTemplateDialog for a hidden (ghost) template too', async () => {
    const user = userEvent.setup();
    mockUseShiftTemplates.mockReturnValue({
      templates: [makeTemplate({ id: 't2', name: 'Ghost Slot', is_active: false })],
      loading: false,
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      hideTemplate: mockHideTemplate,
      restoreTemplate: mockRestoreTemplate,
      deleteTemplate: mockDeleteTemplate,
      isHiding: false,
      isDeleting: false,
    });
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: /hidden/i }));
    await user.click(screen.getByRole('button', { name: /actions for ghost slot/i }));
    await user.click(await screen.findByRole('menuitem', { name: /delete template/i }));

    expect(
      screen.getByRole('heading', { name: /delete "ghost slot"\?/i }),
    ).toBeInTheDocument();
  });

  it('calls deleteTemplate with id/name/pendingClaimsCount when the dialog\'s Delete button is confirmed', async () => {
    const user = userEvent.setup();
    mockImpact.mockReturnValue({
      pendingClaims: { count: 2, names: ['Alex Rivera', 'Jordan Lee'] },
      scheduledShiftsKept: 0,
      upcomingOpenSpots: 0,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderTab();

    await user.click(screen.getByRole('button', { name: /actions for morning server/i }));
    await user.click(await screen.findByRole('menuitem', { name: /delete template/i }));

    const dialog = screen.getByRole('dialog');
    // High impact — ack checkbox gates the Delete button.
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: /^delete template$/i }));

    expect(mockDeleteTemplate).toHaveBeenCalledWith({
      id: 't1',
      name: 'Morning Server',
      pendingClaimsCount: 2,
    });
  });

  it('reuses handleHideTemplate (real keptShiftCount) when the dialog\'s "Hide template" button is clicked', async () => {
    const user = userEvent.setup();
    mockShifts.length = 0;
    mockShifts.push(makeShift({ id: 's1', shift_template_id: 't1' }));
    renderTab();

    await user.click(screen.getByRole('button', { name: /actions for morning server/i }));
    await user.click(await screen.findByRole('menuitem', { name: /delete template/i }));

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^hide template$/i }));

    expect(mockHideTemplate).toHaveBeenCalledWith({
      id: 't1',
      name: 'Morning Server',
      keptShiftCount: 1,
    });

    mockShifts.length = 0;
  });

  it('closes the dialog without calling delete or hide when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: /actions for morning server/i }));
    await user.click(await screen.findByRole('menuitem', { name: /delete template/i }));

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockDeleteTemplate).not.toHaveBeenCalled();
    expect(mockHideTemplate).not.toHaveBeenCalled();
  });
});

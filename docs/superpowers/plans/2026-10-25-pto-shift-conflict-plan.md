# Time-off approval shift choice: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a manager approves a time-off request, show the employee's
shifts in those dates and let the manager post all of them for trade or
delete all of them.

**Architecture:** The front end only. `TimeOffList` fetches the shifts
with the existing `get_timeoff_coverage_impact` RPC. If shifts exist, it
opens a new `TimeOffShiftsDialog`. On confirm, it approves first, then a
new hook `useApplyTimeOffShiftAction` posts or deletes each shift with
`Promise.allSettled` and shows one summary toast.

**Tech Stack:** React 18, TypeScript, React Query 5, shadcn/ui (Dialog,
RadioGroup, AlertDialog), Supabase JS, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-25-pto-shift-conflict-design.md`

## Global Constraints

- No database change. No migration. No new RPC.
- The default trade note is exactly `Approved PTO`. The note has `maxLength={200}`.
- The exact skip error text is `This shift already has an active trade`.
- Every delete filters on `id`, `restaurant_id`, and `employee_id`, and ends with `.select('id')`.
- The approval fetch uses `staleTime: 0`, so a cached empty list cannot skip the shift choice. Only `useTimeoffCoverageImpact` keeps `staleTime: 30000`. The key is `['timeoff-coverage-impact', requestId]`.
- Use semantic tokens only. The amber notice uses `bg-amber-500/10 border-amber-500/20`.
- Every user-visible string is STE-aligned (short sentences, active voice).
- Run tests with `npx vitest run <file>`. Stage explicit paths only. Never `git add -A`.

## Review Focus

1. A long leave (14+ shifts) on a 375 px phone: the footer button must stay on screen. Task 2 adds a layout test for the scroll region classes.
2. A double click on the dialog confirm button: the shift action must run once. Task 3 adds a test.
3. A shift that moved to another employee between the fetch and the delete: the delete must not remove it. Task 1 adds a test for the `employee_id` filter.
4. An RLS-filtered delete (zero rows, `error: null`): it must not count as `done`. Task 1 adds a test.
5. Esc during the submission: the dialog must stay open. Task 2 adds a test.

## Deviations from the spec (decided while planning)

- `submitting` is true only while an async step runs (the shift fetch, the
  approval, the shift action). While the dialog waits for the manager's
  choice, `submitting` is false. The modal dialog covers the row, so the
  row button cannot get a second click. The policy dialog needs live
  buttons, so `submitting` does not stay true across the hand-off.
- The row Approve button gets no spinner. `isApproving` is shared by all
  pending rows, so a spinner shows on every row. The disabled state is
  enough.

Task 3 changes the spec text to match these two points.

## File map

| File | Change | Responsibility |
|------|--------|----------------|
| `src/hooks/useTimeOffShiftAction.ts` | Create | Types, pure helpers, and the bulk hook |
| `src/hooks/useShiftTrades.ts` | Modify `:87` | Export `sendShiftTradeNotification` |
| `src/hooks/useShiftProtection.ts` | Modify `:100-118` | Export `timeoffCoverageImpactKey` and `fetchTimeoffCoverageImpact` |
| `src/components/timeoff/TimeOffShiftsDialog.tsx` | Create | The choice dialog (props only) |
| `src/components/TimeOffList.tsx` | Modify | The approve flow and the policy dialog text |
| `tests/unit/useTimeOffShiftAction.test.tsx` | Create | Helper and hook tests |
| `tests/unit/TimeOffShiftsDialog.test.tsx` | Create | Dialog tests |
| `tests/unit/TimeOffList.test.tsx` | Modify | Flow tests and new mocks |

---

### Task 1: The bulk shift-action hook

**Files:**
- Create: `src/hooks/useTimeOffShiftAction.ts`
- Modify: `src/hooks/useShiftTrades.ts:87` (add `export`)
- Test: `tests/unit/useTimeOffShiftAction.test.tsx`

**Interfaces:**
- Consumes: `sendShiftTradeNotification(tradeId: string, action: 'created' | ...)` and `invalidateShiftTradeQueries(queryClient)` from `@/hooks/useShiftTrades`.
- Produces:
  - `type TimeOffShiftAction = { kind: 'trade'; note: string } | { kind: 'delete' }`
  - `interface ShiftActionSummary { done: number; skipped: number; failed: number }`
  - `const DEFAULT_TRADE_NOTE = 'Approved PTO'`
  - `function tradeNote(note: string): string`
  - `function summarizeShiftResults(results: PromiseSettledResult<'done' | 'skipped'>[]): ShiftActionSummary`
  - `function timeOffShiftToastText(action: TimeOffShiftAction, summary: ShiftActionSummary): { title: string; description: string; variant?: 'destructive' }`
  - `function useApplyTimeOffShiftAction()`: a React Query mutation. `mutateAsync({ restaurantId, employeeId, shiftIds, action }): Promise<ShiftActionSummary>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/useTimeOffShiftAction.test.tsx`:

```tsx
import React, { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  summarizeShiftResults,
  timeOffShiftToastText,
  tradeNote,
  useApplyTimeOffShiftAction,
} from '@/hooks/useTimeOffShiftAction';

const mockToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

// delete().eq(id).eq(restaurant_id).eq(employee_id).select('id')
function setupDelete(resultsById: Record<string, { data: { id: string }[] | null; error: { message: string } | null }>) {
  const eqCalls: Array<[string, string]> = [];
  mockSupabase.from.mockImplementation(() => {
    let id = '';
    const chain = {
      eq: vi.fn((col: string, val: string) => {
        eqCalls.push([col, val]);
        if (col === 'id') id = val;
        return chain;
      }),
      select: vi.fn(() => Promise.resolve(resultsById[id])),
    };
    return { delete: vi.fn(() => chain) };
  });
  return eqCalls;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tradeNote', () => {
  it('trims the note', () => {
    expect(tradeNote('  Family trip  ')).toBe('Family trip');
  });
  it('uses Approved PTO for an empty note', () => {
    expect(tradeNote('   ')).toBe('Approved PTO');
  });
});

describe('summarizeShiftResults', () => {
  it('counts done, skipped, and failed', () => {
    const results: PromiseSettledResult<'done' | 'skipped'>[] = [
      { status: 'fulfilled', value: 'done' },
      { status: 'fulfilled', value: 'done' },
      { status: 'fulfilled', value: 'skipped' },
      { status: 'rejected', reason: new Error('x') },
    ];
    expect(summarizeShiftResults(results)).toEqual({ done: 2, skipped: 1, failed: 1 });
  });
});

describe('timeOffShiftToastText', () => {
  it('names the posted count for a trade', () => {
    expect(timeOffShiftToastText({ kind: 'trade', note: 'x' }, { done: 3, skipped: 0, failed: 0 })).toEqual({
      title: 'Shifts posted for trade',
      description: '3 shifts posted for trade.',
    });
  });
  it('uses the singular for one shift', () => {
    expect(timeOffShiftToastText({ kind: 'delete' }, { done: 1, skipped: 0, failed: 0 })).toEqual({
      title: 'Shifts deleted',
      description: '1 shift deleted.',
    });
  });
  it('names skipped and failed counts and uses the destructive variant', () => {
    expect(timeOffShiftToastText({ kind: 'trade', note: 'x' }, { done: 1, skipped: 1, failed: 1 })).toEqual({
      title: 'Some shifts were not posted',
      description:
        '1 shift posted for trade. 1 shift is already on the trade board. 1 shift failed. Post it from the schedule.',
      variant: 'destructive',
    });
  });
  it('names a skipped delete', () => {
    expect(timeOffShiftToastText({ kind: 'delete' }, { done: 0, skipped: 2, failed: 0 })).toEqual({
      title: 'Shifts deleted',
      description: '0 shifts deleted. 2 shifts are already gone.',
    });
  });
});

describe('useApplyTimeOffShiftAction', () => {
  it('posts each shift with the trimmed note and sends the created email', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: 'trade-1', error: null }).mockResolvedValueOnce({ data: 'trade-2', error: null });
    const { result } = renderHook(() => useApplyTimeOffShiftAction(), { wrapper });

    let summary;
    await act(async () => {
      summary = await result.current.mutateAsync({
        restaurantId: 'r1',
        employeeId: 'e1',
        shiftIds: ['s1', 's2'],
        action: { kind: 'trade', note: '  ' },
      });
    });

    expect(summary).toEqual({ done: 2, skipped: 0, failed: 0 });
    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_shift_trade_for_employee', {
      p_restaurant_id: 'r1',
      p_offered_shift_id: 's1',
      p_offered_by_employee_id: 'e1',
      p_target_employee_id: null,
      p_reason: 'Approved PTO',
    });
    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('send-shift-trade-notification', {
      body: { tradeId: 'trade-1', action: 'created' },
    });
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it('counts an existing trade as skipped', async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: 'trade-1', error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'This shift already has an active trade' } });
    const { result } = renderHook(() => useApplyTimeOffShiftAction(), { wrapper });

    let summary;
    await act(async () => {
      summary = await result.current.mutateAsync({
        restaurantId: 'r1', employeeId: 'e1', shiftIds: ['s1', 's2'], action: { kind: 'trade', note: 'PTO' },
      });
    });
    expect(summary).toEqual({ done: 1, skipped: 1, failed: 0 });
  });

  it('deletes with the restaurant and employee filters', async () => {
    const eqCalls = setupDelete({ s1: { data: [{ id: 's1' }], error: null } });
    const { result } = renderHook(() => useApplyTimeOffShiftAction(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', employeeId: 'e1', shiftIds: ['s1'], action: { kind: 'delete' } });
    });
    expect(mockSupabase.from).toHaveBeenCalledWith('shifts');
    expect(eqCalls).toEqual([['id', 's1'], ['restaurant_id', 'r1'], ['employee_id', 'e1']]);
    expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('counts a zero-row delete as skipped and a delete error as failed', async () => {
    setupDelete({
      s1: { data: [], error: null },
      s2: { data: null, error: { message: 'boom' } },
      s3: { data: [{ id: 's3' }], error: null },
    });
    const { result } = renderHook(() => useApplyTimeOffShiftAction(), { wrapper });

    let summary;
    await act(async () => {
      summary = await result.current.mutateAsync({
        restaurantId: 'r1', employeeId: 'e1', shiftIds: ['s1', 's2', 's3'], action: { kind: 'delete' },
      });
    });
    expect(summary).toEqual({ done: 1, skipped: 1, failed: 1 });
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run tests/unit/useTimeOffShiftAction.test.tsx`
Expected: FAIL. The module `@/hooks/useTimeOffShiftAction` does not exist.

- [ ] **Step 3: Export the trade email helper**

In `src/hooks/useShiftTrades.ts:87`, change `const sendShiftTradeNotification = async (` to
`export const sendShiftTradeNotification = async (`. Change nothing else.

- [ ] **Step 4: Write the hook**

Create `src/hooks/useTimeOffShiftAction.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { invalidateShiftTradeQueries, sendShiftTradeNotification } from '@/hooks/useShiftTrades';

/**
 * One choice for all the shifts in an approved time-off request:
 * post each shift for trade (with a note) or delete each shift.
 */
export type TimeOffShiftAction =
  | { kind: 'trade'; note: string }
  | { kind: 'delete' };

export interface ShiftActionSummary {
  done: number;
  skipped: number;
  failed: number;
}

export interface ApplyTimeOffShiftActionInput {
  restaurantId: string;
  employeeId: string;
  shiftIds: string[];
  action: TimeOffShiftAction;
}

type ShiftOutcome = 'done' | 'skipped';

export const DEFAULT_TRADE_NOTE = 'Approved PTO';
const ACTIVE_TRADE_MESSAGE = 'This shift already has an active trade';

export function tradeNote(note: string): string {
  return note.trim() || DEFAULT_TRADE_NOTE;
}

export function summarizeShiftResults(
  results: PromiseSettledResult<ShiftOutcome>[]
): ShiftActionSummary {
  const summary: ShiftActionSummary = { done: 0, skipped: 0, failed: 0 };
  for (const result of results) {
    if (result.status === 'rejected') summary.failed += 1;
    else summary[result.value] += 1;
  }
  return summary;
}

const shiftCount = (n: number) => `${n} ${n === 1 ? 'shift' : 'shifts'}`;

export function timeOffShiftToastText(
  action: TimeOffShiftAction,
  summary: ShiftActionSummary
): { title: string; description: string; variant?: 'destructive' } {
  const isTrade = action.kind === 'trade';
  const parts = [`${shiftCount(summary.done)} ${isTrade ? 'posted for trade' : 'deleted'}.`];
  if (summary.skipped > 0) {
    const verb = summary.skipped === 1 ? 'is' : 'are';
    parts.push(
      isTrade
        ? `${shiftCount(summary.skipped)} ${verb} already on the trade board.`
        : `${shiftCount(summary.skipped)} ${verb} already gone.`
    );
  }
  if (summary.failed > 0) {
    const pronoun = summary.failed === 1 ? 'it' : 'them';
    parts.push(
      `${shiftCount(summary.failed)} failed. ${isTrade ? 'Post' : 'Delete'} ${pronoun} from the schedule.`
    );
  }
  if (summary.failed > 0) {
    return {
      title: isTrade ? 'Some shifts were not posted' : 'Some shifts were not deleted',
      description: parts.join(' '),
      variant: 'destructive',
    };
  }
  return { title: isTrade ? 'Shifts posted for trade' : 'Shifts deleted', description: parts.join(' ') };
}

async function postShiftForTrade(
  restaurantId: string,
  employeeId: string,
  shiftId: string,
  note: string
): Promise<ShiftOutcome> {
  const { data, error } = await supabase.rpc('create_shift_trade_for_employee', {
    p_restaurant_id: restaurantId,
    p_offered_shift_id: shiftId,
    p_offered_by_employee_id: employeeId,
    p_target_employee_id: null,
    p_reason: tradeNote(note),
  });
  if (error) {
    if (error.message?.includes(ACTIVE_TRADE_MESSAGE)) return 'skipped';
    throw error;
  }
  await sendShiftTradeNotification(data as string, 'created');
  return 'done';
}

async function deleteShift(
  restaurantId: string,
  employeeId: string,
  shiftId: string
): Promise<ShiftOutcome> {
  // The employee_id filter stops a delete of a shift that moved to a
  // different employee after the fetch. A delete that RLS filters, or a
  // shift that is already gone, returns error:null with zero rows.
  const { data, error } = await supabase
    .from('shifts')
    .delete()
    .eq('id', shiftId)
    .eq('restaurant_id', restaurantId)
    .eq('employee_id', employeeId)
    .select('id');
  if (error) throw error;
  return (data?.length ?? 0) > 0 ? 'done' : 'skipped';
}

/**
 * Applies one TimeOffShiftAction to every shift. One failure does not
 * stop the others (Promise.allSettled). Shows one summary toast.
 */
export function useApplyTimeOffShiftAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      restaurantId,
      employeeId,
      shiftIds,
      action,
    }: ApplyTimeOffShiftActionInput): Promise<ShiftActionSummary> => {
      const results = await Promise.allSettled(
        shiftIds.map((shiftId) =>
          action.kind === 'trade'
            ? postShiftForTrade(restaurantId, employeeId, shiftId, action.note)
            : deleteShift(restaurantId, employeeId, shiftId)
        )
      );
      return summarizeShiftResults(results);
    },
    onSuccess: (summary, { restaurantId, action }) => {
      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['timeoff-coverage-impact'] });
      invalidateShiftTradeQueries(queryClient);
      toast(timeOffShiftToastText(action, summary));
    },
  });
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run tests/unit/useTimeOffShiftAction.test.tsx`
Expected: PASS (all tests).

Run: `npx vitest run tests/unit/useShiftTrades.test.ts`
Expected: PASS (the export does not change behavior).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useTimeOffShiftAction.ts src/hooks/useShiftTrades.ts tests/unit/useTimeOffShiftAction.test.tsx
git commit -m "feat(timeoff): add the bulk shift action for approved time off"
```

---

### Task 2: The choice dialog

**Files:**
- Create: `src/components/timeoff/TimeOffShiftsDialog.tsx`
- Test: `tests/unit/TimeOffShiftsDialog.test.tsx`

**Interfaces:**
- Consumes: `TimeOffShiftAction`, `DEFAULT_TRADE_NOTE` (Task 1). `CoverageImpactShift` from `@/hooks/useShiftProtection`. `TimeOffRequest` from `@/types/scheduling`.
- Produces:

```ts
interface TimeOffShiftsDialogProps {
  request: TimeOffRequest | null;   // null → closed
  shifts: CoverageImpactShift[];
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (action: TimeOffShiftAction) => void;
}
export function TimeOffShiftsDialog(props: TimeOffShiftsDialogProps): JSX.Element
```

The parent passes `key={request.id}` so the choice resets for each request.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/TimeOffShiftsDialog.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeOffShiftsDialog } from '../../src/components/timeoff/TimeOffShiftsDialog';
import type { TimeOffRequest } from '../../src/types/scheduling';
import type { CoverageImpactShift } from '../../src/hooks/useShiftProtection';

const request = {
  id: 'req-1',
  restaurant_id: 'rest-1',
  employee_id: 'e-1',
  start_date: '2026-11-02',
  end_date: '2026-11-04',
  reason: 'Family trip',
  status: 'pending',
  employee: { id: 'e-1', name: 'Maria Lopez' },
} as unknown as TimeOffRequest;

const shift = (id: string, date: string): CoverageImpactShift => ({
  shift_id: id,
  shift_date: date,
  position: 'Server',
  start_time: `${date}T16:00:00Z`,
  end_time: `${date}T23:00:00Z`,
  required: 2,
  current_count: 2,
  after_count: 1,
});

const shifts = [shift('s1', '2026-11-02'), shift('s2', '2026-11-03'), shift('s3', '2026-11-04')];

function setup(props: Partial<React.ComponentProps<typeof TimeOffShiftsDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <TimeOffShiftsDialog
      request={request}
      shifts={shifts}
      submitting={false}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...props}
    />
  );
  return { onConfirm, onCancel };
}

describe('TimeOffShiftsDialog', () => {
  it('names the employee and the shift count', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Approve time off' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Maria Lopez is scheduled for 3 shifts in these dates.');
    expect(screen.getAllByTestId('timeoff-shift-row')).toHaveLength(3);
  });

  it('defaults to a trade with the Approved PTO note', () => {
    const { onConfirm } = setup();
    expect(screen.getByLabelText('Trade note')).toHaveValue('Approved PTO');
    fireEvent.click(screen.getByRole('button', { name: 'Approve and post 3 shifts' }));
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'trade', note: 'Approved PTO' });
  });

  it('hides the note and changes the button for a delete', () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByLabelText('Delete the shifts'));
    expect(screen.queryByLabelText('Trade note')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and delete 3 shifts' }));
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'delete' });
  });

  it('submits on Enter in the note input', () => {
    const { onConfirm } = setup();
    const input = screen.getByLabelText('Trade note');
    fireEvent.change(input, { target: { value: 'Vacation' } });
    fireEvent.submit(input.closest('form')!);
    expect(onConfirm).toHaveBeenCalledWith({ kind: 'trade', note: 'Vacation' });
  });

  it('locks every control while submitting', () => {
    setup({ submitting: true });
    expect(screen.getByRole('button', { name: /approving/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Trade note')).toBeDisabled();
    expect(screen.getByLabelText('Delete the shifts')).toBeDisabled();
  });

  it('ignores Esc while submitting', () => {
    const { onCancel } = setup({ submitting: true });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel on Esc when idle', () => {
    const { onCancel } = setup();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('keeps the footer on screen with a scroll region for the shift list', () => {
    setup();
    expect(screen.getByTestId('timeoff-shift-list').className).toContain('max-h-48');
    expect(screen.getByTestId('timeoff-shift-list').className).toContain('overflow-y-auto');
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run tests/unit/TimeOffShiftsDialog.test.tsx`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Write the component**

Create `src/components/timeoff/TimeOffShiftsDialog.tsx`:

```tsx
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CalendarX, Loader2 } from 'lucide-react';
import type { CoverageImpactShift } from '@/hooks/useShiftProtection';
import { DEFAULT_TRADE_NOTE, type TimeOffShiftAction } from '@/hooks/useTimeOffShiftAction';
import type { TimeOffRequest } from '@/types/scheduling';
import { cn } from '@/lib/utils';

interface TimeOffShiftsDialogProps {
  request: TimeOffRequest | null;
  shifts: CoverageImpactShift[];
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (action: TimeOffShiftAction) => void;
}

const shiftWord = (n: number) => (n === 1 ? 'shift' : 'shifts');

function formatDateRange(start: string, end: string) {
  const from = format(parseISO(start), 'MMM d');
  return start === end ? from : `${from} – ${format(parseISO(end), 'MMM d')}`;
}

export function TimeOffShiftsDialog({
  request,
  shifts,
  submitting,
  onCancel,
  onConfirm,
}: TimeOffShiftsDialogProps) {
  const [kind, setKind] = useState<TimeOffShiftAction['kind']>('trade');
  const [note, setNote] = useState(DEFAULT_TRADE_NOTE);

  const name = request?.employee?.name ?? 'This employee';
  const count = shifts.length;
  const isDelete = kind === 'delete';

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    onConfirm(isDelete ? { kind: 'delete' } : { kind: 'trade', note });
  }

  return (
    <Dialog
      open={!!request}
      onOpenChange={(open) => {
        // Esc and the overlay click must not close the dialog mid-flow.
        if (!open && !submitting) onCancel();
      }}
    >
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <CalendarX className="h-5 w-5 text-foreground" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">Approve time off</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {request
                  ? `${name} · ${formatDateRange(request.start_date, request.end_date)}${
                      request.reason ? ` · ${request.reason}` : ''
                    }`
                  : ''}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="px-6 py-5 space-y-5 overflow-y-auto">
            <p
              role="status"
              className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[13px] text-foreground"
            >
              {name} is scheduled for {count} {shiftWord(count)} in these dates.
            </p>

            <ul
              data-testid="timeoff-shift-list"
              className="max-h-48 overflow-y-auto rounded-xl border border-border/40 bg-muted/30 divide-y divide-border/40"
            >
              {shifts.map((shift) => (
                <li
                  key={shift.shift_id}
                  data-testid="timeoff-shift-row"
                  className="flex items-center justify-between px-4 py-2.5 text-[14px]"
                >
                  <span className="font-medium text-foreground">
                    {format(parseISO(shift.shift_date), 'EEE MMM d')}
                    <span className="text-muted-foreground font-normal"> · {shift.position}</span>
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {format(new Date(shift.start_time), 'h:mm a')} – {format(new Date(shift.end_time), 'h:mm a')}
                  </span>
                </li>
              ))}
            </ul>

            <RadioGroup
              value={kind}
              onValueChange={(value) => setKind(value as TimeOffShiftAction['kind'])}
              disabled={submitting}
              className="space-y-3"
            >
              <div className="flex items-start gap-3">
                <RadioGroupItem value="trade" id="timeoff-shift-trade" className="mt-0.5" autoFocus />
                <div>
                  <Label htmlFor="timeoff-shift-trade" className="text-[14px] font-medium text-foreground">
                    Post for trade
                  </Label>
                  <p className="text-[13px] text-muted-foreground">
                    Coworkers can pick up the shifts. {name} keeps each shift until a manager approves the trade.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem value="delete" id="timeoff-shift-delete" className="mt-0.5" />
                <div>
                  <Label htmlFor="timeoff-shift-delete" className="text-[14px] font-medium text-foreground">
                    Delete the shifts
                  </Label>
                  <p className="text-[13px] text-muted-foreground">
                    The shifts leave the schedule. A delete also cancels any open trade on these shifts.
                  </p>
                </div>
              </div>
            </RadioGroup>

            {!isDelete && (
              <div className="space-y-1.5">
                <Label
                  htmlFor="timeoff-trade-note"
                  className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Trade note
                </Label>
                <Input
                  id="timeoff-trade-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  disabled={submitting}
                  className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                />
              </div>
            )}
          </div>

          <DialogFooter className="px-6 py-4 border-t border-border/40">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={submitting}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className={cn(
                'h-9 px-4 rounded-lg text-[13px] font-medium',
                isDelete
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-foreground text-background hover:bg-foreground/90'
              )}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" />
                  Approving…
                </>
              ) : (
                `Approve and ${isDelete ? 'delete' : 'post'} ${count} ${shiftWord(count)}`
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Note: `DialogContent` includes a close (X) button. Radix routes the X
through `onOpenChange(false)`, so the `submitting` guard covers it too.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run tests/unit/TimeOffShiftsDialog.test.tsx`
Expected: PASS. If the Esc test fails because focus is outside the
dialog, fire the key on `screen.getByRole('dialog')` instead. Do not
change the component for this.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeoff/TimeOffShiftsDialog.tsx tests/unit/TimeOffShiftsDialog.test.tsx
git commit -m "feat(timeoff): add the shift choice dialog for time-off approval"
```

---

### Task 3: Connect the flow in `TimeOffList`

**Files:**
- Modify: `src/hooks/useShiftProtection.ts:96-118`
- Modify: `src/components/TimeOffList.tsx` (the imports, the state at `:46-53`, the handlers at `:59-77`, the JSX at `:124-230`)
- Modify: `tests/unit/TimeOffList.test.tsx` (the mocks at `:8-13`, new tests)
- Modify: `docs/superpowers/specs/2026-10-25-pto-shift-conflict-design.md` (the two deviations)

**Interfaces:**
- Consumes: `useApplyTimeOffShiftAction`, `TimeOffShiftAction` (Task 1). `TimeOffShiftsDialog` (Task 2). `useApproveTimeOffRequest().mutateAsync({ id, restaurantId, override? })`, which rejects with `PolicyWarningError` on a policy warning.
- Produces in `useShiftProtection.ts`:
  - `export const timeoffCoverageImpactKey = (requestId: string | null) => ['timeoff-coverage-impact', requestId] as const`
  - `export async function fetchTimeoffCoverageImpact(requestId: string): Promise<CoverageImpact>`

- [ ] **Step 1: Extract the coverage fetch**

In `src/hooks/useShiftProtection.ts`, replace `useTimeoffCoverageImpact` (`:100-118`) with:

```ts
export const timeoffCoverageImpactKey = (requestId: string | null) =>
  ['timeoff-coverage-impact', requestId] as const;

export async function fetchTimeoffCoverageImpact(requestId: string): Promise<CoverageImpact> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
  const { data, error } = await (supabase.rpc as any)('get_timeoff_coverage_impact', {
    p_request_id: requestId,
  });
  if (error) throw error;
  return {
    shifts: (data?.shifts ?? []) as CoverageImpactShift[],
    overlapping_approved: (data?.overlapping_approved ?? 0) as number,
  };
}

/**
 * Coverage impact of a time-off approval, for the manager queue.
 * Fetch lazily — pass null until the approve action needs it.
 */
export function useTimeoffCoverageImpact(requestId: string | null) {
  return useQuery({
    queryKey: timeoffCoverageImpactKey(requestId),
    queryFn: () => fetchTimeoffCoverageImpact(requestId as string),
    enabled: !!requestId,
    staleTime: 30000,
  });
}
```

Run: `npx vitest run tests/unit -t "coverage"`
Expected: PASS (no behavior change).

- [ ] **Step 2: Write the failing flow tests**

In `tests/unit/TimeOffList.test.tsx`, replace the mocks at `:8-13` with:

```tsx
const mockApproveAsync = vi.hoisted(() => vi.fn());
const mockApplyAsync = vi.hoisted(() => vi.fn());
const mockFetchImpact = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

vi.mock('../../src/hooks/useTimeOffRequests', () => ({
  useTimeOffRequests: vi.fn(),
  useApproveTimeOffRequest: () => ({ mutate: vi.fn(), mutateAsync: mockApproveAsync, isPending: false }),
  useRejectTimeOffRequest: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTimeOffRequest: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../src/hooks/useShiftProtection', () => ({
  timeoffCoverageImpactKey: (id: string | null) => ['timeoff-coverage-impact', id],
  fetchTimeoffCoverageImpact: mockFetchImpact,
  useTimeoffCoverageImpact: () => ({ isLoading: false, error: null, data: undefined }),
}));

vi.mock('../../src/hooks/useTimeOffShiftAction', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/hooks/useTimeOffShiftAction')>()),
  useApplyTimeOffShiftAction: () => ({ mutateAsync: mockApplyAsync, isPending: false }),
}));

vi.mock('../../src/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
```

Also add `beforeEach(() => { vi.clearAllMocks(); })` inside the
`describe`, add `fireEvent, waitFor` to the Testing Library import, add
`beforeEach` to the Vitest import, and add
`import { PolicyWarningError } from '../../src/lib/shiftProtection';`.

Note: `TimeOffList` imports `@/hooks/use-toast`. Vitest resolves the
alias, so the relative mock path above points at the same module. If the
mock does not apply, use `vi.mock('@/hooks/use-toast', ...)`.

Append these tests inside the `describe('TimeOffList', ...)` block:

```tsx
  const impactShift = (id: string) => ({
    shift_id: id, shift_date: '2026-06-01', position: 'Server',
    start_time: '2026-06-01T16:00:00Z', end_time: '2026-06-01T23:00:00Z',
    required: 2, current_count: 2, after_count: 1,
  });

  function renderPending() {
    (hookMod.useTimeOffRequests as ReturnType<typeof vi.fn>).mockReturnValue({
      timeOffRequests: [make('p1', 'pending')],
      loading: false,
    });
    render(<TimeOffList restaurantId="rest-1" />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /approve time-off for emp p1/i }));
  }

  it('approves at once when the employee has no shifts', async () => {
    mockFetchImpact.mockResolvedValue({ shifts: [], overlapping_approved: 0 });
    mockApproveAsync.mockResolvedValue({ id: 'p1' });
    renderPending();
    await waitFor(() =>
      expect(mockApproveAsync).toHaveBeenCalledWith({ id: 'p1', restaurantId: 'rest-1', override: false })
    );
    expect(screen.queryByRole('heading', { name: 'Approve time off' })).not.toBeInTheDocument();
    expect(mockApplyAsync).not.toHaveBeenCalled();
  });

  it('approves and names the gap when the shift fetch fails', async () => {
    mockFetchImpact.mockRejectedValue(new Error('network'));
    mockApproveAsync.mockResolvedValue({ id: 'p1' });
    renderPending();
    await waitFor(() => expect(mockApproveAsync).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Could not check shifts',
        description: 'The request is approved without a shift action.',
      })
    );
  });

  it('opens the dialog, approves first, then posts the shifts', async () => {
    mockFetchImpact.mockResolvedValue({ shifts: [impactShift('s1'), impactShift('s2')], overlapping_approved: 0 });
    mockApproveAsync.mockResolvedValue({ id: 'p1' });
    mockApplyAsync.mockResolvedValue({ done: 2, skipped: 0, failed: 0 });
    renderPending();

    const confirm = await screen.findByRole('button', { name: 'Approve and post 2 shifts' });
    expect(mockApproveAsync).not.toHaveBeenCalled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mockApplyAsync).toHaveBeenCalledWith({
        restaurantId: 'rest-1',
        employeeId: 'e-p1',
        shiftIds: ['s1', 's2'],
        action: { kind: 'trade', note: 'Approved PTO' },
      })
    );
    expect(mockApproveAsync.mock.invocationCallOrder[0]).toBeLessThan(mockApplyAsync.mock.invocationCallOrder[0]);
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Approve time off' })).not.toBeInTheDocument()
    );
  });

  it('runs the shift action once on a double click', async () => {
    mockFetchImpact.mockResolvedValue({ shifts: [impactShift('s1')], overlapping_approved: 0 });
    let resolveApprove: (v: unknown) => void = () => {};
    mockApproveAsync.mockReturnValue(new Promise((r) => { resolveApprove = r; }));
    mockApplyAsync.mockResolvedValue({ done: 1, skipped: 0, failed: 0 });
    renderPending();

    const confirm = await screen.findByRole('button', { name: 'Approve and post 1 shift' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    resolveApprove({ id: 'p1' });

    await waitFor(() => expect(mockApplyAsync).toHaveBeenCalledTimes(1));
    expect(mockApproveAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps the shift choice through a policy warning', async () => {
    mockFetchImpact.mockResolvedValue({ shifts: [impactShift('s1'), impactShift('s2')], overlapping_approved: 0 });
    mockApproveAsync
      .mockRejectedValueOnce(new PolicyWarningError([{ rule: 'min_staffing', message: 'Staffing drops below 2.' } as never]))
      .mockResolvedValueOnce({ id: 'p1' });
    mockApplyAsync.mockResolvedValue({ done: 2, skipped: 0, failed: 0 });
    renderPending();

    fireEvent.click(await screen.findByLabelText('Delete the shifts'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve and delete 2 shifts' }));

    expect(await screen.findByText('After approval: delete 2 shifts.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Approve time off' })).not.toBeInTheDocument();
    expect(document.body.style.pointerEvents).not.toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'Approve anyway and delete 2 shifts' }));
    await waitFor(() =>
      expect(mockApproveAsync).toHaveBeenLastCalledWith({ id: 'p1', restaurantId: 'rest-1', override: true })
    );
    await waitFor(() =>
      expect(mockApplyAsync).toHaveBeenCalledWith(expect.objectContaining({ action: { kind: 'delete' } }))
    );
  });

  it('changes nothing when the manager cancels the policy dialog', async () => {
    mockFetchImpact.mockResolvedValue({ shifts: [impactShift('s1')], overlapping_approved: 0 });
    mockApproveAsync.mockRejectedValueOnce(
      new PolicyWarningError([{ rule: 'min_staffing', message: 'Staffing drops below 2.' } as never])
    );
    renderPending();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve and post 1 shift' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ title: 'Nothing changed' }));
    expect(mockApplyAsync).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `npx vitest run tests/unit/TimeOffList.test.tsx`
Expected: the six new tests FAIL. The old tests PASS.

- [ ] **Step 4: Change `TimeOffList`**

In `src/components/TimeOffList.tsx`:

(a) Change the imports. Add these lines in the CLAUDE.md import order:

```tsx
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  fetchTimeoffCoverageImpact,
  timeoffCoverageImpactKey,
  useTimeoffCoverageImpact,
  type CoverageImpactShift,
} from '@/hooks/useShiftProtection';
import { useApplyTimeOffShiftAction, type TimeOffShiftAction } from '@/hooks/useTimeOffShiftAction';
import { TimeOffShiftsDialog } from './timeoff/TimeOffShiftsDialog';
```

Delete the old `import { useState } from 'react';` and the old
`useTimeoffCoverageImpact` import line.

(b) Replace the `policyTarget` state block (`:46-53`) and add the new state:

```tsx
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const applyShiftAction = useApplyTimeOffShiftAction();

  // A shift choice made in TimeOffShiftsDialog. It travels into the
  // policy dialog, so "Approve anyway" still applies it.
  type PendingShiftAction = { shifts: CoverageImpactShift[]; action: TimeOffShiftAction };

  // Shift Protection: an approve that answers policy_warning lands here.
  // The dialog shows the findings plus the coverage impact (fetched
  // lazily, only for this one request) and offers "Approve anyway".
  const [policyTarget, setPolicyTarget] = useState<{
    request: TimeOffRequest;
    warnings: PolicyFinding[];
    shiftAction: PendingShiftAction | null;
  } | null>(null);
  const coverageImpact = useTimeoffCoverageImpact(policyTarget?.request.id ?? null);

  // The employee's shifts in the request dates, shown before the approval.
  const [shiftsTarget, setShiftsTarget] = useState<{
    request: TimeOffRequest;
    shifts: CoverageImpactShift[];
  } | null>(null);

  // True while an async step runs (shift fetch, approval, shift action).
  // The ref blocks a second click before React re-renders.
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  function lock() {
    if (submittingRef.current) return false;
    submittingRef.current = true;
    setSubmitting(true);
    return true;
  }
  function unlock() {
    submittingRef.current = false;
    setSubmitting(false);
  }
```

(c) Replace `handleApprove` and `handleApproveAnyway` (`:59-77`) with:

```tsx
  // Approve, then apply the shift choice. Returns false if the approval
  // did not go through. A policy warning moves the choice into the
  // policy dialog: both state updates run in one handler, so React
  // batches the dialog swap.
  async function approveThenApply(
    request: TimeOffRequest,
    shiftAction: PendingShiftAction | null,
    override: boolean
  ) {
    try {
      await approveRequest.mutateAsync({ id: request.id, restaurantId, override });
    } catch (error) {
      if (error instanceof PolicyWarningError && !override) {
        setShiftsTarget(null);
        setPolicyTarget({ request, warnings: error.warnings, shiftAction });
      }
      return false;
    }
    if (shiftAction) {
      await applyShiftAction.mutateAsync({
        restaurantId,
        employeeId: request.employee_id,
        shiftIds: shiftAction.shifts.map((shift) => shift.shift_id),
        action: shiftAction.action,
      });
    }
    setShiftsTarget(null);
    setPolicyTarget(null);
    return true;
  }

  async function handleApprove(request: TimeOffRequest) {
    if (!lock()) return;
    try {
      let shifts: CoverageImpactShift[];
      try {
        const impact = await queryClient.fetchQuery({
          queryKey: timeoffCoverageImpactKey(request.id),
          queryFn: () => fetchTimeoffCoverageImpact(request.id),
          staleTime: 0,
        });
        shifts = impact.shifts;
      } catch {
        // A failed check does not block the approval.
        const approved = await approveThenApply(request, null, false);
        if (approved) {
          toast({
            title: 'Could not check shifts',
            description: 'The request is approved without a shift action.',
          });
        }
        return;
      }
      if (shifts.length === 0) {
        await approveThenApply(request, null, false);
        return;
      }
      setShiftsTarget({ request, shifts });
    } finally {
      unlock();
    }
  }

  async function handleConfirmShifts(action: TimeOffShiftAction) {
    if (!shiftsTarget || !lock()) return;
    try {
      await approveThenApply(shiftsTarget.request, { shifts: shiftsTarget.shifts, action }, false);
    } finally {
      unlock();
    }
  }

  async function handleApproveAnyway() {
    if (!policyTarget || !lock()) return;
    try {
      await approveThenApply(policyTarget.request, policyTarget.shiftAction, true);
    } finally {
      unlock();
    }
  }

  function handleCancelPolicy() {
    if (submittingRef.current) return;
    if (policyTarget?.shiftAction) toast({ title: 'Nothing changed' });
    setPolicyTarget(null);
  }

  function policyActionText(shiftAction: PendingShiftAction) {
    const n = shiftAction.shifts.length;
    const verb = shiftAction.action.kind === 'trade' ? 'post' : 'delete';
    const suffix = shiftAction.action.kind === 'trade' ? ' for trade' : '';
    return `${verb} ${n} ${n === 1 ? 'shift' : 'shifts'}${suffix}`;
  }
```

Note: the "Approve anyway" button text uses `Approve anyway and delete 2 shifts`
and `Approve anyway and post 2 shifts` (no "for trade" suffix). The policy
note line uses the suffix: `After approval: post 2 shifts for trade.`
Build the button text with `${verb} ${n} ${shiftWord}` only.

(d) Change the `PendingQueue` prop at `:133`:

```tsx
          isApproving={approveRequest.isPending || submitting}
```

(e) Under the `TimeOffRequestDialog` element, add:

```tsx
      <TimeOffShiftsDialog
        key={shiftsTarget?.request.id ?? 'none'}
        request={shiftsTarget?.request ?? null}
        shifts={shiftsTarget?.shifts ?? []}
        submitting={submitting}
        onCancel={() => setShiftsTarget(null)}
        onConfirm={handleConfirmShifts}
      />
```

(f) In the policy `AlertDialog`:

- Change `onOpenChange` at `:152` to `(open) => { if (!open) handleCancelPolicy(); }`.
- After the `ShiftProtectionWarning` element (`:168`), add:

```tsx
              {policyTarget.shiftAction && (
                <p className="text-[13px] font-medium text-foreground">
                  After approval: {policyActionText(policyTarget.shiftAction)}.
                </p>
              )}
```

- Change the footer (`:216-228`) to:

```tsx
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleApproveAnyway();
              }}
              disabled={submitting}
              className="bg-warning text-warning-foreground hover:bg-warning/90"
            >
              {submitting
                ? 'Approving…'
                : policyTarget?.shiftAction
                  ? `Approve anyway and ${policyTarget.shiftAction.action.kind === 'trade' ? 'post' : 'delete'} ${policyTarget.shiftAction.shifts.length} ${policyTarget.shiftAction.shifts.length === 1 ? 'shift' : 'shifts'}`
                  : 'Approve anyway'}
            </AlertDialogAction>
          </AlertDialogFooter>
```

`AlertDialogCancel` calls `onOpenChange(false)`, so Cancel goes through
`handleCancelPolicy`.

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run tests/unit/TimeOffList.test.tsx tests/unit/TimeOffRow.test.tsx tests/unit/TimeOffShiftsDialog.test.tsx tests/unit/useTimeOffShiftAction.test.tsx`
Expected: PASS (all tests, old and new).

If the "keeps the shift choice" test fails on `pointer-events`, do not
remove the assertion. Check that `setShiftsTarget(null)` and
`setPolicyTarget(...)` run in the same handler with no `await` between them.

- [ ] **Step 6: Change the spec for the two deviations**

In `docs/superpowers/specs/2026-10-25-pto-shift-conflict-design.md`,
section "Double-click and close guard":

- Replace the bullet that starts "`submitting` is true from the Approve
  click" with: "`submitting` is true while an async step runs: the shift
  fetch, the approval, or the shift action. While the dialog waits for a
  choice, `submitting` is false. The modal covers the row, so the row
  cannot get a second click."
- In the next bullet, delete the two sentences about the `Loader2`
  spinner on the row.

In the "Flow" block, delete "submitting stays true." from the
`PolicyWarningError` branch.

- [ ] **Step 7: Run the type check and the lint**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx eslint src/components/TimeOffList.tsx src/components/timeoff/TimeOffShiftsDialog.tsx src/hooks/useTimeOffShiftAction.ts src/hooks/useShiftProtection.ts src/hooks/useShiftTrades.ts`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useShiftProtection.ts src/components/TimeOffList.tsx tests/unit/TimeOffList.test.tsx docs/superpowers/specs/2026-10-25-pto-shift-conflict-design.md
git commit -m "feat(timeoff): offer the shift choice when a manager approves time off"
```

---

## Self-review

- Spec coverage: the flow (Task 3), the hook and helpers (Task 1), the
  dialog with layout, a11y, and tokens (Task 2), the policy dialog text
  (Task 3), the guard (Tasks 2 and 3), the `employee_id` filter and the
  zero-row count (Task 1), the fetch-failure toast (Task 3), and the
  query invalidation (Task 1). No SQL work, as the spec says.
- Names match across tasks: `TimeOffShiftAction`, `ShiftActionSummary`,
  `DEFAULT_TRADE_NOTE`, `useApplyTimeOffShiftAction`,
  `fetchTimeoffCoverageImpact`, `timeoffCoverageImpactKey`,
  `TimeOffShiftsDialog`.
- Each Review Focus line has a test in its owning task.

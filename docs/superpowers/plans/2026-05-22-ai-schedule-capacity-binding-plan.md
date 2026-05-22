# Plan: AI schedule under-generation + template binding fixes

Spec: `docs/superpowers/specs/2026-05-22-ai-schedule-capacity-binding-design.md`

## Sequence

Tasks run sequentially (each TDD cycle commits once). Tests within a
task may be batched, but RED → GREEN → REFACTOR → COMMIT applies to
each task as a whole.

---

### Task 1 — Capacity-based required-staff floor (Bug A)

**Files to touch:**
- `supabase/functions/_shared/schedule-prompt-builder.ts`
- `supabase/functions/_shared/staffing-requirements.ts`
- `supabase/functions/generate-schedule/index.ts`
- `tests/unit/staffing-requirements.test.ts`

**RED — new test cases in `tests/unit/staffing-requirements.test.ts`:**

```ts
it('falls back to template capacity when no min_crew and no patterns', () => {
  const result = computeRequiredStaff({
    templates: [
      {
        id: 't1', name: 'Close', days: [1, 2, 3], start_time: '16:00',
        end_time: '23:30', position: 'Server', area: null, capacity: 4,
      },
    ],
    minCrew: null, minStaff: null, priorPatterns: [], hourlySales: [],
  });
  expect(result.get('t1')?.get(1)).toBe(4);
  expect(result.get('t1')?.get(2)).toBe(4);
  expect(result.get('t1')?.get(3)).toBe(4);
});

it('still honors min_crew override when capacity is lower', () => {
  const result = computeRequiredStaff({
    templates: [
      {
        id: 't1', name: 'Close', days: [1], start_time: '16:00',
        end_time: '23:30', position: 'Server', area: null, capacity: 2,
      },
    ],
    minCrew: { Server: 5 },
    minStaff: null, priorPatterns: [], hourlySales: [],
  });
  expect(result.get('t1')?.get(1)).toBe(5);
});

it('still honors prior pattern over capacity when min_crew is absent', () => {
  const result = computeRequiredStaff({
    templates: [
      {
        id: 't1', name: 'Close', days: [1], start_time: '16:00',
        end_time: '23:30', position: 'Server', area: null, capacity: 4,
      },
    ],
    minCrew: null, minStaff: null,
    priorPatterns: [{ day_of_week: 1, position: 'Server', avg_count: 3 }],
    hourlySales: [],
  });
  expect(result.get('t1')?.get(1)).toBe(3);
});

it('adds peak boost on top of capacity fallback', () => {
  const result = computeRequiredStaff({
    templates: [
      {
        id: 't1', name: 'Close', days: [1], start_time: '16:00',
        end_time: '23:30', position: 'Server', area: null, capacity: 4,
      },
    ],
    minCrew: null, minStaff: null, priorPatterns: [],
    hourlySales: [{ day_of_week: 1, hour: 16, avg_sales: 1000 }],
  });
  expect(result.get('t1')?.get(1)).toBe(5);
});
```

Also update every existing ScheduleTemplate fixture in
`staffing-requirements.test.ts` to include `capacity: 1` so they still
construct.

**GREEN — implementation:**

1. `schedule-prompt-builder.ts` — add `capacity: number` to
   `ScheduleTemplate` interface.
2. `staffing-requirements.ts:102` — change to
   `const base = fromMinCrew ?? fromPattern ?? tpl.capacity ?? 1;`.
3. `generate-schedule/index.ts:138` — add `capacity` to the
   `shift_templates` SELECT list.
4. `generate-schedule/index.ts:257-265` — carry
   `capacity: t.capacity ?? 1` in the mapper. Comment why `?? 1`
   exists (defensive against test fixtures; DB has `DEFAULT 1
   CHECK >= 1`).

**REFACTOR:** none expected; this is a one-line semantic widening plus
type addition. Run `npm run typecheck` + the new tests.

**COMMIT:** `fix(scheduling): capacity-based required-staff floor (Bug A)`

---

### Task 2 — `DAY_NOT_IN_TEMPLATE` validator (Bug C)

**Files to touch:**
- `supabase/functions/_shared/schedule-validator.ts`
- `supabase/functions/generate-schedule/index.ts`
- `tests/unit/schedule-validator.test.ts` (existing file; update
  fixtures + add new cases)

**RED — new test cases:**

```ts
it('drops a shift whose day-of-week is not in the template active days',
  () => {
    const ctx: ValidationContext = {
      employeeIds: new Set(['e1']),
      employeePositions: new Map([['e1', 'Server']]),
      templates: new Map([
        ['weekend-close', { days: [0, 5, 6] }], // Sun, Fri, Sat only
      ]),
      availability: new Map([
        ['e1:1', { isAvailable: true, startTime: '10:00:00', endTime: '22:30:00' }],
      ]),
      excludedEmployeeIds: new Set(),
      existingShifts: [],
    };
    const result = validateGeneratedShifts([
      {
        employee_id: 'e1', template_id: 'weekend-close',
        day: '2026-06-01', // Monday (dow=1)
        start_time: '16:00:00', end_time: '22:30:00', position: 'Server',
      },
    ], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('DAY_NOT_IN_TEMPLATE');
  });

it('allows a shift whose day-of-week IS in the template active days',
  () => {
    const ctx: ValidationContext = {
      employeeIds: new Set(['e1']),
      employeePositions: new Map([['e1', 'Server']]),
      templates: new Map([
        ['weekday-close', { days: [1, 2, 3, 4, 5] }],
      ]),
      availability: new Map([
        ['e1:1', { isAvailable: true, startTime: '10:00:00', endTime: '22:30:00' }],
      ]),
      excludedEmployeeIds: new Set(),
      existingShifts: [],
    };
    const result = validateGeneratedShifts([
      {
        employee_id: 'e1', template_id: 'weekday-close',
        day: '2026-06-01', start_time: '16:00:00', end_time: '22:30:00',
        position: 'Server',
      },
    ], ctx);
    expect(result.valid).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });
```

Update every existing test in `schedule-validator.test.ts` to use the
new context shape: replace `templateIds: new Set([...])` with
`templates: new Map(ids.map(id => [id, { days: [0,1,2,3,4,5,6] }]))`.

**GREEN — implementation:**

1. `schedule-validator.ts`:
   - Add `DAY_NOT_IN_TEMPLATE` to the `DropCode` union.
   - Replace `templateIds: Set<string>` in `ValidationContext` with
     `templates: Map<string, { days: number[] }>`.
   - In `validateGeneratedShifts`, change the UNKNOWN_TEMPLATE check
     from `ctx.templateIds.has(shift.template_id)` to
     `ctx.templates.has(shift.template_id)`.
   - After UNKNOWN_TEMPLATE, insert: `const tpl = ctx.templates.get(...);
     if (!tpl.days.includes(getDayOfWeek(shift.day))) drop('DAY_NOT_IN_TEMPLATE', ...)`.
2. `generate-schedule/index.ts`:
   - Replace `const templateIds = new Set(templates.map(...))` with
     `const templateDays = new Map(templates.map(t => [t.id, { days: t.days }]))`.
   - Pass `templates: templateDays` in `validationCtx`.
   - Add `case "DAY_NOT_IN_TEMPLATE":` to the `droppedReasons` switch
     mapping (e.g., `Template not active on ${d.shift.day}`).

**REFACTOR:** none.

**COMMIT:** `fix(scheduling): drop shifts placed on a template's inactive days (Bug C)`

---

### Task 3 — Tighten SYSTEM_PROMPT Rule 1 (Bug D)

**Files to touch:**
- `supabase/functions/_shared/schedule-prompt-builder.ts`
- `tests/unit/schedule-prompt-builder.test.ts` (existing)

**RED — new test case:**

```ts
it('Rule 1 constrains template usage to listed active days', () => {
  const result = buildSchedulePrompt({ ...minimalCtx });
  const systemMsg = result.messages.find(m => m.role === 'system')!.content;
  expect(systemMsg).toMatch(/only on the days listed in that template/i);
});
```

(Add `minimalCtx` builder if one isn't present, mirroring existing
tests in the file.)

**GREEN — implementation:**

Update SYSTEM_PROMPT Rule 1 in `schedule-prompt-builder.ts`:

```text
1. ONLY use the provided shift templates as shift blocks — do not invent custom time ranges, AND only on the days listed in that template's "active days" field (see the Shift Templates section).
```

**REFACTOR:** none.

**COMMIT:** `fix(scheduling): constrain templates to their active days in Rule 1 (Bug D)`

---

### Task 4 — Persist `shift_template_id` (Bug B)

**Files to touch:**
- `src/hooks/useGenerateSchedule.ts`
- `src/hooks/useShiftPlanner.ts` (one-line comment only)
- `tests/unit/useGenerateSchedule.test.tsx`

**RED — strengthen existing test mock + new assertions:**

```ts
// In tests/unit/useGenerateSchedule.test.tsx:
// 1. Ensure insertMock captures args (mockResolvedValue already returns
//    { error: null }; .mock.calls is automatic).
// 2. New assertion after the existing 'inserts shifts on success' test:

it('persists shift_template_id from the LLM response', async () => {
  invokeMock.mockResolvedValueOnce({
    data: {
      shifts: [
        { employee_id: 'e1', template_id: 'tmpl-1', day: '2026-06-01',
          start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
      ],
      metadata: { /* … */ },
    },
    error: null,
  });
  // … call mutateAsync …
  await waitFor(() => expect(insertMock).toHaveBeenCalled());
  const rows = insertMock.mock.calls[0][0] as Array<Record<string, unknown>>;
  expect(rows[0].shift_template_id).toBe('tmpl-1');
});

it('coerces empty-string template_id to null on insert', async () => {
  invokeMock.mockResolvedValueOnce({
    data: {
      shifts: [
        { employee_id: 'e1', template_id: '', day: '2026-06-01',
          start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
      ],
      metadata: { /* … */ },
    },
    error: null,
  });
  // … call mutateAsync …
  await waitFor(() => expect(insertMock).toHaveBeenCalled());
  const rows = insertMock.mock.calls[0][0] as Array<Record<string, unknown>>;
  expect(rows[0].shift_template_id).toBeNull();
});
```

**GREEN — implementation:**

1. `useGenerateSchedule.ts`:
   - Widen `GeneratedShift.template_id` to `string | null | undefined`.
   - Add `shift_template_id: shift.template_id?.trim() || null,` to the
     insert payload.
2. `useShiftPlanner.ts:142-160`: add a single comment line above the
   fallback path noting it still covers manually-created shifts and
   any rows inserted by older bundles.

**REFACTOR:** none.

**COMMIT:** `fix(scheduling): persist shift_template_id on AI-generated shifts (Bug B)`

---

## Verification (Phase 8)

After all four commits, run in the worktree:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Skip `test:db` and `test:e2e` — neither is in scope for this change
(no SQL function, no UI workflow).

## Dependencies between tasks

- Task 1 is independent (capacity floor).
- Task 2 changes the `ValidationContext` shape used by Task 1 not at
  all and by Task 3 not at all. Safe to land in any order.
- Task 3 is a prompt string change — independent.
- Task 4 is hook-only — independent.

Commit them in the order listed (A → C → D → B) so the diff reads
edge-function-first, frontend-last, but any permutation is safe.

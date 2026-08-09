# Sensitive-data UI gating — design

**Date:** 2026-08-09
**Branch:** `fix/sensitive-data-ui-gating` (off `main` f0c5f0db)
**Type:** Follow-up debt from PR #727 (merged). Client-side gating only.

## Goal

Close three UI gaps that the Codex adversarial reviewer flagged on merged
`main`. PR #727 made `view:pay_rates` and `view:employee_pii` real in SQL. The
UI did not follow. Fix the copy and the input gating so the screen matches the
enforcement.

## Scope

One PR. Three fixes. No SQL, no masked view, no column REVOKE change.

`view:costs` stays deferred. No screen and no policy reads it yet.

## Background — what is already enforced

- The masked view `employees_secure` and the column REVOKE hide the eight
  sensitive columns from a caller without the flag (PR #727, merged).
- The two mutation hooks strip masked keys before the write, so a masked NULL
  cannot overwrite a real value. Create path: `src/hooks/useEmployees.tsx:94`
  → `src/hooks/useEmployees.tsx:101`. Update path:
  `src/hooks/useEmployees.tsx:135` → `src/hooks/useEmployees.tsx:142`. Both
  call `assertPermissionsResolved(isResolved)` first
  (`src/hooks/useEmployees.tsx:90`, `src/hooks/useEmployees.tsx:133`).
- The masked field lists are `PAY_RATE_FIELDS` (5 columns,
  `src/lib/employeeMaskedFields.ts:16`) and `EMPLOYEE_PII_FIELDS`
  (`email`, `phone`, `date_of_birth`, `src/lib/employeeMaskedFields.ts:25`).

So a caller without `view:employee_pii` already writes nothing to the three PII
columns, on create and on update. The PII inputs are non-functional for that
caller today. The gating below makes that state honest, and stops a masked
blank box from reading as an intent to clear.

## The three flags render together

`SENSITIVE_FLAGS` (`src/lib/permissions/areas.ts:87`) holds all three:

- `view:costs` → "Item costs & margins" (`src/lib/permissions/areas.ts:94`)
- `view:pay_rates` → "Employee pay rates" (`src/lib/permissions/areas.ts:100`)
- `view:employee_pii` → "Contact details" (`src/lib/permissions/areas.ts:106`)

`RoleEditor` maps over the array (`src/components/roles/RoleEditor.tsx:667`) and
renders one shared paragraph above all three rows
(`src/components/roles/RoleEditor.tsx:662`). That paragraph, and the code
comment above it (`src/components/roles/RoleEditor.tsx:656`), now describe a
state that is only true for one of the three flags.

---

## Fix 1 — RoleEditor copy and comment

### Current state (false for two of three flags)

The paragraph at `src/components/roles/RoleEditor.tsx:662`:

> "Recorded on the role, but not enforced yet — these fields still follow area
> access everywhere in the app. Set them for the role you want; they take
> effect when per-field gating ships."

The comment at `src/components/roles/RoleEditor.tsx:656` says "no screen and no
RLS policy reads them yet, so leaving one off hides nothing."

Both are now false for `view:pay_rates` and `view:employee_pii`.

### Change

Rewrite the shared paragraph to tell the enforced flags apart from the deferred
one. Proposed copy (STE-aligned, final wording set in Phase 4):

> "Employee pay rates and contact details are enforced. A role without the
> switch cannot read those fields. Item costs and margins still follow area
> access; that switch has no effect yet."

Rewrite the comment to state the same split: two flags gate real reads and
writes now; `view:costs` is not gated yet.

No data change. No new prop. Copy and comment only.

---

## Fix 2 — Gate the PII inputs in EmployeeDialog

### Current state

`EmployeeDialog` derives one capability today
(`src/components/EmployeeDialog.tsx:119`):

```ts
const canSeePayRates = isPermissionsResolved && hasCapability('view:pay_rates');
```

`usePermissions` is already imported (`src/components/EmployeeDialog.tsx:12`) and
destructured (`src/components/EmployeeDialog.tsx:118`). The PII inputs are not
gated:

- email `<Input id="email">` (`src/components/EmployeeDialog.tsx:1248`)
- phone `<Input id="phone">` (`src/components/EmployeeDialog.tsx:1261`)
- dateOfBirth `<Input id="dateOfBirth">` (`src/components/EmployeeDialog.tsx:1358`)

### Change

Add next to line 119:

```ts
const canSeePii = isPermissionsResolved && hasCapability('view:employee_pii');
```

Add `disabled={!canSeePii}` to the three inputs above. Add a short comment,
same shape as the pay-gate note.

### No self-row exception

The merged pay gate at `src/components/EmployeeDialog.tsx:119` does not
special-case the current user. A grep of the file finds no `user_id`, `self`,
or `own`-based gate on capability. `EmployeeDialog` is the admin edit surface,
not the self-edit surface. So the PII gate mirrors the pay gate with no self
exception, and the two stay consistent.

### The email input is dual-purpose — decision

Email is a PII field and the invite key. `findMemberByEmail`
(`src/components/EmployeeDialog.tsx:121`) reads it, and the link RPC uses the
match (`src/components/EmployeeDialog.tsx:495`, `p_user_id` at
`src/components/EmployeeDialog.tsx:499`).

**Decision (approved): gate email like phone and date_of_birth.**

Reasons:

- Email is in `EMPLOYEE_PII_FIELDS` (`src/lib/employeeMaskedFields.ts:25`). The
  write path strips it for a no-PII caller on create and update, so the input
  is already non-functional for that caller.
- A blank masked email that stays editable invites an accidental clear. Disable
  removes that trap.
- Every builtin role that can reach this dialog holds `view:employee_pii`, so
  standard invite flows keep working. Only three builtin roles hold
  `manage:employees`: `owner` (`src/lib/permissions/definitions.ts:75`),
  `manager` (`src/lib/permissions/definitions.ts:139`), and
  `operations_manager` (`src/lib/permissions/definitions.ts:186`). All three
  also hold `view:employee_pii` (`src/lib/permissions/definitions.ts:88`,
  `src/lib/permissions/definitions.ts:150`,
  `src/lib/permissions/definitions.ts:194`). Only a custom role set to manage
  employees without the PII flag loses invite-by-typed-email — and that role
  cannot see any contact details anyway, so the block is consistent.

Trade-off accepted: a custom no-PII role loses invite-by-email in this dialog.

---

## Fix 3 — Gate the pay-schedule controls in EmployeeDialog

### Current state

Pay-amount controls already carry `disabled={!canSeePayRates}`
(`src/components/EmployeeDialog.tsx:907`,
`src/components/EmployeeDialog.tsx:947`,
`src/components/EmployeeDialog.tsx:1015`,
`src/components/EmployeeDialog.tsx:1112`,
`src/components/EmployeeDialog.tsx:1175`). The pay-schedule controls do not:

- Pay Period `<Select value={payPeriodType}>`
  (`src/components/EmployeeDialog.tsx:1039`)
- Allocate Daily `<Checkbox id="allocateDaily">`
  (`src/components/EmployeeDialog.tsx:1056`)
- Payment Interval `<Select value={contractorPaymentInterval}>`
  (`src/components/EmployeeDialog.tsx:1121`)
- Standard Work Days `<Select value={dailyRateStandardDays}>`
  (`src/components/EmployeeDialog.tsx:1187`)

### Change

Add `disabled={!canSeePayRates}` to the four controls. The shadcn `Select` root
and `Checkbox` both accept `disabled`.

These controls set pay cadence, not a masked pay amount. Gate them for the same
reason the amounts are gated: a role without pay-rate access must not change pay
configuration.

---

## Testing

### Unit (primary coverage)

New file `tests/unit/EmployeeDialog.sensitiveGating.test.tsx`. Mock
`usePermissions`, `useAuth`, `useRestaurantContext`, and the mutation hooks
(`EmployeeDialog` mounts `EmployeeAppAccessRow`, which calls `useAuth` —
`memory/lessons.md` line 2318). Assert:

1. Without `view:employee_pii`: email, phone, dateOfBirth inputs are `disabled`.
2. With `view:employee_pii`: the three inputs are enabled.
3. Without `view:pay_rates`: the four pay-schedule controls are `disabled`.
   Drive the compensation type through the `employee` prop so each control
   renders (`salary` shows Pay Period + Allocate Daily, `contractor` shows
   Payment Interval, `daily_rate` shows Standard Work Days).

RoleEditor copy: a light assertion that the paragraph names the enforced flags
and the deferred flag, if a RoleEditor test harness already exists; otherwise
the copy is static text and the unit gate above is the primary coverage.

### Fix an existing test that Fix 2 makes misleading

`tests/unit/EmployeeDialog.maskedDob.test.tsx` has two tests with opposite
permission premises, but no `usePermissions` mock. The real hook then falls
through to a null-role branch, so `hasCapability` returns `false` for both
tests. Test 1 (`tests/unit/EmployeeDialog.maskedDob.test.tsx:119`,
`MASKED_EMPLOYEE`) expects a caller without `view:employee_pii`. Test 2
(`tests/unit/EmployeeDialog.maskedDob.test.tsx:138`, `VISIBLE_DOB_EMPLOYEE`)
expects a caller who holds `view:employee_pii` ("a caller who CAN see the
date"). After Fix 2, `canSeePii` is `false` for both, so the date_of_birth
input disables in test 2 too, and contradicts its own premise. The test still
passes only because `fireEvent.change` writes the DOM value directly and
bypasses the native `disabled` gate.

A single file-level granting mock (the pattern at
`tests/unit/EmployeeDialog.maskedRate.test.tsx:54`) fixes test 2 but falsifies
test 1. So control `hasCapability` per test with `vi.hoisted`:

```ts
const { mockHasCapability } = vi.hoisted(() => ({ mockHasCapability: vi.fn() }));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasCapability: mockHasCapability, isResolved: true }),
}));
```

- Test 1 (masked, no PII): `mockHasCapability.mockImplementation((c) => c !== 'view:employee_pii')`.
- Test 2 (visible DOB): `mockHasCapability.mockReturnValue(true)`.

This keeps both premises honest and keeps both assertions green.

### E2E

Extend `tests/e2e/sensitive-data-flags.spec.ts` only if it already opens
`EmployeeDialog` in a no-PII role session. Otherwise a justified exception: the
SQL boundary (masked reads plus write strip) is already E2E-covered by that
spec, and the unit tests assert the disabled state deterministically. This PR
adds no route, no RPC, and no new record-authorization seam — it disables
inputs on an existing dialog.

---

## Out of scope

The IncomeStatement "Payroll Expense (unposted)" residual. Separate later PR,
already flagged at its call site.

## Decided trade-offs

- Gate email with the other PII fields. A custom no-PII role loses
  invite-by-email in this dialog. Accepted — that role has no PII access.
- No new `enforced` field on `SENSITIVE_FLAGS`. The shared paragraph states the
  split in prose. Keeps the change to copy, not data.
- Silent disable, no `title` tooltip on a disabled control. This matches the
  five pay-amount controls already live (`src/components/EmployeeDialog.tsx:907`
  and siblings). A hint is optional polish, not part of this PR.

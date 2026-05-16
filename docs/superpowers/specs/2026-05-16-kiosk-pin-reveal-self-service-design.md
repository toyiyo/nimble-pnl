# Kiosk PIN Setup — Manager Reveal & Employee Self-Service

**Date:** 2026-05-16
**Branch:** `feature/kiosk-pin-reveal-self-service`

## Problem

The current kiosk PIN setup flow has three gaps:

1. **Bulk "Generate N missing" silently discards plain-text PINs.** The
   `useUpsertEmployeePin` mutation returns the plain PIN once, but the bulk
   path in `TimePunchesManager.tsx` only surfaces a count toast ("Created
   PINs for 5 employees"). Because PINs are stored as SHA-256 hashes in
   `employee_pins.pin_hash`, the plain values are unrecoverable after the
   request completes.
2. **No notification reaches the employee** when a manager creates or
   resets their PIN. There's no email and no push notification path for PIN
   changes.
3. **Employees have no self-service path.** `/employee/more` exposes
   timecard, requests, shifts, and tips — nothing for kiosk PIN status or
   reset. If an employee forgets their PIN, they have no recourse except
   asking the manager.

A fourth, softer issue: the manager UI doesn't communicate that resetting a
PIN won't send the new digits to the employee.

## Goals

- Manager can see and copy/print every PIN generated in a session, exactly
  once.
- Employee receives an out-of-band notification ("your manager updated your
  kiosk PIN") that does **not** contain the PIN value.
- Employee can view PIN status and generate a new PIN for themselves from
  `/employee/pin` without needing the manager.
- Kiosk remains a single-input device — no PIN management surface there.
- No DB schema changes; reuse the existing hashed `employee_pins` table.

## Non-goals

- SMS delivery of PINs (out of scope; no existing Twilio integration).
- Storing PINs in a reversible (encrypted) form. Hashing stays.
- Letting the kiosk service account create or reset PINs. The kiosk takes
  a single numeric input; that's a deliberate design boundary.
- Reworking the global notification preference system. The new PIN-changed
  email piggybacks on Resend and the existing `send-push-notification`
  edge function.

## Approach

Three coordinated changes, all gated on existing roles
(`owner`/`manager` for manager paths, employee self for employee paths):

### A. Manager — PIN Reveal Modal (one-time)

Capture the plain PIN that `useUpsertEmployeePin` already returns and
display it in a reveal modal instead of throwing it away.

- For the **bulk path** (`handleAutoGeneratePins`), accumulate every
  `{ employee_id, name, pin }` triple from the loop and open the modal
  once when the loop finishes.
- For the **single-employee path**, replace the current inline green
  "Saved: 1234" panel with the same modal (so the UX is consistent and the
  shared warning copy lives in one place).
- Modal contents:
  - Header: "PINs ready to share" with a warning subtitle: *"PINs are
    hashed in the database. You can't view them again after closing —
    distribute now."*
  - Table: `Name | Position | PIN | Copy` rows.
  - Footer actions: **Copy all** (formatted `Alice — 1234` lines, one per
    employee), **Print** (opens `window.print()` against a printer-friendly
    card layout already inside the dialog), and **Done**.
- The reveal modal is the only place the PIN appears outside the
  generation moment.

### B. Manager — Hint about non-delivery

In `EmployeePinsCard` and the existing per-employee PIN dialog, add a small
muted-tone hint:

> *"Resetting a PIN doesn't email the new digits. We'll notify the
> employee that you changed it — you'll need to share the new PIN in
> person."*

This sets correct expectations and reduces "why didn't they get it?"
support questions.

### C. Employee notification (no PIN value)

New edge function `notify-pin-changed`:

- Inputs: `restaurantId`, `employeeId`, `action: 'created' | 'reset'`,
  `actor: 'manager' | 'self'`.
- When `actor === 'self'`, the function returns 204 without sending —
  notifying employees that they reset their own PIN is noise.
- When `actor === 'manager'`:
  - Looks up the employee record (`employees.user_id`, `employees.email`)
    and restaurant name.
  - Calls existing `send-push-notification` edge function with the
    employee's `user_id` (if any device tokens exist — it's a no-op
    otherwise).
  - Sends email via Resend (`employees.email`) using the existing
    `emailTemplates.ts` `generateHeader()` helper:
    - Subject: *"Your kiosk PIN was updated at {restaurant}"*
    - Body: *"For security, we don't email PIN values. Ask your manager
      for the new PIN, or visit
      [your employee portal](https://app.easyshifthq.com/employee/pin)
      to generate a new one yourself."*
  - Failures (missing email, Resend error, push failure) are logged but
    don't fail the request — PIN write already happened.
- Triggered from `useUpsertEmployeePin.onSuccess` whenever the caller
  context identifies as manager. To carry that context cleanly without
  threading a prop through every callsite, the hook accepts an optional
  `actor` parameter (default `'manager'` to preserve current behavior, but
  the employee page passes `'self'`).

### D. Employee — `/employee/pin` self-service page

New page + route:

- Route: `/employee/pin`, registered under the existing employee guard in
  `src/App.tsx` next to `/employee/timecard`, `/employee/portal`, etc.
- Page layout (Apple/Notion style from CLAUDE.md):
  - Header card: "Kiosk PIN"
  - Status row: "PIN set" + "Last used `X days ago`" *or* "No PIN yet —
    create one below."
  - Primary action: **Generate a new PIN** — calls `useUpsertEmployeePin`
    with `actor: 'self'`, `force_reset: false`, restaurant's current
    `min_length`. On success, shows the PIN in a green reveal panel with
    a Copy button.
  - Secondary action: **Type my own PIN** — collapses to an input + confirm
    field using the same validation as `PinChangeDialog`
    (`min_length`, `isSimpleSequence` if not allowed).
  - Reminder text: *"For security we never store readable PINs. If you
    forget yours, generate a new one here."*
- Add a `Kiosk PIN` entry to `EmployeeMore.tsx`'s `mainItems` list.

The page reuses the existing `useEmployeePins` query (filtered to the
caller's `employee_id`) and `useUpsertEmployeePin` mutation. No new server
endpoint needed for the employee path — RLS already permits the employee's
own row via `user_restaurants` membership.

### Wait — RLS check

Current RLS in `20251125100000_add_kiosk_mode.sql`:

- `employee_pins_select` permits any user linked to the restaurant.
- `employee_pins_manage` (INSERT/UPDATE/DELETE) restricts to
  `role in ('owner', 'manager')`.

That blocks employees from generating their own PIN. We need a narrower
INSERT/UPDATE policy that lets an employee write only the row whose
`employee_id` matches the employee row linked to `auth.uid()`.

**Schema impact:** add a new RLS policy
`employee_pins_self_manage` that allows INSERT/UPDATE when
`employee_pins.employee_id = (SELECT id FROM employees WHERE
user_id = auth.uid() AND restaurant_id = employee_pins.restaurant_id)`.
DELETE remains manager-only.

This is a small additive migration — no data backfill, no schema column
changes.

## Data flow

```
Manager bulk-generate
  └─► loop over missing employees
        ├─► useUpsertEmployeePin (per employee)
        │     ├─► server: hash + store
        │     └─► client: returns { pin, record }
        ├─► accumulate { name, pin, employee_id }
        └─► after loop, open PinRevealDialog
              └─► (fire-and-forget) notify-pin-changed
                    ├─► push notification (if device token)
                    └─► email "your PIN was updated" (no PIN value)

Manager single-set
  └─► same flow, list of length 1

Employee self-reset (/employee/pin)
  └─► useUpsertEmployeePin({ actor: 'self' })
        ├─► server: hash + store (new RLS policy permits employee's own row)
        ├─► client: shows PIN in-page green panel
        └─► no notification (actor === 'self' short-circuits)
```

## Files

### New
- `src/components/time-clock/PinRevealDialog.tsx` — reveal modal
- `src/pages/EmployeePin.tsx` — employee self-service page
- `supabase/functions/notify-pin-changed/index.ts` — push + email
- `supabase/migrations/<ts>_employee_self_pin_rls.sql` — RLS policy for
  employee self-manage
- `tests/unit/PinRevealDialog.test.tsx`
- `tests/unit/EmployeePin.test.tsx`
- `supabase/tests/employee_pins_self_rls.sql` — pgTAP test for the new
  policy

### Modified
- `src/hooks/useKioskPins.tsx` — accept `actor` in `UpsertPinInput`,
  no-op notification when `'self'`, fire `notify-pin-changed` when
  `'manager'`
- `src/pages/TimePunchesManager.tsx` — accumulate plain PINs from bulk
  loop, open reveal dialog; remove inline green "Saved" panel from PIN
  dialog (handled by reveal)
- `src/components/time-clock/EmployeePinsCard.tsx` — add non-delivery
  hint
- `src/pages/EmployeeMore.tsx` — add "Kiosk PIN" nav entry
- `src/App.tsx` — register `/employee/pin` route under employee guard

## Testing

- **Unit (`vitest`):**
  - `PinRevealDialog`: renders rows, copy-all formats correctly, print
    handler fires, "Done" closes.
  - `EmployeePin` page: generate button calls mutation with `actor:
    'self'`, generated PIN shows in green panel, custom-PIN flow
    validates min length and simple-sequence rules.
  - `useKioskPins`: `actor: 'manager'` triggers `notify-pin-changed`
    invoke, `actor: 'self'` does not.
- **Database (`pgTAP`):**
  - Employee can INSERT/UPDATE their own `employee_pins` row.
  - Employee cannot INSERT/UPDATE another employee's row.
  - Employee cannot DELETE any `employee_pins` row.
  - Manager still has full access (regression test).
- **Edge function:**
  - `notify-pin-changed` short-circuits on `actor: 'self'`.
  - `notify-pin-changed` swallows email/push errors and still returns 200.
- **Manual verification:**
  - Bulk-generate flow: open dev server, sign in as manager, generate PINs
    for ≥2 employees, confirm modal shows all PINs, Copy-all yields the
    expected newline-delimited string.
  - Employee-self flow: sign in as a staff user, navigate to
    `/employee/pin`, generate, confirm the PIN displays in-page and the
    kiosk accepts it.
  - Notification: with email captured to Resend logs, confirm the body
    contains no digits matching the new PIN.

## Risks & mitigations

- **PIN in browser memory.** The reveal modal holds plain PINs in React
  state for the duration of the dialog. Mitigation: state is cleared on
  unmount; the modal is the only place plain PINs persist; no plain PIN
  ever lands in localStorage/IndexedDB.
- **RLS migration ordering.** Adding the self-manage policy must come
  before deploying the new client code, or employee self-service will
  error with a permission denied. Mitigation: ship the migration first
  (single PR keeps it monotonic).
- **Email lookups missing.** Some employees may not have an `email` on
  the `employees` row. Mitigation: the edge function logs a warning and
  returns 200; the manager UI hint already tells the manager to share in
  person.
- **Push notification spam if a manager generates a lot in a row.** The
  bulk path fires N notifications. Mitigation: acceptable — these are
  distinct security-relevant events. If volume becomes a complaint we can
  coalesce later.

## Out of scope (deferred)

- Per-employee opt-out of PIN-change emails (use existing notification
  preferences if they grow to cover this category).
- Audit log entries for PIN changes (the `employee_pins.updated_by`
  column exists but is not currently populated — leave as a follow-up).
- Showing the manager which employees have outdated PINs (e.g. PINs not
  used in 90 days). Separate enhancement.

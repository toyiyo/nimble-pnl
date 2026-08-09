# RoleEditor self-row copy fix — Design

**Goal:** Fix one inaccurate sentence in the RoleEditor sensitive-data copy.
The copy overstates the read guarantee for a caller's own employee row.

**Type:** Copy-only change to one React component. No SQL, no gating logic,
no masked-view change.

## Problem

PR #731 shipped this copy in the "Sensitive data" band of the role editor
(`src/components/roles/RoleEditor.tsx:662-666`):

> Pay rates and contact details now gate real reads. A role without the switch
> cannot see those fields. Item costs still follow area access. The costs switch
> has no effect yet.

The sentence "A role without the switch cannot see those fields" is too
absolute. The masked view `employees_secure` keeps a caller's **own** pay and
contact fields visible, with no flag.

The Codex adversarial reviewer flagged this on the merged PR #731 as a P2:
the categorical claim "misleads administrators" for a user with their own
employee record.

## Premise (existing code — verified)

The view gates each sensitive column on the flag **or** the self-row:

- `supabase/migrations/20260806110000_employee_column_gating.sql:90-94` —
  pay fields use `CASE WHEN caps.pay OR caps.self THEN ...`.
- `supabase/migrations/20260806110000_employee_column_gating.sql:95-97` —
  email, phone, and date_of_birth use `CASE WHEN caps.pii OR caps.self THEN ...`.
- `supabase/migrations/20260806110000_employee_column_gating.sql:104` —
  `self` is `(e.user_id = auth.uid())`.

So a caller always reads their own pay and contact data. A role without the
switch hides only **other** employees' fields.

## Change

Replace the paragraph text and fix the matching comment
(`src/components/roles/RoleEditor.tsx:656-661`) so both name the self-row case.

Approved new wording:

> Pay rates and contact details now gate real reads. A role without the switch
> cannot see other employees' pay rates or contact details. Each person still
> sees their own. Item costs follow area access. The costs switch has no effect
> yet.

The first and last sentences stay the same, so the two existing copy tests
(`tests/unit/RoleEditor.test.tsx:302,304`) still pass.

## Scope

- The dialog input gate (`EmployeeDialog.tsx`) is correct and needs no change.
  The admin surface has no self-row case there.
- `view:costs` stays deferred. The copy keeps its caveat.

## Testing

Add one assertion to the existing copy test in
`tests/unit/RoleEditor.test.tsx`: the copy names the "other employees'"
qualification and the self-row exception, and the absolute phrase
"cannot see those fields" is gone.

## Decided trade-offs

- Phase 5 (UI review) and Phase 6 (Simplify) skip: the diff changes only text
  inside one existing `<p>` and one comment. No layout, token, state, or a11y
  delta, and no code to simplify.

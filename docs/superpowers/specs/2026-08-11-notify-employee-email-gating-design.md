# Design — Fix employee-email reads in notification edge functions

Date: 2026-08-11
Branch: `fix/notify-employee-email-gating`
Author: Claude (Opus 4.8), with Jose M Delgado

STE-aligned. Code identifiers, log lines, and error strings stay exact.

---

## 1. Problem

A manager published a schedule under the Wetzel's account. The publish
succeeded, but the notification toast showed an unactionable error:
`Schedule Published — notifications unconfirmed` with the body
`Edge Function returned a non-2xx status code`.

That text helps engineering. It gives the manager nothing to do.

## 2. Root cause (confirmed in production)

Migration `supabase/migrations/20260806110000_employee_column_gating.sql`
revokes table SELECT on `public.employees` from `authenticated`
(line 126) and re-grants only a safe column subset (lines 128–136). It
excludes 8 pay and PII columns. `email` is one of them.

A read that names `email` as role `authenticated` fails with Postgres
`42501` (`permission denied for table employees`). It does not return a
masked NULL. `service_role` keeps the whole table (line 141).

Production check (2026-08-11, project `ncdujvdgqtaunuyigflp`):

| column | `authenticated` SELECT | `service_role` SELECT |
|--------|------------------------|-----------------------|
| email  | false                  | true                  |
| phone  | false                  | true                  |
| name   | true (control)         | true                  |

The edge functions read `email` with a JWT-scoped client. That client
runs as `authenticated`, so the read fails.

### The trap

A JWT-scoped client uses the service key but sends the caller JWT in the
`Authorization` header:

```
createClient(url, SERVICE_ROLE_KEY, { global: { headers: { Authorization: authHeader } } })
```

PostgREST derives the database role from that JWT, not from the key. So
this client runs every `.from()` as `authenticated`, not `service_role`.
"It uses the service key" is not "it runs as service_role".

The prior reader-migration series (#727, #738) moved 11 frontend readers
to the `employees_secure` view and fixed 5 frontend embeds. It never
audited the edge functions. Commit #738 states
`Notification email is sent server-side under service_role`. That claim
is wrong for the two functions below: both read `email` with the
JWT-scoped client.

## 3. Scope

The user chose "All notification paths". In scope:

1. `notify-schedule-published` — the reported failure.
2. `send-shift-trade-notification` — same defect, both trade actions.
3. `_shared/notificationHelpers` callers — audit result below.
4. The client toast — make the failure actionable.

Out of scope (flag only, do not edit this branch): `generate-schedule`
and `ai-execute-tool` show the same client pattern. The user excluded a
full systemic sweep. Section 8 flags them.

## 4. Fix — `notify-schedule-published`

File: `supabase/functions/notify-schedule-published/index.ts`

Facts:
- Line 34–42: `supabase` = anon-key client + caller JWT → role
  `authenticated`.
- Line 57–67: explicit authorization gate. It reads `user_restaurants`
  and rejects any caller who is not `owner` or `manager`. The gate does
  not depend on the roster read.
- Line 82–85: `serviceClient` = bare service-role client. It already
  exists.
- Line 86–90: `resolveChannels` already uses `serviceClient`.
- Line 93–97 (the bug): reads `employees` with `supabase` and names
  `email`. Role `authenticated` → `42501` → line 100
  `throw new Error("Failed to fetch employees")` → HTTP 500.
- Line 120–126: the shifts read uses `supabase` but selects only
  `employee_id`. That column is not gated, so it still works.

Change: line 93, `supabase` → `serviceClient`.

Safety: the authorization gate at line 57–67 is explicit and runs first.
The swap changes the reader role only. It does not remove any access
check. This mirrors the sibling `notify-schedule-unpublished`, which
already reads the roster with a service-role client.

## 5. Fix — `send-shift-trade-notification`

File: `supabase/functions/send-shift-trade-notification/index.ts`

Facts:
- Line 285–287: `supabase` = service key + caller JWT → role
  `authenticated`.
- Line 289–292: a comment states the intent — `admin` does all data
  reads after auth; `supabase` stays limited to `auth.getUser()`.
- Line 293: `admin` = bare service-role client.
- Line 317–342 (bug 1): reads the trade with `supabase`. The select
  embeds `offered_by:employees!...(name, email, user_id)` (line 328) and
  `accepted_by:employees!...(name, email, user_id)` (line 333). The
  embedded `email` fails for role `authenticated`, so the whole read
  fails. `tradeError` is set → line 344 returns HTTP 404
  `Trade not found`. This fails before the action switch, so every
  trade action breaks, not only `created`.
- Line 352–372: explicit membership gate via `admin`. It returns 403 for
  a caller who is not a member of the trade restaurant. It runs before
  any send.
- Line 406–411: the directed-trade target read already uses `admin`.
- Line 422–425 (bug 2): calls `buildEmails(supabase, ...)`. Inside
  `buildEmails` (line 69–138), the `created` path reads `employees.email`
  with the passed client (line 86–91). With `supabase` it fails the same
  way.

Changes:
1. Line 317: `supabase` → `admin` (the trade read).
2. Line 422: `buildEmails(supabase, ...)` → `buildEmails(admin, ...)`.

Safety:
- The membership gate (line 352–372) is explicit and runs before any
  send. The trade read at line 317 runs before the gate, but the
  function returns the trade to nobody. A non-member still gets 403 and
  no data. So reading the trade as `service_role` widens no caller's
  view.
- `buildEmails` also reads `user_restaurants` (line 102) and `profiles`
  (line 110) for the `accepted` path. Both are scoped by `restaurant_id`
  or `user_id`. `profiles` is not gated by the 08-06 migration. Running
  them as `service_role` after the gate is correct and matches the rest
  of the file (lines 355, 406, 501 already use `admin`).

## 6. Audit — `_shared/notificationHelpers` callers

The email readers are `getEmployeeEmail`, `getEmployeeEmails`,
`getAllActiveEmployeeEmails`, and `getManagerEmails`. Each takes an
injected client.

Grep result: the only caller of these readers is
`send-shift-trade-notification/index.refactored.ts` (lines 131, 133),
which passes a JWT-scoped `supabase` client.

`index.refactored.ts` is dead:
- No file imports it.
- It is not in `supabase/config.toml`.
- Supabase deploys `index.ts` only.
- One commit touched it (#295), as an unwired experiment.

So no live caller passes a JWT-scoped client to a gated reader.

Proposal: delete `index.refactored.ts`. It is unreferenced, it is not
deployed, and it demonstrates the exact broken pattern. A future author
could copy it. This serves the audit intent. It is a separate concern
from the two live fixes, so the plan lists it as its own step for
explicit approval.

## 7. Fix — the client toast

File: `src/hooks/useSchedulePublish.tsx`

The edge fixes make the reported error disappear: publish now returns
HTTP 200 and the toast reads `sent`. The toast change is defense in
depth for any future edge failure.

Facts:
- `invokeAndInterpret` (line 92–124): on error it reads
  `error.context.json()` and branches only on a `failed` count
  (line 108). A 500 body like `{ error: "Failed to fetch employees" }`
  has no `failed`, so it falls through to line 115 and returns
  `{ status: 'unknown', message: error.message }`. `error.message` is
  the fixed SDK string `Edge Function returned a non-2xx status code`.
- `notificationToast` (line 143–169): the `unknown` branch (line 162)
  puts `outcome.message` in the body. So the SDK string reaches the
  manager.
- No retry control exists. `notificationToast` returns a plain
  `{ title, description, variant }`. There is no action button.

Design:
- Add one outcome variant: `{ status: 'error'; message?: string }`. It
  means the function ran and returned an error, so nobody was notified.
- In `invokeAndInterpret`: when the error carries an HTTP response body
  (`error.context` present) and the body has no `failed` count, return
  the new `error` outcome. Keep `unknown` for the case with no response
  body (offline, relay failure) and for the timeout path (line 74–82),
  which already sets a human message.
- Do not surface the raw server string. Lesson [2026-04-22] warns
  against leaking raw 500 messages. The `error` copy is fixed and
  actionable.
- `notificationToast` copy for `error`:
  - title: `Schedule Published — notifications not sent`
  - body: `The schedule is published and your team can see it. We could
    not send the notifications. Please tell your team directly.`
  - variant: `destructive`
- The `unknown` copy stays, but drops the raw SDK string. It keeps the
  human message from the timeout path and adds an action:
  `The schedule is published. We could not confirm the notifications.
  Please check with your team.`

This gives the manager a definite action for a hard failure and an
honest hedge for an unconfirmed one. It matches lesson [2026-04-21]:
use `error.context.json()`, then classify.

## 8. Flagged, not fixed (out of scope)

Same client pattern, same latent defect. The user excluded these:
- `supabase/functions/generate-schedule/index.ts:147`
- `supabase/functions/ai-execute-tool/index.ts` (272, 1950, 2210, 2294)

The lessons doc (Section 11) records them so a later sweep can find them.

## 9. Test plan

1. New guard test — `tests/unit/notificationServiceRoleReaders.test.ts`.
   It mirrors the precedent `tests/unit/employeesSecureViewReaders.test.ts`
   (#738). It reads the edge source and asserts:
   - `notify-schedule-published` reads `employees` with `serviceClient`,
     not `supabase`.
   - `send-shift-trade-notification` reads the trade and calls
     `buildEmails` with `admin`, not `supabase`.
   - Each function still holds a bare service-role client
     (no `Authorization` override).
   The test uses exact post-fix substrings, like the precedent. It fails
   before the fix and passes after.

2. Extend `tests/unit/useSchedulePublish.test.ts`.
   - Add a case: the edge returns a 500 body `{ error: "..." }` with no
     `failed`. Assert the toast shows the `error` copy.
   - Assert the body does not contain
     `Edge Function returned a non-2xx status code`.
   The file already has an `invokeFailure(body)` helper (line 43–48).

3. Run `npm run test`, `npm run typecheck`, `npm run lint`.

### E2E exception

The edge behavior needs a real JWT, the gated database, and Resend. CI
cannot drive an email fan-out. So this change takes the justified E2E
exception. The client-selection invariant is covered by the guard test.
The client-facing message is covered by the toast test.

## 10. Risks and rollback

- Risk: a service-role read widens data exposure. Mitigation: both
  functions keep their explicit authorization gate before any send
  (`notify-schedule-published` line 57–67; `send-shift-trade-notification`
  line 352–372). The swap changes reader role only.
- Risk: the new toast variant breaks an existing test. Mitigation: the
  toast test pins the copy; update it in the same change.
- Rollback: revert the branch. The change is small and additive.

## 11. Lessons doc

Append to `memory/lessons.md`. Topic: a column REVOKE from
`authenticated` needs an audit of every caller in both `src/` and
`supabase/functions/`. For each edge caller, confirm the client that
reads the gated column is a bare service-role client with no
`Authorization` override. Cite #738's wrong assumption verbatim. Record
the two flagged functions from Section 8.

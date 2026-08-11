# Design — Fix employee-email reads in notification edge functions

Date: 2026-08-11
Branch: `fix/notify-employee-email-gating`
Author: Claude (Opus 4.8), with Jose M Delgado

STE-aligned. Code identifiers, log lines, and error strings stay exact.

Revision 2. It folds in the Phase 2.5 design review. Section 12 records
the changes. The most important change: do NOT move the shift-trade read
to the service-role client. That would reopen a directed-trade email
leak. See Section 5.

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
2. `send-shift-trade-notification` — same read defect, both trade
   actions. The fix must not widen trade visibility (Section 5).
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
  and rejects any caller who is not `owner` or `manager`. The gate is a
  role check. It does not depend on the roster read.
- Line 82–85: `serviceClient` = bare service-role client. It already
  exists.
- Line 86–90: `resolveChannels` already uses `serviceClient`.
- Line 93–97 (the bug): reads `employees` with `supabase` and names
  `email`. Role `authenticated` → `42501` → line 100
  `throw new Error("Failed to fetch employees")` → HTTP 500.
- Line 120–126: the shifts read uses `supabase` but selects only
  `employee_id`. That column is not gated, so it still works.

Change: line 93, `supabase` → `serviceClient`.

Safety: the authorization gate at line 57–67 is an explicit
owner/manager role check. It runs first. It does not depend on the
roster read. So elevating the roster read to `serviceClient` removes no
gate. A manager who publishes a schedule notifies the whole active
roster by design, so a service-role roster read exposes nothing new to
the caller. This mirrors the sibling `notify-schedule-unpublished`,
which reads its roster with a bare service-role client
(`notify-schedule-unpublished/index.ts:135-137`, `:241`).

## 5. Fix — `send-shift-trade-notification`

File: `supabase/functions/send-shift-trade-notification/index.ts`

### 5.1 Why the read stays on the JWT client

The trade read is also the authorization gate. Migration
`20260713000000_restrict_directed_shift_trade_visibility.sql`
(lines 24–48) sets the `shift_trades` SELECT policy:
- An OPEN trade (`target_employee_id` NULL) is visible to every active
  employee in the restaurant.
- A DIRECTED trade is visible only to its target, offerer, or accepter
  (plus owners/managers via a separate policy).

So the JWT-scoped read at line 317 already enforces directed-trade
privacy. A non-participant who POSTs a directed `tradeId` gets no row →
`!trade` → HTTP 404 at line 344–350. This is the intended behavior.

If the read moves to the bare service-role client (`admin`,
`rolbypassrls`), that policy no longer applies. The only remaining check
is the membership gate (lines 355–372), which verifies same-restaurant
membership only — not participant identity. A same-restaurant
non-participant would then pass, reach the send path, and receive the
target's email in the response body (`recipients`, line 566), plus
trigger a real email (line 452, `to: recipients`) and push (line 512) to
the target. That reopens the exact leak migration `20260713000000`
closed. The current `42501` masks this today, so the naive fix would
INTRODUCE the regression.

Decision: keep the trade read on the JWT client. Drop only the gated
`email` column from the embeds. Read the email VALUES with `admin`
afterward. The read stays an authorization gate; only the value lookup
is elevated. This mirrors #738's frontend embed fix.

### 5.2 Facts

- Line 285–287: `supabase` = service key + caller JWT → role
  `authenticated`.
- Line 288–292: a comment states the intent — `admin` does data reads
  after auth; `supabase` stays for auth. This design keeps the trade
  read on `supabase` because that read is an authorization gate
  (Section 5.1), which the comment does not account for.
- Line 293: `admin` = bare service-role client.
- Line 317–342 (bug): the trade read embeds `email` in
  `offered_by:employees!offered_by_employee_id(name, email, user_id)`
  (line 326–330) and `accepted_by:...(name, email, user_id)`
  (line 331–335). The embedded `email` fails for role `authenticated`,
  so the whole read fails → `tradeError` → 404. This breaks every trade
  action, not only `created`.
- Line 397–419: the directed-trade target email is already resolved via
  `admin`. Correct. No change.
- Line 422–429 (bug): `buildEmails(supabase, ...)`. The `created`
  broadcast path inside `buildEmails` (lines 84–98) reads
  `employees.email` with the passed client → fails under
  `authenticated`. The call also passes `trade.offered_by?.email` and
  `trade.accepted_by?.email` (lines 426–427), which come from the gated
  embed.
- `buildEmails` other reads: `user_restaurants` (line 102–106) and
  `profiles.email` (line 110–113) are not gated by migration
  `20260806110000`.

### 5.3 Changes

1. Line 326–335: drop `email` from both embeds. Keep `name` and
   `user_id`. The read now names no gated column, so it succeeds under
   role `authenticated` and RLS still filters the row.
2. After the trade read and the existing gates, resolve the two
   participant emails with `admin`, keyed by the base columns
   `offered_by_employee_id` and `accepted_by_employee_id` (both present
   via `select('*')`):
   ```
   const ids = [trade.offered_by_employee_id, trade.accepted_by_employee_id].filter(Boolean);
   const emailById = new Map<string, string>();
   if (ids.length) {
     const { data: rows } = await admin.from('employees').select('id, email').in('id', ids);
     rows?.forEach((r) => { if (r.email) emailById.set(r.id, r.email); });
   }
   ```
   Use `emailById.get(trade.offered_by_employee_id)` and
   `...accepted_by_employee_id` in place of `trade.offered_by?.email`
   and `trade.accepted_by?.email` at the `buildEmails` call.
3. Line 423: `buildEmails(supabase, ...)` → `buildEmails(admin, ...)`.
   The open-trade broadcast query then runs under `service_role`. This
   is safe: the caller already passed the RLS-scoped trade read and the
   membership gate, so the caller may see this trade.

Keep the membership gate (lines 355–372) as defense in depth.

Note: the `name` and `user_id` fields the code still reads from the
embed (lines 394–395, 498, 523, 526–527, 530) are not gated, so they
stay in the embed.

## 6. Audit — `_shared/notificationHelpers` callers

The email readers are `getEmployeeEmail`, `getEmployeeEmails`,
`getAllActiveEmployeeEmails`, and `getManagerEmails`. Each takes an
injected client.

Grep result:
- `getEmployeeEmail` and `getEmployeeEmails` have no caller anywhere.
- `getAllActiveEmployeeEmails` and `getManagerEmails` are called only by
  `send-shift-trade-notification/index.refactored.ts` (lines 131, 133),
  which passes a JWT-scoped `supabase` client.

So no LIVE caller passes a JWT-scoped client to a gated reader.

`index.refactored.ts` is dead:
- No file imports it.
- It is not in `supabase/config.toml`.
- Supabase deploys `index.ts` only.
- One commit touched it (#295), as an unwired experiment.

Proposal: delete `index.refactored.ts`. It is unreferenced, it is not
deployed, and it demonstrates the broken pattern. A future author could
copy it. The plan lists this as its own step for explicit approval.

## 7. Fix — the client toast

File: `src/hooks/useSchedulePublish.tsx`

The edge fixes make the reported error disappear: publish returns HTTP
200 and the toast reads `sent`. The toast change is defense in depth for
a future edge failure, and it removes the raw string from every path.

### 7.1 Facts

- `NotificationOutcome` (lines 31–35): `sent` | `partial` | `failed` |
  `unknown` (with `message`).
- Timeout path (lines 74–82): returns `unknown` with a curated message,
  `Notifications did not confirm within ${…}s. They may still be
  sending.` This message is safe to show.
- `invokeAndInterpret` (lines 92–124): on a non-2xx error it reads
  `error.context?.json?.()` (line 104). If `payload.failed > 0` it
  returns `partial`/`failed` (lines 108–113). Otherwise it returns
  `unknown` with `message = error.message` (line 115) — the fixed SDK
  string `Edge Function returned a non-2xx status code`.
- The `catch` (lines 116–123): a consumed or non-JSON body. It returns
  `unknown` with `message = error.message` — a raw string such as
  `Failed to fetch`.
- `notificationToast` (lines 143–169): the `unknown` branch
  (lines 162–167) interpolates `outcome.message`. So the raw string
  reaches the manager.
- `ToastPayload` (lines 131–135) has `title`, `description`,
  `variant?`. No action field.

### 7.2 Design

Add one outcome variant with no payload:
```
| { status: 'error' }
```
It means the function ran and returned an error body we could read, but
not the `partial`/`failed` shape. Nobody was notified. Its copy is
static, so no raw string can leak through it.

Keep `unknown` for the case with no readable HTTP body (offline, relay
failure) and for the timeout. Make its `message` ALWAYS a curated,
user-safe string. Never assign a raw server or network string to it.

`invokeAndInterpret` new branch logic:
- If the error carries a readable HTTP body (`error.context` present)
  and the body is not the `partial`/`failed` shape → return
  `{ status: 'error' }`.
- If there is no readable HTTP body → return `{ status: 'unknown',
  message: 'We could not reach the notification service.' }`.
- The `catch` (consumed or non-JSON body) → return the same `unknown`
  with a curated message. Do NOT pass `error.message`.
- The timeout keeps its own curated message.

`notificationToast` copy:
- `error`:
  - title: `${title} — notifications not sent`
  - description: `The schedule is published and your team can see it. We
    could not send the notifications. Please tell your team directly.`
  - variant: `destructive`
- `unknown` (revised — no raw string):
  - title: `${title} — notifications unconfirmed`
  - description: `${outcome.message} The schedule is published; please
    check with your team.`
  - variant: `destructive`

`variant: destructive` matches the existing `partial`/`failed` cases.
Radix wires `aria-describedby` on the toast description, so assistive
tech announces the message
(`src/components/ui/toast.tsx`, `src/components/ui/toaster.tsx`).

Note on `error` wording: it states nobody was notified. This is true for
the two bugs, which fail before any send. A future function that crashes
mid-send must map to `partial`, not `error`, so this copy stays honest.

Lesson [2026-04-22] warns against leaking raw 500 strings. This design
removes the raw string from every path.

## 8. Flagged, not fixed (out of scope)

These use the same JWT-scoped client pattern. The user excluded them:
- `supabase/functions/generate-schedule/index.ts:147`
- `supabase/functions/ai-execute-tool/index.ts` (272, 1950, 2210, 2294)

Their failure modes may differ, and this matters for the lessons doc:
- `ai-execute-tool/index.ts:1950` names gated columns explicitly via
  `EMPLOYEE_LABOR_COLUMNS` (`_shared/employeeLaborColumns.ts`, which
  lists `hourly_rate` and `salary_amount`). It fails with `42501`, the
  same as the two in-scope functions.
- `ai-execute-tool/index.ts:272, 2210, 2294` use `.select('*')`. The
  failure mode of `select('*')` under a partial column grant is not
  verified. It may `42501`, or it may drop the gated columns silently.
  A future sweep must test each site with a real `authenticated` request
  before it assumes a mode.

Section 11 records these for a later sweep.

## 9. Test plan

1. New guard test — `tests/unit/notificationServiceRoleReaders.test.ts`.
   It mirrors the precedent
   `tests/unit/employeesSecureViewReaders.test.ts` (#738). It reads the
   edge source and asserts:
   - `notify-schedule-published` reads `employees` with `serviceClient`,
     not `supabase`.
   - `send-shift-trade-notification` names NO `email` inside any
     `employees!<fk>(...)` embed. (The read stays RLS-scoped; the
     invariant is "no gated column in the embed", like the #738 embed
     guard.)
   - `send-shift-trade-notification` calls `buildEmails` with `admin`,
     not `supabase`.
   - Each function still constructs a bare service-role client (no
     `Authorization` override).
   The guard scans at least one embed and fails if the match list is
   empty, so a renamed embed cannot silently disarm it (same safeguard
   as the #738 test, lines 99–103).

2. Extend `tests/unit/useSchedulePublish.test.ts`.
   - Widen the `invokeFailure` helper (line 43) so it accepts a body
     with an `error` field, for example `{ error?: string; sent?:
     number; failed?: number }`. The current signature rejects
     `{ error: '…' }` on the excess-property check.
   - Add a case: the edge returns a readable 500 body
     `{ error: 'Failed to fetch employees' }`. Assert the outcome is
     `{ status: 'error' }`. Assert the toast title contains
     `notifications not sent` and the body contains `tell your team
     directly`. Assert the body does NOT contain
     `Edge Function returned a non-2xx status code` and does NOT contain
     `Failed to fetch employees`.
   - UPDATE the existing no-`context` case (lines 110–126). It asserts
     the body contains `Failed to fetch`. Under this design that path
     returns `unknown` with the curated message. Change the assertion:
     the body contains `We could not reach the notification service` and
     does NOT contain `Failed to fetch`.
   - Verify the timeout case (line ~208) still passes. Its toast body is
     now `Notifications did not confirm within 90s. They may still be
     sending. The schedule is published; please check with your team.`
     Update the assertion if it pins the old exact string.

3. Run `npm run test`, `npm run typecheck`, `npm run lint`.

### E2E exception

The edge behavior needs a real JWT, the gated database, and Resend. CI
cannot drive an email fan-out. So this change takes the justified E2E
exception. The client-selection invariant is covered by the guard test.
The client-facing message is covered by the toast test.

## 10. Risks and rollback

- Risk: a service-role read widens data exposure. Mitigation:
  `notify-schedule-published` keeps its explicit owner/manager gate
  (lines 57–67). `send-shift-trade-notification` keeps its RLS-scoped
  trade read as the participant gate (Section 5.1) and its membership
  gate (lines 355–372). Only email-value lookups run under
  `service_role`.
- Risk: the new toast variant breaks the toast copy tests. Mitigation:
  Section 9 item 2 lists every test to add or update.
- Rollback: revert the branch. The changes are small and additive.

## 11. Lessons doc

Append to `memory/lessons.md`. Topics:
1. A column REVOKE from `authenticated` needs an audit of every caller
   in both `src/` AND `supabase/functions/`. For each edge caller,
   confirm the client that reads the gated column is a bare service-role
   client with no `Authorization` override. Cite #738's wrong
   assumption verbatim.
2. Do NOT blindly elevate a read to `service_role` to escape a column
   grant. If the read is also an authorization gate (an RLS-filtered
   read that returns no row to an unauthorized caller), elevating it to
   `service_role` bypasses that gate. Drop only the gated column and
   elevate only the value lookup. Cite the `send-shift-trade-notification`
   directed-trade case and migration `20260713000000`.
3. Record the flagged functions from Section 8, and note that
   `select('*')` and an explicit gated-column name may fail differently
   under a partial column grant.

## 12. Design review outcomes (Phase 2.5)

Two reviewers ran on revision 1. Their findings and the resolutions:

- Critical (supabase-design-reviewer): revision 1 moved the trade read
  to `admin`, which bypasses the `shift_trades` RLS policy and reopens
  the directed-trade email leak. Resolution: Section 5 now keeps the
  read on the JWT client and drops only the gated `email` column from
  the embeds. Only email values move to `admin`.
- Major (frontend-design-reviewer): the revised `unknown` copy collided
  with the existing test that asserts `Failed to fetch`, and the
  `invokeFailure` helper signature rejects an `{ error }` body.
  Resolution: Section 7 curates every `unknown` message and never shows
  a raw string; Section 9 widens the helper and lists the test update.
- Minor (frontend-design-reviewer): revision 1's `error` variant carried
  an unused `message` field. Resolution: the variant is now
  `{ status: 'error' }` with no payload.
- Minor (supabase-design-reviewer): the `notificationHelpers` caller
  count was imprecise. Resolution: Section 6 states two readers have no
  caller and two are called only by the dead file.
- Major (supabase-design-reviewer): revision 1 called all four
  `ai-execute-tool` sites the same defect. Resolution: Section 8 splits
  the explicit-column site from the `select('*')` sites and marks the
  `select('*')` failure mode unverified.

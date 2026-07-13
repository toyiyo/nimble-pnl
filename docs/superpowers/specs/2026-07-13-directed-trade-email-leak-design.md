# Design — Directed-trade email leak fix

**Date:** 2026-07-13
**Branch:** `fix/directed-trade-email-leak`
**Follow-up:** task_0768d931 (from PR #606 review)

## Problem

`send-shift-trade-notification`'s `buildEmails`, `action === 'created'` branch, emails **all**
active employees in the restaurant:

```ts
const { data: employees } = await supabase.from('employees').select('email')
  .eq('restaurant_id', restaurantId).eq('is_active', true).not('email', 'is', null);
```

But shift trades can be **directed** to one coworker (`shift_trades.target_employee_id`).
Directed trades are visible only to the target under RLS + the marketplace filter
(`target_employee_id IS NULL OR target_employee_id = me` — migration
`20260104120000_create_shift_trades.sql`, `useShiftTrades.ts` marketplace query). So a directed
`created` trade currently **emails the whole team a private offer** they can't see in-app.

PR #606 already fixed the identical leak on the **push** channel (directed → notify only the
target; open → broadcast). This applies the same gating to **email**.

## Scope

- **In:** gate the `created` *email* audience — directed trade → the target employee only; open
  marketplace → all active employees (unchanged).
- **Out:** any other change to `buildEmails`. In particular the `accepted` branch's
  `profiles` embed / caller-scoped-client concern is a **separate** follow-up (`task_344afce3`)
  and is not touched here. Push behavior is already correct (#606) — unchanged.

## Approach

### Pure helper — `_shared/tradeEmailAudience.ts` (vitest-importable, tested)

```ts
export interface DirectedTarget { email: string | null }

/** Recipients for a 'created' trade email.
 *  A DIRECTED trade (non-null target) goes ONLY to the target — or nobody if the target has
 *  no email — NEVER the broadcast list, because directed offers are private to the target.
 *  An OPEN marketplace trade (null target) uses the full broadcast list. */
export function resolveCreatedTradeEmailRecipients(
  directedTarget: DirectedTarget | null,
  broadcastEmails: string[],
): string[] {
  if (directedTarget) return directedTarget.email ? [directedTarget.email] : [];
  return broadcastEmails;
}
```

### `buildEmails` — add a trailing `directedTarget` param

```ts
const buildEmails = async (supabase, restaurantId, action,
  offeredByEmployeeEmail?, acceptedByEmployeeEmail?,
  directedTarget: DirectedTarget | null = null) => {
  ...
  if (action === 'created') {
    let broadcastEmails: string[] = [];
    if (!directedTarget) {                         // skip the query entirely for directed trades
      const { data: employees } = await supabase.from('employees').select('email')
        .eq('restaurant_id', restaurantId).eq('is_active', true).not('email', 'is', null);
      broadcastEmails = (employees ?? []).map((e) => e.email).filter((e): e is string => !!e);
    }
    emails.push(...resolveCreatedTradeEmailRecipients(directedTarget, broadcastEmails));
  } else if (...) { /* accepted/approved/rejected/cancelled unchanged */ }
  return [...new Set(emails)];
};
```

### Call site — resolve the directed target via the `admin` client

The existing bare service-role `admin` client (added in #606) reliably reads the target's email
under RLS (per the lesson: a JWT-scoped client can silently read zero rows for other users). The
JWT-scoped `supabase` client stays as buildEmails's argument for the unchanged open-broadcast /
accepted queries (scope discipline — not touching `task_344afce3`).

```ts
let directedTarget: DirectedTarget | null = null;
if (action === 'created' && trade.target_employee_id) {
  const { data: t, error: targetErr } = await admin.from('employees').select('email')
    .eq('id', trade.target_employee_id).eq('restaurant_id', trade.restaurant_id).maybeSingle();
  if (targetErr) console.error('Error resolving directed-trade email target:', targetErr);
  directedTarget = { email: t?.email ?? null };
}
const recipients = await buildEmails(supabase, trade.restaurant_id, action,
  trade.offered_by?.email, trade.accepted_by?.email, directedTarget);
```

Existing empty-recipients guard (`recipients.length === 0` → `200 { message: 'No recipients' }`)
already covers a directed target with no email.

## Testing

- `tests/unit/tradeEmailAudience.test.ts`: directed + email → `[email]`; directed + null email →
  `[]` (privacy: never falls back to broadcast); open (null target) → broadcast list; open +
  empty broadcast → `[]`.
- Edge-function wiring is Deno-only (`sonar.sources=src` excludes it; not coverage-gated);
  verified via `deno check`, `eslint`, `typecheck`, full `vitest run`.

## Decided trade-offs

- **Directed `created` email goes only to the target** (not the poster). Mirrors the push channel
  (#606 excludes the poster); the poster already knows they made the offer. Consistent + private.
- **Client discipline:** only the new directed-target lookup uses `admin`; the pre-existing
  open-broadcast and `accepted` queries keep their current client — the broader caller-scoped-client
  audit is `task_344afce3`, deliberately out of scope here.

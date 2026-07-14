# Design — accept_shift_trade authorization + search_path hardening

**Date:** 2026-07-13
**Branch:** `fix/accept-shift-trade-authz`
**Ticket:** task_d9ab7984 (write-side complement to PR #609)

## Problem

`accept_shift_trade(p_trade_id UUID, p_accepting_employee_id UUID)` is `SECURITY DEFINER` and
`GRANT`ed to `authenticated`, but **trusts the client-supplied `p_accepting_employee_id`**. It
checks only that the trade is `open` and the accepting employee has no schedule conflict — never
that the accepter belongs to the caller (`auth.uid()`), nor (for a directed trade) that it equals
`target_employee_id`. Because it's `SECURITY DEFINER` it bypasses RLS and the UPDATE policy.

Via a direct `supabase.rpc('accept_shift_trade', { p_trade_id, p_accepting_employee_id })` call
(not the UI, which sends the caller's own id), **any authenticated user** can set a trade's
`accepted_by` to any employee and move it to `pending_approval`. Impact is gated by the
owner/manager-only `approve_shift_trade` before the shift actually transfers — so this is an
integrity/griefing hole (forge "who accepted"; a non-target accepting a directed trade), not a
silent takeover. Sibling functions get this right: `approve`/`reject` check
`p_manager_user_id = auth.uid()` + role; `cancel` checks the caller owns the offerer employee.
Only `accept` lacks the caller check.

Separately, none of the four trade functions pin `SET search_path` (a `SECURITY DEFINER` hardening
flagged in the #609 review / Supabase advisor).

## Approach

New migration `supabase/migrations/<ts-after-20260713000000>_harden_accept_shift_trade.sql` that
`CREATE OR REPLACE`s the four functions (historical migration untouched). Bodies copied **verbatim**
from `20260105000100_create_shift_trade_functions.sql`, changing only:

### 1. `accept_shift_trade` — add caller/target checks

Immediately after the `status != 'open'` check (before the conflict check), insert:

```sql
  -- The accepting employee must belong to the caller, be active, and be in the
  -- trade's restaurant. Prevents a direct RPC call from accepting a trade on
  -- behalf of another employee (or across restaurants). SECURITY DEFINER bypasses
  -- RLS, so this is the authorization boundary.
  IF NOT EXISTS (
    SELECT 1 FROM employees e
    WHERE e.id = p_accepting_employee_id
      AND e.user_id = auth.uid()
      AND e.is_active = true
      AND e.restaurant_id = v_trade.restaurant_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can only accept a trade as yourself');
  END IF;

  -- A DIRECTED trade may be accepted only by its target.
  IF v_trade.target_employee_id IS NOT NULL
     AND p_accepting_employee_id <> v_trade.target_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'This trade was offered to a specific employee');
  END IF;
```

Everything else in `accept_shift_trade` (row lock, status check, conflict check, the
`UPDATE shift_trades SET accepted_by_employee_id = …, status = 'pending_approval'`) is unchanged.

### 2. `SET search_path` on all four functions

Add `SET search_path = public, pg_temp` to the `CREATE OR REPLACE FUNCTION … SECURITY DEFINER`
header of `accept_shift_trade`, `approve_shift_trade`, `reject_shift_trade`, `cancel_shift_trade`.
(`public, pg_temp` is the hardened form already used in this codebase; dominant convention is bare
`public`, but pinning `pg_temp` blocks temp-schema function/type shadowing.) approve/reject/cancel
bodies are otherwise copied verbatim — no logic change.

Re-`GRANT EXECUTE … TO authenticated` after the `CREATE OR REPLACE` (grants persist across replace,
but re-granting is idempotent and explicit).

## Testing (pgTAP)

New `supabase/tests/<nn>_accept_shift_trade_authz.sql`, impersonating callers via
`SET LOCAL ROLE authenticated` + `request.jwt.claims {sub}` (SECURITY DEFINER reads `auth.uid()`
from the JWT). Seed: restaurant R1 with employees A(offerer), B(target), C(bystander); a 2nd
restaurant R2 with employee X; an OPEN trade (A, target NULL) and a DIRECTED trade (A→B). Assert on
both the returned `jsonb->>'success'` and the resulting `accepted_by_employee_id`:

1. **Attacker**: C calls `accept_shift_trade(open_trade, B's employee_id)` (not C's) →
   `success=false`, `accepted_by` stays NULL.
2. **Legit self-accept (open)**: C calls with C's own employee_id on the open trade →
   `success=true`, `accepted_by = C`, status `pending_approval`.
3. **Non-target self-accept (directed)**: C calls with C's own id on the A→B directed trade →
   `success=false`, `accepted_by` stays NULL.
4. **Target self-accept (directed)**: B calls with B's own id on the A→B directed trade →
   `success=true`, `accepted_by = B`.
5. **Cross-restaurant**: X (R2) calls with X's own id on an R1 open trade → `success=false`
   (restaurant mismatch), `accepted_by` unchanged.

Remember: `npm run db:reset` before `npm run test:db` (a migration was added/edited).

## Decided trade-offs

- **Offerer self-accepting their own trade** is not explicitly blocked (out of scope) — the new
  checks still require it be *their* employee row; a self-trade is harmless (goes to manager
  approval) and the client never does it. Noted, not fixed.
- **`public, pg_temp`** chosen over bare `public` for the hardened form; over `''` (empty) because
  the bodies reference unqualified `public` objects and the codebase convention keeps `public`.
- Read-side privacy (who can *see* directed trades) shipped in #609; this closes the write side.

# Plan — Directed-trade email leak fix

**Design:** docs/superpowers/specs/2026-07-13-directed-trade-email-leak-design.md
**Branch:** `fix/directed-trade-email-leak`

TDD. `sonar.sources=src` → edge-function files aren't coverage-gated; pure logic still tested.

---

### Task 1 — `_shared/tradeEmailAudience.ts` (pure helper) + test
- **Test** `tests/unit/tradeEmailAudience.test.ts` (RED first):
  - directed + email → `[email]`
  - directed + null email → `[]` (privacy: never falls back to broadcast)
  - open (null directedTarget) → returns the broadcast list verbatim
  - open + empty broadcast → `[]`
- **Code** `supabase/functions/_shared/tradeEmailAudience.ts`: `DirectedTarget` +
  `resolveCreatedTradeEmailRecipients(directedTarget, broadcastEmails)` per design.
- Dep: none.

### Task 2 — wire `buildEmails` + call site + handler flow in `send-shift-trade-notification/index.ts`
- **Code**:
  1. `buildEmails`: add trailing `directedTarget: DirectedTarget | null = null`. In the `created`
     branch, only run the all-active-employees query when `!directedTarget`; then
     `emails.push(...resolveCreatedTradeEmailRecipients(directedTarget, broadcastEmails))`.
  2. Call site (~line 381): before calling buildEmails, for `action==='created' && trade.target_employee_id`,
     resolve the target's email via the bare `admin` client
     (`.from('employees').select('email').eq('id', trade.target_employee_id).eq('restaurant_id', ...).maybeSingle()`,
     log error; `directedTarget = { email: t?.email ?? null }`). Add a comment noting the
     intentional `is_active`-omission parity with the push target lookup. Pass `directedTarget` in.
  3. **Handler flow (major fix):** replace the `if (recipients.length === 0) return 200` early
     return with a conditional email send — compute `content`/`employeeName` first (both channels
     use them), send email only when `recipients.length > 0` (genuine `emailError` still → 500),
     else `console.warn` and fall through. The `created` push block then runs regardless, so a
     directed target with no email still gets the push.
  4. Correct the stale comment in the `created` **push** block ("visible only to its target under
     RLS + the marketplace filter") → "hidden from non-targets by the marketplace filter
     (client-side; not RLS-enforced — see task_35a15d77)".
- **Verify**: `deno check --config supabase/functions/deno.json`, `eslint`, `typecheck`.
- Dep: 1.

---

## Phase 8 verify
Full `npx vitest run` (not just the new file), `typecheck`, `lint`, `build`, `deno check` on the
edited function. No migration, no pgTAP.

## Task order
1 → 2.

## Out of scope (follow-ups filed)
- `task_35a15d77` — enforce directed-trade privacy in `shift_trades` RLS Policy 1 (pgTAP).
- `task_344afce3` — buildEmails caller-scoped client for `accepted` (profiles embed).
- Phase B: admin-only per-type × per-channel resolver.

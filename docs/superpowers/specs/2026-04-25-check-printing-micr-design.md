# Check Printing — Bank Name at Top + MICR Line Support

**Date:** 2026-04-25
**Status:** Approved
**Author:** Jose M Delgado (with Claude)

## Problem

The current check printing layout (`src/utils/checkPrinting.ts`) does not produce a bank-deposit-grade negotiable instrument:

- The bank name is rendered mid-check (y≈2.2") rather than the visually expected top-center position used by Toast and pre-printed check stocks.
- There is no MICR (Magnetic Ink Character Recognition) line — banks cannot read the routing/account/check numbers via their automated check-clearing systems.
- The memo and signature lines sit at y≈2.85", which would conflict with the ANSI X9.13 / X9.100-160 MICR clear band (the bottom 5/8" of the check).

We currently collect only a free-text `bank_name` per `check_bank_accounts` row — no routing or account numbers are stored anywhere.

## Goals

1. Move the bank name to the top-center of the check (Toast-style).
2. Allow users to print a real, machine-readable MICR line containing check number, routing/ABA number, and account number.
3. Move memo and signature lines up to clear the MICR band.
4. Make MICR/bank-name printing optional per bank account, so users with pre-printed check stock are unaffected.
5. Collect and securely store routing and account numbers per check bank account.

## Non-Goals (explicit YAGNI)

- Pulling routing/account from Stripe Financial Connections (only works when the user has Stripe FC; deferred).
- Per-print toggle override (toggle is per-bank-account only; deferred).
- Collecting bank city/state for a two-line top header (deferred).
- Fractional ABA notation in top-right (e.g., `02-66/1110`).
- User-uploaded watermark / background security artwork.
- MICR on the payee/company stubs (not required).

## Architecture

### Data Model

New columns on `public.check_bank_accounts`:

| Column | Type | Notes |
|---|---|---|
| `routing_number` | TEXT | Plaintext (publicly printed on every check). Constrained to exactly 9 digits. ABA checksum validated client-side at save time. |
| `account_number_encrypted` | TEXT | Encrypted at rest via Supabase Vault + pgsodium (or pgcrypto if pgsodium isn't enabled — finalized in build). |
| `account_number_last4` | TEXT | Last 4 digits, plaintext, for masked UI display (e.g., `••••9096`). |
| `print_bank_info` | BOOLEAN NOT NULL DEFAULT false | When true, the PDF prints bank name at top + MICR line at bottom. |

Constraint:

```sql
ALTER TABLE public.check_bank_accounts
  ADD CONSTRAINT check_routing_format
  CHECK (routing_number IS NULL OR routing_number ~ '^[0-9]{9}$');
```

### RPCs

Two new SECURITY DEFINER functions, both restricted to `owner` / `manager` roles on the account's restaurant:

- `set_check_bank_account_secrets(p_id UUID, p_routing TEXT, p_account TEXT) RETURNS VOID`
  - Validates routing format
  - Encrypts `p_account`, stores in `account_number_encrypted`
  - Stores plaintext `routing_number` and `account_number_last4`
  - Throws on auth failure or invalid routing

- `get_check_bank_account_secrets(p_id UUID) RETURNS TABLE(routing_number TEXT, account_number TEXT)`
  - Decrypts and returns plaintext for the print flow
  - Throws on auth failure

The listing query in `useCheckBankAccounts` continues to select only the columns it needs for the table view — `account_number_encrypted` is never sent to the client; `account_number_last4` is fetched for masked display.

### Hook (`useCheckBankAccounts`)

Extends with:

- `saveAccountSecrets({ id, routing, account })` mutation — calls `set_check_bank_account_secrets` and invalidates the bank accounts query.
- `fetchAccountSecrets(id)` non-cached helper — calls `get_check_bank_account_secrets` on demand at print time. The decrypted account number lives only in the local scope of the print call; it never enters React Query cache or component state that outlives the print.

### UI (`CheckSettingsDialog`)

Each bank account row gains a collapsible "Bank info for printing" subsection:

- `Switch` toggle: "Print bank name and account info on checks" (default off). Helper text: "Turn off if your check stock is pre-printed."
- Routing input (only required when toggle is on): numeric, exactly 9 digits, ABA checksum validated. Inline error on bad checksum.
- Account input (only required when toggle is on): numeric, 4–17 digits. After save, displays as `••••<last4>` with an "Edit" button that re-prompts; full account number is never re-displayed in the UI after save.

All styling per CLAUDE.md (uppercase tracking labels, `bg-muted/30` inputs, `rounded-lg`, `border-border/40`, `h-10`, `Switch` with `data-[state=checked]:bg-foreground`).

### PDF Layout (`src/utils/checkPrinting.ts`)

Top-of-page check format unchanged at 3.5" check height. Coordinates in inches (Y-axis grows downward):

| Element | Current Y | New Y | Conditional |
|---|---|---|---|
| Business name | 0.50 | 0.50 | always |
| Business address | 0.65–0.91 | 0.65–0.91 | always |
| Bank name (centered) | 2.20 | **0.55** | only if `print_bank_info` |
| Check # (top-right) | 0.50 | 0.50 | always |
| Date (top-right) | 0.85 | 0.85 | always |
| PAY TO THE ORDER OF | 1.35 | 1.35 | always |
| Amount box (right) | 1.31 | 1.31 | always |
| Amount in words | 1.80 | 1.80 | always |
| Memo line | 2.85 | **2.55** | always |
| Signature line | 2.85 | **2.55** | always |
| MICR line | — | **3.30** | only if `print_bank_info` |
| Perforation | 3.50 | 3.50 | always |

The MICR clear band runs from y=2.875 to y=3.5. Memo/signature at y=2.55 sit safely above it; MICR baseline at y=3.30 is ~3/16" from the bottom edge of the check.

### MICR Format

Following the user's example `⑈239⑈ ⑆111000614⑆ 2907959096⑈`:

```
⑈ checkNumber ⑈   ⑆ routingNumber ⑆   accountNumber ⑈
```

- Glyphs: `⑈` = on-us symbol, `⑆` = transit (routing) symbol — both standard MICR E-13B characters.
- Right-aligned within the bottom-of-check region (industry standard); ends with ~0.5" margin from right edge.
- Font: **GnuMICR** (or equivalent permissively-licensed MICR E-13B font), bundled at `src/assets/fonts/GnuMICR.ttf` (~30 KB) and registered into the jsPDF instance via `doc.addFileToVFS` + `doc.addFont`. The exact glyph→codepoint mapping is encapsulated in a small `formatMicrLine` helper so the font choice is swappable.
- Font size: 12pt (standard MICR character height of 0.117"); character spacing tuned to 8 chars/inch (standard E-13B pitch) via `doc.text(..., { charSpace })`.

### Conditional Rendering

In `renderCheckPage`:

- `settings.print_bank_info && settings.routing_number && settings.account_number` → render top-center bank name + bottom MICR line.
- Otherwise → render neither. The check still works on pre-printed stock that already has both.

### Configuration Plumbing

`CheckPrintConfig` extends with:

```ts
print_bank_info: boolean;
routing_number: string | null;
account_number: string | null;
```

`buildPrintConfig(settings, bankAccount, secrets?)` accepts the optional decrypted secrets object.

`PrintCheckButton` and the `PrintChecks` page: before calling `generateCheckPDF`, check the selected bank account's `print_bank_info`. If true, call `fetchAccountSecrets(id)` and pass the result into `buildPrintConfig`. Failure modes:

- RPC error → toast: "Couldn't load bank info. Please try again."
- Secrets missing (toggle on but routing/account null) → toast: "Bank info incomplete. Open Check Settings to fill in routing/account, or turn off 'Print bank info' for this account."

## Security

- `account_number_encrypted` column never leaves the database in a SELECT outside the `get_check_bank_account_secrets` RPC.
- Decrypted account number lives only in the local scope of the print call. No React Query caching, no component state retention.
- Both RPCs are SECURITY DEFINER with `auth.uid()`-based role checks against `user_restaurants` (owner/manager only).
- Routing number stored plaintext is intentional: it's printed on every paper check that leaves the business and is not considered secret.

## Testing

### pgTAP (`supabase/tests/24_check_printing.sql` extended)

- New columns exist with correct types and defaults
- Routing-format CHECK constraint accepts valid 9-digit, rejects too-short and non-numeric
- `set_check_bank_account_secrets` rejects staff/non-owner roles
- `set_check_bank_account_secrets` persists `account_number_last4` correctly
- `get_check_bank_account_secrets` round-trips (set → get returns same plaintext)
- `account_number_encrypted` stored value differs from plaintext (encryption sanity check)

### Vitest

- `tests/unit/checkMicr.test.ts` (new):
  - `formatMicrLine(checkNumber, routing, account)` produces the exact glyph sequence
  - ABA checksum validator: known good and bad routing numbers
- `tests/unit/checkPrinting.test.ts` (extended):
  - When `print_bank_info=true` + secrets present → bank name appears in top region; MICR text appears in bottom region
  - When `print_bank_info=false` → neither appears
  - Memo and signature lines render at y=2.55 (no overlap with MICR clear band)
- `tests/unit/useCheckBankAccounts.test.ts` (extended):
  - `saveAccountSecrets` calls RPC with correct args; refetches
  - `fetchAccountSecrets` returns plaintext; surfaces RPC errors
- `tests/unit/CheckSettingsDialog.test.tsx` (new):
  - Routing input rejects non-digits and bad checksums with inline error
  - Account input masks after save
  - Toggle off → routing/account fields hidden and not required for save

## Rollout

- Migration is additive. `print_bank_info` defaults to `false`, so all existing accounts continue to print exactly as today, **except** the bank name will no longer appear mid-check (the old y=2.2 slot is removed unconditionally). Users who want the bank name back must enable the new toggle and provide routing/account.
- Rationale for unconditional removal of the mid-check bank name: keeping it there in conjunction with a top-center bank name (when toggle is on) would print the bank name twice; keeping it only when the toggle is off creates two divergent layouts. The cleaner behavior is "no bank info" or "full bank info".
- No data backfill needed — the new columns are nullable.

## Open Questions / Known Limitations

- **MICR font licensing**: GnuMICR is the working assumption. If during build the licensing turns out to require GPL contagion (it's GPL with a font exception, but the exception terms are non-trivial), we'll fall back to a permissive alternative (e.g., a CC0 / Public Domain MICR E-13B font). The design intent is unchanged either way.
- **Print-time precision**: True bank-deposit-grade MICR also requires magnetic ink and exact character spacing measured to the thousandth of an inch. The output of this design will be visually correct and OCR-readable, but not magnetically readable. Most modern check-clearing systems fall back to OCR for non-magnetic checks, which our output will pass — but for high-volume issuance, customers may still want professional check stock.

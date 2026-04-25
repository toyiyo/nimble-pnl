# Check Printing — Bank Name on Top + MICR Line — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the bank name to the top-center of the printed check, add an optional, machine-readable MICR (E-13B) line at the bottom of the check, move memo/signature lines into the upper half so the MICR clear band stays empty, and collect/store the routing and account numbers required to populate that MICR line.

**Architecture:** Add three encrypted/optional columns to `check_bank_accounts`, two SECURITY DEFINER RPCs for set/get of the account-number secret (pgcrypto + Vault-stored key), a small MICR-formatting helper + ABA checksum validator, an embedded public-domain MICR E-13B TTF, conditional rendering in `checkPrinting.ts`, a "Bank info for printing" subsection in `CheckSettingsDialog`, and a fetch-secrets hook used by the print entry points.

**Tech Stack:** TypeScript / React 18 / Vite / TailwindCSS / shadcn/ui / Supabase (Postgres + RLS + pgcrypto + Vault) / jsPDF / Vitest / pgTAP / React Query.

**Spec:** [`docs/superpowers/specs/2026-04-25-check-printing-micr-design.md`](../specs/2026-04-25-check-printing-micr-design.md)

---

## File Structure

**Created:**

- `supabase/migrations/20260425120000_check_bank_account_micr.sql` — column additions + routing CHECK constraint
- `supabase/migrations/20260425120100_check_bank_account_secrets_rpc.sql` — vault key + set/get RPCs
- `src/lib/abaChecksum.ts` — ABA routing-number checksum validator (pure)
- `src/utils/micrLine.ts` — MICR glyph-string formatter (pure)
- `src/assets/fonts/micr-e13b.ts` — base64-encoded TTF + jsPDF registration helper
- `src/assets/fonts/micr-e13b.ttf` — public-domain MICR E-13B font binary (sourced in Task 6)
- `tests/unit/abaChecksum.test.ts`
- `tests/unit/micrLine.test.ts`
- `tests/unit/CheckSettingsDialog.test.tsx`

**Modified:**

- `supabase/tests/24_check_printing.sql` — pgTAP additions for new columns + RPCs
- `src/utils/checkPrinting.ts` — `CheckPrintConfig` extension, top-center bank name, memo/sig y-shift, MICR rendering
- `src/components/checks/CheckSettingsDialog.tsx` — "Bank info for printing" subsection
- `src/hooks/useCheckBankAccounts.ts` — `saveAccountSecrets`, `fetchAccountSecrets`, `print_bank_info` field
- `src/components/pending-outflows/PrintCheckButton.tsx` — fetch secrets before generating PDF
- `src/pages/PrintChecks.tsx` — fetch secrets before generating PDF
- `tests/unit/checkPrinting.test.ts` — new layout + MICR assertions
- `tests/unit/useCheckBankAccounts.test.ts` — secrets mutations

---

## Task 1: DB Migration — Schema Additions

**Files:**
- Create: `supabase/migrations/20260425120000_check_bank_account_micr.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Add MICR printing fields to check_bank_accounts
-- See: docs/superpowers/specs/2026-04-25-check-printing-micr-design.md
-- ============================================================================

ALTER TABLE public.check_bank_accounts
  ADD COLUMN routing_number TEXT,
  ADD COLUMN account_number_encrypted TEXT,
  ADD COLUMN account_number_last4 TEXT,
  ADD COLUMN print_bank_info BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.check_bank_accounts
  ADD CONSTRAINT check_routing_format
  CHECK (routing_number IS NULL OR routing_number ~ '^[0-9]{9}$');

ALTER TABLE public.check_bank_accounts
  ADD CONSTRAINT check_account_last4_format
  CHECK (account_number_last4 IS NULL OR account_number_last4 ~ '^[0-9]{4}$');

COMMENT ON COLUMN public.check_bank_accounts.routing_number IS
  'ABA routing number (9 digits). Plaintext — printed on every check by design.';
COMMENT ON COLUMN public.check_bank_accounts.account_number_encrypted IS
  'pgp_sym_encrypt''d bank account number. Decrypt only via get_check_bank_account_secrets RPC.';
COMMENT ON COLUMN public.check_bank_accounts.account_number_last4 IS
  'Last 4 digits of account number, plaintext, for masked UI display.';
COMMENT ON COLUMN public.check_bank_accounts.print_bank_info IS
  'When true, the printed check includes top-center bank name + bottom MICR line.';
```

- [ ] **Step 2: Apply locally**

```bash
npm run db:reset
```

Expected: migration applies cleanly with no errors.

- [ ] **Step 3: Verify schema**

```bash
psql "$(supabase status -o json | jq -r .DB_URL)" -c "\d public.check_bank_accounts" | grep -E "(routing_number|account_number_encrypted|account_number_last4|print_bank_info)"
```

Expected: all four columns listed with correct types.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260425120000_check_bank_account_micr.sql
git commit -m "feat(db): add MICR printing columns to check_bank_accounts"
```

---

## Task 2: DB Migration — Encryption Key + Set/Get RPCs

**Files:**
- Create: `supabase/migrations/20260425120100_check_bank_account_secrets_rpc.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Encryption key (Vault) + set/get RPCs for check bank account secrets
-- ============================================================================

-- pgcrypto for pgp_sym_encrypt; vault for key storage.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- Create the encryption key as a Vault secret if it doesn't already exist.
-- gen_random_bytes is used so each environment gets a unique 32-byte key.
DO $$
DECLARE
  v_existing UUID;
BEGIN
  SELECT id INTO v_existing
  FROM vault.secrets
  WHERE name = 'check_account_encryption_key';

  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'check_account_encryption_key',
      'Symmetric key for encrypting check_bank_accounts.account_number_encrypted'
    );
  END IF;
END $$;

-- Helper to read the key (private — not granted to anon/authenticated).
CREATE OR REPLACE FUNCTION public._check_account_encryption_key()
RETURNS TEXT AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'check_account_encryption_key'
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, vault, pg_temp;

REVOKE EXECUTE ON FUNCTION public._check_account_encryption_key() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- set_check_bank_account_secrets
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_check_bank_account_secrets(
  p_id UUID,
  p_routing TEXT,
  p_account TEXT
)
RETURNS VOID AS $$
DECLARE
  v_restaurant_id UUID;
  v_key TEXT;
BEGIN
  -- Validate routing format up front (the column CHECK also enforces this).
  IF p_routing IS NULL OR p_routing !~ '^[0-9]{9}$' THEN
    RAISE EXCEPTION 'Routing number must be exactly 9 digits';
  END IF;

  IF p_account IS NULL OR length(p_account) < 4 OR length(p_account) > 17 OR p_account !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Account number must be 4 to 17 digits';
  END IF;

  -- Authorization: caller must be owner/manager of this restaurant.
  SELECT restaurant_id INTO v_restaurant_id
  FROM public.check_bank_accounts
  WHERE id = p_id AND is_active = true;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Check bank account not found: %', p_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_id = auth.uid()
      AND restaurant_id = v_restaurant_id
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: insufficient permissions for this restaurant';
  END IF;

  v_key := public._check_account_encryption_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;

  UPDATE public.check_bank_accounts
  SET routing_number = p_routing,
      account_number_encrypted = encode(
        extensions.pgp_sym_encrypt(p_account, v_key),
        'base64'
      ),
      account_number_last4 = right(p_account, 4),
      updated_at = NOW()
  WHERE id = p_id AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

GRANT EXECUTE ON FUNCTION public.set_check_bank_account_secrets(UUID, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- get_check_bank_account_secrets
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_check_bank_account_secrets(p_id UUID)
RETURNS TABLE(routing_number TEXT, account_number TEXT) AS $$
DECLARE
  v_restaurant_id UUID;
  v_key TEXT;
  v_routing TEXT;
  v_encrypted TEXT;
BEGIN
  SELECT cba.restaurant_id, cba.routing_number, cba.account_number_encrypted
    INTO v_restaurant_id, v_routing, v_encrypted
  FROM public.check_bank_accounts cba
  WHERE cba.id = p_id AND cba.is_active = true;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Check bank account not found: %', p_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_id = auth.uid()
      AND restaurant_id = v_restaurant_id
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: insufficient permissions for this restaurant';
  END IF;

  IF v_routing IS NULL OR v_encrypted IS NULL THEN
    RETURN; -- no rows
  END IF;

  v_key := public._check_account_encryption_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not configured';
  END IF;

  routing_number := v_routing;
  account_number := extensions.pgp_sym_decrypt(decode(v_encrypted, 'base64'), v_key);
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

GRANT EXECUTE ON FUNCTION public.get_check_bank_account_secrets(UUID) TO authenticated;
```

- [ ] **Step 2: Apply locally**

```bash
npm run db:reset
```

Expected: clean apply.

- [ ] **Step 3: Manual smoke from psql**

```bash
psql "$(supabase status -o json | jq -r .DB_URL)" <<'SQL'
SELECT id FROM vault.secrets WHERE name = 'check_account_encryption_key';
SQL
```

Expected: one row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260425120100_check_bank_account_secrets_rpc.sql
git commit -m "feat(db): add encrypted set/get RPCs for check account secrets"
```

---

## Task 3: pgTAP Tests for the Migration

**Files:**
- Modify: `supabase/tests/24_check_printing.sql`

- [ ] **Step 1: Read the existing pgTAP file**

```bash
cat supabase/tests/24_check_printing.sql | tail -40
```

Note the current `SELECT plan(N)` count and the `SELECT * FROM finish();` location — we will increase the plan and append before `finish`.

- [ ] **Step 2: Write the new test block (paste above `SELECT * FROM finish();`)**

```sql
-- ============================================================================
-- MICR-printing additions (2026-04-25)
-- ============================================================================

-- Columns exist with correct types/defaults
SELECT col_type_is(
  'public', 'check_bank_accounts', 'routing_number', 'text',
  'check_bank_accounts.routing_number is text'
);
SELECT col_type_is(
  'public', 'check_bank_accounts', 'account_number_encrypted', 'text',
  'check_bank_accounts.account_number_encrypted is text'
);
SELECT col_type_is(
  'public', 'check_bank_accounts', 'account_number_last4', 'text',
  'check_bank_accounts.account_number_last4 is text'
);
SELECT col_type_is(
  'public', 'check_bank_accounts', 'print_bank_info', 'boolean',
  'check_bank_accounts.print_bank_info is boolean'
);
SELECT col_default_is(
  'public', 'check_bank_accounts', 'print_bank_info', 'false',
  'print_bank_info defaults to false'
);

-- Routing-format CHECK constraint
DO $$
DECLARE
  v_restaurant_id UUID;
  v_account_id UUID;
BEGIN
  -- Disable RLS for fixture inserts
  ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
  ALTER TABLE public.check_bank_accounts DISABLE ROW LEVEL SECURITY;

  -- Reuse the test restaurant created earlier in this file, or create one
  SELECT id INTO v_restaurant_id FROM public.restaurants
    WHERE name = 'pgTAP Check Printing Restaurant' LIMIT 1;
  IF v_restaurant_id IS NULL THEN
    INSERT INTO public.restaurants (id, name, owner_id, created_at)
    VALUES (gen_random_uuid(), 'pgTAP Check Printing Restaurant',
            (SELECT id FROM auth.users LIMIT 1), NOW())
    RETURNING id INTO v_restaurant_id;
  END IF;

  INSERT INTO public.check_bank_accounts (restaurant_id, account_name)
  VALUES (v_restaurant_id, 'pgTAP MICR Account')
  RETURNING id INTO v_account_id;

  PERFORM set_config('test.account_id', v_account_id::text, true);
END $$;

-- Reject too-short routing
SELECT throws_ok(
  $$ UPDATE public.check_bank_accounts SET routing_number = '12345'
     WHERE id = current_setting('test.account_id')::uuid $$,
  '23514',
  NULL,
  'CHECK constraint rejects 5-digit routing'
);

-- Reject non-numeric routing
SELECT throws_ok(
  $$ UPDATE public.check_bank_accounts SET routing_number = 'abcdefghi'
     WHERE id = current_setting('test.account_id')::uuid $$,
  '23514',
  NULL,
  'CHECK constraint rejects alphabetic routing'
);

-- Accept valid 9-digit routing
SELECT lives_ok(
  $$ UPDATE public.check_bank_accounts SET routing_number = '111000614'
     WHERE id = current_setting('test.account_id')::uuid $$,
  'CHECK constraint accepts valid 9-digit routing'
);

-- ---------------------------------------------------------------------------
-- RPC: set/get round-trip + encryption sanity
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user_id UUID;
  v_account_id UUID := current_setting('test.account_id')::uuid;
  v_restaurant_id UUID;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
    FROM public.check_bank_accounts WHERE id = v_account_id;

  -- Make the test user owner so RPC auth check passes
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;
  INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
  VALUES (v_user_id, v_restaurant_id, 'owner')
  ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
END $$;

SELECT lives_ok(
  $$ SELECT public.set_check_bank_account_secrets(
       current_setting('test.account_id')::uuid,
       '111000614',
       '2907959096'
     ) $$,
  'set_check_bank_account_secrets succeeds for owner'
);

SELECT is(
  (SELECT account_number_last4 FROM public.check_bank_accounts
     WHERE id = current_setting('test.account_id')::uuid),
  '9096',
  'account_number_last4 is persisted as last 4 digits'
);

SELECT isnt(
  (SELECT account_number_encrypted FROM public.check_bank_accounts
     WHERE id = current_setting('test.account_id')::uuid),
  '2907959096',
  'account_number_encrypted is not the plaintext value'
);

SELECT is(
  (SELECT account_number FROM public.get_check_bank_account_secrets(
     current_setting('test.account_id')::uuid)),
  '2907959096',
  'get_check_bank_account_secrets round-trips the account number'
);

SELECT is(
  (SELECT routing_number FROM public.get_check_bank_account_secrets(
     current_setting('test.account_id')::uuid)),
  '111000614',
  'get_check_bank_account_secrets returns the routing number'
);

-- Reject invalid routing in set RPC (independent of column constraint)
SELECT throws_ok(
  $$ SELECT public.set_check_bank_account_secrets(
       current_setting('test.account_id')::uuid, '123', '1234') $$,
  'P0001',
  'Routing number must be exactly 9 digits',
  'set RPC rejects short routing with explicit error'
);

-- Reject too-short account
SELECT throws_ok(
  $$ SELECT public.set_check_bank_account_secrets(
       current_setting('test.account_id')::uuid, '111000614', '12') $$,
  'P0001',
  'Account number must be 4 to 17 digits',
  'set RPC rejects 2-digit account'
);
```

Increase the `SELECT plan(N)` count at the top of the file by **12** (the number of new assertions). If the file currently says `SELECT plan(33);`, change to `SELECT plan(45);`.

- [ ] **Step 3: Run pgTAP**

```bash
npm run test:db -- supabase/tests/24_check_printing.sql
```

Expected: `ok` lines for all 12 new assertions; final `ok ... # tests N`.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/24_check_printing.sql
git commit -m "test(db): pgTAP coverage for MICR columns + secrets RPCs"
```

---

## Task 4: ABA Routing-Number Checksum Validator

**Files:**
- Create: `src/lib/abaChecksum.ts`
- Test: `tests/unit/abaChecksum.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/abaChecksum.test.ts
import { describe, it, expect } from 'vitest';
import { isValidAbaRouting } from '@/lib/abaChecksum';

describe('isValidAbaRouting', () => {
  it('accepts a known-good Chase Texas routing number', () => {
    expect(isValidAbaRouting('111000614')).toBe(true);
  });

  it('accepts a second known-good routing (Wells Fargo NY)', () => {
    expect(isValidAbaRouting('026009593')).toBe(true);
  });

  it('rejects a 9-digit number with a bad checksum', () => {
    expect(isValidAbaRouting('111000615')).toBe(false);
  });

  it('rejects shorter than 9 digits', () => {
    expect(isValidAbaRouting('12345678')).toBe(false);
  });

  it('rejects longer than 9 digits', () => {
    expect(isValidAbaRouting('1110006141')).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(isValidAbaRouting('11100061a')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidAbaRouting('')).toBe(false);
  });

  it('rejects all zeros (passes checksum but invalid routing)', () => {
    expect(isValidAbaRouting('000000000')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- tests/unit/abaChecksum.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/abaChecksum'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/abaChecksum.ts

/**
 * Validate an ABA routing number using the standard checksum:
 *   3·d1 + 7·d2 + d3 + 3·d4 + 7·d5 + d6 + 3·d7 + 7·d8 + d9 ≡ 0 (mod 10)
 * Also rejects all-zero routing numbers (special-case: reserved/invalid).
 */
export function isValidAbaRouting(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  if (routing === '000000000') return false;
  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(routing[i]) * weights[i];
  }
  return sum % 10 === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- tests/unit/abaChecksum.test.ts
```

Expected: 8/8 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/abaChecksum.ts tests/unit/abaChecksum.test.ts
git commit -m "feat(checks): ABA routing checksum validator"
```

---

## Task 5: MICR Line Formatter

**Files:**
- Create: `src/utils/micrLine.ts`
- Test: `tests/unit/micrLine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/micrLine.test.ts
import { describe, it, expect } from 'vitest';
import { formatMicrLine, MICR_TRANSIT, MICR_ON_US } from '@/utils/micrLine';

describe('formatMicrLine', () => {
  it('formats the standard business-check MICR sequence', () => {
    // ⑈239⑈   ⑆111000614⑆   2907959096⑈
    const result = formatMicrLine({
      checkNumber: 239,
      routingNumber: '111000614',
      accountNumber: '2907959096',
    });
    expect(result).toBe(
      `${MICR_ON_US}239${MICR_ON_US}  ${MICR_TRANSIT}111000614${MICR_TRANSIT}  2907959096${MICR_ON_US}`
    );
  });

  it('right-pads check number with no leading zeros (raw decimal)', () => {
    const result = formatMicrLine({
      checkNumber: 1001,
      routingNumber: '111000614',
      accountNumber: '12345',
    });
    expect(result).toContain(`${MICR_ON_US}1001${MICR_ON_US}`);
  });

  it('throws on an invalid routing number', () => {
    expect(() => formatMicrLine({
      checkNumber: 1,
      routingNumber: '123',
      accountNumber: '1234',
    })).toThrow(/routing/i);
  });

  it('throws on a non-numeric account number', () => {
    expect(() => formatMicrLine({
      checkNumber: 1,
      routingNumber: '111000614',
      accountNumber: '12a4',
    })).toThrow(/account/i);
  });

  it('throws on a non-positive check number', () => {
    expect(() => formatMicrLine({
      checkNumber: 0,
      routingNumber: '111000614',
      accountNumber: '1234',
    })).toThrow(/check number/i);
  });
});

describe('glyph constants', () => {
  it('exports the on-us and transit glyphs', () => {
    expect(MICR_ON_US).toBe('⑈'); // ⑈
    expect(MICR_TRANSIT).toBe('⑆'); // ⑆
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm run test -- tests/unit/micrLine.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/micrLine.ts
import { isValidAbaRouting } from '@/lib/abaChecksum';

/** MICR E-13B "on-us" symbol (⑈) — flanks check number and ends account field. */
export const MICR_ON_US = '⑈';

/** MICR E-13B "transit" symbol (⑆) — flanks the 9-digit routing number. */
export const MICR_TRANSIT = '⑆';

export interface MicrLineInput {
  checkNumber: number;
  routingNumber: string;
  accountNumber: string;
}

/**
 * Build the MICR line string for a US business check:
 *   ⑈ checkNumber ⑈   ⑆ routing ⑆   account ⑈
 *
 * The two-space separator between fields follows industry placement
 * conventions; actual on-paper spacing is controlled by the PDF renderer
 * via charSpace + the font's natural pitch.
 *
 * Throws on malformed input — callers should validate first.
 */
export function formatMicrLine({ checkNumber, routingNumber, accountNumber }: MicrLineInput): string {
  if (!Number.isInteger(checkNumber) || checkNumber < 1) {
    throw new Error('check number must be a positive integer');
  }
  if (!isValidAbaRouting(routingNumber)) {
    throw new Error('routing number is not a valid 9-digit ABA');
  }
  if (!/^\d{4,17}$/.test(accountNumber)) {
    throw new Error('account number must be 4-17 digits');
  }
  return (
    `${MICR_ON_US}${checkNumber}${MICR_ON_US}` +
    `  ${MICR_TRANSIT}${routingNumber}${MICR_TRANSIT}` +
    `  ${accountNumber}${MICR_ON_US}`
  );
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm run test -- tests/unit/micrLine.test.ts
```

Expected: 6/6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/micrLine.ts tests/unit/micrLine.test.ts
git commit -m "feat(checks): MICR E-13B line formatter"
```

---

## Task 6: MICR E-13B Font Asset + jsPDF Registration Helper

**Files:**
- Create: `src/assets/fonts/micr-e13b.ttf` (binary, sourced)
- Create: `src/assets/fonts/micr-e13b.ts`

- [ ] **Step 1: Source a public-domain MICR E-13B TTF**

Search order:
1. The `MICR_Font` repo by `arosenberg01` on GitHub (public domain).
2. The `micrencoding.com` free download (no commercial license required for embedding).
3. Luc Devroye's MICRE13B (public domain attribution OK).

Download the chosen TTF, verify the license file in the repo says public domain or CC0, and save to:

```bash
mkdir -p src/assets/fonts
mv ~/Downloads/<chosen-font>.ttf src/assets/fonts/micr-e13b.ttf
```

Verify it embeds the four MICR symbols by inspecting glyph coverage:

```bash
fc-query src/assets/fonts/micr-e13b.ttf 2>&1 | head -20 || \
  python3 -c "from fontTools.ttLib import TTFont; f=TTFont('src/assets/fonts/micr-e13b.ttf'); print(sorted(f.getBestCmap().keys()))" | grep -E "(0x2446|0x2447|0x2448|0x2449|97|98|99|100)"
```

Expected: the font contains glyphs for either Unicode 0x2446–0x2449 OR the ASCII fallback positions a/b/c/d (0x61–0x64) commonly used by MICR fonts.

**Note for executing engineer:** if the chosen font uses the ASCII fallback mapping (a=transit, b=amount, c=on-us, d=dash), the `formatMicrLine` output (which uses Unicode glyphs) will need a conversion step before passing to `doc.text`. Implement that mapping in step 2 below — see `MICR_PDF_CHAR_MAP`.

- [ ] **Step 2: Write the registration module**

```ts
// src/assets/fonts/micr-e13b.ts
import type { jsPDF } from 'jspdf';
import { MICR_ON_US, MICR_TRANSIT } from '@/utils/micrLine';
// Vite's ?url suffix gives us a URL we can fetch the binary from.
// The file is bundled and emitted to /assets/.
import micrFontUrl from './micr-e13b.ttf?url';

const MICR_FONT_FAMILY = 'MICR-E13B';
const MICR_FONT_FILENAME = 'micr-e13b.ttf';

let cachedBase64: string | null = null;

async function loadFontBase64(): Promise<string> {
  if (cachedBase64) return cachedBase64;
  const res = await fetch(micrFontUrl);
  if (!res.ok) throw new Error(`Failed to load MICR font: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // base64 encode in chunks to avoid call-stack overflow on large fonts.
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < buf.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, buf.subarray(i, i + chunkSize) as unknown as number[]);
  }
  cachedBase64 = btoa(binary);
  return cachedBase64;
}

/**
 * Register the MICR E-13B font with the given jsPDF instance.
 * Returns the font family name to pass to doc.setFont().
 */
export async function registerMicrFont(doc: jsPDF): Promise<string> {
  const base64 = await loadFontBase64();
  doc.addFileToVFS(MICR_FONT_FILENAME, base64);
  doc.addFont(MICR_FONT_FILENAME, MICR_FONT_FAMILY, 'normal');
  return MICR_FONT_FAMILY;
}

/**
 * Some public-domain MICR fonts map the symbols to ASCII positions a-d
 * instead of Unicode 0x2446-0x2449. Override this if the chosen font uses
 * the ASCII mapping; default is identity (Unicode).
 *
 * Common ASCII mapping observed in the wild:
 *   a → transit (⑆), b → amount (⑇), c → on-us (⑈), d → dash (⑉)
 */
export const MICR_PDF_CHAR_MAP: Record<string, string> = {
  // If the chosen TTF uses the ASCII mapping, populate these entries:
  // [MICR_TRANSIT]: 'a',
  // [MICR_ON_US]: 'c',
};

/** Translate a Unicode MICR string into the renderer-specific characters. */
export function toMicrPdfText(unicodeMicr: string): string {
  if (Object.keys(MICR_PDF_CHAR_MAP).length === 0) return unicodeMicr;
  let out = '';
  for (const ch of unicodeMicr) {
    out += MICR_PDF_CHAR_MAP[ch] ?? ch;
  }
  return out;
}
```

After font is downloaded and inspected, populate `MICR_PDF_CHAR_MAP` if the font uses the ASCII fallback. Leave empty if it uses Unicode positions natively.

- [ ] **Step 3: Manually smoke-test the loader (optional but recommended)**

```bash
npm run test -- --run --reporter=verbose tests/unit/checkPrinting.test.ts 2>&1 | head -20
```

The existing checkPrinting tests should continue to pass (we haven't changed checkPrinting yet).

- [ ] **Step 4: Commit**

```bash
git add src/assets/fonts/micr-e13b.ttf src/assets/fonts/micr-e13b.ts
git commit -m "feat(checks): bundle public-domain MICR E-13B font for jsPDF"
```

---

## Task 7: PDF Layout — Bank Name on Top + Memo/Sig Y-Shift

**Files:**
- Modify: `src/utils/checkPrinting.ts`
- Modify: `tests/unit/checkPrinting.test.ts`

- [ ] **Step 1: Read current `renderCheckPage` to understand current state**

```bash
sed -n '105,225p' src/utils/checkPrinting.ts
```

- [ ] **Step 2: Add the failing test for new positions**

Append to `tests/unit/checkPrinting.test.ts` (inside the existing `describe('generateCheckPDF', ...)` block):

```ts
it('renders bank name centered at top when print_bank_info is true', () => {
  const config: CheckPrintConfig = {
    business_name: 'Test Restaurant',
    business_address_line1: '1 Main St',
    business_address_line2: null,
    business_city: 'Austin',
    business_state: 'TX',
    business_zip: '78701',
    bank_name: 'Test Bank NA',
    print_bank_info: true,
    routing_number: '111000614',
    account_number: '2907959096',
  };
  const doc = generateCheckPDF(config, [
    { checkNumber: 1001, payeeName: 'X', amount: 1, issueDate: '2026-04-25' },
  ]);
  const text = doc.output('datauristring');
  expect(text).toContain('Test Bank NA');
});

it('does NOT render bank name when print_bank_info is false', () => {
  const config: CheckPrintConfig = {
    business_name: 'Test Restaurant',
    business_address_line1: null,
    business_address_line2: null,
    business_city: null,
    business_state: null,
    business_zip: null,
    bank_name: 'Test Bank NA',
    print_bank_info: false,
    routing_number: null,
    account_number: null,
  };
  const doc = generateCheckPDF(config, [
    { checkNumber: 1001, payeeName: 'X', amount: 1, issueDate: '2026-04-25' },
  ]);
  // Render to a string and confirm the bank name was NOT drawn on the check
  // (the stub area never contained bank_name, so total absence is meaningful).
  const text = doc.output('datauristring');
  // base64-decode and search for "Test Bank NA"
  const decoded = atob(text.split(',')[1]);
  expect(decoded).not.toContain('Test Bank NA');
});
```

- [ ] **Step 3: Update `CheckPrintConfig` interface in `src/utils/checkPrinting.ts`**

Replace the existing interface with:

```ts
export interface CheckPrintConfig {
  business_name: string;
  business_address_line1: string | null;
  business_address_line2: string | null;
  business_city: string | null;
  business_state: string | null;
  business_zip: string | null;
  bank_name: string | null;
  print_bank_info: boolean;
  routing_number: string | null;
  account_number: string | null;
}
```

- [ ] **Step 4: Update `buildPrintConfig` to accept secrets**

Replace the existing `buildPrintConfig`:

```ts
export interface PrintSecretsInput {
  routing_number: string;
  account_number: string;
}

export function buildPrintConfig(
  settings: Omit<CheckPrintConfig, 'bank_name' | 'print_bank_info' | 'routing_number' | 'account_number'>,
  bankAccount: { bank_name: string | null; print_bank_info: boolean } | null,
  secrets: PrintSecretsInput | null,
): CheckPrintConfig {
  return {
    ...settings,
    bank_name: bankAccount?.bank_name ?? null,
    print_bank_info: Boolean(bankAccount?.print_bank_info && secrets),
    routing_number: secrets?.routing_number ?? null,
    account_number: secrets?.account_number ?? null,
  };
}
```

- [ ] **Step 5: Modify `renderCheckPage` — bank name, memo Y, sig Y**

In `src/utils/checkPrinting.ts`, find the existing block:

```ts
  // Bank name
  if (settings.bank_name) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(settings.bank_name, margin, 2.2);
  }
```

Replace with:

```ts
  // Bank name (top-center) — only when print_bank_info is enabled.
  if (settings.print_bank_info && settings.bank_name) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(settings.bank_name, pageWidth / 2, 0.55, { align: 'center' });
  }
```

Then find the memo line block:

```ts
  // Memo line
  const memoY = 2.85;
```

Replace with:

```ts
  // Memo line — moved up from y=2.85 to y=2.55 so the MICR clear band
  // (bottom 5/8" of the check, y=2.875–3.50) stays empty.
  const memoY = 2.55;
```

The signature line uses `memoY + 0.05` etc., so it moves automatically.

- [ ] **Step 6: Run the new tests + the existing suite**

```bash
npm run test -- tests/unit/checkPrinting.test.ts
```

Expected: all existing tests pass + 2 new tests pass.

- [ ] **Step 7: Verify the dialog/hooks compile after the interface change**

```bash
npm run typecheck 2>&1 | grep -E "(error|checkPrinting|buildPrintConfig)" | head -20
```

You will see `buildPrintConfig` callers fail to compile — that's expected. They get fixed in Task 9 (hook) and Task 11 (print flow). For now, just verify no other unrelated errors appeared.

- [ ] **Step 8: Commit**

```bash
git add src/utils/checkPrinting.ts tests/unit/checkPrinting.test.ts
git commit -m "feat(checks): bank name top-center, raise memo/sig above MICR clear band"
```

---

## Task 8: PDF Rendering — MICR Line

**Files:**
- Modify: `src/utils/checkPrinting.ts`
- Modify: `tests/unit/checkPrinting.test.ts`

- [ ] **Step 1: Add the failing test for MICR rendering**

Append to `tests/unit/checkPrinting.test.ts`:

```ts
it('renders the MICR line at the bottom of the check when print_bank_info', async () => {
  const config: CheckPrintConfig = {
    business_name: 'Test Restaurant',
    business_address_line1: null,
    business_address_line2: null,
    business_city: null,
    business_state: null,
    business_zip: null,
    bank_name: 'Test Bank NA',
    print_bank_info: true,
    routing_number: '111000614',
    account_number: '2907959096',
  };
  const doc = await generateCheckPDFAsync(config, [
    { checkNumber: 239, payeeName: 'X', amount: 1, issueDate: '2026-04-25' },
  ]);
  const decoded = atob(doc.output('datauristring').split(',')[1]);
  // The MICR routing/account digits should appear in the PDF stream
  expect(decoded).toMatch(/111000614/);
  expect(decoded).toMatch(/2907959096/);
  expect(decoded).toMatch(/239/); // check number
});

it('does NOT render the MICR line when print_bank_info is false', async () => {
  const config: CheckPrintConfig = {
    business_name: 'X',
    business_address_line1: null,
    business_address_line2: null,
    business_city: null,
    business_state: null,
    business_zip: null,
    bank_name: null,
    print_bank_info: false,
    routing_number: null,
    account_number: null,
  };
  const doc = await generateCheckPDFAsync(config, [
    { checkNumber: 1001, payeeName: 'X', amount: 1, issueDate: '2026-04-25' },
  ]);
  const decoded = atob(doc.output('datauristring').split(',')[1]);
  expect(decoded).not.toMatch(/111000614/);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm run test -- tests/unit/checkPrinting.test.ts
```

Expected: FAIL — `generateCheckPDFAsync` is not exported.

- [ ] **Step 3: Add MICR rendering and async PDF builder**

In `src/utils/checkPrinting.ts`:

Add at the top of the file:

```ts
import { formatMicrLine } from './micrLine';
import { registerMicrFont, toMicrPdfText } from '@/assets/fonts/micr-e13b';
```

Add a new helper inside the file:

```ts
async function renderMicrLine(
  doc: jsPDF,
  check: CheckData,
  settings: CheckPrintConfig,
  pageWidth: number,
): Promise<void> {
  if (!settings.print_bank_info || !settings.routing_number || !settings.account_number) {
    return;
  }
  const fontFamily = await registerMicrFont(doc);
  const micr = formatMicrLine({
    checkNumber: check.checkNumber,
    routingNumber: settings.routing_number,
    accountNumber: settings.account_number,
  });
  const renderable = toMicrPdfText(micr);

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);

  // MICR baseline at y = 3.30 (about 3/16" up from check bottom edge at 3.50).
  // Right-aligned with 0.5" right margin (industry placement).
  const micrY = 3.30;
  const rightX = pageWidth - 0.5;
  doc.text(renderable, rightX, micrY, { align: 'right', charSpace: 0.018 });

  // Restore default font for any subsequent rendering.
  doc.setFont('helvetica', 'normal');
}
```

Now make `renderCheckPage` async and call `renderMicrLine` after the signature block. Change the signature:

```ts
async function renderCheckPage(doc: jsPDF, settings: CheckPrintConfig, check: CheckData) {
  // ... existing code ...

  // (existing signature line code already drew at memoY + 0.05 etc.)

  await renderMicrLine(doc, check, settings, pageWidth);

  // Perforation line between check and first stub (existing code unchanged)
  // ...
}
```

Add a new async exported function:

```ts
export async function generateCheckPDFAsync(
  settings: CheckPrintConfig,
  checks: CheckData[],
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });

  for (let i = 0; i < checks.length; i++) {
    if (i > 0) doc.addPage();
    await renderCheckPage(doc, settings, checks[i]);
  }
  return doc;
}
```

Keep the existing synchronous `generateCheckPDF` for backward-compat tests, but change its body to throw if `print_bank_info` is true (since MICR requires async font loading). Replace its body:

```ts
export function generateCheckPDF(settings: CheckPrintConfig, checks: CheckData[]): jsPDF {
  if (settings.print_bank_info) {
    throw new Error('print_bank_info requires generateCheckPDFAsync (font loading is async)');
  }
  const doc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
  checks.forEach((check, index) => {
    if (index > 0) doc.addPage();
    // Synchronous path: skip MICR, no async work needed.
    void renderCheckPageSync(doc, settings, check);
  });
  return doc;
}

// Pull the body of the old renderCheckPage out into a sync version that
// omits the MICR call. The async version delegates to it then renders MICR.
function renderCheckPageSync(doc: jsPDF, settings: CheckPrintConfig, check: CheckData) {
  // (paste the body of the old renderCheckPage here, MINUS the await renderMicrLine line)
}
```

Update `renderCheckPage` to:

```ts
async function renderCheckPage(doc: jsPDF, settings: CheckPrintConfig, check: CheckData) {
  renderCheckPageSync(doc, settings, check);
  await renderMicrLine(doc, check, settings, 8.5); // pageWidth = letter
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- tests/unit/checkPrinting.test.ts
```

Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/checkPrinting.ts tests/unit/checkPrinting.test.ts
git commit -m "feat(checks): render MICR line at bottom of check when enabled"
```

---

## Task 9: Hook — `print_bank_info`, `saveAccountSecrets`, `fetchAccountSecrets`

**Files:**
- Modify: `src/hooks/useCheckBankAccounts.ts`
- Modify: `tests/unit/useCheckBankAccounts.test.ts`

- [ ] **Step 1: Read the existing hook**

```bash
cat src/hooks/useCheckBankAccounts.ts
```

Note where `CheckBankAccount` and `UpsertCheckBankAccountInput` types live and the React Query keys used.

- [ ] **Step 2: Add the failing test for `saveAccountSecrets`**

Append to `tests/unit/useCheckBankAccounts.test.ts` (inside the main describe block):

```ts
describe('saveAccountSecrets', () => {
  it('calls set_check_bank_account_secrets RPC with correct args', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    (supabase as any).rpc = mockRpc;

    const { result } = renderHook(() => useCheckBankAccounts(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.saveAccountSecrets.mutateAsync({
      id: 'abc-123',
      routing: '111000614',
      account: '2907959096',
    });

    expect(mockRpc).toHaveBeenCalledWith('set_check_bank_account_secrets', {
      p_id: 'abc-123',
      p_routing: '111000614',
      p_account: '2907959096',
    });
  });

  it('throws when the RPC returns an error', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Routing number must be exactly 9 digits' },
    });
    (supabase as any).rpc = mockRpc;

    const { result } = renderHook(() => useCheckBankAccounts(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      result.current.saveAccountSecrets.mutateAsync({
        id: 'abc-123', routing: '12345', account: '1234',
      })
    ).rejects.toThrow(/Routing number/);
  });
});

describe('fetchAccountSecrets', () => {
  it('returns plaintext routing + account on success', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: [{ routing_number: '111000614', account_number: '2907959096' }],
      error: null,
    });
    (supabase as any).rpc = mockRpc;

    const { result } = renderHook(() => useCheckBankAccounts(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const secrets = await result.current.fetchAccountSecrets('abc-123');
    expect(mockRpc).toHaveBeenCalledWith('get_check_bank_account_secrets', { p_id: 'abc-123' });
    expect(secrets).toEqual({ routing_number: '111000614', account_number: '2907959096' });
  });

  it('returns null when the RPC returns no rows', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: [], error: null });
    (supabase as any).rpc = mockRpc;

    const { result } = renderHook(() => useCheckBankAccounts(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const secrets = await result.current.fetchAccountSecrets('abc-123');
    expect(secrets).toBeNull();
  });

  it('throws when the RPC returns an error', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Unauthorized' },
    });
    (supabase as any).rpc = mockRpc;

    const { result } = renderHook(() => useCheckBankAccounts(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.fetchAccountSecrets('abc-123')).rejects.toThrow(/Unauthorized/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npm run test -- tests/unit/useCheckBankAccounts.test.ts
```

Expected: FAIL — `result.current.saveAccountSecrets` and `result.current.fetchAccountSecrets` are undefined.

- [ ] **Step 4: Implement the additions in the hook**

Open `src/hooks/useCheckBankAccounts.ts`. Update the `CheckBankAccount` and `UpsertCheckBankAccountInput` types:

```ts
export interface CheckBankAccount {
  id: string;
  restaurant_id: string;
  account_name: string;
  bank_name: string | null;
  connected_bank_id: string | null;
  next_check_number: number;
  is_default: boolean;
  is_active: boolean;
  // MICR-printing fields (account_number_encrypted is intentionally NOT exposed)
  routing_number: string | null;
  account_number_last4: string | null;
  print_bank_info: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertCheckBankAccountInput {
  id?: string;
  account_name: string;
  bank_name: string | null;
  next_check_number: number;
  is_default: boolean;
  print_bank_info: boolean;
}
```

In the SELECT statement of the listing query, change:

```ts
.select('id, restaurant_id, account_name, bank_name, connected_bank_id, next_check_number, is_default, is_active, created_at, updated_at')
```

to:

```ts
.select('id, restaurant_id, account_name, bank_name, connected_bank_id, next_check_number, is_default, is_active, routing_number, account_number_last4, print_bank_info, created_at, updated_at')
```

In the existing `saveAccount` upsert payload, include `print_bank_info`:

```ts
const payload = {
  ...(input.id ? { id: input.id } : {}),
  restaurant_id: restaurantId,
  account_name: input.account_name,
  bank_name: input.bank_name,
  next_check_number: input.next_check_number,
  is_default: input.is_default,
  print_bank_info: input.print_bank_info,
};
```

Add the two new mutations + the fetch helper. After the existing `deleteAccount` block:

```ts
const saveAccountSecrets = useMutation({
  mutationFn: async ({ id, routing, account }: { id: string; routing: string; account: string }) => {
    const { error } = await supabase.rpc('set_check_bank_account_secrets', {
      p_id: id,
      p_routing: routing,
      p_account: account,
    });
    if (error) throw new Error(error.message);
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['check-bank-accounts', restaurantId] });
  },
});

const fetchAccountSecrets = useCallback(
  async (id: string): Promise<{ routing_number: string; account_number: string } | null> => {
    const { data, error } = await supabase.rpc('get_check_bank_account_secrets', { p_id: id });
    if (error) throw new Error(error.message);
    if (!Array.isArray(data) || data.length === 0) return null;
    const row = data[0];
    return {
      routing_number: row.routing_number,
      account_number: row.account_number,
    };
  },
  [],
);
```

Add `saveAccountSecrets` and `fetchAccountSecrets` to the returned object.

- [ ] **Step 5: Run tests**

```bash
npm run test -- tests/unit/useCheckBankAccounts.test.ts
```

Expected: all existing tests + 5 new tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useCheckBankAccounts.ts tests/unit/useCheckBankAccounts.test.ts
git commit -m "feat(checks): hook for bank-info print toggle + encrypted account secrets"
```

---

## Task 10: UI — "Bank info for printing" Subsection in `CheckSettingsDialog`

**Files:**
- Modify: `src/components/checks/CheckSettingsDialog.tsx`
- Create: `tests/unit/CheckSettingsDialog.test.tsx`

- [ ] **Step 1: Read the current dialog account-form section**

```bash
sed -n '100,260p' src/components/checks/CheckSettingsDialog.tsx
```

Find the inline add/edit form block (where `account_name`, `bank_name`, `next_check_number`, `is_default` are rendered). The new subsection lives at the bottom of that form.

- [ ] **Step 2: Update `AccountFormState`**

Replace:

```ts
interface AccountFormState {
  id?: string;
  account_name: string;
  bank_name: string;
  next_check_number: number;
  is_default: boolean;
}

const emptyAccountForm: AccountFormState = {
  account_name: '',
  bank_name: '',
  next_check_number: 1001,
  is_default: false,
};
```

With:

```ts
interface AccountFormState {
  id?: string;
  account_name: string;
  bank_name: string;
  next_check_number: number;
  is_default: boolean;
  print_bank_info: boolean;
  // Bank info fields (only used when print_bank_info is true). Account number
  // is plaintext only during entry; it is never re-displayed after save.
  routing_number: string;
  account_number: string;
  account_number_last4: string | null;
}

const emptyAccountForm: AccountFormState = {
  account_name: '',
  bank_name: '',
  next_check_number: 1001,
  is_default: false,
  print_bank_info: false,
  routing_number: '',
  account_number: '',
  account_number_last4: null,
};
```

- [ ] **Step 3: When entering edit mode, hydrate the new fields**

Find where edit-mode form state is set from an existing account row (look for `setEditingAccount(...)` usage). Update the population to include:

```ts
print_bank_info: account.print_bank_info,
routing_number: account.routing_number ?? '',
account_number: '', // never pre-fill — user must re-enter to change
account_number_last4: account.account_number_last4,
```

- [ ] **Step 4: Add the subsection JSX**

Inside the inline form's grid, after the `is_default` switch row, add:

```tsx
import { isValidAbaRouting } from '@/lib/abaChecksum';
// (add to existing imports at top of file)

// ... inside the form ...

<div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
  <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center justify-between">
    <h3 className="text-[13px] font-semibold text-foreground">Bank info for printing</h3>
    <Switch
      checked={editingAccount.print_bank_info}
      onCheckedChange={(checked) =>
        setEditingAccount({ ...editingAccount, print_bank_info: checked })
      }
      className="data-[state=checked]:bg-foreground"
      aria-label="Print bank name and account info on checks"
    />
  </div>
  <div className="p-4 space-y-4">
    <p className="text-[13px] text-muted-foreground">
      Turn on if you print on blank check stock. Leave off if your check stock
      already has the bank name and MICR line pre-printed.
    </p>
    {editingAccount.print_bank_info && (
      <>
        <div>
          <Label
            htmlFor="routing-number"
            className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
          >
            Routing Number
          </Label>
          <Input
            id="routing-number"
            inputMode="numeric"
            maxLength={9}
            placeholder="111000614"
            value={editingAccount.routing_number}
            onChange={(e) =>
              setEditingAccount({
                ...editingAccount,
                routing_number: e.target.value.replace(/\D/g, '').slice(0, 9),
              })
            }
            className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            aria-describedby="routing-help"
          />
          <p id="routing-help" className="mt-1 text-[12px] text-muted-foreground">
            9-digit ABA routing number printed on the bottom of your checks.
          </p>
          {editingAccount.routing_number.length === 9 && !isValidAbaRouting(editingAccount.routing_number) && (
            <p className="mt-1 text-[12px] text-destructive" role="alert">
              Routing number checksum is invalid. Please double-check the digits.
            </p>
          )}
        </div>

        <div>
          <Label
            htmlFor="account-number"
            className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
          >
            Account Number
          </Label>
          {editingAccount.account_number_last4 && editingAccount.account_number === '' ? (
            <div className="flex items-center gap-2">
              <Input
                id="account-number-masked"
                disabled
                value={`••••${editingAccount.account_number_last4}`}
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setEditingAccount({ ...editingAccount, account_number_last4: null })
                }
                className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
              >
                Edit
              </Button>
            </div>
          ) : (
            <Input
              id="account-number"
              inputMode="numeric"
              maxLength={17}
              placeholder="2907959096"
              value={editingAccount.account_number}
              onChange={(e) =>
                setEditingAccount({
                  ...editingAccount,
                  account_number: e.target.value.replace(/\D/g, '').slice(0, 17),
                })
              }
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
              aria-describedby="account-help"
            />
          )}
          <p id="account-help" className="mt-1 text-[12px] text-muted-foreground">
            Stored encrypted; only the last 4 digits will be shown after saving.
          </p>
        </div>
      </>
    )}
  </div>
</div>
```

- [ ] **Step 5: Update the save handler**

Find the existing `handleSaveAccount` (or equivalent). After the `saveAccount.mutateAsync(...)` call, add a secrets save when relevant:

```ts
const savedAccount = await saveAccount.mutateAsync({
  id: editingAccount.id,
  account_name: editingAccount.account_name,
  bank_name: editingAccount.bank_name || null,
  next_check_number: editingAccount.next_check_number,
  is_default: editingAccount.is_default,
  print_bank_info: editingAccount.print_bank_info,
});

// If MICR is enabled and the user provided routing + account, persist secrets.
if (
  editingAccount.print_bank_info &&
  editingAccount.routing_number.length === 9 &&
  isValidAbaRouting(editingAccount.routing_number) &&
  editingAccount.account_number.length >= 4
) {
  await saveAccountSecrets.mutateAsync({
    id: savedAccount.id,
    routing: editingAccount.routing_number,
    account: editingAccount.account_number,
  });
}

// Block save if MICR is enabled but inputs are incomplete.
// (Surface this with toast — return early before mutateAsync if invalid.)
```

The validation (`return early with toast`) lives ABOVE the `saveAccount.mutateAsync` call:

```ts
if (editingAccount.print_bank_info) {
  if (!isValidAbaRouting(editingAccount.routing_number)) {
    toast({ title: 'Invalid routing number', description: 'Enter a valid 9-digit ABA routing number.', variant: 'destructive' });
    return;
  }
  // Account number is required either as a new entry OR pre-existing (account_number_last4 != null and not in edit-replacement mode).
  const hasExistingSecret = !!editingAccount.account_number_last4 && editingAccount.id !== undefined;
  if (!hasExistingSecret && editingAccount.account_number.length < 4) {
    toast({ title: 'Account number required', description: 'Enter a 4–17 digit account number.', variant: 'destructive' });
    return;
  }
}
```

Note: `saveAccount.mutateAsync` must return the saved row including `id`. If the existing implementation does not, update it to return the row from the upsert: `.select().single()`.

- [ ] **Step 6: Write the dialog test**

Create `tests/unit/CheckSettingsDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CheckSettingsDialog } from '@/components/checks/CheckSettingsDialog';

// Minimal mocks for hooks the dialog uses.
vi.mock('@/hooks/useCheckSettings', () => ({
  useCheckSettings: () => ({
    settings: {
      business_name: 'Test', business_address_line1: null, business_address_line2: null,
      business_city: null, business_state: null, business_zip: null,
    },
    saveSettings: { mutateAsync: vi.fn() },
  }),
}));

const saveAccount = vi.fn().mockResolvedValue({ id: 'new-id' });
const saveAccountSecrets = vi.fn().mockResolvedValue(undefined);
const deleteAccount = vi.fn();

vi.mock('@/hooks/useCheckBankAccounts', () => ({
  useCheckBankAccounts: () => ({
    accounts: [],
    saveAccount: { mutateAsync: saveAccount },
    saveAccountSecrets: { mutateAsync: saveAccountSecrets },
    deleteAccount: { mutateAsync: deleteAccount },
    fetchAccountSecrets: vi.fn(),
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { id: 'r1', name: 'R', legal_name: 'R LLC' } },
  }),
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  saveAccount.mockClear();
  saveAccountSecrets.mockClear();
});

describe('CheckSettingsDialog — Bank info for printing', () => {
  it('hides routing and account inputs when toggle is off', () => {
    render(
      <CheckSettingsDialog open onOpenChange={() => {}} />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: /add account/i }));
    expect(screen.queryByLabelText(/routing number/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/account number/i)).not.toBeInTheDocument();
  });

  it('shows routing and account inputs when toggle is on', () => {
    render(
      <CheckSettingsDialog open onOpenChange={() => {}} />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: /add account/i }));
    fireEvent.click(screen.getByLabelText(/print bank name and account info/i));
    expect(screen.getByLabelText(/routing number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/account number/i)).toBeInTheDocument();
  });

  it('strips non-digits from routing input', () => {
    render(<CheckSettingsDialog open onOpenChange={() => {}} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /add account/i }));
    fireEvent.click(screen.getByLabelText(/print bank name and account info/i));
    const input = screen.getByLabelText(/routing number/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '111-000-614' } });
    expect(input.value).toBe('111000614');
  });

  it('shows checksum error for invalid 9-digit routing', () => {
    render(<CheckSettingsDialog open onOpenChange={() => {}} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /add account/i }));
    fireEvent.click(screen.getByLabelText(/print bank name and account info/i));
    fireEvent.change(screen.getByLabelText(/routing number/i), { target: { value: '111000615' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid/i);
  });

  it('saves both account and secrets when MICR is enabled and inputs valid', async () => {
    render(<CheckSettingsDialog open onOpenChange={() => {}} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /add account/i }));
    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: 'Operating' } });
    fireEvent.click(screen.getByLabelText(/print bank name and account info/i));
    fireEvent.change(screen.getByLabelText(/routing number/i), { target: { value: '111000614' } });
    fireEvent.change(screen.getByLabelText(/account number/i), { target: { value: '2907959096' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await screen.findByText(/Operating/i, undefined, { timeout: 1000 }).catch(() => undefined);
    expect(saveAccount).toHaveBeenCalled();
    expect(saveAccountSecrets).toHaveBeenCalledWith({
      id: 'new-id',
      routing: '111000614',
      account: '2907959096',
    });
  });
});
```

- [ ] **Step 7: Run dialog tests**

```bash
npm run test -- tests/unit/CheckSettingsDialog.test.tsx
```

Expected: all 5 tests pass. Iterate on selector text/labels if any fail (the dialog code may use slightly different button text; adjust the selector strings).

- [ ] **Step 8: Commit**

```bash
git add src/components/checks/CheckSettingsDialog.tsx tests/unit/CheckSettingsDialog.test.tsx
git commit -m "feat(checks): bank info subsection with routing + account inputs"
```

---

## Task 11: Print Flow — Fetch Secrets Before Generating PDF

**Files:**
- Modify: `src/components/pending-outflows/PrintCheckButton.tsx`
- Modify: `src/pages/PrintChecks.tsx`

- [ ] **Step 1: Read both consumers**

```bash
grep -n "generateCheckPDF\|buildPrintConfig" src/components/pending-outflows/PrintCheckButton.tsx src/pages/PrintChecks.tsx
```

Note the call sites and any local state that holds the selected `bankAccountId`.

- [ ] **Step 2: Update `PrintCheckButton.tsx`**

Inside the click-to-print handler (where `generateCheckPDF` is currently called):

```ts
import { generateCheckPDFAsync, buildPrintConfig } from '@/utils/checkPrinting';
import { useToast } from '@/hooks/use-toast';
import { useCheckBankAccounts } from '@/hooks/useCheckBankAccounts';

// inside the component:
const { accounts, fetchAccountSecrets } = useCheckBankAccounts();
const { toast } = useToast();

async function handlePrint() {
  const account = accounts?.find(a => a.id === selectedBankAccountId);
  let secrets: { routing_number: string; account_number: string } | null = null;

  if (account?.print_bank_info) {
    if (!account.routing_number || !account.account_number_last4) {
      toast({
        title: 'Bank info incomplete',
        description: 'Open Check Settings to add the routing and account numbers, or turn off "Print bank info" for this account.',
        variant: 'destructive',
      });
      return;
    }
    try {
      secrets = await fetchAccountSecrets(account.id);
    } catch (e) {
      toast({
        title: "Couldn't load bank info",
        description: e instanceof Error ? e.message : 'Please try again.',
        variant: 'destructive',
      });
      return;
    }
    if (!secrets) {
      toast({
        title: 'Bank info incomplete',
        description: 'Account number is missing. Re-enter it in Check Settings.',
        variant: 'destructive',
      });
      return;
    }
  }

  const config = buildPrintConfig(settings, account ?? null, secrets);
  const doc = await generateCheckPDFAsync(config, [checkData]);
  doc.save(generateCheckFilename(restaurantName, [checkData.checkNumber]));
}
```

(Adapt variable names — `selectedBankAccountId`, `settings`, `checkData`, `restaurantName` — to whatever the existing component uses.)

- [ ] **Step 3: Update `PrintChecks.tsx`**

Same pattern as Step 2 — replace any `generateCheckPDF` call with the async version, and fetch secrets first when the selected bank account has `print_bank_info` enabled.

- [ ] **Step 4: Manual smoke**

```bash
npm run dev
```

In the browser:
1. Open Check Settings, edit a bank account, enable "Print bank name and account info on checks", enter routing `111000614`, enter account `2907959096`, save.
2. Print a check from `PrintCheckButton` or `PrintChecks` page.
3. Open the resulting PDF and verify:
   - Bank name appears centered at the top
   - Memo and signature lines sit clearly above the bottom edge
   - MICR line `⑈239⑈ ⑆111000614⑆ 2907959096⑈` (or check#) appears at the bottom

If MICR characters look wrong (boxes, garbled), the font character mapping in Task 6 needs fixing (set `MICR_PDF_CHAR_MAP` accordingly).

4. Toggle the bank account's "Print bank info" off, print again, verify no bank name on top + no MICR line + check still prints.

- [ ] **Step 5: Run typecheck + full test suite**

```bash
npm run typecheck && npm run test
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/pending-outflows/PrintCheckButton.tsx src/pages/PrintChecks.tsx
git commit -m "feat(checks): wire print flow to fetch encrypted account secrets"
```

---

## Self-Review Pass

- [ ] **Spec coverage:** Every section of the design has a task — schema (Task 1), encryption + RPCs (Task 2), pgTAP (Task 3), validation lib (Task 4), MICR formatter (Task 5), font asset (Task 6), PDF layout (Task 7), MICR rendering (Task 8), hook plumbing (Task 9), dialog UI (Task 10), print flow (Task 11). ✓
- [ ] **Type consistency:** `print_bank_info`, `routing_number`, `account_number`, `account_number_last4` use the same names across migration → RPC return → hook → dialog → checkPrinting config. `formatMicrLine`, `isValidAbaRouting`, `registerMicrFont`, `toMicrPdfText` are introduced once and used consistently. ✓
- [ ] **Placeholder scan:** No "TBD"/"TODO". Each step shows actual code. The two soft-decision spots — font sourcing in Task 6 and the optional `MICR_PDF_CHAR_MAP` population — are concrete fallbacks with explicit verification commands, not unfinished work. ✓

---

## Done Definition

- All 11 tasks committed on `feature/check-micr-bank-info`
- `npm run test`, `npm run test:db`, `npm run typecheck`, `npm run lint`, `npm run build` all green
- Manual smoke from Task 11 Step 4 confirms: bank name centered top, memo/signature above the bottom 5/8" of the check, MICR line readable at the bottom of the check, toggle-off path prints exactly as today minus the mid-check bank name

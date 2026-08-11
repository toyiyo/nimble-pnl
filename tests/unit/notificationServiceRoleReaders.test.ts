import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Migration 20260806110000 revoked SELECT on `employees.email` (and other PII/pay
// columns) from the `authenticated` role. Two notifier edge functions read the
// roster to fan out schedule and shift-trade emails. When a notifier reads
// `employees` with a client that carries the caller's JWT, PostgREST runs the
// read as `authenticated`, so naming `email` raises 42501 "permission denied for
// table employees" and aborts the whole request. The manager then sees an
// engineering error with no action.
//
// Each notifier already holds an authorization gate that does NOT depend on the
// roster read (see the assertions below). So each notifier may read the email
// column with its bare service-role client, AFTER that gate. These guards pin
// each read to the correct client, so a later refactor cannot silently route an
// email read back through the JWT client and break the page again.
//
// This guard mirrors tests/unit/employeesSecureViewReaders.test.ts (#738): it
// scans source text, not runtime behavior, because the failure is a role/column
// mismatch that a unit test with a mocked client cannot reproduce.

const readSource = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../..', relativePath), 'utf8');

const NOTIFY_PUBLISHED = 'supabase/functions/notify-schedule-published/index.ts';
const SHIFT_TRADE = 'supabase/functions/send-shift-trade-notification/index.ts';

describe('notify-schedule-published reads the roster as service_role', () => {
  const source = readSource(NOTIFY_PUBLISHED);

  it('constructs a bare service-role client (no Authorization override)', () => {
    // A bare client — SERVICE_ROLE_KEY and no `global.headers.Authorization` —
    // runs as `service_role`, which keeps its column grants. The block ends at
    // `);` right after the key, so no JWT overrides the role.
    expect(source).toContain(
      'const serviceClient = createClient(\n' +
        '      Deno.env.get("SUPABASE_URL") ?? "",\n' +
        '      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""\n' +
        '    );'
    );
  });

  it('reads the active-employee roster with serviceClient', () => {
    // The authorization gate here is an explicit owner/manager role check on
    // `user_restaurants` (independent of this read), so elevating the roster
    // read to service_role does not bypass any gate.
    expect(source).toContain(
      'const { data: employees, error: empError } = await serviceClient\n      .from("employees")'
    );
  });

  it('does NOT read the roster with the JWT-scoped client', () => {
    // The regression: this exact read ran as `authenticated`, named `email`, and
    // raised 42501.
    expect(source).not.toContain(
      'const { data: employees, error: empError } = await supabase\n      .from("employees")'
    );
  });
});

describe('send-shift-trade-notification keeps the trade read gated but resolves email as service_role', () => {
  const source = readSource(SHIFT_TRADE);

  it('constructs a bare service-role client named admin', () => {
    expect(source).toContain('const admin = createClient(supabaseUrl, supabaseServiceKey);');
  });

  it('reads the trade row with the JWT-scoped client, NOT admin', () => {
    // CRITICAL privacy property. The `shift_trades` SELECT policy
    // (20260713000000) makes a DIRECTED trade visible only to its target,
    // offerer, or accepter. That RLS-filtered read IS the participant
    // authorization gate. Elevating it to `admin` would let a same-restaurant
    // non-participant read a private trade and receive the target's email in the
    // `recipients` response — the exact leak that migration closed.
    expect(source).toContain(
      "const { data: trade, error: tradeError } = await supabase\n      .from('shift_trades')"
    );
    expect(source).not.toContain(
      "const { data: trade, error: tradeError } = await admin\n      .from('shift_trades')"
    );
  });

  it('names no gated column inside any employees embed', () => {
    // A PostgREST embed reads the base `employees` table as the caller's role.
    // Naming `email` in an embed on the JWT-scoped trade read raises 42501 and
    // aborts the whole query. Keep the embeds to ungated columns (`name`,
    // `user_id`); resolve `email` separately via `admin`.
    // The guard must scan at least one embed, or a renamed field would disarm it.
    const embeddedColumns = [...source.matchAll(/employees![a-z_]+\(([^)]*)\)/g)].map((m) => m[1]);
    expect(embeddedColumns).not.toHaveLength(0);
    const embedded = embeddedColumns.join(',');
    expect(new RegExp('\\bemail\\b').test(embedded)).toBe(false);
  });

  it('builds the recipient list with admin so it can read the gated email column', () => {
    // buildEmails reads `employees.email` for the open-trade broadcast and must
    // run as service_role. It is reached only after the trade read (participant
    // gate) and the membership gate above.
    expect(source).toContain('await buildEmails(\n      admin,');
    expect(source).not.toContain('await buildEmails(\n      supabase,');
  });
});

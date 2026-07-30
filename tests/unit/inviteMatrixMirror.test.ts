/**
 * The invite matrix is duplicated: the TS source of truth in
 * src/lib/permissions/invitations.ts and a verbatim Deno mirror in the
 * send-team-invitation edge function. There is no compiler link between
 * them, so this test is the only thing preventing silent drift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Extract `const INVITABLE_ROLES ... = { ... };` and parse it into a plain object. */
function parseMatrix(source: string, file: string): Record<string, string[]> {
  const start = source.indexOf('const INVITABLE_ROLES');
  expect(start, `INVITABLE_ROLES not found in ${file}`).toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  expect(end, `unbalanced braces in ${file}`).toBeGreaterThan(open);

  const body = source.slice(open, end + 1);
  const matrix: Record<string, string[]> = {};
  // Matches:  owner: [ 'a', 'b', ],   across newlines
  const entry = /(\w+)\s*:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(body)) !== null) {
    // Accept either quote style so a double-quoted role in the Deno mirror
    // (e.g. "kiosk") is still parsed — missing it would silently defeat the guard.
    matrix[m[1]] = [...m[2].matchAll(/(['"])([^'"]+)\1/g)].map((r) => r[2]);
  }
  return matrix;
}

/** Extract the string members of `const CUSTOM_ROLE_INVITERS ... = [ ... ];`. */
function parseCustomRoleInviters(source: string, file: string): string[] {
  const match = /const CUSTOM_ROLE_INVITERS[^=]*=\s*\[([^\]]*)\]/.exec(source);
  expect(match, `CUSTOM_ROLE_INVITERS not found in ${file}`).not.toBeNull();
  return [...match![1].matchAll(/(['"])([^'"]+)\1/g)].map((r) => r[2]);
}

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const TS_PATH = 'src/lib/permissions/invitations.ts';
const DENO_PATH = 'supabase/functions/send-team-invitation/index.ts';

describe('invite matrix mirror', () => {
  const ts = parseMatrix(read(TS_PATH), TS_PATH);
  const deno = parseMatrix(read(DENO_PATH), DENO_PATH);

  it('the Deno mirror defines every inviter role the TS matrix grants invites to', () => {
    const tsInviters = Object.entries(ts).filter(([, t]) => t.length > 0).map(([r]) => r).sort();
    expect(Object.keys(deno).sort()).toEqual(tsInviters);
  });

  it('every shared inviter row is deep-equal between TS and Deno', () => {
    for (const inviter of Object.keys(deno)) {
      expect(deno[inviter], `row "${inviter}" drifted between TS and Deno`)
        .toEqual(ts[inviter]);
    }
  });

  it('the custom-role inviter list is identical between TS and Deno', () => {
    // A second duplicated list, and a more dangerous one than the matrix: it
    // gates who may hand out an arbitrary bundle of areas rather than one of
    // ten fixed roles. Drift here means the client hides the control while the
    // endpoint still honours the call, or the reverse.
    expect(parseCustomRoleInviters(read(DENO_PATH), DENO_PATH))
      .toEqual(parseCustomRoleInviters(read(TS_PATH), TS_PATH));
  });

  it('custom roles cannot be invited by anyone who cannot invite builtin collaborators', () => {
    // The custom-role gate must not be a way around the matrix: every inviter
    // admitted to custom roles must already be trusted with the builtin
    // collaborator roles, which are the weakest thing a custom role can be.
    for (const inviter of parseCustomRoleInviters(read(TS_PATH), TS_PATH)) {
      expect(ts[inviter], `${inviter} may invite custom roles but no builtin collaborator role`)
        .toContain('collaborator_accountant');
    }
  });

  it('collaborator_custom is not a target in either matrix — it is a pointer, not a role', () => {
    // Admitting the literal to the matrix would grant "any custom role" in one
    // step, bypassing the per-role ownership check the endpoint performs.
    for (const [inviter, targets] of [...Object.entries(ts), ...Object.entries(deno)]) {
      expect(targets, `${inviter} lists collaborator_custom as a matrix target`)
        .not.toContain('collaborator_custom');
    }
  });

  it('no role can invite kiosk — a kiosk is a device credential, not a person', () => {
    for (const [inviter, targets] of Object.entries(ts)) {
      expect(targets, `${inviter} should not be able to invite kiosk`).not.toContain('kiosk');
    }
    for (const [inviter, targets] of Object.entries(deno)) {
      expect(targets, `${inviter} (Deno) should not be able to invite kiosk`).not.toContain('kiosk');
    }
  });
});

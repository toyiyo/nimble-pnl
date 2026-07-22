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
    matrix[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((r) => r[1]);
  }
  return matrix;
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

  it('no role can invite kiosk — a kiosk is a device credential, not a person', () => {
    for (const [inviter, targets] of Object.entries(ts)) {
      expect(targets, `${inviter} should not be able to invite kiosk`).not.toContain('kiosk');
    }
    for (const [inviter, targets] of Object.entries(deno)) {
      expect(targets, `${inviter} (Deno) should not be able to invite kiosk`).not.toContain('kiosk');
    }
  });
});

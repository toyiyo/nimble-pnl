import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ai-execute-tool/index.ts has Deno URL imports, so Vitest cannot import it.
const src = readFileSync(resolve(__dirname, '../../supabase/functions/ai-execute-tool/index.ts'), 'utf8');

describe('ai-execute-tool checks required arguments (D10)', () => {
  const permissionEnd = src.indexOf('// "Today" for the tools is the restaurant\'s local day');
  const check = src.indexOf('missingRequiredArgs(tool_name, args)');

  it('calls missingRequiredArgs after the permission check and before the timezone lookup', () => {
    expect(check).toBeGreaterThan(src.indexOf('TOOL_PERMISSION_DENIED'));
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(permissionEnd);
  });

  it('answers in band with HTTP 200 and INVALID_ARGUMENTS', () => {
    const block = src.slice(check, permissionEnd);
    expect(block).toContain("code: 'INVALID_ARGUMENTS'");
    expect(block).toMatch(/toolErrorResponse\(200,/);
    expect(block).toMatch(/missing/);
  });

  it('checks that preview and confirmed are booleans', () => {
    const block = src.slice(check, permissionEnd);
    expect(block).toContain('nonBooleanFlagArgs(args)');
  });

  it('writes only when confirmed is the boolean true', () => {
    expect(src).not.toMatch(/\n\s+if \(confirmed\) \{/);
    expect(src.match(/if \(confirmed === true\) \{/g)?.length).toBe(3);
  });
});

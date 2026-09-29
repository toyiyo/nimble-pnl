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

describe('get_hourly_sales checks its arguments in band (task-5)', () => {
  const helperStart = src.indexOf('async function fetchHourlySalesPattern(');
  const helperEnd = src.indexOf('\n/**', helperStart + 1);
  const helperBody = src.slice(helperStart, helperEnd);

  const handlerStart = src.indexOf('async function executeGetHourlySales(');
  const handlerEnd = src.indexOf('\n/**', handlerStart + 1);
  const handlerBody = src.slice(handlerStart, handlerEnd);

  it('has the handler and a switch case that dispatches to it', () => {
    expect(handlerStart).toBeGreaterThan(0);
    expect(src).toMatch(/case 'get_hourly_sales':\s*\n\s*result = await executeGetHourlySales\(/);
  });

  it('checks arguments with parseHourlySalesArgs before any DB read', () => {
    const parseCall = handlerBody.indexOf('parseHourlySalesArgs(args)');
    const firstDbRead = handlerBody.indexOf(".from('staffing_settings')");
    expect(parseCall).toBeGreaterThan(0);
    expect(parseCall).toBeLessThan(firstDbRead);
  });

  it('answers a bad argument in band, not by throwing', () => {
    expect(handlerBody).toMatch(/if \(!parsed\.ok\) \{\s*\n\s*return \{ ok: false, error: parsed\.error \};/);
  });

  it('maps a 22023 RPC error to INVALID_ARGUMENTS in the shared fetch helper', () => {
    expect(helperStart).toBeGreaterThan(0);
    expect(helperBody).toMatch(/error\.code === '22023'/);
    expect(helperBody).toMatch(/code: 'INVALID_ARGUMENTS', message: error\.message/);
  });

  it('propagates the shared helper error from both the primary and sub-hour fetch', () => {
    expect(handlerBody.match(/if \(!(primary|hourly)\.ok\) return \{ ok: false, error: \1\.error \};/g)?.length).toBe(2);
  });

  it('calls the shared fetch helper a second time at 60 minutes only for a sub-hour interval', () => {
    expect(handlerBody).toMatch(/parsedArgs\.interval_minutes !== 60/);
    expect(handlerBody.match(/fetchHourlySalesPattern\(/g)?.length).toBe(2);
  });
});

/**
 * RED test (Phase 4 T6): assert the generated Supabase types reflect the
 * batched 7-arg `bulk_process_historical_sales` RPC signature added in
 * supabase/migrations/20260720120000_bulk_deduction_keyset_batching.sql.
 *
 * The migration drops the old 3-arg signature (p_restaurant_id, p_start_date,
 * p_end_date) and replaces it with a 7-arg signature that adds keyset-cursor
 * batching params (p_batch_size, p_after_sale_date, p_after_created_at,
 * p_after_id — all optional, since they have SQL DEFAULTs).
 *
 * This is a static-source audit of the generated types file — no mocking
 * required, and it intentionally does NOT re-derive the types (that would
 * defeat the point of testing the generated output). It FAILS until the
 * types file is regenerated via `supabase gen types` / the sync-types skill.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const TYPES_PATH = resolve(__dirname, '../../src/integrations/supabase/types.ts');

function extractFunctionBlock(source: string, functionName: string): string {
  const marker = `${functionName}: {`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Could not find "${marker}" in ${TYPES_PATH}`);
  }
  // Walk braces from the opening "{" after the marker to find the matching close.
  let depth = 0;
  let i = start + marker.length - 1; // index of the opening brace itself
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return source.slice(start, i);
}

describe('bulk_process_historical_sales generated types', () => {
  it('reflects the batched 7-arg RPC signature (keyset cursor params)', () => {
    const source = readFileSync(TYPES_PATH, 'utf-8');
    const block = extractFunctionBlock(source, 'bulk_process_historical_sales');

    // Required (no SQL default): unchanged from the original signature.
    expect(block).toMatch(/p_restaurant_id:\s*string/);
    expect(block).toMatch(/p_start_date:\s*string/);
    expect(block).toMatch(/p_end_date:\s*string/);

    // New batching params — all have SQL DEFAULTs, so generated types mark
    // them optional (`?:`).
    expect(block).toMatch(/p_batch_size\?:\s*number/);
    expect(block).toMatch(/p_after_sale_date\?:\s*string/);
    expect(block).toMatch(/p_after_created_at\?:\s*string/);
    expect(block).toMatch(/p_after_id\?:\s*string/);

    // Return type is still jsonb -> Json.
    expect(block).toMatch(/Returns:\s*Json/);
  });
});

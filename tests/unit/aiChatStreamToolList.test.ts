import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ai-chat-stream/index.ts has Deno URL imports, so Vitest cannot import it.
// These source checks pin the D9 wiring.
const src = readFileSync(resolve(__dirname, '../../supabase/functions/ai-chat-stream/index.ts'), 'utf8');

describe('ai-chat-stream builds the tool list from the capability (D9)', () => {
  it('resolves the capability together with the timezone', () => {
    expect(src).toMatch(/import \{[^}]*\bhasSchedulingOrPayrollCapability\b[^}]*\} from "\.\.\/_shared\/tools-registry\.ts"/);
    expect(src).toMatch(
      /Promise\.all\(\[\s*resolveRestaurantTimeZone\(supabase, projectRef\),\s*hasSchedulingOrPayrollCapability\(projectRef, supabase\),?\s*\]\)/,
    );
  });

  it('passes the flag to getTools', () => {
    expect(src).toMatch(/getTools\(projectRef, userRestaurant\.role, \{ hasSchedulingOrPayroll \}\)/);
  });

  it('names get_labor_costs in the prompt only through the flag-dependent section', () => {
    const promptStart = src.indexOf('const systemMessage');
    const prompt = src.slice(promptStart);
    expect(prompt).not.toMatch(/\*\*get_labor_costs: REQUIRED/);
    expect(src).toMatch(/const laborToolsPrompt = hasSchedulingOrPayroll/);
    expect(prompt).toContain('${laborToolsPrompt}');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Source-contract guards for the "AI chat does not see today's sales" fix.
 *
 * Edge functions run in UTC. After 19:00 CDT the UTC date is the next day.
 * The AI chat and its tools must take "today" from the restaurant timezone.
 * The edge entry files use Deno https imports, so Vitest cannot import them.
 * These tests read the source instead. restaurantDate.test.ts covers the
 * date math.
 */

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const chatStream = read('supabase/functions/ai-chat-stream/index.ts');
const executeTool = read('supabase/functions/ai-execute-tool/index.ts');

const UTC_DAY_SLICE = /toISOString\(\)\.split\('T'\)\[0\]/g;

describe('ai-chat-stream system prompt date', () => {
  it('resolves the restaurant timezone', () => {
    expect(chatStream).toMatch(/resolveRestaurantTimeZone\(/);
  });

  it('does not put the UTC date in the prompt', () => {
    expect(chatStream.match(UTC_DAY_SLICE)).toBeNull();
  });

  it('puts the restaurant-local date and the timezone in the prompt', () => {
    expect(chatStream).toMatch(/Current date: \$\{todayStr\}/);
    expect(chatStream).toMatch(/timezone \$\{restaurantTimeZone\}/);
  });
});

describe('ai-execute-tool date wiring', () => {
  it('builds the restaurant clock from the restaurant timezone', () => {
    expect(executeTool).toMatch(/resolveRestaurantTimeZone\(/);
    expect(executeTool).toMatch(/restaurantWallClock\(new Date\(\), /);
  });

  it('uses the shared calculateDateRange, not a local copy', () => {
    expect(executeTool).toMatch(/from '\.\.\/_shared\/restaurantDate\.ts'/);
    expect(executeTool).not.toMatch(/function calculateDateRange\(/);
  });

  it('does not slice a UTC day for a calendar day', () => {
    expect(executeTool.match(UTC_DAY_SLICE)).toBeNull();
  });
});

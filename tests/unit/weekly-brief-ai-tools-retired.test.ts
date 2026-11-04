import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTools, canUseTool } from '../../supabase/functions/_shared/tools-registry';

/**
 * Absence guards for the weekly-brief / ops-inbox decommission (task 4).
 *
 * The design deletes the two AI tools `get_proactive_insights` and
 * `resolve_inbox_item`, and the three weekly-brief edge functions. These
 * tests fail if the tools or the functions come back.
 */

const root = resolve(__dirname, '../..');

const DELETED_FUNCTION_DIRS = [
  'supabase/functions/generate-weekly-brief',
  'supabase/functions/generate-weekly-brief-worker',
  'supabase/functions/send-weekly-brief-email',
];

const DELETED_TOOL_NAMES = ['get_proactive_insights', 'resolve_inbox_item'];

describe('weekly-brief edge functions are deleted', () => {
  it.each(DELETED_FUNCTION_DIRS)('%s does not exist', (dir) => {
    expect(existsSync(resolve(root, dir))).toBe(false);
  });
});

describe('the AI tools get_proactive_insights and resolve_inbox_item are deleted', () => {
  it('getTools() does not expose the deleted tools to any role', () => {
    for (const role of ['owner', 'manager', 'chef', 'staff'] as const) {
      const names = getTools('restaurant-1', role).map((t) => t.name);
      for (const tool of DELETED_TOOL_NAMES) {
        expect(names).not.toContain(tool);
      }
    }
  });

  it('canUseTool() rejects the deleted tool names for owner', () => {
    for (const tool of DELETED_TOOL_NAMES) {
      expect(canUseTool(tool, 'owner')).toBe(false);
    }
  });

  it('tools-registry.ts does not name the deleted tools', () => {
    const src = readFileSync(
      resolve(root, 'supabase/functions/_shared/tools-registry.ts'),
      'utf-8',
    );
    for (const tool of DELETED_TOOL_NAMES) {
      expect(src).not.toContain(tool);
    }
  });

  it('ai-execute-tool/index.ts does not dispatch the deleted tools', () => {
    const src = readFileSync(
      resolve(root, 'supabase/functions/ai-execute-tool/index.ts'),
      'utf-8',
    );
    for (const tool of DELETED_TOOL_NAMES) {
      expect(src).not.toContain(tool);
    }
    expect(src).not.toContain('executeGetProactiveInsights');
    expect(src).not.toContain('executeResolveInboxItem');
  });

  it('ai-chat-stream/index.ts does not prompt for proactive insights', () => {
    const src = readFileSync(
      resolve(root, 'supabase/functions/ai-chat-stream/index.ts'),
      'utf-8',
    );
    expect(src).not.toContain('get_proactive_insights');
    expect(src).not.toContain('PROACTIVE INSIGHTS');
  });
});

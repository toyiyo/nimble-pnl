import { describe, it, expect } from 'vitest';
import { getTools } from '../../supabase/functions/_shared/tools-registry';
import { WRITE_TOOL_NAMES, isWriteTool } from '../../supabase/functions/_shared/aiWriteTools';

/** The registry tools that take a `confirmed` argument. These tools change data. */
function toolsWithConfirmed(): string[] {
  return getTools('', 'owner')
    .filter((tool) => {
      const properties = (tool.parameters as { properties?: Record<string, unknown> })?.properties ?? {};
      return Object.prototype.hasOwnProperty.call(properties, 'confirmed');
    })
    .map((tool) => tool.name)
    .sort();
}

describe('aiWriteTools', () => {
  it('lists each registry tool that has a confirmed property', () => {
    for (const name of toolsWithConfirmed()) {
      expect(WRITE_TOOL_NAMES).toContain(name);
    }
  });

  it('lists only registry tools that have a confirmed property', () => {
    const confirmable = toolsWithConfirmed();
    for (const name of WRITE_TOOL_NAMES) {
      expect(confirmable).toContain(name);
    }
  });

  it('holds the three write tools', () => {
    expect([...WRITE_TOOL_NAMES].sort()).toEqual([
      'batch_categorize_pos_sales',
      'batch_categorize_transactions',
      'create_categorization_rule',
    ]);
  });

  it('isWriteTool is true only for a write tool', () => {
    expect(isWriteTool('batch_categorize_transactions')).toBe(true);
    expect(isWriteTool('create_categorization_rule')).toBe(true);
    expect(isWriteTool('get_kpis')).toBe(false);
    expect(isWriteTool('toString')).toBe(false);
    expect(isWriteTool('')).toBe(false);
  });
});

/**
 * The AI tools that change data. The model calls each tool with `preview` first.
 * It calls the tool with `confirmed` only after the user approves the preview
 * in a new message.
 *
 * This module is pure. It has no Deno imports, so the client and the edge
 * functions can use the same list.
 */
export const WRITE_TOOL_NAMES: readonly string[] = Object.freeze([
  'batch_categorize_transactions',
  'batch_categorize_pos_sales',
  'create_categorization_rule',
]);

const WRITE_TOOL_SET: ReadonlySet<string> = new Set(WRITE_TOOL_NAMES);

/** Returns true when the tool changes data. */
export function isWriteTool(name: string): boolean {
  return WRITE_TOOL_SET.has(name);
}

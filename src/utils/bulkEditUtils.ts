/**
 * Utility functions for bulk edit operations
 */

/**
 * Generate a preview message for bulk updates
 * Shows only what will change (delta-only preview)
 */
export function generateChangePreview(
  changes: Record<string, { from?: string; to: string }>,
  affectedCount: number
): Array<{ label: string; change: string }> {
  return Object.entries(changes).map(([field, { from, to }]) => {
    const label = field.charAt(0).toUpperCase() + field.slice(1);
    const change = from 
      ? `${from} → ${to}` 
      : to === 'Unchanged' 
        ? 'Unchanged' 
        : `→ ${to}`;
    return { label, change };
  });
}

/**
 * Check if a keyboard event includes modifier keys for multi-select
 * - Cmd/Ctrl+Click: Toggle individual item
 * - Shift+Click: Select range
 */
export function isMultiSelectKey(event: React.MouseEvent | React.KeyboardEvent): {
  isToggle: boolean;
  isRange: boolean;
} {
  return {
    isToggle: event.metaKey || event.ctrlKey,
    isRange: event.shiftKey,
  };
}

/**
 * Format a count message for bulk operations
 */
export function formatBulkCount(count: number, itemType: string): string {
  return `${count} ${itemType}${count !== 1 ? 's' : ''}`;
}

/**
 * Validate bulk operation - ensure at least one item selected
 */
export function validateBulkOperation(selectedCount: number): {
  isValid: boolean;
  error?: string;
} {
  if (selectedCount === 0) {
    return {
      isValid: false,
      error: 'Please select at least one item',
    };
  }
  return { isValid: true };
}

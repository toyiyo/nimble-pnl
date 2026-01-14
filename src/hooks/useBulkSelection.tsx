import { useState, useCallback, useMemo } from 'react';

/**
 * Custom hook for managing bulk selection state
 * Follows Apple Mail / Photos pattern for selection management
 * 
 * @template T - Type of items being selected (must have 'id' property)
 */
export function useBulkSelection<T extends { id: string }>() {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /**
   * Toggle selection mode on/off
   */
  const toggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => {
      if (prev) {
        // Exiting selection mode - clear selections
        setSelectedIds(new Set());
      }
      return !prev;
    });
  }, []);

  /**
   * Enter selection mode
   */
  const enterSelectionMode = useCallback(() => {
    setIsSelectionMode(true);
  }, []);

  /**
   * Exit selection mode and clear selections
   */
  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  /**
   * Toggle selection for a single item
   */
  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /**
   * Select a single item (does not deselect others)
   */
  const selectItem = useCallback((id: string) => {
    setSelectedIds((prev) => new Set(prev).add(id));
  }, []);

  /**
   * Deselect a single item
   */
  const deselectItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  /**
   * Select all items from the provided list
   */
  const selectAll = useCallback((items: T[]) => {
    setSelectedIds(new Set(items.map((item) => item.id)));
  }, []);

  /**
   * Clear all selections
   */
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  /**
   * Select range of items (Shift+Click behavior)
   * @param items - Full list of items
   * @param fromId - Starting item ID
   * @param toId - Ending item ID
   */
  const selectRange = useCallback((items: T[], fromId: string, toId: string) => {
    const fromIndex = items.findIndex((item) => item.id === fromId);
    const toIndex = items.findIndex((item) => item.id === toId);
    
    if (fromIndex === -1 || toIndex === -1) return;
    
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    
    const rangeIds = items.slice(start, end + 1).map((item) => item.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      rangeIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  /**
   * Check if an item is selected
   */
  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  /**
   * Get selected items from a list
   */
  const getSelectedItems = useCallback(
    (items: T[]) => items.filter((item) => selectedIds.has(item.id)),
    [selectedIds]
  );

  /**
   * Computed properties
   */
  const selectedCount = useMemo(() => selectedIds.size, [selectedIds]);
  const hasSelection = useMemo(() => selectedIds.size > 0, [selectedIds]);

  return {
    // State
    isSelectionMode,
    selectedIds,
    selectedCount,
    hasSelection,

    // Actions
    toggleSelectionMode,
    enterSelectionMode,
    exitSelectionMode,
    toggleItem,
    selectItem,
    deselectItem,
    selectAll,
    selectRange,
    clearSelection,
    isSelected,
    getSelectedItems,
  };
}

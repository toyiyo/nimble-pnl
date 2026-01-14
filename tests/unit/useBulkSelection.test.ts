import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBulkSelection } from '@/hooks/useBulkSelection';

describe('useBulkSelection', () => {
  const mockItems = [
    { id: '1', name: 'Item 1' },
    { id: '2', name: 'Item 2' },
    { id: '3', name: 'Item 3' },
    { id: '4', name: 'Item 4' },
    { id: '5', name: 'Item 5' },
  ];

  describe('Selection Mode', () => {
    it('should start with selection mode disabled', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      expect(result.current.isSelectionMode).toBe(false);
      expect(result.current.selectedCount).toBe(0);
      expect(result.current.hasSelection).toBe(false);
    });

    it('should toggle selection mode on', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.toggleSelectionMode();
      });
      
      expect(result.current.isSelectionMode).toBe(true);
    });

    it('should toggle selection mode off and clear selections', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.toggleSelectionMode();
        result.current.selectItem('1');
      });
      
      expect(result.current.selectedCount).toBe(1);
      
      act(() => {
        result.current.toggleSelectionMode();
      });
      
      expect(result.current.isSelectionMode).toBe(false);
      expect(result.current.selectedCount).toBe(0);
    });

    it('should enter selection mode', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.enterSelectionMode();
      });
      
      expect(result.current.isSelectionMode).toBe(true);
    });

    it('should exit selection mode and clear selections', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.enterSelectionMode();
        result.current.selectItem('1');
        result.current.selectItem('2');
      });
      
      expect(result.current.selectedCount).toBe(2);
      
      act(() => {
        result.current.exitSelectionMode();
      });
      
      expect(result.current.isSelectionMode).toBe(false);
      expect(result.current.selectedCount).toBe(0);
    });
  });

  describe('Single Item Selection', () => {
    it('should select a single item', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.selectItem('1');
      });
      
      expect(result.current.isSelected('1')).toBe(true);
      expect(result.current.selectedCount).toBe(1);
      expect(result.current.hasSelection).toBe(true);
    });

    it('should deselect a single item', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.selectItem('1');
        result.current.deselectItem('1');
      });
      
      expect(result.current.isSelected('1')).toBe(false);
      expect(result.current.selectedCount).toBe(0);
    });

    it('should toggle item selection on and off', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.toggleItem('1');
      });
      
      expect(result.current.isSelected('1')).toBe(true);
      
      act(() => {
        result.current.toggleItem('1');
      });
      
      expect(result.current.isSelected('1')).toBe(false);
    });
  });

  describe('Multiple Item Selection', () => {
    it('should select multiple items', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.selectItem('1');
        result.current.selectItem('2');
        result.current.selectItem('3');
      });
      
      expect(result.current.selectedCount).toBe(3);
      expect(result.current.isSelected('1')).toBe(true);
      expect(result.current.isSelected('2')).toBe(true);
      expect(result.current.isSelected('3')).toBe(true);
    });

    it('should select all items', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.selectAll(mockItems);
      });
      
      expect(result.current.selectedCount).toBe(5);
      mockItems.forEach(item => {
        expect(result.current.isSelected(item.id)).toBe(true);
      });
    });

    it('should clear all selections', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.selectAll(mockItems);
        result.current.clearSelection();
      });
      
      expect(result.current.selectedCount).toBe(0);
      expect(result.current.hasSelection).toBe(false);
    });
  });

  describe('Range Selection', () => {
    it('should select a range of items (forward)', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.selectRange(mockItems, '2', '4');
      });
      
      expect(result.current.selectedCount).toBe(3);
      expect(result.current.isSelected('2')).toBe(true);
      expect(result.current.isSelected('3')).toBe(true);
      expect(result.current.isSelected('4')).toBe(true);
      expect(result.current.isSelected('1')).toBe(false);
      expect(result.current.isSelected('5')).toBe(false);
    });

    it('should select a range of items (backward)', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.selectRange(mockItems, '4', '2');
      });
      
      expect(result.current.selectedCount).toBe(3);
      expect(result.current.isSelected('2')).toBe(true);
      expect(result.current.isSelected('3')).toBe(true);
      expect(result.current.isSelected('4')).toBe(true);
    });

    it('should handle range selection with already selected items', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.selectItem('1');
        result.current.selectRange(mockItems, '3', '5');
      });
      
      // Should have 1, 3, 4, 5 selected
      expect(result.current.selectedCount).toBe(4);
      expect(result.current.isSelected('1')).toBe(true);
      expect(result.current.isSelected('3')).toBe(true);
      expect(result.current.isSelected('4')).toBe(true);
      expect(result.current.isSelected('5')).toBe(true);
    });

    it('should handle range selection with invalid IDs gracefully', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.selectRange(mockItems, 'invalid', '2');
      });
      
      expect(result.current.selectedCount).toBe(0);
    });
  });

  describe('Get Selected Items', () => {
    it('should return selected items from a list', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      act(() => {
        result.current.selectItem('2');
        result.current.selectItem('4');
      });
      
      const selectedItems = result.current.getSelectedItems(mockItems);
      
      expect(selectedItems).toHaveLength(2);
      expect(selectedItems[0].id).toBe('2');
      expect(selectedItems[1].id).toBe('4');
    });

    it('should return empty array when nothing selected', () => {
      const { result } = renderHook(() => useBulkSelection());
      
      const selectedItems = result.current.getSelectedItems(mockItems);
      
      expect(selectedItems).toHaveLength(0);
    });
  });
});

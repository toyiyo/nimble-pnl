import { describe, it, expect } from 'vitest';
import {
  generateChangePreview,
  isMultiSelectKey,
  formatBulkCount,
  validateBulkOperation,
} from '@/utils/bulkEditUtils';

describe('bulkEditUtils', () => {
  describe('generateChangePreview', () => {
    it('should generate preview for changes with from/to values', () => {
      const changes = {
        category: { from: 'Uncategorized', to: '4000 - Sales' },
        supplier: { from: 'None', to: 'ACME Corp' },
      };
      
      const preview = generateChangePreview(changes, 3);
      
      expect(preview).toHaveLength(2);
      expect(preview[0]).toEqual({
        label: 'Category',
        change: 'Uncategorized → 4000 - Sales',
      });
      expect(preview[1]).toEqual({
        label: 'Supplier',
        change: 'None → ACME Corp',
      });
    });

    it('should generate preview for changes with only to values', () => {
      const changes = {
        category: { to: '4000 - Sales' },
      };
      
      const preview = generateChangePreview(changes, 5);
      
      expect(preview[0]).toEqual({
        label: 'Category',
        change: '→ 4000 - Sales',
      });
    });

    it('should handle unchanged fields', () => {
      const changes = {
        supplier: { to: 'Unchanged' },
      };
      
      const preview = generateChangePreview(changes, 2);
      
      expect(preview[0].change).toBe('Unchanged');
    });
  });

  describe('isMultiSelectKey', () => {
    it('should detect Cmd+Click as toggle', () => {
      const event = { metaKey: true, ctrlKey: false, shiftKey: false } as React.MouseEvent;
      
      const result = isMultiSelectKey(event);
      
      expect(result.isToggle).toBe(true);
      expect(result.isRange).toBe(false);
    });

    it('should detect Ctrl+Click as toggle', () => {
      const event = { metaKey: false, ctrlKey: true, shiftKey: false } as React.MouseEvent;
      
      const result = isMultiSelectKey(event);
      
      expect(result.isToggle).toBe(true);
      expect(result.isRange).toBe(false);
    });

    it('should detect Shift+Click as range', () => {
      const event = { metaKey: false, ctrlKey: false, shiftKey: true } as React.MouseEvent;
      
      const result = isMultiSelectKey(event);
      
      expect(result.isToggle).toBe(false);
      expect(result.isRange).toBe(true);
    });

    it('should return false for normal click', () => {
      const event = { metaKey: false, ctrlKey: false, shiftKey: false } as React.MouseEvent;
      
      const result = isMultiSelectKey(event);
      
      expect(result.isToggle).toBe(false);
      expect(result.isRange).toBe(false);
    });
  });

  describe('formatBulkCount', () => {
    it('should format singular count', () => {
      expect(formatBulkCount(1, 'transaction')).toBe('1 transaction');
    });

    it('should format plural count', () => {
      expect(formatBulkCount(5, 'transaction')).toBe('5 transactions');
    });

    it('should handle zero count', () => {
      expect(formatBulkCount(0, 'item')).toBe('0 items');
    });
  });

  describe('validateBulkOperation', () => {
    it('should validate when items are selected', () => {
      const result = validateBulkOperation(3);
      
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should fail validation when no items selected', () => {
      const result = validateBulkOperation(0);
      
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Please select at least one item');
    });
  });
});

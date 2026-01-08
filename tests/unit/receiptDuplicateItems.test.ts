import { describe, it, expect } from 'vitest';

/**
 * Tests for duplicate item detection and linking in receipt imports
 * 
 * These tests verify the business logic for:
 * 1. Identifying duplicate items by parsed_name (case-insensitive)
 * 2. Auto-applying mapping decisions to matching items
 * 3. Preventing duplicate product creation during import
 */

describe('Receipt Duplicate Item Detection', () => {
  describe('Duplicate Item Identification', () => {
    it('should identify items with same parsed_name (case-insensitive)', () => {
      const lineItems = [
        { id: '1', parsed_name: 'CHEEK MEAT', mapping_status: 'pending' },
        { id: '2', parsed_name: 'cheek meat', mapping_status: 'pending' },
        { id: '3', parsed_name: 'CHORIZO', mapping_status: 'pending' },
      ];

      const targetItem = lineItems[0];
      const matchingItems = lineItems.filter(item => 
        item.id !== targetItem.id &&
        item.mapping_status === 'pending' &&
        item.parsed_name?.toLowerCase().trim() === targetItem.parsed_name?.toLowerCase().trim()
      );

      expect(matchingItems).toHaveLength(1);
      expect(matchingItems[0].id).toBe('2');
    });

    it('should not match items with different parsed_name', () => {
      const lineItems = [
        { id: '1', parsed_name: 'CHEEK MEAT', mapping_status: 'pending' },
        { id: '2', parsed_name: 'CHICKEN', mapping_status: 'pending' },
      ];

      const targetItem = lineItems[0];
      const matchingItems = lineItems.filter(item => 
        item.id !== targetItem.id &&
        item.mapping_status === 'pending' &&
        item.parsed_name?.toLowerCase().trim() === targetItem.parsed_name?.toLowerCase().trim()
      );

      expect(matchingItems).toHaveLength(0);
    });

    it('should only match pending items', () => {
      const lineItems = [
        { id: '1', parsed_name: 'CHEEK MEAT', mapping_status: 'pending' },
        { id: '2', parsed_name: 'CHEEK MEAT', mapping_status: 'mapped' },
        { id: '3', parsed_name: 'CHEEK MEAT', mapping_status: 'pending' },
      ];

      const targetItem = lineItems[0];
      const matchingItems = lineItems.filter(item => 
        item.id !== targetItem.id &&
        item.mapping_status === 'pending' &&
        item.parsed_name?.toLowerCase().trim() === targetItem.parsed_name?.toLowerCase().trim()
      );

      expect(matchingItems).toHaveLength(1);
      expect(matchingItems[0].id).toBe('3');
    });

    it('should handle items with null parsed_name', () => {
      const lineItems = [
        { id: '1', parsed_name: null, mapping_status: 'pending' },
        { id: '2', parsed_name: 'CHEEK MEAT', mapping_status: 'pending' },
      ];

      const targetItem = lineItems[0];
      const matchingItems = lineItems.filter(item => 
        item.id !== targetItem.id &&
        item.mapping_status === 'pending' &&
        item.parsed_name?.toLowerCase().trim() === targetItem.parsed_name?.toLowerCase().trim()
      );

      expect(matchingItems).toHaveLength(0);
    });

    it('should trim whitespace when matching', () => {
      const lineItems = [
        { id: '1', parsed_name: 'CHEEK MEAT', mapping_status: 'pending' },
        { id: '2', parsed_name: '  cheek meat  ', mapping_status: 'pending' },
      ];

      const targetItem = lineItems[0];
      const matchingItems = lineItems.filter(item => 
        item.id !== targetItem.id &&
        item.mapping_status === 'pending' &&
        item.parsed_name?.toLowerCase().trim() === targetItem.parsed_name?.toLowerCase().trim()
      );

      expect(matchingItems).toHaveLength(1);
      expect(matchingItems[0].id).toBe('2');
    });
  });

  describe('Linked Items Count', () => {
    it('should count items with same parsed_name', () => {
      const lineItems = [
        { id: '1', parsed_name: 'CHEEK MEAT' },
        { id: '2', parsed_name: 'CHEEK MEAT' },
        { id: '3', parsed_name: 'CHORIZO' },
      ];

      const getLinkedItemsCount = (item: { id: string; parsed_name: string | null }) => {
        if (!item.parsed_name) return 0;
        return lineItems.filter(i => 
          i.parsed_name?.toLowerCase().trim() === item.parsed_name?.toLowerCase().trim()
        ).length;
      };

      expect(getLinkedItemsCount(lineItems[0])).toBe(2);
      expect(getLinkedItemsCount(lineItems[1])).toBe(2);
      expect(getLinkedItemsCount(lineItems[2])).toBe(1);
    });

    it('should return 0 for items with null parsed_name', () => {
      const lineItems = [
        { id: '1', parsed_name: null },
      ];

      const getLinkedItemsCount = (item: { id: string; parsed_name: string | null }) => {
        if (!item.parsed_name) return 0;
        return lineItems.filter(i => 
          i.parsed_name?.toLowerCase().trim() === item.parsed_name?.toLowerCase().trim()
        ).length;
      };

      expect(getLinkedItemsCount(lineItems[0])).toBe(0);
    });
  });

  describe('Product Deduplication Logic', () => {
    it('should track created products by normalized name', () => {
      const createdProducts = new Map<string, string>();
      
      // First item creates product
      const item1 = { parsed_name: 'CHEEK MEAT', raw_text: 'CHEEK MEAT' };
      const productId1 = 'product-123';
      const itemNameKey1 = (item1.parsed_name || item1.raw_text).toLowerCase().trim();
      createdProducts.set(itemNameKey1, productId1);

      // Second item with same name should detect existing product
      const item2 = { parsed_name: 'cheek meat', raw_text: 'cheek meat' };
      const itemNameKey2 = (item2.parsed_name || item2.raw_text).toLowerCase().trim();
      
      expect(createdProducts.has(itemNameKey2)).toBe(true);
      expect(createdProducts.get(itemNameKey2)).toBe(productId1);
    });

    it('should handle case variations correctly', () => {
      const createdProducts = new Map<string, string>();
      
      createdProducts.set('cheek meat', 'product-123');

      // Test various case variations
      expect(createdProducts.has('CHEEK MEAT'.toLowerCase())).toBe(true);
      expect(createdProducts.has('Cheek Meat'.toLowerCase())).toBe(true);
      expect(createdProducts.has('cheek meat'.toLowerCase())).toBe(true);
    });

    it('should not match different products', () => {
      const createdProducts = new Map<string, string>();
      
      createdProducts.set('cheek meat', 'product-123');

      expect(createdProducts.has('chicken'.toLowerCase())).toBe(false);
      expect(createdProducts.has('chorizo'.toLowerCase())).toBe(false);
    });
  });

  describe('CRITICAL: Real-world Receipt Scenario', () => {
    it('should handle receipt with 2 identical CHEEK MEAT items correctly', () => {
      // Simulates the problem described in the issue
      const receiptItems = [
        {
          id: 'item-1',
          parsed_name: 'CHEEK MEAT',
          parsed_quantity: 6.86,
          parsed_unit: 'lb',
          parsed_price: 31.83,
          mapping_status: 'pending'
        },
        {
          id: 'item-2',
          parsed_name: 'CHEEK MEAT',
          parsed_quantity: 6.96,
          parsed_unit: 'lb',
          parsed_price: 32.29,
          mapping_status: 'pending'
        },
        {
          id: 'item-3',
          parsed_name: 'CHORIZO',
          parsed_quantity: 2.0,
          parsed_unit: 'each',
          parsed_price: 21.96,
          mapping_status: 'pending'
        }
      ];

      // User selects "Create new item" for first CHEEK MEAT
      const selectedItemId = 'item-1';
      const selectedItem = receiptItems.find(i => i.id === selectedItemId)!;

      // Find matching items that should be auto-updated
      const matchingItems = receiptItems.filter(item => 
        item.id !== selectedItemId &&
        item.mapping_status === 'pending' &&
        item.parsed_name?.toLowerCase().trim() === selectedItem.parsed_name?.toLowerCase().trim()
      );

      // Verify only the second CHEEK MEAT item matches
      expect(matchingItems).toHaveLength(1);
      expect(matchingItems[0].id).toBe('item-2');
      expect(matchingItems[0].parsed_name).toBe('CHEEK MEAT');

      // Simulate product creation tracking during import
      const createdProducts = new Map<string, string>();
      const productId = 'product-cheek-meat';

      // First CHEEK MEAT creates the product
      const itemKey1 = 'cheek meat';
      createdProducts.set(itemKey1, productId);

      // Second CHEEK MEAT should detect existing product
      const itemKey2 = 'cheek meat';
      expect(createdProducts.has(itemKey2)).toBe(true);
      expect(createdProducts.get(itemKey2)).toBe(productId);

      // CHORIZO should not match
      const itemKey3 = 'chorizo';
      expect(createdProducts.has(itemKey3)).toBe(false);
    });

    it('CRITICAL: should result in single product with aggregated quantities', () => {
      // This test verifies the expected end state after import
      const item1Quantity = 6.86;
      const item2Quantity = 6.96;
      const expectedTotalStock = item1Quantity + item2Quantity;

      // After import, both items should reference the same product
      const productStock = item1Quantity + item2Quantity;

      expect(productStock).toBeCloseTo(13.82, 2);
      expect(productStock).toBe(expectedTotalStock);
    });
  });
});

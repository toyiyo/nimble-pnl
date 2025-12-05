import { describe, it, expect } from 'vitest';
import {
  createRecipeByItemNameMap,
  createMappedItemNamesSet,
  hasRecipeMapping,
  hasRecipeMappingFromSet,
  getRecipeForItem,
  countUnmappedItems,
  getUnmappedItems,
  getRecipeStatus,
  Recipe,
  MinimalRecipe,
  SaleItem,
} from '@/utils/recipeMapping';

describe('Recipe Mapping Utilities', () => {
  // Test fixtures
  const mockRecipes: Recipe[] = [
    {
      id: 'recipe-1',
      name: 'Margarita',
      pos_item_name: 'Margarita',
      profit_margin: 75,
      ingredients: [
        { product_id: 'prod-1', quantity: 2, unit: 'oz' },
        { product_id: 'prod-2', quantity: 1, unit: 'oz' },
      ],
    },
    {
      id: 'recipe-2',
      name: 'Maestro Dobel Shot',
      pos_item_name: 'Maestro Dobel',
      profit_margin: 80,
      ingredients: [
        { product_id: 'prod-3', quantity: 1.5, unit: 'oz' },
      ],
    },
    {
      id: 'recipe-3',
      name: 'House Wine',
      pos_item_name: 'House Wine Glass',
      profit_margin: 65,
      ingredients: [], // Recipe exists but no ingredients
    },
    {
      id: 'recipe-4',
      name: 'Special Menu Item',
      // No pos_item_name - not mapped to POS
      profit_margin: 50,
      ingredients: [
        { product_id: 'prod-4', quantity: 1, unit: 'each' },
      ],
    },
  ];

  const mockSales: SaleItem[] = [
    { itemName: 'Margarita', quantity: 5, totalPrice: 50 },
    { itemName: 'Maestro Dobel', quantity: 2, totalPrice: 24 },
    { itemName: 'Corona Beer', quantity: 10, totalPrice: 60 }, // No recipe
    { itemName: 'House Wine Glass', quantity: 3, totalPrice: 27 },
    { itemName: 'Nachos', quantity: 1, totalPrice: 12 }, // No recipe
  ];

  describe('createRecipeByItemNameMap', () => {
    it('creates a map with lowercase keys', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      expect(map.has('margarita')).toBe(true);
      expect(map.has('maestro dobel')).toBe(true);
      expect(map.has('house wine glass')).toBe(true);
    });

    it('excludes recipes without pos_item_name', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      // Recipe 4 has no pos_item_name, so it should not appear in the map
      expect(map.size).toBe(3);
      expect(map.has('special menu item')).toBe(false);
    });

    it('includes recipe info with correct hasIngredients flag', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      const margarita = map.get('margarita');
      expect(margarita?.hasIngredients).toBe(true);
      
      const houseWine = map.get('house wine glass');
      expect(houseWine?.hasIngredients).toBe(false);
    });

    it('handles empty recipe list', () => {
      const map = createRecipeByItemNameMap([]);
      expect(map.size).toBe(0);
    });

    it('handles recipes with undefined ingredients', () => {
      const recipesWithUndefined: Recipe[] = [
        {
          id: 'recipe-x',
          name: 'Test Item',
          pos_item_name: 'Test',
          // ingredients is undefined
        },
      ];
      
      const map = createRecipeByItemNameMap(recipesWithUndefined);
      const testItem = map.get('test');
      expect(testItem?.hasIngredients).toBe(false);
    });
  });

  describe('hasRecipeMapping', () => {
    it('returns true for items with recipe mapping', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      expect(hasRecipeMapping('Margarita', map)).toBe(true);
      expect(hasRecipeMapping('Maestro Dobel', map)).toBe(true);
    });

    it('returns false for items without recipe mapping', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      expect(hasRecipeMapping('Corona Beer', map)).toBe(false);
      expect(hasRecipeMapping('Nachos', map)).toBe(false);
    });

    it('is case-insensitive', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      expect(hasRecipeMapping('MARGARITA', map)).toBe(true);
      expect(hasRecipeMapping('margarita', map)).toBe(true);
      expect(hasRecipeMapping('MaRgArItA', map)).toBe(true);
    });

    it('handles edge cases with special characters', () => {
      const recipesWithSpecialChars: Recipe[] = [
        {
          id: 'recipe-special',
          name: "Jack & Coke",
          pos_item_name: "Jack & Coke",
          ingredients: [{ product_id: 'prod-1', quantity: 1, unit: 'oz' }],
        },
      ];
      
      const map = createRecipeByItemNameMap(recipesWithSpecialChars);
      expect(hasRecipeMapping("Jack & Coke", map)).toBe(true);
      expect(hasRecipeMapping("jack & coke", map)).toBe(true);
    });
  });

  describe('getRecipeForItem', () => {
    it('returns recipe info for mapped items', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      const recipe = getRecipeForItem('Margarita', map);
      expect(recipe).toBeDefined();
      expect(recipe?.id).toBe('recipe-1');
      expect(recipe?.name).toBe('Margarita');
      expect(recipe?.profitMargin).toBe(75);
      expect(recipe?.hasIngredients).toBe(true);
    });

    it('returns undefined for unmapped items', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      const recipe = getRecipeForItem('Corona Beer', map);
      expect(recipe).toBeUndefined();
    });

    it('is case-insensitive', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      const recipe1 = getRecipeForItem('MAESTRO DOBEL', map);
      const recipe2 = getRecipeForItem('maestro dobel', map);
      
      expect(recipe1).toEqual(recipe2);
      expect(recipe1?.id).toBe('recipe-2');
    });
  });

  describe('countUnmappedItems', () => {
    it('counts unique unmapped items correctly', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      // Corona Beer and Nachos are unmapped
      expect(countUnmappedItems(mockSales, map)).toBe(2);
    });

    it('returns 0 when all items are mapped', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      const allMappedSales: SaleItem[] = [
        { itemName: 'Margarita', quantity: 5, totalPrice: 50 },
        { itemName: 'Maestro Dobel', quantity: 2, totalPrice: 24 },
      ];
      
      expect(countUnmappedItems(allMappedSales, map)).toBe(0);
    });

    it('counts each unique item only once even with multiple sales', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      const repeatedSales: SaleItem[] = [
        { itemName: 'Corona Beer', quantity: 5, totalPrice: 30 },
        { itemName: 'Corona Beer', quantity: 3, totalPrice: 18 },
        { itemName: 'Corona Beer', quantity: 2, totalPrice: 12 },
        { itemName: 'Nachos', quantity: 1, totalPrice: 12 },
      ];
      
      // Only 2 unique unmapped items: Corona Beer and Nachos
      expect(countUnmappedItems(repeatedSales, map)).toBe(2);
    });

    it('handles empty sales array', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      expect(countUnmappedItems([], map)).toBe(0);
    });
  });

  describe('getUnmappedItems', () => {
    it('returns list of unmapped item names', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      const unmapped = getUnmappedItems(mockSales, map);
      
      expect(unmapped).toContain('Corona Beer');
      expect(unmapped).toContain('Nachos');
      expect(unmapped.length).toBe(2);
    });

    it('does not include mapped items', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      const unmapped = getUnmappedItems(mockSales, map);
      
      expect(unmapped).not.toContain('Margarita');
      expect(unmapped).not.toContain('Maestro Dobel');
      expect(unmapped).not.toContain('House Wine Glass');
    });

    it('returns empty array when all items are mapped', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      const allMappedSales: SaleItem[] = [
        { itemName: 'Margarita', quantity: 5, totalPrice: 50 },
      ];
      
      expect(getUnmappedItems(allMappedSales, map)).toEqual([]);
    });
  });

  describe('getRecipeStatus', () => {
    it('returns "mapped" for items with recipe and ingredients', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      expect(getRecipeStatus('Margarita', map)).toBe('mapped');
      expect(getRecipeStatus('Maestro Dobel', map)).toBe('mapped');
    });

    it('returns "mapped-no-ingredients" for recipe without ingredients', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      expect(getRecipeStatus('House Wine Glass', map)).toBe('mapped-no-ingredients');
    });

    it('returns "unmapped" for items without recipe', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      expect(getRecipeStatus('Corona Beer', map)).toBe('unmapped');
      expect(getRecipeStatus('Nachos', map)).toBe('unmapped');
    });

    it('is case-insensitive', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      expect(getRecipeStatus('MARGARITA', map)).toBe('mapped');
      expect(getRecipeStatus('house wine glass', map)).toBe('mapped-no-ingredients');
    });
  });

  describe('Integration: Bug fix scenario', () => {
    /**
     * This test validates the fix for the bug where the POS list view
     * was failing to show "No Recipe" warning because of a logic gap.
     * 
     * The original bug: When an item was not in the unmappedItems list
     * (from useUnifiedSales) but also not in recipeByItemName (from useRecipes),
     * nothing was displayed.
     * 
     * The fix: Use recipeByItemName as the single source of truth.
     * If hasRecipeMapping returns false, always show the warning.
     */
    it('correctly identifies unmapped items regardless of cache state', () => {
      const map = createRecipeByItemNameMap(mockRecipes);
      
      // Simulate a new sale item that was just added
      // It won't be in any "unmappedItems" cache yet, but we should still detect it
      const newSaleItem = 'manual_upload_1764577725438_25';
      
      // Using hasRecipeMapping as single source of truth
      const hasRecipe = hasRecipeMapping(newSaleItem, map);
      expect(hasRecipe).toBe(false);
      
      // This is the key assertion: if no recipe, show warning
      const status = getRecipeStatus(newSaleItem, map);
      expect(status).toBe('unmapped');
    });

    it('handles the Maestro Dobel scenario from the bug report', () => {
      // The bug was that "Maestro Dobel" item wasn't showing the warning
      // because there was a mismatch between data sources
      
      // Scenario: User creates a manual sale "Maestro Dobel" but there's no recipe yet
      const emptyRecipes: Recipe[] = [];
      const map = createRecipeByItemNameMap(emptyRecipes);
      
      // The item should be detected as unmapped
      expect(hasRecipeMapping('Maestro Dobel', map)).toBe(false);
      expect(getRecipeStatus('Maestro Dobel', map)).toBe('unmapped');
    });

    it('correctly identifies mapped items after recipe is created', () => {
      // After user creates recipe with pos_item_name = 'Maestro Dobel'
      const recipesWithMaestro: Recipe[] = [
        {
          id: 'recipe-maestro',
          name: 'Maestro Dobel Shot',
          pos_item_name: 'Maestro Dobel',
          profit_margin: 80,
          ingredients: [
            { product_id: 'tequila-1', quantity: 1.5, unit: 'oz' },
          ],
        },
      ];
      
      const map = createRecipeByItemNameMap(recipesWithMaestro);
      
      expect(hasRecipeMapping('Maestro Dobel', map)).toBe(true);
      expect(getRecipeStatus('Maestro Dobel', map)).toBe('mapped');
    });
  });

  describe('Minimal Recipe Functions (for useUnifiedSales)', () => {
    // These functions are used when only checking existence, not needing full recipe details
    const minimalRecipes: MinimalRecipe[] = [
      { id: 'recipe-1', pos_item_name: 'Margarita' },
      { id: 'recipe-2', pos_item_name: 'Maestro Dobel' },
      { id: 'recipe-3', pos_item_name: null },
      { id: 'recipe-4' }, // No pos_item_name property
    ];

    describe('createMappedItemNamesSet', () => {
      it('creates a set with lowercase item names', () => {
        const set = createMappedItemNamesSet(minimalRecipes);
        
        expect(set.has('margarita')).toBe(true);
        expect(set.has('maestro dobel')).toBe(true);
      });

      it('excludes recipes without pos_item_name', () => {
        const set = createMappedItemNamesSet(minimalRecipes);
        
        // Only 2 recipes have valid pos_item_name
        expect(set.size).toBe(2);
      });

      it('handles empty array', () => {
        const set = createMappedItemNamesSet([]);
        expect(set.size).toBe(0);
      });

      it('handles null pos_item_name values', () => {
        const recipesWithNull: MinimalRecipe[] = [
          { id: '1', pos_item_name: null },
          { id: '2', pos_item_name: 'Valid' },
        ];
        
        const set = createMappedItemNamesSet(recipesWithNull);
        expect(set.size).toBe(1);
        expect(set.has('valid')).toBe(true);
      });
    });

    describe('hasRecipeMappingFromSet', () => {
      it('returns true for items in the set', () => {
        const set = createMappedItemNamesSet(minimalRecipes);
        
        expect(hasRecipeMappingFromSet('Margarita', set)).toBe(true);
        expect(hasRecipeMappingFromSet('Maestro Dobel', set)).toBe(true);
      });

      it('returns false for items not in the set', () => {
        const set = createMappedItemNamesSet(minimalRecipes);
        
        expect(hasRecipeMappingFromSet('Corona Beer', set)).toBe(false);
        expect(hasRecipeMappingFromSet('Nachos', set)).toBe(false);
      });

      it('is case-insensitive', () => {
        const set = createMappedItemNamesSet(minimalRecipes);
        
        expect(hasRecipeMappingFromSet('MARGARITA', set)).toBe(true);
        expect(hasRecipeMappingFromSet('margarita', set)).toBe(true);
        expect(hasRecipeMappingFromSet('MaRgArItA', set)).toBe(true);
      });
    });

    it('matches behavior with full recipe functions', () => {
      // The minimal functions should produce the same results as the full functions
      const fullRecipes: Recipe[] = [
        { id: 'recipe-1', name: 'Margarita', pos_item_name: 'Margarita' },
        { id: 'recipe-2', name: 'Maestro Dobel Shot', pos_item_name: 'Maestro Dobel' },
      ];
      
      const map = createRecipeByItemNameMap(fullRecipes);
      const set = createMappedItemNamesSet(fullRecipes);
      
      const testItems = ['Margarita', 'Maestro Dobel', 'Corona', 'Unknown Item'];
      
      testItems.forEach(item => {
        expect(hasRecipeMapping(item, map)).toBe(hasRecipeMappingFromSet(item, set));
      });
    });
  });
});

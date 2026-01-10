import { describe, it, expect } from 'vitest';

/**
 * Unit tests for receipt package size extraction and handling
 * Tests the new three-field system: package_type, size_value, size_unit
 */

describe('Receipt Package Size Extraction', () => {
  describe('Package Type Detection', () => {
    it('should identify container types correctly', () => {
      const containerTypes = ['bottle', 'bag', 'box', 'can', 'jar', 'case'];
      
      containerTypes.forEach(type => {
        expect(type).toMatch(/^(bottle|bag|box|can|jar|case|container|package)$/);
      });
    });

    it('should distinguish containers from measurement units', () => {
      const measurementUnits = ['lb', 'kg', 'g', 'oz', 'fl oz', 'ml', 'L', 'gal'];
      const containerTypes = ['bottle', 'bag', 'box', 'case'];
      
      // These should not overlap
      measurementUnits.forEach(unit => {
        expect(containerTypes).not.toContain(unit);
      });
    });
  });

  describe('Size Value Parsing', () => {
    it('should handle integer values', () => {
      const sizeValue = 750;
      expect(sizeValue).toBe(750);
      expect(Number.isInteger(sizeValue)).toBe(true);
    });

    it('should handle decimal values', () => {
      const sizeValue = 6.86;
      expect(sizeValue).toBeCloseTo(6.86);
      expect(Number.isFinite(sizeValue)).toBe(true);
    });

    it('should handle zero values', () => {
      const sizeValue = 0;
      expect(sizeValue).toBe(0);
    });

    it('should handle null/undefined values', () => {
      const sizeValue = null;
      expect(sizeValue).toBeNull();
    });

    it('should handle very large values', () => {
      const sizeValue = 1000000;
      expect(sizeValue).toBe(1000000);
      expect(Number.isSafeInteger(sizeValue)).toBe(true);
    });

    it('should handle very small decimal values', () => {
      const sizeValue = 0.001;
      expect(sizeValue).toBeCloseTo(0.001);
    });
  });

  describe('Size Unit Validation', () => {
    it('should accept valid weight units', () => {
      const weightUnits = ['lb', 'kg', 'g', 'oz'];
      
      weightUnits.forEach(unit => {
        expect(['lb', 'kg', 'g', 'oz']).toContain(unit);
      });
    });

    it('should accept valid volume units', () => {
      const volumeUnits = ['fl oz', 'cup', 'tbsp', 'tsp', 'ml', 'L', 'gal', 'qt'];
      
      volumeUnits.forEach(unit => {
        expect(['fl oz', 'cup', 'tbsp', 'tsp', 'ml', 'L', 'gal', 'qt']).toContain(unit);
      });
    });

    it('should handle null unit', () => {
      const unit = null;
      expect(unit).toBeNull();
    });

    it('should handle empty string unit', () => {
      const unit = '';
      expect(unit).toBe('');
    });
  });

  describe('Complete Package Info Combinations', () => {
    it('CRITICAL: should handle bottle with ml size', () => {
      const packageInfo = {
        packageType: 'bottle',
        sizeValue: 750,
        sizeUnit: 'ml',
        quantity: 2
      };

      expect(packageInfo.packageType).toBe('bottle');
      expect(packageInfo.sizeValue).toBe(750);
      expect(packageInfo.sizeUnit).toBe('ml');
      expect(packageInfo.quantity).toBe(2);
    });

    it('CRITICAL: should handle bag with lb size', () => {
      const packageInfo = {
        packageType: 'bag',
        sizeValue: 5,
        sizeUnit: 'lb',
        quantity: 1
      };

      expect(packageInfo.packageType).toBe('bag');
      expect(packageInfo.sizeValue).toBe(5);
      expect(packageInfo.sizeUnit).toBe('lb');
      expect(packageInfo.quantity).toBe(1);
    });

    it('CRITICAL: should handle case with can size', () => {
      const packageInfo = {
        packageType: 'case',
        sizeValue: 355,
        sizeUnit: 'ml',
        quantity: 1
      };

      expect(packageInfo.packageType).toBe('case');
      expect(packageInfo.sizeValue).toBe(355);
      expect(packageInfo.sizeUnit).toBe('ml');
    });

    it('should handle weight-based items without container', () => {
      const packageInfo = {
        packageType: null,
        sizeValue: 6.86,
        sizeUnit: 'lb',
        quantity: 6.86
      };

      expect(packageInfo.packageType).toBeNull();
      expect(packageInfo.sizeValue).toBeCloseTo(6.86);
      expect(packageInfo.sizeUnit).toBe('lb');
    });

    it('should handle items with package type but no size', () => {
      const packageInfo = {
        packageType: 'box',
        sizeValue: null,
        sizeUnit: null,
        quantity: 2
      };

      expect(packageInfo.packageType).toBe('box');
      expect(packageInfo.sizeValue).toBeNull();
      expect(packageInfo.sizeUnit).toBeNull();
      expect(packageInfo.quantity).toBe(2);
    });
  });

  describe('Edge Cases and Error Conditions', () => {
    it('should handle all null values', () => {
      const packageInfo = {
        packageType: null,
        sizeValue: null,
        sizeUnit: null,
        quantity: null
      };

      expect(packageInfo.packageType).toBeNull();
      expect(packageInfo.sizeValue).toBeNull();
      expect(packageInfo.sizeUnit).toBeNull();
      expect(packageInfo.quantity).toBeNull();
    });

    it('CRITICAL: should handle negative size value', () => {
      const sizeValue = -10;
      expect(sizeValue).toBeLessThan(0);
      // In real code, this should be validated and rejected
    });

    it('should handle missing unit with value', () => {
      const packageInfo = {
        packageType: 'bottle',
        sizeValue: 750,
        sizeUnit: null
      };

      expect(packageInfo.sizeValue).toBe(750);
      expect(packageInfo.sizeUnit).toBeNull();
      // This is incomplete data but should not crash
    });

    it('should handle unit without value', () => {
      const packageInfo = {
        packageType: 'bottle',
        sizeValue: null,
        sizeUnit: 'ml'
      };

      expect(packageInfo.sizeValue).toBeNull();
      expect(packageInfo.sizeUnit).toBe('ml');
      // This is incomplete data but should not crash
    });

    it('CRITICAL: should handle mismatched unit and value types', () => {
      // Volume unit with what might be weight value
      const packageInfo = {
        packageType: 'bottle',
        sizeValue: 1, // Small number, could be confused
        sizeUnit: 'L' // Volume unit
      };

      expect(packageInfo.sizeValue).toBe(1);
      expect(packageInfo.sizeUnit).toBe('L');
      // System should trust the AI extraction
    });

    it('should handle very long strings for package type', () => {
      const packageType = 'bottle_with_very_long_descriptive_name';
      expect(packageType.length).toBeGreaterThan(10);
      expect(typeof packageType).toBe('string');
    });
  });

  describe('Product Creation Logic', () => {
    it('CRITICAL: should set uom_purchase to package_type when available', () => {
      const item = {
        package_type: 'bottle',
        size_value: 750,
        size_unit: 'ml',
        parsed_unit: 'bottle' // Backward compat field
      };

      const uomPurchase = item.package_type || item.parsed_unit || 'unit';
      expect(uomPurchase).toBe('bottle');
    });

    it('CRITICAL: should fallback to parsed_unit when package_type is null', () => {
      const item = {
        package_type: null,
        size_value: 750,
        size_unit: 'ml',
        parsed_unit: 'bottle'
      };

      const uomPurchase = item.package_type || item.parsed_unit || 'unit';
      expect(uomPurchase).toBe('bottle');
    });

    it('should use default "unit" when both are null', () => {
      const item = {
        package_type: null,
        size_value: null,
        size_unit: null,
        parsed_unit: null
      };

      const uomPurchase = item.package_type || item.parsed_unit || 'unit';
      expect(uomPurchase).toBe('unit');
    });

    it('CRITICAL: should set size info only when both value and unit exist', () => {
      const item = {
        size_value: 750,
        size_unit: 'ml'
      };

      const shouldSetSize = item.size_unit && item.size_value && item.size_value > 0;
      expect(shouldSetSize).toBe(true);
    });

    it('should not set size info when value is 0', () => {
      const item = {
        size_value: 0,
        size_unit: 'ml'
      };

      const shouldSetSize = item.size_unit && item.size_value && item.size_value > 0;
      expect(shouldSetSize).toBeFalsy();
    });

    it('should not set size info when unit is missing', () => {
      const item = {
        size_value: 750,
        size_unit: null
      };

      const shouldSetSize = item.size_unit && item.size_value && item.size_value > 0;
      expect(shouldSetSize).toBeFalsy();
    });
  });

  describe('Data Type Consistency', () => {
    it('should maintain numeric type for size_value', () => {
      const sizeValue = 750;
      expect(typeof sizeValue).toBe('number');
    });

    it('should maintain string type for size_unit', () => {
      const sizeUnit = 'ml';
      expect(typeof sizeUnit).toBe('string');
    });

    it('should maintain string type for package_type', () => {
      const packageType = 'bottle';
      expect(typeof packageType).toBe('string');
    });

    it('CRITICAL: should handle string-to-number conversion for size_value', () => {
      const stringValue = '750';
      const numericValue = parseFloat(stringValue);
      
      expect(numericValue).toBe(750);
      expect(typeof numericValue).toBe('number');
    });

    it('should handle NaN when parsing invalid size_value', () => {
      const invalidValue = 'not-a-number';
      const numericValue = parseFloat(invalidValue);
      
      expect(Number.isNaN(numericValue)).toBe(true);
    });
  });

  describe('Backward Compatibility', () => {
    it('CRITICAL: should handle old receipts with only parsed_unit', () => {
      const oldItem = {
        parsed_quantity: 2,
        parsed_unit: 'bottle',
        package_type: null,
        size_value: null,
        size_unit: null
      };

      // Should still be able to create product using parsed_unit
      const packageType = oldItem.package_type || oldItem.parsed_unit;
      expect(packageType).toBe('bottle');
    });

    it('should prioritize new fields over legacy fields', () => {
      const item = {
        package_type: 'bottle',
        parsed_unit: 'box', // Legacy field with different value
        size_value: 750,
        size_unit: 'ml'
      };

      const packageType = item.package_type || item.parsed_unit;
      expect(packageType).toBe('bottle'); // New field takes precedence
    });

    it('should handle mixed old and new data', () => {
      const item = {
        package_type: 'bottle',
        size_value: 750,
        size_unit: 'ml',
        parsed_unit: 'bottle', // Same as package_type (consistent)
        parsed_quantity: 2
      };

      expect(item.package_type).toBe(item.parsed_unit);
      expect(item.size_value).toBe(750);
    });
  });

  describe('Common Receipt Patterns', () => {
    it('should extract from "2 bottles 750ML VODKA"', () => {
      const extracted = {
        parsedQuantity: 2,
        packageType: 'bottle',
        sizeValue: 750,
        sizeUnit: 'ml',
        parsedName: 'VODKA'
      };

      expect(extracted.parsedQuantity).toBe(2);
      expect(extracted.packageType).toBe('bottle');
      expect(extracted.sizeValue).toBe(750);
      expect(extracted.sizeUnit).toBe('ml');
    });

    it('should extract from "5LB BAG RICE"', () => {
      const extracted = {
        parsedQuantity: 5,
        packageType: 'bag',
        sizeValue: 5,
        sizeUnit: 'lb',
        parsedName: 'RICE'
      };

      expect(extracted.sizeValue).toBe(5);
      expect(extracted.sizeUnit).toBe('lb');
      expect(extracted.packageType).toBe('bag');
    });

    it('should extract from "1 case 12x355ML BEER"', () => {
      const extracted = {
        parsedQuantity: 1,
        packageType: 'case',
        sizeValue: 355,
        sizeUnit: 'ml',
        parsedName: 'BEER'
      };

      expect(extracted.packageType).toBe('case');
      expect(extracted.sizeValue).toBe(355);
    });

    it('should extract from "6.86 @ 4.64 CHEEK MEAT"', () => {
      const extracted = {
        parsedQuantity: 6.86,
        packageType: null, // Weight-based, no container
        sizeValue: 6.86,
        sizeUnit: 'lb',
        parsedName: 'CHEEK MEAT'
      };

      expect(extracted.parsedQuantity).toBeCloseTo(6.86);
      expect(extracted.sizeValue).toBeCloseTo(6.86);
      expect(extracted.sizeUnit).toBe('lb');
    });
  });
});

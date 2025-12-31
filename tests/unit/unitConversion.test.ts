/**
 * Unit Conversion Utility Tests
 *
 * Tests the client-side unit conversion helper functions used for
 * unit categorization, normalization, and recipe unit suggestions.
 */

import { describe, it, expect } from 'vitest';
import {
  getUnitCategory,
  normalizeUnitName,
  suggestRecipeUnits,
  type MeasurementCategory,
} from '@/lib/unitConversion';

// ===== UNIT CATEGORY TESTS =====

describe('Unit Category Detection', () => {
  describe('getUnitCategory', () => {
    it('identifies volume units correctly', () => {
      // Standard volume units
      expect(getUnitCategory('ml')).toBe('volume');
      expect(getUnitCategory('L')).toBe('volume');
      expect(getUnitCategory('fl oz')).toBe('volume');
      expect(getUnitCategory('cup')).toBe('volume');
      expect(getUnitCategory('tbsp')).toBe('volume');
      expect(getUnitCategory('tsp')).toBe('volume');
      expect(getUnitCategory('gal')).toBe('volume');
      expect(getUnitCategory('qt')).toBe('volume');

      // Extended volume units
      expect(getUnitCategory('l')).toBe('volume'); // lowercase
      expect(getUnitCategory('gallon')).toBe('volume');
      expect(getUnitCategory('quart')).toBe('volume');
      expect(getUnitCategory('pint')).toBe('volume');
      expect(getUnitCategory('floz')).toBe('volume');
    });

    it('identifies weight units correctly', () => {
      // Standard weight units
      expect(getUnitCategory('g')).toBe('weight');
      expect(getUnitCategory('kg')).toBe('weight');
      expect(getUnitCategory('lb')).toBe('weight');
      expect(getUnitCategory('oz')).toBe('weight');

      // Extended weight units
      expect(getUnitCategory('mg')).toBe('weight');
    });

    it('identifies count units correctly', () => {
      expect(getUnitCategory('each')).toBe('count');
      expect(getUnitCategory('piece')).toBe('count');
      expect(getUnitCategory('serving')).toBe('count');
      expect(getUnitCategory('bottle')).toBe('count');
      expect(getUnitCategory('can')).toBe('count');
      expect(getUnitCategory('box')).toBe('count');
      expect(getUnitCategory('bag')).toBe('count');
      expect(getUnitCategory('case')).toBe('count');
      expect(getUnitCategory('container')).toBe('count');
      expect(getUnitCategory('package')).toBe('count');
      expect(getUnitCategory('dozen')).toBe('count');
      expect(getUnitCategory('unit')).toBe('count');
      expect(getUnitCategory('jar')).toBe('count');
    });

    it('identifies length units correctly', () => {
      expect(getUnitCategory('inch')).toBe('length');
      expect(getUnitCategory('cm')).toBe('length');
      expect(getUnitCategory('mm')).toBe('length');
      expect(getUnitCategory('ft')).toBe('length');
      expect(getUnitCategory('meter')).toBe('length');
    });

    it('returns unknown for unrecognized units', () => {
      expect(getUnitCategory('unknown')).toBe('unknown');
      expect(getUnitCategory('random')).toBe('unknown');
      expect(getUnitCategory('')).toBe('unknown');
    });

    it('handles case insensitivity and whitespace', () => {
      expect(getUnitCategory('ML')).toBe('volume');
      expect(getUnitCategory(' ml ')).toBe('volume');
      expect(getUnitCategory('Fl Oz')).toBe('volume');
      expect(getUnitCategory(' CUP ')).toBe('volume');
    });

    it('handles partial matches correctly', () => {
      expect(getUnitCategory('tablespoon')).toBe('volume'); // contains 'tbsp'
      expect(getUnitCategory('teaspoon')).toBe('volume'); // contains 'tsp'
      expect(getUnitCategory('fluid ounce')).toBe('volume'); // contains 'fl oz'
    });
  });
});

// ===== UNIT NORMALIZATION TESTS =====

describe('Unit Name Normalization', () => {
  describe('normalizeUnitName', () => {
    it('normalizes volume units correctly', () => {
      expect(normalizeUnitName('ounce')).toBe('oz');
      expect(normalizeUnitName('fluid ounce')).toBe('fl oz');
      expect(normalizeUnitName('fl oz')).toBe('fl oz');
      expect(normalizeUnitName('fluid oz')).toBe('fl oz');
      expect(normalizeUnitName('milliliter')).toBe('ml');
      expect(normalizeUnitName('millilitre')).toBe('ml');
      expect(normalizeUnitName('cups')).toBe('cup');
      expect(normalizeUnitName('tablespoon')).toBe('tbsp');
      expect(normalizeUnitName('tablespoons')).toBe('tbsp');
      expect(normalizeUnitName('teaspoon')).toBe('tsp');
      expect(normalizeUnitName('teaspoons')).toBe('tsp');
    });

    it('normalizes weight units correctly', () => {
      expect(normalizeUnitName('lbs')).toBe('lb');
      expect(normalizeUnitName('pound')).toBe('lb');
      expect(normalizeUnitName('pounds')).toBe('lb');
      expect(normalizeUnitName('gram')).toBe('g');
      expect(normalizeUnitName('grams')).toBe('g');
      expect(normalizeUnitName('kilogram')).toBe('kg');
      expect(normalizeUnitName('kilograms')).toBe('kg');
    });

    it('normalizes count units correctly', () => {
      expect(normalizeUnitName('ea')).toBe('each');
      expect(normalizeUnitName('pc')).toBe('piece');
      expect(normalizeUnitName('pcs')).toBe('piece');
      expect(normalizeUnitName('pieces')).toBe('piece');
      expect(normalizeUnitName('servings')).toBe('serving');
      expect(normalizeUnitName('bottles')).toBe('bottle');
      expect(normalizeUnitName('cans')).toBe('can');
      expect(normalizeUnitName('boxes')).toBe('box');
      expect(normalizeUnitName('bags')).toBe('bag');
      expect(normalizeUnitName('cases')).toBe('case');
      expect(normalizeUnitName('containers')).toBe('container');
      expect(normalizeUnitName('packages')).toBe('package');
      expect(normalizeUnitName('pack')).toBe('package');
      expect(normalizeUnitName('packs')).toBe('package');
    });

    it('returns original unit for unmapped values', () => {
      expect(normalizeUnitName('custom')).toBe('custom');
      expect(normalizeUnitName('unknown')).toBe('unknown');
      expect(normalizeUnitName('')).toBe('');
    });

    it('handles case insensitivity and whitespace', () => {
      expect(normalizeUnitName('OUNCE')).toBe('oz');
      expect(normalizeUnitName(' Fluid Ounce ')).toBe('fl oz');
      expect(normalizeUnitName('GRAM')).toBe('g');
      expect(normalizeUnitName(' EA ')).toBe('each');
    });
  });
});

// ===== RECIPE UNIT SUGGESTION TESTS =====

describe('Recipe Unit Suggestions', () => {
  describe('suggestRecipeUnits', () => {
    it('suggests appropriate units for volume purchases', () => {
      const suggestions = suggestRecipeUnits('ml');
      expect(suggestions).toEqual(['fl oz', 'ml', 'cup', 'tbsp', 'tsp']);
    });

    it('suggests appropriate units for weight purchases', () => {
      const suggestions = suggestRecipeUnits('lb');
      expect(suggestions).toEqual(['lb', 'oz', 'g']);
    });

    it('suggests appropriate units for count purchases', () => {
      const suggestions = suggestRecipeUnits('bottle');
      expect(suggestions).toEqual(['each', 'piece', 'serving']);
    });

    it('suggests count units for generic package shorthand', () => {
      const suggestions = suggestRecipeUnits('unit');
      expect(suggestions).toEqual(['each', 'piece', 'serving']);
    });

    it('suggests appropriate units for length purchases', () => {
      const suggestions = suggestRecipeUnits('inch');
      expect(suggestions).toEqual(['inch', 'cm']);
    });

    it('suggests default units for unknown purchases', () => {
      const suggestions = suggestRecipeUnits('unknown');
      expect(suggestions).toEqual(['each', 'piece']);
    });

    it('handles case insensitivity', () => {
      expect(suggestRecipeUnits('ML')).toEqual(['fl oz', 'ml', 'cup', 'tbsp', 'tsp']);
      expect(suggestRecipeUnits('LB')).toEqual(['lb', 'oz', 'g']);
      expect(suggestRecipeUnits('BOTTLE')).toEqual(['each', 'piece', 'serving']);
    });

    it('trims whitespace before determining suggestions', () => {
      expect(suggestRecipeUnits('  LB  ')).toEqual(['lb', 'oz', 'g']);
      expect(suggestRecipeUnits('  FT  ')).toEqual(['inch', 'cm']);
    });
  });
});

// ===== EDGE CASES AND ERROR HANDLING =====

describe('Edge Cases and Error Handling', () => {
  describe('getUnitCategory edge cases', () => {
    it('handles empty and whitespace inputs', () => {
      expect(getUnitCategory('')).toBe('unknown');
      expect(getUnitCategory('   ')).toBe('unknown');
    });

    it('handles null and undefined inputs gracefully', () => {
      // TypeScript will prevent null/undefined, but test string equivalents
      expect(getUnitCategory('null')).toBe('unknown');
      expect(getUnitCategory('undefined')).toBe('unknown');
    });
  });

  describe('normalizeUnitName edge cases', () => {
    it('handles empty and whitespace inputs', () => {
      expect(normalizeUnitName('')).toBe('');
      expect(normalizeUnitName('   ')).toBe('   ');
    });
  });

  describe('suggestRecipeUnits edge cases', () => {
    it('handles empty and whitespace inputs', () => {
      expect(suggestRecipeUnits('')).toEqual(['each', 'piece']);
      expect(suggestRecipeUnits('   ')).toEqual(['each', 'piece']);
    });
  });
});

/**
 * Tests for src/lib/utils.ts
 * 
 * These tests cover utility functions used across the application.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeForOrFilter, formatTime, cn } from '@/lib/utils';

describe('Utility Functions', () => {
  describe('sanitizeForOrFilter', () => {
    it('returns empty string for empty input', () => {
      expect(sanitizeForOrFilter('')).toBe('');
    });

    it('returns unchanged string when no special characters', () => {
      expect(sanitizeForOrFilter('Margarita')).toBe('Margarita');
      expect(sanitizeForOrFilter('House Burger')).toBe('House Burger');
      expect(sanitizeForOrFilter('12345')).toBe('12345');
    });

    it('removes commas from input', () => {
      expect(sanitizeForOrFilter('item,with,commas')).toBe('itemwithcommas');
      expect(sanitizeForOrFilter('Burger, Fries')).toBe('Burger Fries');
    });

    it('removes parentheses from input', () => {
      expect(sanitizeForOrFilter('item(test)')).toBe('itemtest');
      expect(sanitizeForOrFilter('Soup (Large)')).toBe('Soup Large');
      expect(sanitizeForOrFilter('(nested)(parens)')).toBe('nestedparens');
    });

    it('removes backslashes from input', () => {
      expect(sanitizeForOrFilter('path\\to\\item')).toBe('pathtoitem');
      expect(sanitizeForOrFilter('escape\\test')).toBe('escapetest');
    });

    it('removes single quotes from input', () => {
      expect(sanitizeForOrFilter("it's")).toBe('its');
      expect(sanitizeForOrFilter("Chef's Special")).toBe('Chefs Special');
    });

    it('removes double quotes from input', () => {
      expect(sanitizeForOrFilter('"quoted"')).toBe('quoted');
      expect(sanitizeForOrFilter('The "Best" Burger')).toBe('The Best Burger');
    });

    it('removes multiple special characters at once', () => {
      expect(sanitizeForOrFilter("item(1),item'2\"")).toBe('item1item2');
      expect(sanitizeForOrFilter("Complex (Item), 'with' \"quotes\"")).toBe('Complex Item with quotes');
    });

    it('preserves other special characters', () => {
      // These characters should NOT be removed
      expect(sanitizeForOrFilter('item-with-dashes')).toBe('item-with-dashes');
      expect(sanitizeForOrFilter('item_with_underscores')).toBe('item_with_underscores');
      expect(sanitizeForOrFilter('item.with.dots')).toBe('item.with.dots');
      expect(sanitizeForOrFilter('item@email.com')).toBe('item@email.com');
      expect(sanitizeForOrFilter('item#1')).toBe('item#1');
      expect(sanitizeForOrFilter('50% off')).toBe('50% off');
      expect(sanitizeForOrFilter('item & item')).toBe('item & item');
    });

    it('handles unicode characters', () => {
      expect(sanitizeForOrFilter('Café')).toBe('Café');
      expect(sanitizeForOrFilter('日本語')).toBe('日本語');
      expect(sanitizeForOrFilter('Müller')).toBe('Müller');
    });

    it('handles real-world POS item names', () => {
      expect(sanitizeForOrFilter('Chicken Wings (12pc)')).toBe('Chicken Wings 12pc');
      expect(sanitizeForOrFilter("Fish 'n' Chips")).toBe('Fish n Chips');
      expect(sanitizeForOrFilter('Burger, Fries & Drink')).toBe('Burger Fries & Drink');
    });

    it('handles potential injection attempts', () => {
      // These patterns could break PostgREST filters if not sanitized
      expect(sanitizeForOrFilter('name.eq.admin,password.eq.secret')).toBe('name.eq.adminpassword.eq.secret');
      expect(sanitizeForOrFilter('),(or')).toBe('or');
      // Semicolons are safe in PostgREST filters, quotes are the danger
      expect(sanitizeForOrFilter("'; DROP TABLE users; --")).toBe('; DROP TABLE users; --');
    });
  });

  describe('formatTime', () => {
    it('returns empty string for null input', () => {
      expect(formatTime(null)).toBe('');
    });

    it('returns empty string for undefined input', () => {
      expect(formatTime(undefined)).toBe('');
    });

    it('returns empty string for empty string input', () => {
      expect(formatTime('')).toBe('');
    });

    it('formats HH:MM:SS to HH:MM', () => {
      expect(formatTime('14:30:00')).toBe('14:30');
      expect(formatTime('09:00:00')).toBe('09:00');
      expect(formatTime('23:59:59')).toBe('23:59');
    });

    it('preserves HH:MM format', () => {
      expect(formatTime('14:30')).toBe('14:30');
      expect(formatTime('09:00')).toBe('09:00');
    });

    it('handles edge cases', () => {
      expect(formatTime('00:00:00')).toBe('00:00');
      expect(formatTime('12:00')).toBe('12:00');
    });
  });

  describe('cn (className utility)', () => {
    it('merges class names', () => {
      expect(cn('foo', 'bar')).toBe('foo bar');
    });

    it('handles conditional classes', () => {
      const isIncluded = true;
      const isExcluded = false;
      expect(cn('base', isIncluded && 'included', isExcluded && 'excluded')).toBe('base included');
    });

    it('handles undefined and null', () => {
      expect(cn('base', undefined, null, 'end')).toBe('base end');
    });

    it('merges tailwind classes correctly', () => {
      // Later classes should override earlier ones
      expect(cn('px-2', 'px-4')).toBe('px-4');
      expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
    });

    it('handles array of classes', () => {
      expect(cn(['foo', 'bar'])).toBe('foo bar');
    });

    it('handles object syntax', () => {
      expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz');
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  SELECT_RESTAURANT_PARAM,
  readLinkedRestaurantId,
  resolveLinkedRestaurant,
  withoutLinkedRestaurant,
} from '@/lib/restaurantDeepLink';

const memberships = [{ restaurant_id: 'r-1' }, { restaurant_id: 'r-2' }];

describe('restaurantDeepLink', () => {
  it('uses select_restaurant as the param name', () => {
    expect(SELECT_RESTAURANT_PARAM).toBe('select_restaurant');
  });

  describe('readLinkedRestaurantId', () => {
    it('returns the value when the key exists', () => {
      expect(readLinkedRestaurantId(new URLSearchParams('select_restaurant=r-2'))).toBe('r-2');
    });
    it('returns null when the key is missing', () => {
      expect(readLinkedRestaurantId(new URLSearchParams('welcome=true'))).toBeNull();
    });
    it('returns null when the value is empty', () => {
      expect(readLinkedRestaurantId(new URLSearchParams('select_restaurant='))).toBeNull();
    });
  });

  describe('resolveLinkedRestaurant', () => {
    it('returns the membership with the linked id', () => {
      expect(resolveLinkedRestaurant('r-2', memberships)).toBe(memberships[1]);
    });
    it('returns null when no membership matches', () => {
      expect(resolveLinkedRestaurant('r-9', memberships)).toBeNull();
    });
    it('returns null when the id is null', () => {
      expect(resolveLinkedRestaurant(null, memberships)).toBeNull();
    });
    it('returns null for an empty list', () => {
      expect(resolveLinkedRestaurant('r-1', [])).toBeNull();
    });
  });

  describe('withoutLinkedRestaurant', () => {
    it('deletes only the select_restaurant key', () => {
      const input = new URLSearchParams('welcome=true&select_restaurant=r-1&tab=a');
      const out = withoutLinkedRestaurant(input);
      expect(out.get('select_restaurant')).toBeNull();
      expect(out.get('welcome')).toBe('true');
      expect(out.get('tab')).toBe('a');
    });
    it('does not change the input', () => {
      const input = new URLSearchParams('select_restaurant=r-1');
      withoutLinkedRestaurant(input);
      expect(input.get('select_restaurant')).toBe('r-1');
    });
  });
});

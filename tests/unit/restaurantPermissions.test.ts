/**
 * Tests for src/lib/restaurantPermissions.ts
 * 
 * These tests cover the restaurant creation permission logic.
 */

import { describe, it, expect } from 'vitest';
import { canUserCreateRestaurant } from '@/lib/restaurantPermissions';
import { UserRestaurant } from '@/hooks/useRestaurants';

// Helper to create mock UserRestaurant objects
const createMockUserRestaurant = (
  role: 'owner' | 'manager' | 'chef' | 'staff' | 'kiosk',
  restaurantId: string = 'rest-1'
): UserRestaurant => ({
  id: `ur-${restaurantId}`,
  user_id: 'user-1',
  restaurant_id: restaurantId,
  role,
  created_at: new Date().toISOString(),
  restaurant: {
    id: restaurantId,
    name: `Restaurant ${restaurantId}`,
    address: '123 Main St',
    phone: '555-1234',
    cuisine_type: 'american',
    timezone: 'America/Chicago',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
});

describe('Restaurant Permissions', () => {
  describe('canUserCreateRestaurant', () => {
    describe('First-time users (no restaurants)', () => {
      it('returns true when restaurants is null', () => {
        expect(canUserCreateRestaurant(null)).toBe(true);
      });

      it('returns true when restaurants is undefined', () => {
        expect(canUserCreateRestaurant(undefined)).toBe(true);
      });

      it('returns true when restaurants is empty array', () => {
        expect(canUserCreateRestaurant([])).toBe(true);
      });
    });

    describe('Users with owner role', () => {
      it('returns true when user is owner of one restaurant', () => {
        const restaurants = [createMockUserRestaurant('owner')];
        expect(canUserCreateRestaurant(restaurants)).toBe(true);
      });

      it('returns true when user is owner of multiple restaurants', () => {
        const restaurants = [
          createMockUserRestaurant('owner', 'rest-1'),
          createMockUserRestaurant('owner', 'rest-2'),
        ];
        expect(canUserCreateRestaurant(restaurants)).toBe(true);
      });

      it('returns true when user is owner of one and manager of another', () => {
        const restaurants = [
          createMockUserRestaurant('owner', 'rest-1'),
          createMockUserRestaurant('manager', 'rest-2'),
        ];
        expect(canUserCreateRestaurant(restaurants)).toBe(true);
      });

      it('returns true when user is owner of one and staff of another', () => {
        const restaurants = [
          createMockUserRestaurant('staff', 'rest-1'),
          createMockUserRestaurant('owner', 'rest-2'),
        ];
        expect(canUserCreateRestaurant(restaurants)).toBe(true);
      });
    });

    describe('Users without owner role', () => {
      it('returns false when user is only a manager', () => {
        const restaurants = [createMockUserRestaurant('manager')];
        expect(canUserCreateRestaurant(restaurants)).toBe(false);
      });

      it('returns false when user is only staff', () => {
        const restaurants = [createMockUserRestaurant('staff')];
        expect(canUserCreateRestaurant(restaurants)).toBe(false);
      });

      it('returns false when user is manager of multiple restaurants', () => {
        const restaurants = [
          createMockUserRestaurant('manager', 'rest-1'),
          createMockUserRestaurant('manager', 'rest-2'),
        ];
        expect(canUserCreateRestaurant(restaurants)).toBe(false);
      });

      it('returns false when user is staff and manager but not owner', () => {
        const restaurants = [
          createMockUserRestaurant('staff', 'rest-1'),
          createMockUserRestaurant('manager', 'rest-2'),
        ];
        expect(canUserCreateRestaurant(restaurants)).toBe(false);
      });

      it('returns false when user is only a chef', () => {
        const restaurants = [createMockUserRestaurant('chef')];
        expect(canUserCreateRestaurant(restaurants)).toBe(false);
      });

      it('returns false when user is only a kiosk', () => {
        const restaurants = [createMockUserRestaurant('kiosk')];
        expect(canUserCreateRestaurant(restaurants)).toBe(false);
      });

      it('returns false when user has various non-owner roles', () => {
        const restaurants = [
          createMockUserRestaurant('staff', 'rest-1'),
          createMockUserRestaurant('manager', 'rest-2'),
          createMockUserRestaurant('chef', 'rest-3'),
          createMockUserRestaurant('kiosk', 'rest-4'),
        ];
        expect(canUserCreateRestaurant(restaurants)).toBe(false);
      });
    });
  });
});

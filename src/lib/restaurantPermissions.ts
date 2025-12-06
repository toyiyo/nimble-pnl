import { UserRestaurant } from '@/hooks/useRestaurants';

/**
 * Determines if a user can create a new restaurant.
 * 
 * Rules:
 * - First-time users (no restaurants) can create their first restaurant
 * - Users who are owners of any restaurant can create additional restaurants
 * - Users who are only managers/staff cannot create restaurants
 * 
 * @param restaurants - Array of user's restaurant associations
 * @returns boolean - true if user can create a restaurant
 */
export function canUserCreateRestaurant(restaurants: UserRestaurant[] | null | undefined): boolean {
  // First-time users with no restaurants can create their first one
  if (!restaurants || restaurants.length === 0) {
    return true;
  }
  
  // Users with owner role on any restaurant can create more
  return restaurants.some(r => r.role === 'owner');
}

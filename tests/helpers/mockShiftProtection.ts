/**
 * Shared vi.mock module for '@/hooks/useShiftProtection'.
 *
 * The real hooks run through React Query; component tests render without
 * a QueryClientProvider, so they stub the family with everything-off
 * defaults. Use it as:
 *
 *   vi.mock('@/hooks/useShiftProtection', () => import('../helpers/mockShiftProtection'));
 */
import { SHIFT_PROTECTION_DEFAULTS } from '@/lib/shiftProtection';

export const shiftProtectionQueryKey = (restaurantId: string | null) =>
  ['shift-protection', restaurantId] as const;

export const useShiftProtection = () => ({
  protection: SHIFT_PROTECTION_DEFAULTS,
  isLoading: false,
  error: null,
});

export const useInvalidateShiftProtection = () => () => {};

export const useTimeoffDayCounts = () => ({ data: [], isLoading: false, error: null });

export const useTimeoffCoverageImpact = () => ({ data: null, isLoading: false, error: null });

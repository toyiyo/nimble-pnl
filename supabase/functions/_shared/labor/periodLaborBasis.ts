/**
 * The labor figure of the dashboard (`useCostsFromSource`): accrued labor
 * (time punches) or paid labor (bank), never the sum. `resolveLaborBasis`
 * picks the basis for the period.
 */
import { resolveLaborBasis, type LaborBasis } from './combineCosts.ts';
import {
  loadPeriodBankLabor,
  loadPeriodLaborCost,
  type PeriodLaborCostInput,
} from './periodLaborCost.ts';
import type { LaborQueryClient } from './types.ts';

export type PeriodLaborBasisInput = PeriodLaborCostInput;

export interface PeriodLaborBasisResult {
  /** The labor of the basis source only (dollars). */
  totalLaborCost: number;
  /** `accrued` when the period has wage labor, else `paid`. */
  laborBasis: LaborBasis;
  /** Accrued labor: `loadPeriodLaborCost` `totalCost` (dollars). */
  pendingLaborCost: number;
  /** Paid labor: `loadPeriodBankLabor` `totalCost` (dollars). */
  actualLaborCost: number;
  /** Accrued wages + per-job payments, tips owed excluded (dollars). */
  wageCost: number;
  /** True when a paged read of either loader hit the `maxPages` cap. */
  capped: boolean;
}

/**
 * The period labor with the basis rule of `useCostsFromSource`: the basis
 * is `resolveLaborBasis(wageCost)`, and the total is the basis source only.
 */
export async function loadPeriodLaborBasis(
  client: LaborQueryClient,
  input: PeriodLaborBasisInput,
): Promise<PeriodLaborBasisResult> {
  const [accrued, paid] = await Promise.all([
    loadPeriodLaborCost(client, input),
    loadPeriodBankLabor(client, {
      restaurantId: input.restaurantId,
      startDay: input.startDay,
      endDay: input.endDay,
    }),
  ]);

  // Tips owed alone must not hide paid (bank) labor behind the accrued pick,
  // so the basis reads wageCost, not totalCost.
  const laborBasis = resolveLaborBasis(accrued.wageCost);
  return {
    totalLaborCost: laborBasis === 'accrued' ? accrued.totalCost : paid.totalCost,
    laborBasis,
    pendingLaborCost: accrued.totalCost,
    actualLaborCost: paid.totalCost,
    wageCost: accrued.wageCost,
    capped: accrued.capped || paid.capped,
  };
}

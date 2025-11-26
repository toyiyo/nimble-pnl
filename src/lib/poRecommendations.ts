export interface RecommendationContext {
  onHand?: number | null;
  parLevelMin?: number | null;
  parLevelMax?: number | null;
  reorderPoint?: number | null;
  safetyStock?: number | null;
  defaultOrderQuantity?: number | null;
  minOrderMultiple?: number | null;
}

export interface RecommendationResult {
  recommendedQuantity: number;
  targetLevel: number | null;
  shortfall: number | null;
}

const sanitizeNumber = (value?: number | null): number | null => {
  if (typeof value !== 'number') return null;
  if (Number.isNaN(value)) return null;
  return value;
};

const resolveTargetLevel = (context: RecommendationContext): number | null => {
  const parMax = sanitizeNumber(context.parLevelMax);
  const parMin = sanitizeNumber(context.parLevelMin);
  const reorderPoint = sanitizeNumber(context.reorderPoint);
  const defaultQty = sanitizeNumber(context.defaultOrderQuantity);
  const safetyStock = sanitizeNumber(context.safetyStock) ?? 0;

  const baseTarget = parMax ?? parMin ?? reorderPoint ?? defaultQty;
  if (baseTarget === null) return null;

  return Math.max(baseTarget + safetyStock, 0);
};

const alignToMultiple = (quantity: number, multiple?: number | null): number => {
  const normalizedMultiple = sanitizeNumber(multiple);
  if (!normalizedMultiple || normalizedMultiple <= 0) {
    return quantity;
  }

  const multiplier = Math.ceil(quantity / normalizedMultiple);
  return multiplier * normalizedMultiple;
};

export const calculateRecommendation = (context: RecommendationContext): RecommendationResult => {
  const onHand = sanitizeNumber(context.onHand) ?? 0;
  const targetLevel = resolveTargetLevel(context);

  if (targetLevel === null) {
    const fallback = sanitizeNumber(context.defaultOrderQuantity);
    const recommendedQuantity = fallback ? Math.max(fallback, 0) : 0;
    return {
      recommendedQuantity: alignToMultiple(recommendedQuantity, context.minOrderMultiple),
      targetLevel: null,
      shortfall: null,
    };
  }

  const shortfall = Math.max(targetLevel - onHand, 0);
  const recommendedQuantity = alignToMultiple(shortfall, context.minOrderMultiple);

  return {
    recommendedQuantity,
    targetLevel,
    shortfall,
  };
};

export const hasRecommendationSignal = (context: RecommendationContext): boolean => {
  return (
    sanitizeNumber(context.parLevelMax) !== null ||
    sanitizeNumber(context.parLevelMin) !== null ||
    sanitizeNumber(context.reorderPoint) !== null ||
    sanitizeNumber(context.defaultOrderQuantity) !== null
  );
};


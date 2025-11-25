import { describe, test, expect } from '@playwright/test';
import { calculateRecommendation, hasRecommendationSignal, RecommendationContext } from '../../src/lib/poRecommendations';

const buildContext = (overrides: Partial<RecommendationContext> = {}): RecommendationContext => ({
  onHand: 0,
  parLevelMin: null,
  parLevelMax: null,
  reorderPoint: null,
  safetyStock: null,
  defaultOrderQuantity: null,
  minOrderMultiple: null,
  ...overrides,
});

describe('poRecommendations', () => {
  test('returns zero recommendation when no signals are present', () => {
    const result = calculateRecommendation(buildContext());
    expect(result.recommendedQuantity).toBe(0);
    expect(result.targetLevel).toBeNull();
    expect(result.shortfall).toBeNull();
  });

  test('uses par max minus on-hand for recommendation', () => {
    const result = calculateRecommendation(
      buildContext({
        onHand: 3,
        parLevelMax: 10,
      }),
    );

    expect(result.recommendedQuantity).toBe(7);
    expect(result.targetLevel).toBe(10);
    expect(result.shortfall).toBe(7);
  });

  test('falls back to par min when par max missing', () => {
    const result = calculateRecommendation(
      buildContext({
        onHand: 1,
        parLevelMin: 5,
      }),
    );
    expect(result.recommendedQuantity).toBe(4);
  });

  test('falls back to reorder point when par levels missing', () => {
    const result = calculateRecommendation(
      buildContext({
        onHand: 2,
        reorderPoint: 8,
      }),
    );
    expect(result.recommendedQuantity).toBe(6);
  });

  test('uses default order quantity when no targets available', () => {
    const result = calculateRecommendation(
      buildContext({
        defaultOrderQuantity: 12,
      }),
    );
    expect(result.recommendedQuantity).toBe(12);
    expect(result.targetLevel).toBeNull();
  });

  test('applies safety stock to target', () => {
    const result = calculateRecommendation(
      buildContext({
        onHand: 2,
        parLevelMax: 8,
        safetyStock: 2,
      }),
    );
    expect(result.targetLevel).toBe(10);
    expect(result.recommendedQuantity).toBe(8);
  });

  test('aligns recommendations to minimum order multiples', () => {
    const result = calculateRecommendation(
      buildContext({
        onHand: 1,
        parLevelMax: 10,
        minOrderMultiple: 3,
      }),
    );
    // Need 9 units, but align to multiple of 3 -> already 9
    expect(result.recommendedQuantity).toBe(9);

    const secondResult = calculateRecommendation(
      buildContext({
        onHand: 2,
        parLevelMax: 10,
        minOrderMultiple: 4,
      }),
    );
    // Need 8 units, already multiple. If we needed 7 it should bump to 8 etc.
    expect(secondResult.recommendedQuantity).toBe(8);

    const thirdResult = calculateRecommendation(
      buildContext({
        onHand: 3,
        parLevelMax: 10,
        minOrderMultiple: 4,
      }),
    );
    // Need 7 units => align to 8
    expect(thirdResult.recommendedQuantity).toBe(8);
  });

  test('handles negative or NaN values safely', () => {
    const result = calculateRecommendation(
      buildContext({
        onHand: NaN,
        parLevelMax: -5,
        parLevelMin: 6,
      }),
    );
    expect(result.recommendedQuantity).toBe(6);
  });

  test('detects recommendation signals', () => {
    expect(hasRecommendationSignal(buildContext())).toBe(false);
    expect(hasRecommendationSignal(buildContext({ parLevelMax: 10 }))).toBe(true);
    expect(hasRecommendationSignal(buildContext({ parLevelMin: 5 }))).toBe(true);
    expect(hasRecommendationSignal(buildContext({ reorderPoint: 7 }))).toBe(true);
    expect(hasRecommendationSignal(buildContext({ defaultOrderQuantity: 6 }))).toBe(true);
  });
});


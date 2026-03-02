/**
 * Tip Classification Shared Module
 *
 * Canonical definitions for tip keyword matching and subtype classification.
 * Used by edge functions that classify liability accounts as tips.
 *
 * The frontend equivalent lives in src/hooks/utils/passThroughAdjustments.ts
 * and must stay in sync with these definitions.
 */

const TIP_REGEX = /(^|[^a-z])(?:tip|tips|gratuity)([^a-z]|$)/i;

export const hasTipKeyword = (value: string): boolean => TIP_REGEX.test(value);

// Subtypes that definitively indicate tips
export const TIP_SUBTYPES = new Set(['tips', 'tips_payable', 'tips payable']);

// Generic subtypes where name-based matching should apply as fallback
export const GENERIC_SUBTYPES = new Set(['', 'liability', 'other_current_liability', 'other']);

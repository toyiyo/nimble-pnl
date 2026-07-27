import { describe, it, expect } from 'vitest';
import {
  stageForElapsedDays,
  nextStage,
  recipientsForStage,
} from '../../supabase/functions/_shared/bankReauthStages';

describe('stageForElapsedDays', () => {
  it('maps exactly 1 whole UTC day elapsed to day_1', () => {
    expect(stageForElapsedDays(1)).toBe('day_1');
  });

  it('maps 3 days elapsed to still day_1 (boundary not yet crossed)', () => {
    expect(stageForElapsedDays(3)).toBe('day_1');
  });

  it('maps exactly 4 days elapsed to day_4', () => {
    expect(stageForElapsedDays(4)).toBe('day_4');
  });

  it('maps exactly 10 days elapsed to day_10', () => {
    expect(stageForElapsedDays(10)).toBe('day_10');
  });

  it('caps at day_10 for 40 days elapsed — no stage past 10', () => {
    expect(stageForElapsedDays(40)).toBe('day_10');
  });

  it('returns null for 0 days elapsed — day 0 is in-app only', () => {
    expect(stageForElapsedDays(0)).toBeNull();
  });
});

describe('nextStage', () => {
  it('returns day_4 (not day_1) for a bank at day 6 with only day_1 already sent', () => {
    expect(nextStage(['day_1'], 6)).toBe('day_4');
  });

  it('returns the current stage when nothing has been sent yet', () => {
    expect(nextStage([], 1)).toBe('day_1');
  });

  it('returns null once the currently-applicable stage has already been sent', () => {
    expect(nextStage(['day_1'], 3)).toBeNull();
  });

  it('returns null at day_10 once day_10 has already been sent, even if the outage continues', () => {
    expect(nextStage(['day_1', 'day_4', 'day_10'], 40)).toBeNull();
  });

  it('returns null for 0 days elapsed regardless of sent history', () => {
    expect(nextStage([], 0)).toBeNull();
  });

  it('jumps straight to day_10 without backfilling a skipped day_4', () => {
    expect(nextStage(['day_1'], 15)).toBe('day_10');
  });
});

describe('recipientsForStage', () => {
  it('sends day_1 to owners + managers over email + push', () => {
    expect(recipientsForStage('day_1')).toEqual({
      roles: ['owner', 'manager'],
      channels: ['email', 'push'],
    });
  });

  it('sends day_4 to owners + managers over email + push', () => {
    expect(recipientsForStage('day_4')).toEqual({
      roles: ['owner', 'manager'],
      channels: ['email', 'push'],
    });
  });

  it('sends day_10 to owners only, over email only (no push interrupt)', () => {
    expect(recipientsForStage('day_10')).toEqual({
      roles: ['owner'],
      channels: ['email'],
    });
  });

  it('sends recovered to owners + managers over email only', () => {
    expect(recipientsForStage('recovered')).toEqual({
      roles: ['owner', 'manager'],
      channels: ['email'],
    });
  });
});

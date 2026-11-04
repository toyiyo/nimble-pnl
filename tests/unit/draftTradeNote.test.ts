import { describe, it, expect } from 'vitest';
import {
  TENTATIVE_NOTE,
  tentativeEmailBlock,
  tentativePushBody,
} from '../../supabase/functions/_shared/draftTradeNote';

describe('draftTradeNote', () => {
  it('emits the note block only for is_published === false', () => {
    expect(tentativeEmailBlock(false)).toContain(TENTATIVE_NOTE);
    expect(tentativeEmailBlock(true)).toBe('');
  });

  it('undefined and null do not read as tentative', () => {
    // A row from before the embed change lacks the field. Fail safe:
    // no tentative note rather than a wrong one on a published shift.
    expect(tentativeEmailBlock(undefined)).toBe('');
    expect(tentativeEmailBlock(null)).toBe('');
    expect(tentativePushBody('base', undefined)).toBe('base');
  });

  it('appends the note to a push body only for false', () => {
    expect(tentativePushBody('A teammate offered a shift for trade.', false)).toBe(
      `A teammate offered a shift for trade. ${TENTATIVE_NOTE}`,
    );
    expect(tentativePushBody('A teammate offered a shift for trade.', true)).toBe(
      'A teammate offered a shift for trade.',
    );
  });
});

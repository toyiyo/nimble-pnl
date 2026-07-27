import { describe, it, expect } from 'vitest';
import { VERDICTS, composeReply } from '../../dev-tools/pr-triage.js';

describe('pr-triage: VERDICTS', () => {
  it('defines exactly the three verdict keys', () => {
    expect(Object.keys(VERDICTS).sort()).toEqual(['agreed', 'ignored', 'pushed-back']);
  });

  it('carries display and marker forms', () => {
    expect(VERDICTS.agreed.display).toBe('✅ Agreed');
    expect(VERDICTS.agreed.marker).toBe('<!-- pr-triage: agreed -->');
    expect(VERDICTS['pushed-back'].display).toBe('↩️ Pushed back');
    expect(VERDICTS.ignored.display).toBe('⏭️ Ignored');
  });
});

describe('pr-triage: composeReply', () => {
  it('builds an agreed reply with the marker, display form and commit', () => {
    const body = composeReply({
      verdict: 'agreed',
      rationale: 'Coerced capacity via Number.isFinite before use.',
      commit: 'abc1234',
    });
    expect(body).toContain('<!-- pr-triage: agreed -->');
    expect(body).toContain('**✅ Agreed**');
    expect(body).toContain('Coerced capacity via Number.isFinite before use.');
    expect(body).toContain('`abc1234`');
  });

  it('builds a pushed-back reply without requiring a commit', () => {
    const body = composeReply({
      verdict: 'pushed-back',
      rationale: 'bg-amber-500/10 is the documented CLAUDE.md pattern.',
    });
    expect(body).toContain('<!-- pr-triage: pushed-back -->');
    expect(body).toContain('**↩️ Pushed back**');
  });

  it('throws when agreed has no commit', () => {
    expect(() =>
      composeReply({ verdict: 'agreed', rationale: 'Fixed it properly.' }),
    ).toThrow(/commit/i);
  });

  it('throws on an unknown verdict', () => {
    expect(() =>
      composeReply({ verdict: 'maybe', rationale: 'Some rationale here.' }),
    ).toThrow(/unknown verdict/i);
  });

  it('throws on an empty or whitespace rationale', () => {
    expect(() => composeReply({ verdict: 'ignored', rationale: '   ' })).toThrow(/rationale/i);
  });

  it('throws on a rationale too short to explain anything', () => {
    expect(() => composeReply({ verdict: 'ignored', rationale: 'nit' })).toThrow(/rationale/i);
  });
});

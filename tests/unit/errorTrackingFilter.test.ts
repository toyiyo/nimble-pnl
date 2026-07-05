import { describe, expect, it } from 'vitest';

import {
  isUnactionableScriptError,
  MASKED_SCRIPT_ERROR_MESSAGES,
} from '../../src/lib/errorTrackingFilter';

/**
 * Minimal shape matching posthog-js's `CaptureResult` for `$exception`
 * events: `event` is the event name, `properties.$exception_list` is an
 * array of `{ type, value, mechanism: { synthetic }, stacktrace? }`
 * entries (see posthog-js/lib/src/posthog-exceptions.d.ts + dist bundle).
 */
function makeExceptionEvent(exceptionList: unknown[]) {
  return {
    uuid: 'test-uuid',
    event: '$exception',
    properties: {
      $exception_list: exceptionList,
    },
  };
}

function syntheticNoStackEntry(value: string) {
  return {
    type: 'Error',
    value,
    mechanism: { type: 'generic', handled: true, synthetic: true },
    // no `stacktrace` property at all
  };
}

function syntheticNoFramesEntry(value: string) {
  return {
    type: 'Error',
    value,
    mechanism: { type: 'generic', handled: true, synthetic: true },
    stacktrace: { type: 'raw', frames: [] },
  };
}

function realErrorEntry(value: string) {
  return {
    type: 'TypeError',
    value,
    mechanism: { type: 'onerror', handled: false, synthetic: false },
    stacktrace: {
      type: 'raw',
      frames: [
        { filename: 'app.js', lineno: 12, colno: 4, function: 'doThing' },
      ],
    },
  };
}

describe('MASKED_SCRIPT_ERROR_MESSAGES', () => {
  it('exposes the exact masked-message literals for auditability', () => {
    expect(MASKED_SCRIPT_ERROR_MESSAGES).toEqual(
      expect.arrayContaining(['Script error.', 'Script error'])
    );
  });
});

describe('isUnactionableScriptError', () => {
  it('drops a synthetic, stack-frame-less "Script error." exception', () => {
    const event = makeExceptionEvent([syntheticNoStackEntry('Script error.')]);
    expect(isUnactionableScriptError(event)).toBe(true);
  });

  it('drops a synthetic, stack-frame-less "Script error." exception with an empty frames array', () => {
    const event = makeExceptionEvent([syntheticNoFramesEntry('Script error.')]);
    expect(isUnactionableScriptError(event)).toBe(true);
  });

  it('drops the same shape for "Script error" (no trailing period)', () => {
    const event = makeExceptionEvent([syntheticNoStackEntry('Script error')]);
    expect(isUnactionableScriptError(event)).toBe(true);
  });

  it('keeps a real exception message', () => {
    const event = makeExceptionEvent([
      realErrorEntry('TypeError: x is not a function'),
    ]);
    expect(isUnactionableScriptError(event)).toBe(false);
  });

  it('keeps "Script error." when it has real stack frames', () => {
    const event = makeExceptionEvent([realErrorEntry('Script error.')]);
    expect(isUnactionableScriptError(event)).toBe(false);
  });

  it('keeps a mixed list where one entry is a real error', () => {
    const event = makeExceptionEvent([
      syntheticNoStackEntry('Script error.'),
      realErrorEntry('TypeError: x is not a function'),
    ]);
    expect(isUnactionableScriptError(event)).toBe(false);
  });

  it('keeps non-$exception events (e.g. $pageview)', () => {
    const event = {
      uuid: 'test-uuid',
      event: '$pageview',
      properties: {
        $exception_list: [syntheticNoStackEntry('Script error.')],
      },
    };
    expect(isUnactionableScriptError(event)).toBe(false);
  });

  it('keeps null events', () => {
    expect(isUnactionableScriptError(null)).toBe(false);
  });

  it('keeps undefined events', () => {
    expect(isUnactionableScriptError(undefined)).toBe(false);
  });

  it('keeps $exception events with a missing $exception_list', () => {
    const event = {
      uuid: 'test-uuid',
      event: '$exception',
      properties: {},
    };
    expect(isUnactionableScriptError(event)).toBe(false);
  });

  it('keeps $exception events with an empty $exception_list', () => {
    const event = makeExceptionEvent([]);
    expect(isUnactionableScriptError(event)).toBe(false);
  });
});

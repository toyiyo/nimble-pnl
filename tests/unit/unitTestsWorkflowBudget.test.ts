import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The unit-test job costs ~9m30s on a warm runner: ~30s install, ~7m50s
 * `test:coverage`, ~10s `test:tz`, ~1m45s SonarCloud. It shipped with
 * `timeout-minutes: 10`, so ordinary runner variance was enough to push it
 * over and have GitHub cancel the job mid-Sonar-upload with all 8017 tests
 * green (runs 30472141373 and 30480912925 both died at exactly 10m0x).
 *
 * The timeout is a hang detector, not a performance budget — it needs room
 * for the suite to keep growing.
 */
const MIN_TIMEOUT_MINUTES = 20;

const WORKFLOW = resolve(__dirname, '../../.github/workflows/unit-tests.yml');

/** Body of a top-level job block, up to the next 2-space-indented key. */
function jobBody(src: string, job: string): string {
  const afterHeader = src.split(new RegExp(`^ {2}${job}:$`, 'm'))[1];
  expect(afterHeader, `job "${job}" not found in unit-tests.yml`).toBeDefined();
  return afterHeader.split(/^ {2}\S/m)[0];
}

describe('unit-tests workflow budget', () => {
  const src = readFileSync(WORKFLOW, 'utf8');

  it('gives the unit-test job headroom over its real runtime', () => {
    const timeout = jobBody(src, 'test').match(/^\s+timeout-minutes:\s*(\d+)\s*$/m);

    expect(timeout, 'the unit-test job must declare timeout-minutes').not.toBeNull();
    expect(Number(timeout![1])).toBeGreaterThanOrEqual(MIN_TIMEOUT_MINUTES);
  });
});

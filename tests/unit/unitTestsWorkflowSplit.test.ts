import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The unit suite and the SonarCloud scan used to share one job, so one status
 * check carried two independent signals: a slow or cancelled Sonar upload
 * reported to PR authors as "Unit Tests: fail" with all 8017 tests green
 * (runs 30472141373 and 30480912925 both died that way).
 *
 * They are now two jobs. These assertions pin the properties that would
 * silently restore the bug — or silently break the scan — if the workflow
 * were edited back. The coverage-path check is the one that matters most:
 * a wrong download path makes Sonar report 0% new-code coverage and fail the
 * quality gate with no "file not found" anywhere in the log.
 */
const MIN_TEST_JOB_TIMEOUT_MINUTES = 15;
const COVERAGE_ARTIFACT = 'coverage-report';

const WORKFLOW = resolve(__dirname, '../../.github/workflows/unit-tests.yml');
const SONAR_PROPERTIES = resolve(__dirname, '../../sonar-project.properties');

const workflow = readFileSync(WORKFLOW, 'utf8');
const sonarProperties = readFileSync(SONAR_PROPERTIES, 'utf8');

/** Everything above `jobs:` — the workflow-level keys. */
function preamble(src: string): string {
  return src.split(/^jobs:$/m)[0];
}

/** Body of a top-level job block, up to the next 2-space-indented key. */
function jobBody(src: string, job: string): string {
  const afterHeader = src.split(new RegExp(`^ {2}${job}:$`, 'm'))[1];
  expect(afterHeader, `job "${job}" not found in unit-tests.yml`).toBeDefined();
  return afterHeader.split(/^ {2}\S/m)[0];
}

/** A job's own keys — everything above its `steps:` list. */
function jobKeys(body: string): string {
  return body.split(/^ {4}steps:$/m)[0];
}

/** Individual `- name: ...` step blocks within a job body. */
function steps(body: string): string[] {
  return body.split(/^ {6}- /m).slice(1);
}

function stepUsing(body: string, action: string): string | undefined {
  return steps(body).find((step) => step.includes(action));
}

/** A step's `with:` mapping, where action inputs live. */
function inputs(step: string): string {
  return step.split(/^ {8}with:$/m)[1]?.split(/^ {8}\S/m)[0] ?? '';
}

/** Value of `key:` in a block, minus any trailing `# comment`. */
function scalar(block: string, key: string): string | undefined {
  const value = block
    .match(new RegExp(`^\\s+${key}:(.*)$`, 'm'))?.[1]
    .replace(/\s+#.*$/, '')
    .trim();

  return value || undefined;
}

/** Directory Sonar reads lcov from, e.g. `coverage/lcov.info` -> `coverage`. */
function sonarCoverageDir(): string {
  const reportPath = sonarProperties.match(
    /^sonar\.javascript\.lcov\.reportPaths=(\S+)\s*$/m,
  )?.[1];

  expect(
    reportPath,
    'sonar-project.properties must declare sonar.javascript.lcov.reportPaths',
  ).toBeDefined();

  return reportPath!.replace(/\/[^/]+$/, '');
}

describe('unit-tests workflow: Unit Tests and SonarCloud are separate jobs', () => {
  describe('the test job', () => {
    const body = jobBody(workflow, 'test');

    it('does not run the SonarCloud scan', () => {
      // Referring to the sonar job in a comment is fine; running it is not.
      expect(steps(body).some((step) => /uses:.*sonar/i.test(step))).toBe(false);
      expect(body).not.toMatch(/SONAR_TOKEN/);
    });

    it('has headroom over its real runtime', () => {
      const timeout = scalar(jobKeys(body), 'timeout-minutes');

      expect(timeout, 'the test job must declare timeout-minutes').toBeDefined();
      expect(Number(timeout)).toBeGreaterThanOrEqual(MIN_TEST_JOB_TIMEOUT_MINUTES);
    });

    it('still uploads coverage under the name the sonar job downloads', () => {
      const upload = stepUsing(body, 'actions/upload-artifact');

      expect(upload, 'the test job must upload a coverage artifact').toBeDefined();
      expect(scalar(inputs(upload!), 'name')).toBe(COVERAGE_ARTIFACT);
    });
  });

  describe('the sonarcloud job', () => {
    const body = jobBody(workflow, 'sonarcloud');

    it('runs the SonarCloud scan', () => {
      expect(body).toMatch(/uses:\s*SonarSource\/\S*sonar\S*-action@/i);
    });

    it('waits for the unit suite to pass', () => {
      // Plain `needs:` with no `if:` — a failed suite skips the scan rather
      // than publishing a quality gate built from partial coverage.
      expect(scalar(jobKeys(body), 'needs')).toBe('[test]');
      expect(jobKeys(body)).not.toMatch(/^\s+if:/m);
    });

    it('checks out full git history for new-code detection', () => {
      // Jobs get separate runners and separate checkouts, so the test job's
      // clone depth does not carry over to this one.
      const checkout = stepUsing(body, 'actions/checkout');

      expect(checkout, 'the sonar job needs its own checkout').toBeDefined();
      expect(scalar(inputs(checkout!), 'fetch-depth')).toBe('0');
    });

    it('downloads coverage to the directory sonar-project.properties reads from', () => {
      const download = stepUsing(body, 'actions/download-artifact');

      expect(download, 'the sonar job must download the coverage artifact').toBeDefined();
      expect(scalar(inputs(download!), 'name')).toBe(COVERAGE_ARTIFACT);
      expect(scalar(inputs(download!), 'path')?.replace(/\/$/, '')).toBe(sonarCoverageDir());
    });

    it('inherits the workflow-level permissions that enable PR decoration', () => {
      // A job-level `permissions:` block REPLACES the workflow default rather
      // than merging with it, so declaring one here would drop
      // `pull-requests: read` and silently break decoration.
      expect(preamble(workflow)).toMatch(/^\s+pull-requests:\s*read\b/m);
      expect(jobKeys(body)).not.toMatch(/^\s+permissions:/m);
    });
  });
});

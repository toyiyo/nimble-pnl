import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Absence guards for the residual sweep (task 8) of the weekly-brief /
 * ops-inbox decommission.
 *
 * The sweep deletes the last live references outside the allowed
 * leftovers (git history, old migrations, old design docs and plans,
 * memory/lessons.md, and the decommission design and plan pair).
 * These tests fail if a retired reference comes back.
 */

const root = resolve(__dirname, '../..');

const RETIRED_ROUTE_STRINGS = ['weekly-brief', 'ops-inbox'];
const RETIRED_NAMES = ['Weekly Brief', 'Ops Inbox'];

const SWEPT_SOURCE_FILES = [
  'supabase/functions/_shared/tools-registry.ts',
  'supabase/functions/ai-execute-tool/index.ts',
];

describe('the AI tool sources have no retired route string', () => {
  it.each(SWEPT_SOURCE_FILES)('%s has no retired route string', (file) => {
    const text = readFileSync(resolve(root, file), 'utf-8');
    for (const route of RETIRED_ROUTE_STRINGS) {
      expect(text).not.toContain(route);
    }
  });
});

describe('the helpdesk index does not list the retired articles', () => {
  it('docs/helpdesk/README.md has no retired slug or feature name', () => {
    const text = readFileSync(resolve(root, 'docs/helpdesk/README.md'), 'utf-8');
    for (const route of RETIRED_ROUTE_STRINGS) {
      expect(text).not.toContain(route);
    }
    for (const name of RETIRED_NAMES) {
      expect(text).not.toContain(name);
    }
  });
});

describe('the grafana doc for the retired pipeline is deleted', () => {
  it('docs/grafana/weekly-brief-pipeline.md does not exist', () => {
    expect(existsSync(resolve(root, 'docs/grafana/weekly-brief-pipeline.md'))).toBe(false);
  });
});

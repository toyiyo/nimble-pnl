/**
 * Tests for src/lib/helpContent.ts
 *
 * Only the pure, export-stable functions are tested here. The glob-based
 * `helpArticles`, `getArticleBySlug`, `getArticlesByCategory`, and
 * `searchHelpArticles` all depend on import.meta.glob (Vite-only) so they
 * are exercised through injected helper functions / direct data instead.
 */

import { describe, it, expect } from 'vitest';
import {
  parseHelpFrontmatter,
  HELP_CATEGORIES,
  getCategory,
  type HelpFrontmatter,
  type HelpArticle,
} from '@/lib/helpContent';

// ---------------------------------------------------------------------------
// Helpers shared across tests
// ---------------------------------------------------------------------------

/** Build a minimal valid frontmatter block from overrides. */
function makeFrontmatter(overrides: Partial<Record<string, string>> = {}): string {
  const defaults: Record<string, string> = {
    title: '"Test Article"',
    category: '"getting-started"',
    summary: '"A brief summary"',
    audience: '["owner", "manager"]',
    order: '5',
    keywords: '["onboarding", "setup"]',
    related: '["other-article"]',
  };
  const fields = { ...defaults, ...overrides };
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\nThis is the body.`;
}

// ---------------------------------------------------------------------------
// parseHelpFrontmatter — full, well-formed frontmatter
// ---------------------------------------------------------------------------

describe('parseHelpFrontmatter', () => {
  describe('full, well-formed frontmatter', () => {
    it('parses title, category, summary as strings', () => {
      const raw = makeFrontmatter();
      const { data } = parseHelpFrontmatter(raw);
      expect(data.title).toBe('Test Article');
      expect(data.category).toBe('getting-started');
      expect(data.summary).toBe('A brief summary');
    });

    it('parses order as a number', () => {
      const raw = makeFrontmatter({ order: '3' });
      const { data } = parseHelpFrontmatter(raw);
      expect(data.order).toBe(3);
    });

    it('parses audience as an array of strings', () => {
      const raw = makeFrontmatter({ audience: '["owner", "chef", "manager"]' });
      const { data } = parseHelpFrontmatter(raw);
      expect(data.audience).toEqual(['owner', 'chef', 'manager']);
    });

    it('parses keywords as an array of strings', () => {
      const raw = makeFrontmatter({ keywords: '["inventory", "recipe", "count"]' });
      const { data } = parseHelpFrontmatter(raw);
      expect(data.keywords).toEqual(['inventory', 'recipe', 'count']);
    });

    it('parses related as an array of strings', () => {
      const raw = makeFrontmatter({ related: '["connect-pos", "import-csv"]' });
      const { data } = parseHelpFrontmatter(raw);
      expect(data.related).toEqual(['connect-pos', 'import-csv']);
    });

    it('extracts the body after the closing ---', () => {
      const raw = `---\ntitle: "Hello"\ncategory: "foo"\nsummary: "bar"\naudience: []\norder: 1\nkeywords: []\nrelated: []\n---\n\n## Heading\n\nParagraph text.`;
      const { body } = parseHelpFrontmatter(raw);
      expect(body).toContain('## Heading');
      expect(body).toContain('Paragraph text.');
    });

    it('trims leading/trailing whitespace from the body', () => {
      const raw = `---\ntitle: "T"\ncategory: "c"\nsummary: "s"\naudience: []\norder: 1\nkeywords: []\nrelated: []\n---\n\n\n  body content  \n\n`;
      const { body } = parseHelpFrontmatter(raw);
      expect(body).toBe('body content');
    });
  });

  // ---------------------------------------------------------------------------
  // Empty arrays
  // ---------------------------------------------------------------------------

  describe('empty arrays', () => {
    it('parses [] for audience as an empty array', () => {
      const raw = makeFrontmatter({ audience: '[]' });
      const { data } = parseHelpFrontmatter(raw);
      expect(data.audience).toEqual([]);
    });

    it('parses [] for keywords as an empty array', () => {
      const raw = makeFrontmatter({ keywords: '[]' });
      const { data } = parseHelpFrontmatter(raw);
      expect(data.keywords).toEqual([]);
    });

    it('parses [] for related as an empty array', () => {
      const raw = makeFrontmatter({ related: '[]' });
      const { data } = parseHelpFrontmatter(raw);
      expect(data.related).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Bare vs quoted string values
  // ---------------------------------------------------------------------------

  describe('bare vs quoted string values', () => {
    it('parses a bare (unquoted) title', () => {
      const raw = `---\ntitle: My Bare Title\ncategory: "cat"\nsummary: "s"\naudience: []\norder: 1\nkeywords: []\nrelated: []\n---\nbody`;
      const { data } = parseHelpFrontmatter(raw);
      expect(data.title).toBe('My Bare Title');
    });

    it('parses a double-quoted title, stripping the quotes', () => {
      const raw = makeFrontmatter({ title: '"Quoted Title"' });
      const { data } = parseHelpFrontmatter(raw);
      expect(data.title).toBe('Quoted Title');
    });

    it('handles colons inside a double-quoted value', () => {
      const raw = `---\ntitle: "Hello: World"\ncategory: "cat"\nsummary: "s"\naudience: []\norder: 1\nkeywords: []\nrelated: []\n---\nbody`;
      const { data } = parseHelpFrontmatter(raw);
      // The value is everything after the FIRST colon, so inner colons are
      // preserved; only the surrounding quotes are stripped.
      expect(data.title).toBe('Hello: World');
    });

    it('parses a bare summary without quotes', () => {
      const raw = `---\ntitle: T\ncategory: cat\nsummary: Plain bare summary\naudience: []\norder: 1\nkeywords: []\nrelated: []\n---\nbody`;
      const { data } = parseHelpFrontmatter(raw);
      expect(data.summary).toBe('Plain bare summary');
    });
  });

  // ---------------------------------------------------------------------------
  // Missing fields — assert the defaults
  // ---------------------------------------------------------------------------

  describe('missing fields — defaults', () => {
    const MINIMAL_RAW = `---\ntitle: "Only Title"\n---\nbody text`;

    it('defaults category to empty string', () => {
      const { data } = parseHelpFrontmatter(MINIMAL_RAW);
      expect(data.category).toBe('');
    });

    it('defaults summary to empty string', () => {
      const { data } = parseHelpFrontmatter(MINIMAL_RAW);
      expect(data.summary).toBe('');
    });

    it('defaults order to 999', () => {
      const { data } = parseHelpFrontmatter(MINIMAL_RAW);
      expect(data.order).toBe(999);
    });

    it('defaults audience to []', () => {
      const { data } = parseHelpFrontmatter(MINIMAL_RAW);
      expect(data.audience).toEqual([]);
    });

    it('defaults keywords to []', () => {
      const { data } = parseHelpFrontmatter(MINIMAL_RAW);
      expect(data.keywords).toEqual([]);
    });

    it('defaults related to []', () => {
      const { data } = parseHelpFrontmatter(MINIMAL_RAW);
      expect(data.related).toEqual([]);
    });

    it('still returns the body when fields are missing', () => {
      const { body } = parseHelpFrontmatter(MINIMAL_RAW);
      expect(body).toBe('body text');
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-line body with markdown headings
  // ---------------------------------------------------------------------------

  describe('multi-line body with markdown headings', () => {
    const MD_BODY = [
      '---',
      'title: "Rich Article"',
      'category: "payroll-and-tips"',
      'summary: "Covers wages and tips"',
      'audience: ["manager"]',
      'order: 2',
      'keywords: ["wage", "tip"]',
      'related: []',
      '---',
      '',
      '## Introduction',
      '',
      'Some introductory paragraph.',
      '',
      '## Details',
      '',
      '- Point one',
      '- Point two',
    ].join('\n');

    it('includes all heading levels in body', () => {
      const { body } = parseHelpFrontmatter(MD_BODY);
      expect(body).toContain('## Introduction');
      expect(body).toContain('## Details');
    });

    it('includes bullet points in body', () => {
      const { body } = parseHelpFrontmatter(MD_BODY);
      expect(body).toContain('- Point one');
      expect(body).toContain('- Point two');
    });

    it('does not include any frontmatter key in the body', () => {
      const { body } = parseHelpFrontmatter(MD_BODY);
      expect(body).not.toContain('title:');
      expect(body).not.toContain('category:');
    });

    it('parses frontmatter fields correctly alongside rich body', () => {
      const { data } = parseHelpFrontmatter(MD_BODY);
      expect(data.title).toBe('Rich Article');
      expect(data.keywords).toEqual(['wage', 'tip']);
    });
  });

  // ---------------------------------------------------------------------------
  // Input with NO frontmatter block
  // ---------------------------------------------------------------------------

  describe('input with no frontmatter block', () => {
    it('returns the entire input as the body', () => {
      const raw = '## Just a heading\n\nSome content.';
      const { body } = parseHelpFrontmatter(raw);
      expect(body).toContain('Just a heading');
      expect(body).toContain('Some content.');
    });

    it('returns all default data values', () => {
      const raw = 'No frontmatter at all.';
      const { data } = parseHelpFrontmatter(raw);
      expect(data.title).toBe('');
      expect(data.category).toBe('');
      expect(data.summary).toBe('');
      expect(data.order).toBe(999);
      expect(data.audience).toEqual([]);
      expect(data.keywords).toEqual([]);
      expect(data.related).toEqual([]);
    });

    it('handles an empty string input gracefully', () => {
      const { data, body } = parseHelpFrontmatter('');
      expect(body).toBe('');
      expect(data.title).toBe('');
      expect(data.order).toBe(999);
    });
  });

  // ---------------------------------------------------------------------------
  // Malformed / edge-case frontmatter
  // ---------------------------------------------------------------------------

  describe('malformed / edge-case frontmatter', () => {
    it('treats whole input as body when closing --- is missing', () => {
      const raw = '---\ntitle: "No Closing"\ncategory: "x"\n';
      const { data, body } = parseHelpFrontmatter(raw);
      expect(data.title).toBe('');
      expect(body.length).toBeGreaterThan(0);
    });

    it('defaults order to 999 when order value is not a number', () => {
      const raw = makeFrontmatter({ order: '"not-a-number"' });
      const { data } = parseHelpFrontmatter(raw);
      expect(data.order).toBe(999);
    });

    it('ignores unknown frontmatter keys without throwing', () => {
      const raw = `---\ntitle: "T"\ncategory: "c"\nsummary: "s"\naudience: []\norder: 1\nkeywords: []\nrelated: []\nunknown_key: "ignored"\n---\nbody`;
      expect(() => parseHelpFrontmatter(raw)).not.toThrow();
    });

    it('handles an array with single-quoted items', () => {
      const raw = `---\ntitle: "T"\ncategory: "c"\nsummary: "s"\naudience: ['owner', 'staff']\norder: 1\nkeywords: []\nrelated: []\n---\nbody`;
      const { data } = parseHelpFrontmatter(raw);
      expect(data.audience).toEqual(['owner', 'staff']);
    });

    it('handles array items without any quotes', () => {
      const raw = `---\ntitle: "T"\ncategory: "c"\nsummary: "s"\naudience: [owner, staff]\norder: 1\nkeywords: []\nrelated: []\n---\nbody`;
      const { data } = parseHelpFrontmatter(raw);
      expect(data.audience).toEqual(['owner', 'staff']);
    });
  });

  // ---------------------------------------------------------------------------
  // Return shape invariants
  // ---------------------------------------------------------------------------

  describe('return shape invariants', () => {
    it('always returns an object with exactly { data, body }', () => {
      const result = parseHelpFrontmatter(makeFrontmatter());
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('body');
    });

    it('data always has all required HelpFrontmatter keys', () => {
      const { data } = parseHelpFrontmatter('no frontmatter');
      const requiredKeys: (keyof HelpFrontmatter)[] = [
        'title',
        'category',
        'summary',
        'audience',
        'order',
        'keywords',
        'related',
      ];
      for (const key of requiredKeys) {
        expect(data).toHaveProperty(key);
      }
    });

    it('is deterministic — same input always produces the same output', () => {
      const raw = makeFrontmatter();
      const r1 = parseHelpFrontmatter(raw);
      const r2 = parseHelpFrontmatter(raw);
      expect(r1).toEqual(r2);
    });
  });
});

// ---------------------------------------------------------------------------
// HELP_CATEGORIES static data
// ---------------------------------------------------------------------------

describe('HELP_CATEGORIES', () => {
  it('contains exactly 8 categories', () => {
    expect(HELP_CATEGORIES).toHaveLength(8);
  });

  it('every category has the required shape', () => {
    for (const cat of HELP_CATEGORIES) {
      expect(typeof cat.slug).toBe('string');
      expect(cat.slug.length).toBeGreaterThan(0);
      expect(typeof cat.title).toBe('string');
      expect(typeof cat.description).toBe('string');
      expect(typeof cat.icon).toBe('string');
      expect(typeof cat.order).toBe('number');
    }
  });

  it('slugs are unique', () => {
    const slugs = HELP_CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('is sorted by order (ascending)', () => {
    const orders = HELP_CATEGORIES.map((c) => c.order);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]);
    }
  });

  it('contains the expected slugs', () => {
    const slugs = HELP_CATEGORIES.map((c) => c.slug);
    expect(slugs).toContain('getting-started');
    expect(slugs).toContain('pos-and-sales');
    expect(slugs).toContain('inventory-and-recipes');
    expect(slugs).toContain('financials-and-accounting');
    expect(slugs).toContain('payroll-and-tips');
    expect(slugs).toContain('scheduling-and-time');
    expect(slugs).toContain('employee-self-service');
    expect(slugs).toContain('settings-and-integrations');
  });

  it('first category is "getting-started" with order 10', () => {
    const first = HELP_CATEGORIES[0];
    expect(first.slug).toBe('getting-started');
    expect(first.order).toBe(10);
  });

  it('last category is "settings-and-integrations" with order 80', () => {
    const last = HELP_CATEGORIES[HELP_CATEGORIES.length - 1];
    expect(last.slug).toBe('settings-and-integrations');
    expect(last.order).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// getCategory
// ---------------------------------------------------------------------------

describe('getCategory', () => {
  it('returns the matching category for a valid slug', () => {
    const cat = getCategory('payroll-and-tips');
    expect(cat).toBeDefined();
    expect(cat?.slug).toBe('payroll-and-tips');
    expect(cat?.title).toBe('Payroll & Tips');
  });

  it('returns undefined for an unknown slug', () => {
    expect(getCategory('does-not-exist')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(getCategory('')).toBeUndefined();
  });

  it('is case-sensitive (no partial matches)', () => {
    expect(getCategory('Payroll-and-Tips')).toBeUndefined();
    expect(getCategory('payroll')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// searchHelpArticles — tested via injected pure helper
// (We replicate the search logic independently to avoid import.meta.glob)
// ---------------------------------------------------------------------------

/**
 * A self-contained replica of the search logic from helpContent.ts,
 * accepting an explicit article list so we can test it without import.meta.glob.
 */
function searchArticles(articles: HelpArticle[], query: string): HelpArticle[] {
  const trimmed = query.trim();
  if (trimmed === '') return articles;

  const terms = trimmed.toLowerCase().split(/\s+/);

  return articles.filter((article) => {
    const haystack = [
      article.title,
      article.summary,
      article.keywords.join(' '),
      article.body,
    ]
      .join(' ')
      .toLowerCase();

    return terms.some((term) => haystack.includes(term));
  });
}

const SAMPLE_ARTICLES: HelpArticle[] = [
  {
    slug: 'connect-square',
    title: 'Connect Square POS',
    category: 'pos-and-sales',
    summary: 'Link your Square account to sync sales data automatically.',
    audience: ['owner'],
    order: 1,
    keywords: ['square', 'pos', 'integration'],
    related: ['import-csv'],
    body: 'Step-by-step guide to connect Square.',
  },
  {
    slug: 'run-inventory-count',
    title: 'Run an Inventory Count',
    category: 'inventory-and-recipes',
    summary: 'Count your stock and reconcile discrepancies.',
    audience: ['manager', 'chef'],
    order: 2,
    keywords: ['inventory', 'count', 'stock'],
    related: [],
    body: 'Open the Inventory page and tap Start Count.',
  },
  {
    slug: 'manage-tip-pools',
    title: 'Manage Tip Pools',
    category: 'payroll-and-tips',
    summary: 'Create tip pools and configure distribution rules.',
    audience: ['owner', 'manager'],
    order: 1,
    keywords: ['tips', 'payroll', 'distribution'],
    related: ['export-payroll'],
    body: 'Navigate to Payroll > Tip Pools to get started.',
  },
];

describe('searchHelpArticles (pure logic via injected data)', () => {
  it('returns all articles for an empty query', () => {
    expect(searchArticles(SAMPLE_ARTICLES, '')).toHaveLength(3);
  });

  it('returns all articles for a whitespace-only query', () => {
    expect(searchArticles(SAMPLE_ARTICLES, '   ')).toHaveLength(3);
  });

  it('matches by title (case-insensitive)', () => {
    const results = searchArticles(SAMPLE_ARTICLES, 'SQUARE');
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe('connect-square');
  });

  it('matches by summary', () => {
    const results = searchArticles(SAMPLE_ARTICLES, 'reconcile');
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe('run-inventory-count');
  });

  it('matches by keyword', () => {
    const results = searchArticles(SAMPLE_ARTICLES, 'distribution');
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe('manage-tip-pools');
  });

  it('matches by body text', () => {
    const results = searchArticles(SAMPLE_ARTICLES, 'Payroll > Tip');
    // "payroll" appears as a keyword in the tips article AND "payroll" is in the body;
    // "tip" also appears in the title and body of manage-tip-pools.
    // ">" doesn't match anything — but ANY term matches, so we get at least 1 result.
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.slug === 'manage-tip-pools')).toBe(true);
  });

  it('is case-insensitive for multi-word queries', () => {
    // ANY-term matching: "Inventory" OR "Count".
    // "count" is a substring of "connect" (in connect-square), so both
    // connect-square and run-inventory-count match.
    const results = searchArticles(SAMPLE_ARTICLES, 'Inventory Count');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.slug === 'run-inventory-count')).toBe(true);
  });

  it('returns multiple articles when a term matches several', () => {
    // "count" is a substring of "connect" (connect-square body/title) AND
    // appears explicitly in run-inventory-count, so 2 articles match.
    // manage-tip-pools does NOT contain "count".
    const results = searchArticles(SAMPLE_ARTICLES, 'count');
    expect(results).toHaveLength(2);
    expect(results.some((r) => r.slug === 'run-inventory-count')).toBe(true);
    expect(results.some((r) => r.slug === 'connect-square')).toBe(true);
  });

  it('uses ANY-term matching: returns article if any term matches', () => {
    // "square xyz_no_match" — "square" matches connect-square, "xyz_no_match" matches nothing
    const results = searchArticles(SAMPLE_ARTICLES, 'square xyz_no_match');
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe('connect-square');
  });

  it('returns empty array when no articles match', () => {
    const results = searchArticles(SAMPLE_ARTICLES, 'zzz_nonexistent_term_xyz');
    expect(results).toHaveLength(0);
  });

  it('preserves sorted order of results', () => {
    // An empty query returns all in insertion order (which mirrors the sorted helpArticles)
    const results = searchArticles(SAMPLE_ARTICLES, '');
    expect(results.map((r) => r.slug)).toEqual([
      'connect-square',
      'run-inventory-count',
      'manage-tip-pools',
    ]);
  });
});

// ---------------------------------------------------------------------------
// getArticlesByCategory — tested via injected pure helper
// ---------------------------------------------------------------------------

function articlesByCategory(articles: HelpArticle[], categorySlug: string): HelpArticle[] {
  return articles.filter((a) => a.category === categorySlug);
}

describe('getArticlesByCategory (pure logic via injected data)', () => {
  it('returns articles that belong to the given category', () => {
    const results = articlesByCategory(SAMPLE_ARTICLES, 'pos-and-sales');
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe('connect-square');
  });

  it('returns multiple articles for a category with several articles', () => {
    const extended = [
      ...SAMPLE_ARTICLES,
      {
        ...SAMPLE_ARTICLES[0],
        slug: 'connect-clover',
        title: 'Connect Clover POS',
      },
    ];
    const results = articlesByCategory(extended, 'pos-and-sales');
    expect(results).toHaveLength(2);
  });

  it('returns an empty array for an unknown category', () => {
    expect(articlesByCategory(SAMPLE_ARTICLES, 'does-not-exist')).toEqual([]);
  });

  it('is case-sensitive', () => {
    expect(articlesByCategory(SAMPLE_ARTICLES, 'POS-AND-SALES')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getArticleBySlug — tested via injected pure helper
// ---------------------------------------------------------------------------

function articleBySlug(articles: HelpArticle[], slug: string): HelpArticle | undefined {
  return articles.find((a) => a.slug === slug);
}

describe('getArticleBySlug (pure logic via injected data)', () => {
  it('returns the matching article', () => {
    const result = articleBySlug(SAMPLE_ARTICLES, 'manage-tip-pools');
    expect(result).toBeDefined();
    expect(result?.title).toBe('Manage Tip Pools');
  });

  it('returns undefined for an unknown slug', () => {
    expect(articleBySlug(SAMPLE_ARTICLES, 'unknown-slug')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(articleBySlug(SAMPLE_ARTICLES, '')).toBeUndefined();
  });

  it('is case-sensitive', () => {
    expect(articleBySlug(SAMPLE_ARTICLES, 'Manage-Tip-Pools')).toBeUndefined();
  });
});

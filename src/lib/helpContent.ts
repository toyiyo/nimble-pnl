/**
 * Help Center content loader for EasyShiftHQ.
 *
 * Markdown files live under /src/content/help/**\/*.md and are loaded at
 * build-time via Vite's import.meta.glob. Each file must start with a
 * YAML-like frontmatter block delimited by "---" lines.
 *
 * parseHelpFrontmatter is a pure function (no import.meta) so it can be unit-tested.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HelpFrontmatter {
  title: string;
  category: string;
  summary: string;
  audience: string[];
  order: number;
  keywords: string[];
  related: string[];
}

export interface HelpArticle extends HelpFrontmatter {
  slug: string;
  body: string;
}

export interface HelpCategory {
  slug: string;
  title: string;
  description: string;
  icon: string;
  order: number;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    description: 'Account creation, sign-in, team setup, roles, and subscription plans.',
    icon: 'Rocket',
    order: 10,
  },
  {
    slug: 'pos-and-sales',
    title: 'POS & Sales',
    description:
      'Connect point-of-sale systems, sync sales data, import CSVs, and categorize revenue.',
    icon: 'ShoppingCart',
    order: 20,
  },
  {
    slug: 'inventory-and-recipes',
    title: 'Inventory & Recipes',
    description:
      'Manage products, scan barcodes, run counts, build recipes, and create purchase orders.',
    icon: 'Package',
    order: 30,
  },
  {
    slug: 'financials-and-accounting',
    title: 'Financials & Accounting',
    description:
      'Bank connections, transactions, financial statements, budgets, assets, invoices, and the chart of accounts.',
    icon: 'Wallet',
    order: 40,
  },
  {
    slug: 'payroll-and-tips',
    title: 'Payroll & Tips',
    description: 'Calculate wages, manage tip pools, approve splits, and export payroll.',
    icon: 'Coins',
    order: 50,
  },
  {
    slug: 'scheduling-and-time',
    title: 'Scheduling & Time',
    description:
      'Build weekly schedules, manage shifts, track time punches, and handle availability.',
    icon: 'CalendarCheck',
    order: 60,
  },
  {
    slug: 'employee-self-service',
    title: 'Employee Self-Service',
    description:
      'Clock in, view pay and tips, check schedules, request time off, and manage your kiosk PIN.',
    icon: 'Smartphone',
    order: 70,
  },
  {
    slug: 'settings-and-integrations',
    title: 'Settings & Integrations',
    description:
      'Restaurant profile, payroll rules, POS and scheduling integrations, and the AI Chef Assistant.',
    icon: 'Settings',
    order: 80,
  },
];

// ---------------------------------------------------------------------------
// Pure frontmatter parser (no import.meta — fully unit-testable)
// ---------------------------------------------------------------------------

/**
 * Parse an inline array token such as `["a","b"]` or `['a', 'b']` or `[]`.
 * Returns an empty array when the token is not array-shaped.
 */
function parseInlineArray(token: string): string[] {
  const trimmed = token.trim();
  // Must start with '[' and end with ']'
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];

  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') return [];

  // Split on commas, strip surrounding whitespace and quotes from each element
  return inner.split(',').map((item) => {
    return item.trim().replace(/^["']|["']$/g, '');
  });
}

const DEFAULT_FRONTMATTER: HelpFrontmatter = {
  title: '',
  category: '',
  summary: '',
  audience: [],
  order: 999,
  keywords: [],
  related: [],
};

/**
 * Pure, deterministic frontmatter parser.
 *
 * Supports:
 *   - String values: bare or double-quoted
 *   - Number values (order)
 *   - Inline array values: ["a","b"] / ['a', 'b'] / []
 *   - Graceful defaults for missing / malformed fields
 */
export function parseHelpFrontmatter(raw: string): { data: HelpFrontmatter; body: string } {
  const lines = raw.split('\n');

  // Frontmatter must start on line 0 with exactly "---"
  if (lines[0]?.trim() !== '---') {
    return { data: { ...DEFAULT_FRONTMATTER }, body: raw.trim() };
  }

  // Find the closing "---"
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    // No closing delimiter found — treat whole input as body
    return { data: { ...DEFAULT_FRONTMATTER }, body: raw.trim() };
  }

  const frontmatterLines = lines.slice(1, closingIndex);
  const bodyLines = lines.slice(closingIndex + 1);
  const body = bodyLines.join('\n').trim();

  const data: HelpFrontmatter = { ...DEFAULT_FRONTMATTER };

  for (const line of frontmatterLines) {
    // Each line is expected to be:  key: value
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    switch (key) {
      case 'title':
      case 'category':
      case 'summary':
        // Strip surrounding double-quotes if present
        data[key] = rawValue.replace(/^"|"$/g, '');
        break;

      case 'order': {
        const parsed = parseInt(rawValue, 10);
        data.order = isNaN(parsed) ? 999 : parsed;
        break;
      }

      case 'audience':
      case 'keywords':
      case 'related':
        data[key] = parseInlineArray(rawValue);
        break;

      default:
        // Unknown keys are intentionally ignored
        break;
    }
  }

  return { data, body };
}

// ---------------------------------------------------------------------------
// Glob-based article loader
// ---------------------------------------------------------------------------

const modules = import.meta.glob('/src/content/help/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Derive the article slug from a file path like
 * "/src/content/help/getting-started/overview.md" → "overview"
 */
function slugFromPath(filePath: string): string {
  const parts = filePath.split('/');
  const filename = parts[parts.length - 1] ?? '';
  return filename.replace(/\.md$/, '');
}

/**
 * Return the numeric order of a category by its slug.
 * Unknown categories fall back to a high number so they sort last.
 */
function categoryOrder(categorySlug: string): number {
  return HELP_CATEGORIES.find((c) => c.slug === categorySlug)?.order ?? Number.MAX_SAFE_INTEGER;
}

function buildArticles(): HelpArticle[] {
  const articles: HelpArticle[] = Object.entries(modules).map(([filePath, raw]) => {
    const slug = slugFromPath(filePath);
    const { data, body } = parseHelpFrontmatter(raw);
    return { slug, body, ...data };
  });

  // Sort: category order → article.order → title (lexicographic, case-insensitive)
  articles.sort((a, b) => {
    const catDiff = categoryOrder(a.category) - categoryOrder(b.category);
    if (catDiff !== 0) return catDiff;

    const orderDiff = a.order - b.order;
    if (orderDiff !== 0) return orderDiff;

    return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
  });

  return articles;
}

export const helpArticles: HelpArticle[] = buildArticles();

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function getArticleBySlug(slug: string): HelpArticle | undefined {
  return helpArticles.find((a) => a.slug === slug);
}

export function getArticlesByCategory(categorySlug: string): HelpArticle[] {
  return helpArticles.filter((a) => a.category === categorySlug);
}

export function getCategory(slug: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find((c) => c.slug === slug);
}

/**
 * Case-insensitive full-text search over title, summary, keywords, and body.
 *
 * - An empty / whitespace-only query returns all articles (sorted).
 * - Multiple terms are split on whitespace; an article matches if ANY term
 *   appears as a substring anywhere in the searchable text.
 */
export function searchHelpArticles(query: string): HelpArticle[] {
  const trimmed = query.trim();
  if (trimmed === '') return helpArticles;

  const terms = trimmed.toLowerCase().split(/\s+/);

  return helpArticles.filter((article) => {
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

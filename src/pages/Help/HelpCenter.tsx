import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Rocket,
  ShoppingCart,
  Package,
  Wallet,
  Coins,
  CalendarCheck,
  Smartphone,
  Settings,
  Search,
  LifeBuoy,
  type LucideIcon,
} from 'lucide-react';

import { Input } from '@/components/ui/input';

import {
  HELP_CATEGORIES,
  helpArticles,
  getArticlesByCategory,
  searchHelpArticles,
  type HelpArticle,
  type HelpCategory,
} from '@/lib/helpContent';

// ----------------------------------------------------------------
// Icon registry — maps category icon names to Lucide components
// ----------------------------------------------------------------
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Rocket,
  ShoppingCart,
  Package,
  Wallet,
  Coins,
  CalendarCheck,
  Smartphone,
  Settings,
};

// ----------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------

interface ArticleCardProps {
  article: HelpArticle;
}

function ArticleCard({ article }: ArticleCardProps) {
  return (
    <Link
      to={`/help/${article.slug}`}
      className="group flex flex-col gap-1.5 p-4 rounded-xl border border-border/40 bg-background hover:border-border hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-[14px] font-medium text-foreground group-hover:text-foreground/80 transition-colors">
        {article.title}
      </span>
      <span className="text-[13px] text-muted-foreground line-clamp-2 leading-relaxed">
        {article.summary}
      </span>
    </Link>
  );
}

interface CategorySectionProps {
  category: HelpCategory;
  articles: HelpArticle[];
}

function CategorySection({ category, articles }: CategorySectionProps) {
  const Icon = CATEGORY_ICONS[category.icon] ?? Settings;

  if (articles.length === 0) return null;

  return (
    <section aria-labelledby={`cat-${category.slug}`}>
      <div className="flex items-start gap-3 mb-4">
        <div className="h-9 w-9 rounded-xl bg-muted/50 flex items-center justify-center shrink-0 mt-0.5">
          <Icon className="h-[18px] w-[18px] text-foreground" aria-hidden="true" />
        </div>
        <div>
          <h2
            id={`cat-${category.slug}`}
            className="text-[15px] font-semibold text-foreground"
          >
            {category.title}
          </h2>
          <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">
            {category.description}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {articles.map((article) => (
          <ArticleCard key={article.slug} article={article} />
        ))}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------
// Search results flat list
// ----------------------------------------------------------------

interface SearchResultsProps {
  articles: HelpArticle[];
  query: string;
}

function SearchResults({ articles, query }: SearchResultsProps) {
  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
          <Search className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="text-[15px] font-medium text-foreground">No results for &ldquo;{query}&rdquo;</p>
        <p className="text-[13px] text-muted-foreground max-w-xs">
          Try a different keyword, or browse the categories below.
        </p>
      </div>
    );
  }

  return (
    <section aria-label={`Search results for ${query}`}>
      <p className="text-[13px] text-muted-foreground mb-4">
        {articles.length} result{articles.length !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {articles.map((article) => (
          <ArticleCard key={article.slug} article={article} />
        ))}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------
// Main page
// ----------------------------------------------------------------

export default function HelpCenter() {
  const [query, setQuery] = useState('');

  const searchResults = query.trim().length > 0 ? searchHelpArticles(query.trim()) : [];
  const isSearching = query.trim().length > 0;

  return (
    <div className="min-h-screen bg-background">
      {/* ---- Page header ---- */}
      <div className="border-b border-border/40 bg-muted/20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          <div className="flex items-center gap-3 mb-2">
            <LifeBuoy className="h-6 w-6 text-foreground" aria-hidden="true" />
            <h1 className="text-[17px] font-semibold text-foreground">Help Center</h1>
          </div>
          <p className="text-[14px] text-muted-foreground mb-6">
            Guides and answers for every part of EasyShiftHQ.
          </p>

          {/* Search */}
          <div className="relative max-w-xl">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <Input
              id="help-search"
              type="search"
              aria-label="Search help articles"
              placeholder="Search articles…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 h-10 text-[14px] bg-background border-border/60 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>
        </div>
      </div>

      {/* ---- Main content ---- */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-10">
        {isSearching ? (
          <SearchResults articles={searchResults} query={query.trim()} />
        ) : (
          <>
            {/* Categories */}
            {HELP_CATEGORIES.map((cat) => {
              const articles = getArticlesByCategory(cat.slug);
              return (
                <CategorySection key={cat.slug} category={cat} articles={articles} />
              );
            })}

            {/* No articles in any category (edge case) */}
            {helpArticles.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
                  <LifeBuoy className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                </div>
                <p className="text-[15px] font-medium text-foreground">No articles yet</p>
                <p className="text-[13px] text-muted-foreground">
                  Check back soon — content is on its way.
                </p>
              </div>
            )}
          </>
        )}

        {/* ---- Footer callout (hidden while searching) ---- */}
        {!isSearching && (
        <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[14px] font-medium text-foreground">Payroll calculations</p>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Understand exactly how wages, salary, and overtime are computed.
              </p>
            </div>
            <Link
              to="/help/payroll-calculations"
              className="shrink-0 h-9 px-4 inline-flex items-center rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Read the guide
            </Link>
          </div>
        </div>
        )}
      </main>
    </div>
  );
}

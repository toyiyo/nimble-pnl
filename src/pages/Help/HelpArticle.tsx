import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronRight, LifeBuoy, ArrowLeft } from 'lucide-react';
import type { Components } from 'react-markdown';

import {
  getArticleBySlug,
  getCategory,
} from '@/lib/helpContent';

// ----------------------------------------------------------------
// Markdown component map — explicit token-based styling, no prose plugin
// ----------------------------------------------------------------
function buildComponents(): Components {
  return {
    h1: ({ children, ...props }) => (
      <h1
        className="text-[22px] font-semibold text-foreground leading-snug mt-8 mb-3 first:mt-0"
        {...props}
      >
        {children}
      </h1>
    ),
    h2: ({ children, ...props }) => (
      <h2
        className="text-[18px] font-semibold text-foreground leading-snug mt-7 mb-2.5"
        {...props}
      >
        {children}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3
        className="text-[15px] font-semibold text-foreground leading-snug mt-5 mb-2"
        {...props}
      >
        {children}
      </h3>
    ),
    p: ({ children, ...props }) => (
      <p className="text-[14px] text-foreground leading-relaxed mb-4" {...props}>
        {children}
      </p>
    ),
    ul: ({ children, ...props }) => (
      <ul
        className="list-disc list-outside pl-5 space-y-1.5 mb-4 text-[14px] text-foreground"
        {...props}
      >
        {children}
      </ul>
    ),
    ol: ({ children, ...props }) => (
      <ol
        className="list-decimal list-outside pl-5 space-y-1.5 mb-4 text-[14px] text-foreground"
        {...props}
      >
        {children}
      </ol>
    ),
    li: ({ children, ...props }) => (
      <li className="leading-relaxed" {...props}>
        {children}
      </li>
    ),
    a: ({ href, children, ...props }) => {
      const isInternal = href && href.startsWith('/');
      if (isInternal) {
        return (
          <Link
            to={href}
            className="text-foreground underline underline-offset-2 decoration-border/60 hover:decoration-foreground transition-colors"
          >
            {children}
          </Link>
        );
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline underline-offset-2 decoration-border/60 hover:decoration-foreground transition-colors"
          {...props}
        >
          {children}
        </a>
      );
    },
    code: ({ className, children, ...props }) => {
      // react-markdown v10 removed the `inline` prop. A fenced code block is
      // signalled by a `language-*` className OR by spanning multiple lines;
      // anything else is treated as inline code.
      const text = String(children ?? '');
      const isBlock = (className?.includes('language-') ?? false) || text.includes('\n');
      if (isBlock) {
        return (
          <code
            className="block text-[13px] font-mono leading-relaxed"
            {...props}
          >
            {children}
          </code>
        );
      }
      return (
        <code
          className="text-[13px] font-mono px-1.5 py-0.5 rounded-md bg-muted text-foreground"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre: ({ children, ...props }) => (
      <pre
        className="rounded-xl border border-border/40 bg-muted/40 px-4 py-4 overflow-x-auto mb-5 text-[13px] font-mono"
        {...props}
      >
        {children}
      </pre>
    ),
    blockquote: ({ children, ...props }) => (
      <blockquote
        className="border-l-2 border-border pl-4 my-4 text-[14px] text-muted-foreground italic"
        {...props}
      >
        {children}
      </blockquote>
    ),
    table: ({ children, ...props }) => (
      <div className="overflow-x-auto mb-5 rounded-xl border border-border/40">
        <table className="w-full text-[13px]" {...props}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children, ...props }) => (
      <thead className="bg-muted/50" {...props}>
        {children}
      </thead>
    ),
    tbody: ({ children, ...props }) => (
      <tbody className="divide-y divide-border/40" {...props}>
        {children}
      </tbody>
    ),
    tr: ({ children, ...props }) => (
      <tr className="hover:bg-muted/30 transition-colors" {...props}>
        {children}
      </tr>
    ),
    th: ({ children, ...props }) => (
      <th
        className="text-left px-4 py-2.5 text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
        {...props}
      >
        {children}
      </th>
    ),
    td: ({ children, ...props }) => (
      <td className="px-4 py-2.5 text-foreground" {...props}>
        {children}
      </td>
    ),
  };
}

// ----------------------------------------------------------------
// Main page
// ----------------------------------------------------------------

export default function HelpArticle() {
  const { slug } = useParams<{ slug: string }>();
  const article = slug ? getArticleBySlug(slug) : undefined;
  const category = article ? getCategory(article.category) : undefined;
  const components = useMemo(() => buildComponents(), []);

  // ---- Not found state ----
  if (!article) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
        <div className="h-14 w-14 rounded-full bg-muted/50 flex items-center justify-center">
          <LifeBuoy className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        </div>
        <h1 className="text-[17px] font-semibold text-foreground">Article not found</h1>
        <p className="text-[14px] text-muted-foreground text-center max-w-xs">
          We couldn&apos;t find that article. It may have been moved or the link may be incorrect.
        </p>
        <Link
          to="/help"
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to Help Center
        </Link>
      </div>
    );
  }

  // Resolve related articles (skip unknowns)
  const relatedArticles = (article.related ?? [])
    .map((s) => getArticleBySlug(s))
    .filter((a): a is NonNullable<typeof a> => a !== undefined);

  return (
    <div className="min-h-screen bg-background">
      {/* ---- Top nav strip ---- */}
      <div className="border-b border-border/40 bg-muted/20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-1 flex-wrap text-[13px] text-muted-foreground">
              <li>
                <Link
                  to="/help"
                  className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                >
                  Help
                </Link>
              </li>
              {category && (
                <>
                  <li aria-hidden="true">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  </li>
                  <li>
                    <span className="text-muted-foreground">{category.title}</span>
                  </li>
                </>
              )}
              <li aria-hidden="true">
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              </li>
              <li>
                <span className="text-foreground font-medium" aria-current="page">
                  {article.title}
                </span>
              </li>
            </ol>
          </nav>
        </div>
      </div>

      {/* ---- Article body ---- */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Article header */}
        <header className="mb-8">
          <h1
            id="article-title"
            className="text-[22px] font-semibold text-foreground leading-snug mb-2"
          >
            {article.title}
          </h1>
          <p className="text-[14px] text-muted-foreground leading-relaxed">
            {article.summary}
          </p>
        </header>

        {/* Markdown content */}
        <article aria-labelledby="article-title">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {article.body}
          </ReactMarkdown>
        </article>

        {/* ---- Related articles ---- */}
        {relatedArticles.length > 0 && (
          <section className="mt-10 pt-8 border-t border-border/40" aria-labelledby="related-heading">
            <h2
              id="related-heading"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-4"
            >
              Related articles
            </h2>
            <ul className="space-y-2">
              {relatedArticles.map((related) => (
                <li key={related.slug}>
                  <Link
                    to={`/help/${related.slug}`}
                    className="group flex items-center justify-between p-4 rounded-xl border border-border/40 bg-background hover:border-border hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div>
                      <span className="text-[14px] font-medium text-foreground group-hover:text-foreground/80 transition-colors">
                        {related.title}
                      </span>
                      <p className="text-[13px] text-muted-foreground mt-0.5 line-clamp-1">
                        {related.summary}
                      </p>
                    </div>
                    <ChevronRight
                      className="h-4 w-4 text-muted-foreground shrink-0 ml-3 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---- Back link ---- */}
        <div className="mt-10 pt-6 border-t border-border/40">
          <Link
            to="/help"
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to Help Center
          </Link>
        </div>
      </main>
    </div>
  );
}

import type { BalanceState, LaborPnlSummary } from '@/lib/laborPnlAnalytics';

interface LaborVerdictProps {
  /**
   * `null`/`undefined` are accepted defensively (e.g. a page mounting this
   * before its summary hook has produced a value) even though
   * `summarizeLaborPnl` (design §5) always returns a valid object — never
   * `undefined` — once its owning hook (`useLaborPnlSummary` /
   * `useLaborPnlAnalytics`) has mounted.
   */
  readonly summary: LaborPnlSummary | null | undefined;
}

/**
 * Pure: balance tone -> tone-dot background class, using the dedicated
 * `--labor-over` / `--labor-under` / `--labor-balanced` tokens (design §7).
 * `'none'` (no sales in the window, `summarizeLaborPnl`'s no-data case) maps
 * to a neutral dot rather than a `--labor-*` token, mirroring
 * `CoverageVerdict`'s neutral "no demand configured" dot.
 */
export function verdictDotClassName(tone: BalanceState | 'none'): string {
  if (tone === 'over') return 'bg-[hsl(var(--labor-over))]';
  if (tone === 'under') return 'bg-[hsl(var(--labor-under))]';
  if (tone === 'balanced') return 'bg-[hsl(var(--labor-balanced))]';
  return 'bg-muted-foreground/50';
}

/**
 * One-line plain-English verdict for the `/labor` page (design §2.2): a
 * tone dot + `summary.verdict` sentence, mirroring
 * `CoverageVerdict`'s dot-plus-sentence pattern (the codebase's existing
 * precedent for this exact shape). The sentence text itself stays
 * `text-foreground` regardless of tone — color lives on the dot only, so
 * it's never the sole signal (the sentence and its "over/under target"
 * wording carry the same information for screen readers).
 *
 * Renders `null` for a missing `summary` (defensive guard per plan D5) —
 * the page composing this component owns the shared loading/error/empty
 * states (design §6) and only mounts it once a summary exists.
 */
export function LaborVerdict({ summary }: LaborVerdictProps) {
  if (!summary) return null;

  return (
    <div className="flex items-center gap-2 py-1">
      <span
        aria-hidden
        className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${verdictDotClassName(summary.verdictTone)}`}
      />
      <p className="text-[15px] font-medium text-foreground">{summary.verdict}</p>
    </div>
  );
}

import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import {
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  FileText,
  AlertTriangle,
  Inbox,
  ArrowRight,
} from 'lucide-react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useWeeklyBrief, getMostRecentSunday } from '@/hooks/useWeeklyBrief';
import type { WeeklyBrief as WeeklyBriefType } from '@/hooks/useWeeklyBrief';
import { FeatureGate } from '@/components/subscription/FeatureGate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(val: number | undefined): string {
  if (val === undefined) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(val);
}

function formatPct(val: number | undefined): string {
  if (val === undefined) return '0%';
  return `${val.toFixed(1)}%`;
}

function metricLabel(metric: string): string {
  const labels: Record<string, string> = {
    net_revenue: 'Revenue',
    food_cost: 'Food Cost',
    food_cost_pct: 'Food Cost %',
    labor_cost: 'Labor Cost',
    labor_cost_pct: 'Labor Cost %',
    prime_cost: 'Prime Cost',
    prime_cost_pct: 'Prime Cost %',
    gross_profit: 'Gross Profit',
  };
  return labels[metric] || metric;
}

function formatWeekRange(weekEndStr: string): string {
  const [year, month, day] = weekEndStr.split('-').map(Number);
  const weekEnd = new Date(year, month - 1, day);
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 6);

  const startMonth = weekStart.toLocaleDateString('en-US', { month: 'short' });
  const startDay = weekStart.getDate();
  const endMonth = weekEnd.toLocaleDateString('en-US', { month: 'short' });
  const endDay = weekEnd.getDate();
  const endYear = weekEnd.getFullYear();

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay} – ${endDay}, ${endYear}`;
  }
  return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${endYear}`;
}

function shiftDate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function isUpGood(metric: string): boolean {
  return metric === 'net_revenue' || metric === 'gross_profit';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface MetricCardProps {
  label: string;
  value: string;
  deltaPct: number | null;
  direction: 'up' | 'down' | 'flat';
  goodWhenUp: boolean;
}

function MetricCard({ label, value, deltaPct, direction, goodWhenUp }: MetricCardProps) {
  let isGood = true;
  if (direction === 'up') isGood = goodWhenUp;
  else if (direction === 'down') isGood = !goodWhenUp;

  const colorClass = isGood
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400';

  return (
    <div className="rounded-xl border border-border/40 bg-background p-4 flex flex-col gap-1">
      <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className="text-[22px] font-semibold text-foreground">{value}</span>
      {deltaPct !== null && direction !== 'flat' && (
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${colorClass}`}>
          {direction === 'up' ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {deltaPct > 0 ? '+' : ''}
          {deltaPct.toFixed(1)}% vs prior week
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function WeeklyBrief() {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id;

  const [selectedDate, setSelectedDate] = useState<string>(getMostRecentSunday);

  const { data: brief, isLoading, error } = useWeeklyBrief(restaurantId, selectedDate);

  // Prevent navigating into the future
  const canGoForward = selectedDate < getMostRecentSunday();

  // Find variance entries for the 4 hero metrics
  const heroMetrics = useMemo(() => {
    const keys = ['net_revenue', 'food_cost_pct', 'labor_cost_pct', 'prime_cost_pct'] as const;
    if (!brief) return null;
    const metrics = brief.metrics_json;
    const variances = brief.variances_json || [];

    return keys.map((key) => {
      const variance = variances.find((v) => v.metric === key);
      const isCurrency = key === 'net_revenue';
      const raw = metrics[key];
      return {
        key,
        label: metricLabel(key),
        value: isCurrency ? formatCurrency(raw) : formatPct(raw),
        deltaPct: variance?.delta_pct_vs_prior ?? null,
        direction: variance?.direction ?? ('flat' as const),
        goodWhenUp: isUpGood(key),
      };
    });
  }, [brief]);

  // Flagged variances (critical / warning)
  const flaggedVariances = useMemo(() => {
    if (!brief?.variances_json) return [];
    return brief.variances_json.filter((v) => v.flag !== null);
  }, [brief]);

  // Recommendations (max 3)
  const recommendations = useMemo(() => {
    if (!brief?.recommendations_json) return [];
    return brief.recommendations_json.slice(0, 3);
  }, [brief]);

  // Inbox summary
  const inbox = brief?.inbox_summary_json;
  const hasInboxItems = inbox && (inbox.open_count ?? 0) > 0;

  // ----------- Loading state -----------
  if (isLoading) {
    return (
      <FeatureGate featureKey="weekly_brief">
        <div className="min-h-screen bg-background">
          <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
            <div className="flex items-center justify-between">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-9 w-48" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-32 rounded-xl" />
          </div>
        </div>
      </FeatureGate>
    );
  }

  // ----------- Error state -----------
  if (error) {
    return (
      <FeatureGate featureKey="weekly_brief">
        <div className="min-h-screen bg-background">
          <div className="max-w-5xl mx-auto px-4 py-6">
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <p className="text-[14px] font-medium text-foreground">
                Failed to load the weekly brief
              </p>
              <p className="text-[13px] text-muted-foreground">
                {error instanceof Error ? error.message : 'An unexpected error occurred.'}
              </p>
            </div>
          </div>
        </div>
      </FeatureGate>
    );
  }

  // ----------- Empty state -----------
  if (!brief) {
    return (
      <FeatureGate featureKey="weekly_brief">
        <div className="min-h-screen bg-background">
          <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
            <DateHeader
              date={selectedDate}
              onPrev={() => setSelectedDate((d) => shiftDate(d, -7))}
              onNext={() => setSelectedDate((d) => shiftDate(d, 7))}
              canGoForward={canGoForward}
            />
            <div className="flex flex-col items-center justify-center py-24 space-y-3">
              <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-[14px] font-medium text-foreground">
                No brief generated for this week
              </p>
              <p className="text-[13px] text-muted-foreground">
                Briefs are generated every Monday morning.
              </p>
            </div>
          </div>
        </div>
      </FeatureGate>
    );
  }

  // ----------- Populated state -----------
  return (
    <FeatureGate featureKey="weekly_brief">
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <DateHeader
          date={selectedDate}
          onPrev={() => setSelectedDate((d) => shiftDate(d, -7))}
          onNext={() => setSelectedDate((d) => shiftDate(d, 7))}
          canGoForward={canGoForward}
        />

        {/* Metrics Row */}
        {heroMetrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {heroMetrics.map((m) => (
              <MetricCard
                key={m.key}
                label={m.label}
                value={m.value}
                deltaPct={m.deltaPct}
                direction={m.direction}
                goodWhenUp={m.goodWhenUp}
              />
            ))}
          </div>
        )}

        {/* What Changed */}
        {flaggedVariances.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-foreground">What Changed</h2>
            <div className="space-y-2">
              {flaggedVariances.map((v) => (
                <VarianceCard key={v.metric} variance={v} />
              ))}
            </div>
          </section>
        )}

        {/* Narrative */}
        {brief.narrative && (
          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-foreground">Summary</h2>
            <div className="rounded-xl border border-border/40 bg-muted/30 p-5 space-y-3">
              <p className="text-[14px] leading-relaxed text-foreground whitespace-pre-line">
                {brief.narrative}
              </p>
              {brief.computed_at && (
                <p className="text-[11px] text-muted-foreground">
                  Generated {new Date(brief.computed_at).toLocaleString()}
                </p>
              )}
            </div>
          </section>
        )}

        {/* Top Actions */}
        {recommendations.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-foreground">Top Actions</h2>
            <div className="space-y-2">
              {recommendations.map((rec, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-border/40 bg-background p-4 space-y-1.5"
                >
                  <p className="text-[14px] font-medium text-foreground">{rec.title}</p>
                  <p className="text-[13px] text-muted-foreground">{rec.body}</p>
                  <div className="flex items-center gap-2 pt-1">
                    {rec.impact && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted font-medium text-muted-foreground">
                        Impact: {rec.impact}
                      </span>
                    )}
                    {rec.effort && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted font-medium text-muted-foreground">
                        Effort: {rec.effort}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Open Issues */}
        {hasInboxItems && (
          <section>
            <Link
              to="/ops-inbox"
              className="group flex items-center justify-between rounded-xl border border-border/40 bg-background p-4 hover:border-border transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-muted/50 flex items-center justify-center">
                  <Inbox className="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <p className="text-[14px] font-medium text-foreground">Open Issues</p>
                  <p className="text-[13px] text-muted-foreground">
                    {inbox!.open_count} open
                    {(inbox!.critical_count ?? 0) > 0 && (
                      <span className="text-red-600 dark:text-red-400">
                        {' '}
                        ({inbox!.critical_count} critical)
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </Link>
          </section>
        )}
      </div>
    </div>
    </FeatureGate>
  );
}

// ---------------------------------------------------------------------------
// Date header
// ---------------------------------------------------------------------------

interface DateHeaderProps {
  date: string;
  onPrev: () => void;
  onNext: () => void;
  canGoForward: boolean;
}

function DateHeader({ date, onPrev, onNext, canGoForward }: DateHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-[17px] font-semibold text-foreground">Weekly Brief</h1>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={onPrev}
          aria-label="Previous week"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-[14px] font-medium text-foreground min-w-[180px] text-center">
          {formatWeekRange(date)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={onNext}
          disabled={!canGoForward}
          aria-label="Next week"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variance card
// ---------------------------------------------------------------------------

interface VarianceCardProps {
  variance: WeeklyBriefType['variances_json'][number];
}

function VarianceCard({ variance }: VarianceCardProps) {
  const isCritical = variance.flag === 'critical';

  const flagBg = isCritical
    ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400'
    : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400';

  const deltaStr =
    variance.delta_pct_vs_prior !== null
      ? `${variance.delta_pct_vs_prior > 0 ? '+' : ''}${variance.delta_pct_vs_prior.toFixed(1)}% vs prior week`
      : null;

  const isPctMetric = variance.metric.endsWith('_pct');
  const formattedValue = isPctMetric
    ? formatPct(variance.value)
    : formatCurrency(variance.value);

  return (
    <div className="rounded-xl border border-border/40 bg-background p-4 flex items-start gap-3">
      <span
        className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium shrink-0 ${flagBg}`}
      >
        {isCritical ? 'Critical' : 'Warning'}
      </span>
      <div className="space-y-0.5 min-w-0">
        <p className="text-[14px] font-medium text-foreground">
          {metricLabel(variance.metric)}
        </p>
        <p className="text-[13px] text-muted-foreground">
          {formattedValue}
          {deltaStr && <span className="ml-1.5">{deltaStr}</span>}
        </p>
      </div>
    </div>
  );
}

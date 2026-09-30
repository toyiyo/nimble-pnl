import { Skeleton } from '@/components/ui/skeleton';

// Stable keys for placeholder rows. The rows never reorder, but a named key
// keeps the list free of array-index keys.
function placeholderKeys(count: number): string[] {
  return Array.from({ length: count }, (_, position) => `placeholder-${position + 1}`);
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      {/* Today card skeleton */}
      <div
        data-testid="skeleton-today-card"
        className="rounded-xl border border-border/40 overflow-hidden"
      >
        <div className="px-5 py-3 border-b border-border/40">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid grid-cols-5 gap-px bg-border/40">
          {placeholderKeys(5).map((key) => (
            <div key={key} className="bg-background p-4">
              <Skeleton className="h-3 w-16 mb-2" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      </div>

      {/* Needs your attention + Month progress skeleton */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div data-testid="skeleton-half-card-attention" className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <div className="rounded-xl border border-border/40 p-4 space-y-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>
        <div data-testid="skeleton-half-card-month" className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <div className="rounded-xl border border-border/40 p-4">
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>
      </div>

      {/* Chart Skeleton */}
      <div className="rounded-xl border border-border/40 overflow-hidden">
        <div className="px-5 py-3 border-b border-border/40">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="p-5">
          <Skeleton className="h-56 w-full" />
        </div>
      </div>

      {/* Insights Skeleton */}
      <div className="rounded-xl border border-border/40 overflow-hidden">
        <div className="px-5 py-3 border-b border-border/40">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="p-4 space-y-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      </div>

      {/* Period + Metrics Skeleton */}
      <div className="space-y-4">
        <Skeleton className="h-5 w-40" />
        <div className="h-10 flex gap-4 border-b border-border/40">
          {placeholderKeys(6).map((key) => (
            <Skeleton key={key} className="h-4 w-16" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {placeholderKeys(5).map((key) => (
          <div key={key} className="p-4 rounded-xl border border-border/40">
            <Skeleton className="h-3 w-20 mb-3" />
            <Skeleton className="h-7 w-24 mb-1" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>

      {/* Quick Actions Skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-28" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {placeholderKeys(8).map((key) => (
            <div key={key} className="p-4 rounded-xl border border-border/40">
              <Skeleton className="h-8 w-8 rounded-lg mb-3" />
              <Skeleton className="h-4 w-20 mb-1" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

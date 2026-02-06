import { Skeleton } from '@/components/ui/skeleton';

export function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      {/* Snapshot Skeleton */}
      <div className="rounded-xl border border-border/40 overflow-hidden">
        <div className="px-5 py-3 border-b border-border/40">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid grid-cols-5 gap-px bg-border/40">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-background p-4">
              <Skeleton className="h-3 w-16 mb-2" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
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
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-4 w-16" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="p-4 rounded-xl border border-border/40">
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
          {[...Array(8)].map((_, i) => (
            <div key={i} className="p-4 rounded-xl border border-border/40">
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

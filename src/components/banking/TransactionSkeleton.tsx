import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function TransactionSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-full max-w-[200px]" />
            <Skeleton className="h-3 w-full max-w-[150px]" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-5 w-16" />
          </div>
        </div>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-8 w-full" />
      </CardContent>
    </Card>
  );
}

interface TransactionTableSkeletonProps {
  readonly rowCount?: number;
}

export function TransactionTableSkeleton({ rowCount = 10 }: TransactionTableSkeletonProps) {
  return (
    <div className="w-full overflow-hidden">
      {/* Header skeleton */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/50">
        <Skeleton className="h-4 w-[110px]" />
        <Skeleton className="h-4 flex-1 min-w-[180px]" />
        <Skeleton className="h-4 w-[120px] hidden md:block" />
        <Skeleton className="h-4 w-[140px] hidden lg:block" />
        <Skeleton className="h-4 w-[100px]" />
        <Skeleton className="h-4 w-[140px] hidden lg:block" />
        <Skeleton className="h-4 w-[60px]" />
      </div>

      {/* Row skeletons - matches MemoizedTransactionRow layout */}
      <div className="h-[600px]">
        {Array.from({ length: rowCount }, (_, i) => (
          <div key={`skeleton-row-${i}`} className="flex items-center gap-2 px-4 py-3 border-b">
            {/* Date */}
            <Skeleton className="h-4 w-[110px]" />
            {/* Description */}
            <div className="flex-1 min-w-[180px] space-y-1">
              <Skeleton className="h-4 w-full max-w-[200px]" />
              <Skeleton className="h-3 w-16" />
            </div>
            {/* Payee */}
            <Skeleton className="h-4 w-[120px] hidden md:block" />
            {/* Bank Account */}
            <Skeleton className="h-4 w-[140px] hidden lg:block" />
            {/* Amount */}
            <Skeleton className="h-4 w-[100px]" />
            {/* Category */}
            <Skeleton className="h-6 w-[140px] rounded-full hidden lg:block" />
            {/* Actions */}
            <Skeleton className="h-8 w-8 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

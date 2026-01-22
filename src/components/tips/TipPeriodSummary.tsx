import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatCurrencyFromCents } from '@/utils/tipPooling';
import { format, differenceInDays } from 'date-fns';
import { DollarSign, Users, Calendar, AlertTriangle, CheckCircle, Lock, FileText } from 'lucide-react';
import type { TipSplitWithItems } from '@/hooks/useTipSplits';

interface TipPeriodSummaryProps {
  splits: TipSplitWithItems[] | undefined;
  startDate: Date;
  endDate: Date;
  isLoading: boolean;
  shareMethod: string;
}

/**
 * TipPeriodSummary - Summary card for period-level statistics
 * Shows totals, coverage, employee count, and status
 */
export function TipPeriodSummary({
  splits,
  startDate,
  endDate,
  isLoading,
  shareMethod,
}: TipPeriodSummaryProps) {
  const stats = useMemo(() => {
    if (!splits) {
      return {
        totalTipsCents: 0,
        daysWithEntries: 0,
        totalDaysInPeriod: 0,
        employeeCount: 0,
        draftCount: 0,
        approvedCount: 0,
        archivedCount: 0,
      };
    }

    const totalDays = differenceInDays(endDate, startDate) + 1;
    const uniqueEmployees = new Set<string>();

    splits.forEach(split => {
      split.items?.forEach(item => {
        uniqueEmployees.add(item.employee_id);
      });
    });

    return {
      totalTipsCents: splits.reduce((sum, s) => sum + s.total_amount, 0),
      daysWithEntries: splits.length,
      totalDaysInPeriod: totalDays,
      employeeCount: uniqueEmployees.size,
      draftCount: splits.filter(s => s.status === 'draft').length,
      approvedCount: splits.filter(s => s.status === 'approved').length,
      archivedCount: splits.filter(s => s.status === 'archived').length,
    };
  }, [splits, startDate, endDate]);

  const periodStatus = useMemo(() => {
    if (stats.archivedCount > 0 && stats.archivedCount === stats.daysWithEntries) {
      return 'locked';
    }
    if (stats.approvedCount === stats.daysWithEntries && stats.daysWithEntries === stats.totalDaysInPeriod) {
      return 'ready';
    }
    return 'draft';
  }, [stats]);

  const getStatusBadge = () => {
    switch (periodStatus) {
      case 'locked':
        return (
          <Badge className="bg-muted text-muted-foreground border-muted-foreground/20">
            <Lock className="h-3 w-3 mr-1" />
            Locked
          </Badge>
        );
      case 'ready':
        return (
          <Badge className="bg-green-500/10 text-green-700 border-green-500/20">
            <CheckCircle className="h-3 w-3 mr-1" />
            Ready for payroll
          </Badge>
        );
      default:
        return (
          <Badge className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
            <FileText className="h-3 w-3 mr-1" />
            Draft
          </Badge>
        );
    }
  };

  const getShareMethodLabel = (method: string): string => {
    if (method === 'hours') return 'By hours worked';
    if (method === 'role') return 'By role';
    return 'Manual';
  };

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardContent className="pt-6">
          <Skeleton className="h-24" />
        </CardContent>
      </Card>
    );
  }

  const coveragePercent = stats.totalDaysInPeriod > 0
    ? Math.round((stats.daysWithEntries / stats.totalDaysInPeriod) * 100)
    : 0;
  const missingDays = stats.totalDaysInPeriod - stats.daysWithEntries;

  return (
    <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
      <CardContent className="pt-6 space-y-4">
        {/* Header with status */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              Weekly tips &middot; {format(startDate, 'MMM d')} - {format(endDate, 'MMM d')}
            </p>
          </div>
          {getStatusBadge()}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              Total tips
            </div>
            <p className="text-2xl font-bold">
              {formatCurrencyFromCents(stats.totalTipsCents)}
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              Employees
            </div>
            <p className="text-2xl font-bold">{stats.employeeCount}</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              Coverage
            </div>
            <p className="text-2xl font-bold">
              {stats.daysWithEntries} of {stats.totalDaysInPeriod} days
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Split method</p>
            <p className="text-lg font-medium">{getShareMethodLabel(shareMethod)}</p>
          </div>
        </div>

        {/* Warning if incomplete */}
        {missingDays > 0 && periodStatus !== 'locked' && (
          <Alert className="border-yellow-500/50 bg-yellow-500/10">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-sm">
              {missingDays} day{missingDays > 1 ? 's' : ''} missing tips &mdash; payroll preview may change
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

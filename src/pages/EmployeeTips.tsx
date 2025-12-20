import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useTipSplits } from '@/hooks/useTipSplits';
import { usePeriodNavigation } from '@/hooks/usePeriodNavigation';
import { formatCurrencyFromCents } from '@/utils/tipPooling';
import { format } from 'date-fns';
import {
  EmployeePageHeader,
  NoRestaurantState,
  EmployeePageSkeleton,
  EmployeeNotLinkedState,
  PeriodSelector,
} from '@/components/employee';
import { TipTransparency } from '@/components/tips/TipTransparency';
import { TipDispute } from '@/components/tips/TipDispute';
import { Banknote, Clock } from 'lucide-react';

/**
 * EmployeeTips - Part 3 of Apple-style UX
 * Employee-facing tip breakdown and transparency view
 */
const EmployeeTips = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const { currentEmployee, loading: employeeLoading } = useCurrentEmployee(restaurantId);

  const {
    periodType,
    setPeriodType,
    startDate,
    endDate,
    handlePreviousWeek,
    handleNextWeek,
    handleToday,
  } = usePeriodNavigation({ includeLast2Weeks: false });

  const { splits, isLoading } = useTipSplits(
    restaurantId,
    format(startDate, 'yyyy-MM-dd'),
    format(endDate, 'yyyy-MM-dd')
  );

  // Filter splits to only show approved ones with current employee
  const myTips = useMemo(() => {
    if (!splits || !currentEmployee) return [];
    
    return splits
      .filter(split => split.status === 'approved')
      .map(split => {
        const myItem = split.items.find(item => item.employee_id === currentEmployee.id);
        if (!myItem) return null;

        return {
          id: split.id,
          split_id: split.id,
          date: split.split_date,
          amount: myItem.amount,
          hours: myItem.hours_worked,
          role: myItem.role,
          shareMethod: split.share_method,
          totalSplit: split.total_amount,
          totalTeamHours: split.items.reduce((sum, item) => sum + (item.hours_worked || 0), 0),
        };
      })
      .filter(Boolean);
  }, [splits, currentEmployee]);

  // Calculate period totals
  const periodTotal = myTips.reduce((sum, tip) => sum + (tip?.amount || 0), 0);
  const periodHours = myTips.reduce((sum, tip) => sum + (tip?.hours || 0), 0);

  if (!restaurantId) {
    return <NoRestaurantState />;
  }

  if (employeeLoading) {
    return <EmployeePageSkeleton />;
  }

  if (!currentEmployee) {
    return <EmployeeNotLinkedState />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <EmployeePageHeader
        icon={Banknote}
        title="My Tips"
        subtitle={currentEmployee.name}
      />

      {/* Period Summary */}
      <Card className="bg-gradient-to-br from-green-500/5 to-green-600/5 border-green-500/20">
        <CardContent className="pt-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-muted-foreground mb-1">This period</p>
              <p className="text-3xl font-bold text-green-600">
                {formatCurrencyFromCents(periodTotal)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Hours worked</p>
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-bold">{periodHours.toFixed(1)}</p>
                <Clock className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Period Selector */}
      <PeriodSelector
        periodType={periodType}
        onPeriodTypeChange={setPeriodType}
        startDate={startDate}
        endDate={endDate}
        onPrevious={handlePreviousWeek}
        onNext={handleNextWeek}
        onToday={handleToday}
        label="View period:"
      />

      {/* Tabs: This Week / History */}
      <Tabs defaultValue="breakdown" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Breakdown Tab */}
        <TabsContent value="breakdown" className="space-y-4">
          {isLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          )}
          {!isLoading && myTips.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <Banknote className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No tips yet</h3>
                <p className="text-muted-foreground">
                  Your tips will appear here once they are approved by management.
                </p>
              </CardContent>
            </Card>
          )}
          {!isLoading && myTips.length > 0 && (
            <>
              {myTips.map((tip) => (
                <Card key={tip!.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        {format(new Date(tip!.date), 'EEEE, MMM d')}
                      </CardTitle>
                      <Badge variant="outline" className="text-green-600 border-green-600">
                        {formatCurrencyFromCents(tip!.amount)}
                      </Badge>
                    </div>
                    <CardDescription className="flex items-center gap-4">
                      {Boolean(tip!.hours) && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {tip!.hours.toFixed(1)} hours
                        </span>
                      )}
                      {tip!.role && <span>• {tip!.role}</span>}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <TipTransparency
                      employeeTip={tip!}
                      totalTeamHours={tip!.totalTeamHours}
                      shareMethod={tip!.shareMethod || 'manual'}
                    />
                    <TipDispute
                      restaurantId={restaurantId}
                      employeeId={currentEmployee.id}
                      tipSplitId={tip!.id}
                      tipDate={tip!.date}
                    />
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-4">
          {isLoading && <Skeleton className="h-64" />}
          {!isLoading && myTips.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No tip history available.</p>
              </CardContent>
            </Card>
          )}
          {!isLoading && myTips.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tip History</CardTitle>
                <CardDescription>
                  All approved tips for the selected period
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {myTips.map((tip) => (
                    <div 
                      key={tip!.id}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div>
                        <p className="font-medium">
                          {format(new Date(tip!.date), 'EEE, MMM d, yyyy')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {tip!.hours?.toFixed(1)} hours
                        </p>
                      </div>
                      <p className="font-bold text-green-600">
                        {formatCurrencyFromCents(tip!.amount)}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default EmployeeTips;

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useMarketplaceTrades, useAcceptShiftTrade } from '@/hooks/useShiftTrades';
import {
  EmployeePageHeader,
  NoRestaurantState,
  EmployeePageSkeleton,
  EmployeeNotLinkedState,
} from '@/components/employee';
import { format, parseISO } from 'date-fns';
import { Store, Calendar, Clock, MapPin, User, ArrowRightLeft, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const EmployeeShiftMarketplace = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const { toast } = useToast();

  const { currentEmployee, loading: employeeLoading } = useCurrentEmployee(restaurantId);
  const { trades, loading: tradesLoading, refetch } = useMarketplaceTrades(
    restaurantId, 
    currentEmployee?.id || null
  );
  const { mutate: acceptTrade, isPending: isAccepting } = useAcceptShiftTrade();

  const [acceptingTradeId, setAcceptingTradeId] = useState<string | null>(null);

  if (!selectedRestaurant) {
    return <NoRestaurantState />;
  }

  if (employeeLoading) {
    return <EmployeePageSkeleton />;
  }

  if (!currentEmployee) {
    return <EmployeeNotLinkedState />;
  }

  const handleAcceptTrade = (tradeId: string) => {
    if (!currentEmployee?.id) {
      toast({
        title: 'Error',
        description: 'Employee information not found',
        variant: 'destructive',
      });
      return;
    }

    setAcceptingTradeId(tradeId);
    acceptTrade(
      { tradeId, acceptingEmployeeId: currentEmployee.id },
      {
        onSuccess: () => {
          toast({
            title: 'Trade request accepted',
            description: 'Your manager will review and approve the trade.',
          });
          setAcceptingTradeId(null);
          refetch();
        },
        onError: (error) => {
          toast({
            title: 'Failed to accept trade',
            description: error.message,
            variant: 'destructive',
          });
          setAcceptingTradeId(null);
        },
      }
    );
  };

  const formatShiftTime = (startTime: string, endTime: string) => {
    const start = parseISO(startTime);
    const end = parseISO(endTime);
    return `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`;
  };

  const formatShiftDuration = (startTime: string, endTime: string) => {
    const start = parseISO(startTime);
    const end = parseISO(endTime);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    return `${hours.toFixed(1)} hours`;
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6 max-w-7xl">
      {/* Header with Navigation */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <EmployeePageHeader
          icon={ArrowRightLeft}
          title="Shift Marketplace"
          description="Browse and accept available shifts from your teammates"
        />
        <Link to="/employee/schedule">
          <Button variant="outline" className="border-primary/20 hover:bg-primary/5">
            <Calendar className="h-4 w-4 mr-2" />
            My Schedule
          </Button>
        </Link>
      </div>

      {/* Available Shifts */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Store className="h-6 w-6 text-primary" />
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Available Shifts
              </CardTitle>
              <CardDescription>Shifts offered by your teammates</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {tradesLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : !trades || trades.length === 0 ? (
            <div className="text-center py-12">
              <ArrowRightLeft className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No shifts available</h3>
              <p className="text-muted-foreground mb-4">
                There are currently no shifts available for trade.
              </p>
              <p className="text-sm text-muted-foreground">
                Check back later or offer one of your own shifts!
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {trades.map((trade) => {
                const shiftStart = parseISO(trade.offered_shift.start_time);
                const isPast = shiftStart < new Date();
                const isAcceptingThis = acceptingTradeId === trade.id;

                return (
                  <Card
                    key={trade.id}
                    className={cn(
                      'border-2 transition-all duration-300 hover:shadow-md',
                      isPast && 'opacity-50'
                    )}
                  >
                    <CardContent className="p-6">
                      <div className="flex flex-col sm:flex-row gap-6">
                        {/* Shift Details */}
                        <div className="flex-1 space-y-4">
                          {/* Date & Position */}
                          <div className="flex flex-wrap items-center gap-3">
                            <Badge className="bg-gradient-to-r from-primary to-accent text-white px-3 py-1">
                              <Calendar className="w-3 h-3 mr-1" />
                              {format(shiftStart, 'EEE, MMM d')}
                            </Badge>
                            <Badge variant="outline" className="px-3 py-1">
                              <MapPin className="w-3 h-3 mr-1" />
                              {trade.offered_shift.position}
                            </Badge>
                          </div>

                          {/* Time & Duration */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-lg font-semibold">
                              <Clock className="w-5 h-5 text-primary" />
                              {formatShiftTime(trade.offered_shift.start_time, trade.offered_shift.end_time)}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {formatShiftDuration(trade.offered_shift.start_time, trade.offered_shift.end_time)}
                            </div>
                          </div>

                          {/* From Employee */}
                          <div className="flex items-center gap-2 text-sm">
                            <User className="w-4 h-4 text-muted-foreground" />
                            <span className="text-muted-foreground">Offered by:</span>
                            <span className="font-medium">{trade.offered_by.name}</span>
                          </div>

                          {/* Reason */}
                          {trade.reason && (
                            <div className="bg-muted/50 p-3 rounded-md">
                              <p className="text-sm text-muted-foreground">
                                <span className="font-medium">Reason:</span> {trade.reason}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Action Button */}
                        <div className="flex flex-col justify-center items-center sm:items-end gap-2">
                          {trade.status === 'pending_approval' ? (
                            <div className="text-center">
                              <Badge className="bg-gradient-to-r from-yellow-500 to-orange-600 mb-2">
                                <Clock className="w-3 h-3 mr-1" />
                                Pending Approval
                              </Badge>
                              <p className="text-xs text-muted-foreground">
                                Awaiting manager review
                              </p>
                            </div>
                          ) : (
                            <Button
                              onClick={() => handleAcceptTrade(trade.id)}
                              disabled={isPast || isAcceptingThis || isAccepting}
                              className={cn(
                                'bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-opacity',
                                'min-w-[140px]'
                              )}
                            >
                              {isAcceptingThis ? (
                                <>
                                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                                  Accepting...
                                </>
                              ) : isPast ? (
                                'Past Shift'
                              ) : (
                                <>
                                  <CheckCircle className="w-4 h-4 mr-2" />
                                  Accept Shift
                                </>
                              )}
                            </Button>
                          )}
                          {trade.to_employee_id === currentEmployee.id && (
                            <Badge variant="outline" className="text-xs">
                              Offered to you
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default EmployeeShiftMarketplace;

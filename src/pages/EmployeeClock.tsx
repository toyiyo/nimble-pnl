import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee, useEmployeePunchStatus, useCreateTimePunch, useTimePunches } from '@/hooks/useTimePunches';
import { Clock, LogIn, LogOut, Coffee, PlayCircle, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

const EmployeeClock = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const [currentTime, setCurrentTime] = useState(new Date());

  const { employee, loading: employeeLoading } = useCurrentEmployee(restaurantId);
  const { status, loading: statusLoading } = useEmployeePunchStatus(employee?.id || null);
  const createPunch = useCreateTimePunch();
  const { punches } = useTimePunches(restaurantId, employee?.id || undefined, new Date(new Date().setHours(0, 0, 0, 0)));

  // Update current time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const handlePunch = async (punchType: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
    if (!restaurantId || !employee) return;

    // Get device info
    const deviceInfo = `${navigator.userAgent.substring(0, 100)}`;

    // Get location if available
    let location = undefined;
    if (navigator.geolocation) {
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
      } catch (error) {
        console.log('Location not available:', error);
      }
    }

    createPunch.mutate({
      restaurant_id: restaurantId,
      employee_id: employee.id,
      punch_type: punchType,
      punch_time: new Date().toISOString(),
      location,
      device_info: deviceInfo,
    });
  };

  if (!restaurantId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Please select a restaurant.</p>
      </div>
    );
  }

  if (employeeLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!employee) {
    return (
      <Card className="bg-gradient-to-br from-destructive/5 via-destructive/5 to-transparent border-destructive/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <div>
              <CardTitle className="text-2xl">Access Required</CardTitle>
              <CardDescription>Your account is not linked to an employee record.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Please contact your manager to link your account to your employee profile.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isClockedIn = status?.is_clocked_in || false;
  const onBreak = status?.on_break || false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Clock className="h-6 w-6 text-primary transition-transform duration-300" />
            </div>
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Time Clock
              </CardTitle>
              <CardDescription>Welcome, {employee.name}</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Current Time Display */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <div className="text-6xl font-bold tabular-nums">
              {format(currentTime, 'h:mm:ss a')}
            </div>
            <div className="text-xl text-muted-foreground">
              {format(currentTime, 'EEEE, MMMM d, yyyy')}
            </div>
            
            {/* Status Badge */}
            <div className="flex justify-center gap-2 mt-4">
              {statusLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : isClockedIn ? (
                onBreak ? (
                  <Badge variant="outline" className="text-lg px-4 py-2 bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
                    <Coffee className="w-4 h-4 mr-2" />
                    On Break
                  </Badge>
                ) : (
                  <Badge variant="default" className="text-lg px-4 py-2 bg-green-500/10 text-green-700 border-green-500/20">
                    <PlayCircle className="w-4 h-4 mr-2" />
                    Clocked In
                  </Badge>
                )
              ) : (
                <Badge variant="outline" className="text-lg px-4 py-2">
                  Clocked Out
                </Badge>
              )}
            </div>

            {/* Last Punch Info */}
            {status?.last_punch_time && (
              <p className="text-sm text-muted-foreground">
                Last action: {format(new Date(status.last_punch_time), 'h:mm a')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!isClockedIn ? (
              <Button
                size="lg"
                className="h-24 text-xl"
                onClick={() => handlePunch('clock_in')}
                disabled={createPunch.isPending}
              >
                <LogIn className="mr-2 h-6 w-6" />
                Clock In
              </Button>
            ) : onBreak ? (
              <>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-24 text-xl"
                  onClick={() => handlePunch('break_end')}
                  disabled={createPunch.isPending}
                >
                  <PlayCircle className="mr-2 h-6 w-6" />
                  End Break
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  className="h-24 text-xl"
                  onClick={() => handlePunch('clock_out')}
                  disabled={createPunch.isPending}
                >
                  <LogOut className="mr-2 h-6 w-6" />
                  Clock Out
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-24 text-xl"
                  onClick={() => handlePunch('break_start')}
                  disabled={createPunch.isPending}
                >
                  <Coffee className="mr-2 h-6 w-6" />
                  Start Break
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  className="h-24 text-xl"
                  onClick={() => handlePunch('clock_out')}
                  disabled={createPunch.isPending}
                >
                  <LogOut className="mr-2 h-6 w-6" />
                  Clock Out
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Today's Punches */}
      <Card>
        <CardHeader>
          <CardTitle>Today's Activity</CardTitle>
          <CardDescription>Your time punches for today</CardDescription>
        </CardHeader>
        <CardContent>
          {punches.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No punches recorded today</p>
          ) : (
            <div className="space-y-2">
              {punches.map((punch) => (
                <div
                  key={punch.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card"
                >
                  <div className="flex items-center gap-3">
                    {punch.punch_type === 'clock_in' && <LogIn className="h-4 w-4 text-green-600" />}
                    {punch.punch_type === 'clock_out' && <LogOut className="h-4 w-4 text-red-600" />}
                    {punch.punch_type === 'break_start' && <Coffee className="h-4 w-4 text-yellow-600" />}
                    {punch.punch_type === 'break_end' && <PlayCircle className="h-4 w-4 text-blue-600" />}
                    <div>
                      <div className="font-medium">
                        {punch.punch_type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {format(new Date(punch.punch_time), 'h:mm:ss a')}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default EmployeeClock;

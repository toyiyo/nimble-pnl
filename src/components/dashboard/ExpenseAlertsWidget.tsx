import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useExpenseAlerts, AlertSeverity } from '@/hooks/useExpenseAlerts';
import { AlertTriangle, Info, AlertCircle, X, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

interface ExpenseAlertsWidgetProps {
  startDate: Date;
  endDate: Date;
}

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertCircle,
    color: 'bg-red-500/10 text-red-700 border-red-500/20',
    badgeColor: 'bg-red-500 text-white',
  },
  warn: {
    icon: AlertTriangle,
    color: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
    badgeColor: 'bg-amber-500 text-white',
  },
  info: {
    icon: Info,
    color: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
    badgeColor: 'bg-blue-500 text-white',
  },
};

export const ExpenseAlertsWidget = ({ startDate, endDate }: ExpenseAlertsWidgetProps) => {
  const { data: alerts, isLoading, isError, error, refetch } = useExpenseAlerts(startDate, endDate);
  const navigate = useNavigate();
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());

  const handleDismiss = (alertId: string) => {
    setDismissedAlerts(prev => new Set(prev).add(alertId));
  };

  const handleCtaClick = (route: string, filters?: Record<string, any>) => {
    if (filters) {
      navigate(route, { state: filters });
    } else {
      navigate(route);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="bg-gradient-to-br from-destructive/5 to-transparent border-destructive/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <CardTitle>Smart Alerts</CardTitle>
          </div>
          <CardDescription>Failed to load alerts</CardDescription>
        </CardHeader>
        <CardContent className="py-6 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            {error?.message || 'Unable to generate expense alerts.'}
          </p>
          <Button onClick={() => refetch()} variant="outline" size="sm">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!alerts || alerts.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-green-500/5 to-transparent border-green-500/10">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-green-600" />
            <CardTitle>Smart Alerts</CardTitle>
          </div>
          <CardDescription>No alerts at this time</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            All expense metrics are within normal ranges. We'll notify you if anything requires attention.
          </p>
        </CardContent>
      </Card>
    );
  }

  const visibleAlerts = alerts.filter(alert => !dismissedAlerts.has(alert.id));

  if (visibleAlerts.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-green-500/5 to-transparent border-green-500/10">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-green-600" />
            <CardTitle>Smart Alerts</CardTitle>
          </div>
          <CardDescription>All alerts dismissed</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            You've dismissed all alerts. They'll appear again on the next refresh.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-primary" />
            <CardTitle>Smart Alerts</CardTitle>
          </div>
          <Badge variant="outline">
            {visibleAlerts.length} alert{visibleAlerts.length !== 1 ? 's' : ''}
          </Badge>
        </div>
        <CardDescription>Expense insights and recommendations</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {visibleAlerts.map((alert) => {
            const config = SEVERITY_CONFIG[alert.severity];
            const Icon = config.icon;

            return (
              <div
                key={alert.id}
                className={`p-4 rounded-lg border ${config.color} relative`}
              >
                <button
                  onClick={() => handleDismiss(alert.id)}
                  className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Dismiss alert"
                >
                  <X className="w-4 h-4" />
                </button>

                <div className="flex items-start gap-3 pr-6">
                  <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold">{alert.title}</h4>
                      <Badge className={config.badgeColor} variant="default">
                        {alert.severity}
                      </Badge>
                    </div>
                    <p className="text-sm mb-3">{alert.message}</p>
                    {alert.cta && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCtaClick(alert.cta!.route, alert.cta!.filters)}
                        className="group"
                      >
                        {alert.cta.label}
                        <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Alerts refresh automatically and are based on your spending patterns and targets.
        </p>
      </CardContent>
    </Card>
  );
};

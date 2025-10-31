import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  Info, 
  Lightbulb,
  CheckCircle
} from 'lucide-react';

interface Insight {
  type: 'critical' | 'warning' | 'success' | 'info' | 'tip';
  title: string;
  description: string;
}

interface DashboardInsightsProps {
  insights: Insight[];
}

export function DashboardInsights({ insights }: DashboardInsightsProps) {
  const getInsightIcon = (type: Insight['type']) => {
    switch (type) {
      case 'critical':
        return <AlertTriangle className="h-4 w-4" />;
      case 'warning':
        return <TrendingDown className="h-4 w-4" />;
      case 'success':
        return <CheckCircle className="h-4 w-4" />;
      case 'tip':
        return <Lightbulb className="h-4 w-4" />;
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  const getInsightVariant = (type: Insight['type']) => {
    switch (type) {
      case 'critical':
        return 'destructive';
      case 'warning':
        return 'default';
      default:
        return 'default';
    }
  };

  const getInsightColor = (type: Insight['type']) => {
    switch (type) {
      case 'critical':
        return 'text-red-600 dark:text-red-400';
      case 'warning':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'success':
        return 'text-green-600 dark:text-green-400';
      case 'tip':
        return 'text-blue-600 dark:text-blue-400';
      default:
        return 'text-muted-foreground';
    }
  };

  // Check if all systems are healthy (no critical or warning alerts)
  const hasIssues = insights.some(i => i.type === 'critical' || i.type === 'warning');
  const showAllGood = insights.length === 0 || !hasIssues;

  const getGradientBorder = (type: Insight['type']) => {
    switch (type) {
      case 'critical':
        return 'border-l-red-500 dark:border-l-red-400';
      case 'warning':
        return 'border-l-yellow-500 dark:border-l-yellow-400';
      case 'success':
        return 'border-l-green-500 dark:border-l-green-400';
      case 'tip':
        return 'border-l-blue-500 dark:border-l-blue-400';
      default:
        return 'border-l-primary';
    }
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-accent/5 animate-fade-in">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="rounded-lg p-2 bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/30">
            <Lightbulb className="h-5 w-5 text-white" />
          </div>
          Smart Alerts
        </CardTitle>
        <CardDescription>
          Your trusted advisor for restaurant performance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAllGood && (
          <Alert 
            variant="default"
            className="border-l-4 border-l-green-500 dark:border-l-green-400 bg-gradient-to-r from-green-50/50 to-transparent dark:from-green-950/30 animate-fade-in"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-green-100 to-green-50 dark:from-green-900/50 dark:to-green-950/30 text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="font-semibold text-sm text-green-700 dark:text-green-400">
                  Your restaurant looks healthy!
                </div>
                <AlertDescription className="text-xs leading-relaxed text-green-600 dark:text-green-500">
                  Keep an eye on food cost trends this week as supplier prices shift.
                </AlertDescription>
              </div>
            </div>
          </Alert>
        )}
        {insights.map((insight, index) => (
          <Alert 
            key={index} 
            variant={getInsightVariant(insight.type)} 
            className={`border-l-4 transition-all duration-300 hover:shadow-md animate-fade-in ${getGradientBorder(insight.type)}`}
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg bg-gradient-to-br from-background to-muted/50 ${getInsightColor(insight.type)}`}>
                {getInsightIcon(insight.type)}
              </div>
              <div className="flex-1 space-y-1">
                <div className="font-semibold text-sm flex items-center gap-2">
                  {insight.title}
                  <Badge variant="outline" className="text-xs font-medium">
                    {insight.type.toUpperCase()}
                  </Badge>
                </div>
                <AlertDescription className="text-xs leading-relaxed">
                  {insight.description}
                </AlertDescription>
              </div>
            </div>
          </Alert>
        ))}
      </CardContent>
    </Card>
  );
}

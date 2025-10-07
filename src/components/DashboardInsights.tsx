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

  if (insights.length === 0) {
    return null;
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          AI-Powered Insights
        </CardTitle>
        <CardDescription>
          Smart recommendations based on your restaurant's performance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {insights.map((insight, index) => (
          <Alert key={index} variant={getInsightVariant(insight.type)} className="border-l-4">
            <div className="flex items-start gap-3">
              <div className={getInsightColor(insight.type)}>
                {getInsightIcon(insight.type)}
              </div>
              <div className="flex-1 space-y-1">
                <div className="font-semibold text-sm flex items-center gap-2">
                  {insight.title}
                  <Badge variant="outline" className="text-xs">
                    {insight.type.toUpperCase()}
                  </Badge>
                </div>
                <AlertDescription className="text-xs">
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

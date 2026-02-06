import {
  AlertTriangle,
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

  const getInsightColor = (type: Insight['type']) => {
    switch (type) {
      case 'critical':
        return 'text-destructive';
      case 'warning':
        return 'text-orange-500';
      case 'success':
        return 'text-green-600';
      case 'tip':
        return 'text-blue-500';
      default:
        return 'text-muted-foreground';
    }
  };

  const getBorderColor = (type: Insight['type']) => {
    switch (type) {
      case 'critical':
        return 'border-l-destructive';
      case 'warning':
        return 'border-l-orange-500';
      case 'success':
        return 'border-l-green-500';
      case 'tip':
        return 'border-l-blue-500';
      default:
        return 'border-l-border';
    }
  };

  const hasIssues = insights.some(i => i.type === 'critical' || i.type === 'warning');
  const showAllGood = insights.length === 0 || !hasIssues;

  return (
    <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
      <div className="px-5 py-3 border-b border-border/40 flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-[14px] font-medium text-foreground">Smart Alerts</h3>
      </div>
      <div className="p-4 space-y-2">
        {showAllGood && (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-green-500/5 border-l-2 border-l-green-500">
            <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
            <div>
              <p className="text-[14px] font-medium text-foreground">Restaurant looks healthy</p>
              <p className="text-[12px] text-muted-foreground">Keep an eye on food cost trends this week.</p>
            </div>
          </div>
        )}
        {insights.map((insight, index) => (
          <div
            key={index}
            className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border-l-2 ${getBorderColor(insight.type)}`}
          >
            <div className={`shrink-0 mt-0.5 ${getInsightColor(insight.type)}`}>
              {getInsightIcon(insight.type)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-medium text-foreground">{insight.title}</p>
                <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium uppercase">
                  {insight.type}
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
                {insight.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

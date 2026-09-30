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

const INSIGHT_ICONS = {
  critical: AlertTriangle,
  warning: TrendingDown,
  success: CheckCircle,
  info: Info,
  tip: Lightbulb,
} as const;

export function DashboardInsights({ insights }: Readonly<DashboardInsightsProps>) {
  const hasIssues = insights.some(i => i.type === 'critical' || i.type === 'warning');
  const showAllGood = insights.length === 0 || !hasIssues;

  return (
    <section aria-labelledby="dashboard-smart-alerts" className="space-y-3">
      <h2 id="dashboard-smart-alerts" className="text-[17px] font-semibold text-foreground">
        Smart Alerts
      </h2>
      <ul className="rounded-xl border border-border/40 bg-background divide-y divide-border/40">
        {showAllGood && (
          <li className="flex items-center gap-3 px-4 py-3">
            <CheckCircle className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-foreground">Restaurant looks healthy</p>
              <p className="text-[13px] text-muted-foreground">Keep an eye on food cost trends this week.</p>
            </div>
          </li>
        )}
        {insights.map((insight) => {
          const Icon = INSIGHT_ICONS[insight.type] ?? Info;
          const iconColor = insight.type === 'critical' ? 'text-destructive' : 'text-muted-foreground';
          return (
            <li key={`${insight.type}-${insight.title}`} className="flex items-start gap-3 px-4 py-3">
              <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconColor}`} aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-medium text-foreground">{insight.title}</p>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium uppercase">
                    {insight.type}
                  </span>
                </div>
                <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">
                  {insight.description}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CountingNumber } from "@/components/CountingNumber";
import { TrendingUp, TrendingDown, Activity, Calendar } from "lucide-react";
import { useCashFlowMetrics } from "@/hooks/useCashFlowMetrics";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import type { Period } from "@/components/PeriodSelector";
import { differenceInDays } from "date-fns";

interface FinancialPulseHeroProps {
  selectedPeriod: Period;
}

export function FinancialPulseHero({ selectedPeriod }: FinancialPulseHeroProps) {
  const { data: metrics, isLoading } = useCashFlowMetrics(selectedPeriod.from, selectedPeriod.to);
  const periodDays = differenceInDays(selectedPeriod.to, selectedPeriod.from) + 1;

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!metrics) return null;

  const getStatusColor = (value: number) => {
    if (value > 0) return 'from-emerald-500 to-green-600';
    if (value < 0) return 'from-red-500 to-rose-600';
    return 'from-gray-500 to-slate-600';
  };

  const getStatusGlow = (value: number) => {
    if (value > 0) return 'shadow-lg shadow-emerald-500/20';
    if (value < 0) return 'shadow-lg shadow-red-500/20';
    return '';
  };

  const volatilityScore = Math.max(0, 100 - (metrics.volatility / 100));
  const getVolatilityStatus = () => {
    if (volatilityScore >= 80) return { label: 'Low', color: 'bg-emerald-500' };
    if (volatilityScore >= 60) return { label: 'Medium', color: 'bg-yellow-500' };
    return { label: 'High', color: 'bg-red-500' };
  };

  const volatilityStatus = getVolatilityStatus();
  const trendSparklineData = metrics.trend.map(value => ({ value }));

  return (
    <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10 animate-fade-in">
      <CardContent className="p-6">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Financial Pulse
              </h2>
              <p className="text-sm text-muted-foreground">Real-time cash flow insights for {selectedPeriod.label}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Net Cash Flow */}
          <div className={`group p-4 rounded-lg bg-gradient-to-br ${getStatusColor(metrics.netCashFlow7d)} ${getStatusGlow(metrics.netCashFlow7d)} transition-all duration-300 hover:scale-105`}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-white/80">Net Cash Flow</p>
                <p className="text-xs text-white/60">({periodDays <= 7 ? periodDays : 7} days)</p>
              </div>
              {metrics.netCashFlow7d > 0 ? (
                <TrendingUp className="h-5 w-5 text-white/80" />
              ) : (
                <TrendingDown className="h-5 w-5 text-white/80" />
              )}
            </div>
            <div className="text-3xl font-bold text-white">
              <CountingNumber 
                value={Math.abs(metrics.netCashFlow7d)} 
                decimals={0}
                prefix={metrics.netCashFlow7d >= 0 ? '$' : '-$'}
              />
            </div>
            {trendSparklineData.length > 0 && (
              <div className="mt-3 h-12 opacity-70">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendSparklineData}>
                    <Line 
                      type="monotone" 
                      dataKey="value" 
                      stroke="white" 
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Average Daily Cash Flow */}
          <div className="group p-4 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 shadow-lg shadow-blue-500/20 transition-all duration-300 hover:scale-105">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-white/80">Avg Daily Flow</p>
                <p className="text-xs text-white/60">{selectedPeriod.label}</p>
              </div>
              <Calendar className="h-5 w-5 text-white/80" />
            </div>
            <div className="text-3xl font-bold text-white">
              <CountingNumber 
                value={Math.abs(metrics.avgDailyCashFlow)} 
                decimals={0}
                prefix={metrics.avgDailyCashFlow >= 0 ? '$' : '-$'}
              />
            </div>
            <div className="mt-3 text-xs text-white/70">
              ${metrics.netCashFlow30d.toLocaleString()} total
            </div>
          </div>

          {/* Cash Flow Volatility */}
          <div className="group p-4 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 shadow-lg shadow-purple-500/20 transition-all duration-300 hover:scale-105">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-white/80">Volatility</p>
                <p className="text-xs text-white/60">Cash flow stability</p>
              </div>
              <Badge className={`${volatilityStatus.color} text-white border-none`}>
                {volatilityStatus.label}
              </Badge>
            </div>
            <div className="text-3xl font-bold text-white">
              <CountingNumber 
                value={volatilityScore} 
                decimals={0}
                suffix="/100"
              />
            </div>
            <div className="mt-3">
              <div className="w-full bg-white/20 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${volatilityStatus.color} transition-all duration-1000`}
                  style={{ width: `${volatilityScore}%` }}
                />
              </div>
            </div>
          </div>

          {/* Trailing Trend */}
          <div className="group p-4 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20 transition-all duration-300 hover:scale-105">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-white/80">Trailing Trend</p>
                <p className="text-xs text-white/60">vs Previous {periodDays} days</p>
              </div>
              {metrics.trailingTrendPercentage > 0 ? (
                <TrendingUp className="h-5 w-5 text-white/80" />
              ) : (
                <TrendingDown className="h-5 w-5 text-white/80" />
              )}
            </div>
            <div className="text-3xl font-bold text-white">
              <CountingNumber 
                value={Math.abs(metrics.trailingTrendPercentage)} 
                decimals={1}
                prefix={metrics.trailingTrendPercentage >= 0 ? '+' : '-'}
                suffix="%"
              />
            </div>
            <div className="mt-3 text-xs text-white/70">
              Inflows: ${metrics.netInflows30d.toLocaleString()}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

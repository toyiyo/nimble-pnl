import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useTopVendors } from '@/hooks/useTopVendors';
import { Building2, TrendingUp, TrendingDown, Calendar, ArrowRight, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

interface TopVendorsCardProps {
  startDate: Date;
  endDate: Date;
  periodLabel: string;
}

export const TopVendorsCard = ({ startDate, endDate, periodLabel }: TopVendorsCardProps) => {
  const { data, isLoading, isError, error, refetch } = useTopVendors(startDate, endDate);
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="bg-gradient-to-br from-destructive/5 to-transparent border-destructive/20">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <div>
              <CardTitle className="text-2xl">Failed to Load Vendor Data</CardTitle>
              <CardDescription>Top vendors by spend • {periodLabel}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
          <h3 className="text-lg font-semibold mb-2">Unable to load vendor information</h3>
          <p className="text-muted-foreground mb-4">
            {error?.message || 'An error occurred while fetching vendor data.'}
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Check your connection or try refreshing the data.
          </p>
          <Button onClick={() => refetch()} variant="outline">
            <TrendingUp className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.topVendors.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-muted/50 to-transparent">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Building2 className="h-6 w-6 text-primary" />
            <div>
              <CardTitle className="text-2xl">Top Vendors</CardTitle>
              <CardDescription>Top vendors by spend • {periodLabel}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No vendor payments yet</h3>
          <p className="text-muted-foreground">Connect bank or upload invoices to see vendor insights.</p>
        </CardContent>
      </Card>
    );
  }

  const handleVendorClick = (vendor: string) => {
    navigate('/banking', { state: { filterVendor: vendor } });
  };

  return (
    <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="h-6 w-6 text-primary transition-transform duration-300 group-hover:scale-110" />
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Top Vendors
              </CardTitle>
              <CardDescription>Top vendors by spend • {periodLabel}</CardDescription>
            </div>
          </div>
          {data.vendorConcentration > 40 && (
            <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/20">
              Top 3: {data.vendorConcentration.toFixed(0)}%
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {data.topVendors.map((vendor, idx) => {
            const maxSpend = data.topVendors[0].spend;
            const barWidth = (vendor.spend / maxSpend) * 100;
            const showMoM = vendor.momChange !== undefined;
            const momPositive = vendor.momChange !== undefined && vendor.momChange > 0;

            return (
              <button
                key={vendor.vendor}
                onClick={() => handleVendorClick(vendor.vendor)}
                className="w-full text-left group"
                aria-label={`View ${vendor.vendor} transactions`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-sm font-semibold text-muted-foreground">#{idx + 1}</span>
                    <span className="font-medium truncate">{vendor.vendor}</span>
                    {vendor.isRecurring && (
                      <Badge variant="outline" className="text-xs">
                        Recurring
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <div className="font-semibold">
                        ${vendor.spend.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {vendor.percentage.toFixed(1)}% • {vendor.paymentCount} payment{vendor.paymentCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="relative h-6 bg-muted rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-accent transition-all duration-300"
                    style={{ width: `${barWidth}%` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-between px-3">
                    <div className="flex items-center gap-2">
                      {showMoM && (
                        <div className={`flex items-center gap-1 text-xs font-medium ${
                          momPositive ? 'text-red-600' : 'text-green-600'
                        }`}>
                          {momPositive ? (
                            <TrendingUp className="w-3 h-3" />
                          ) : (
                            <TrendingDown className="w-3 h-3" />
                          )}
                          {Math.abs(vendor.momChange!).toFixed(0)}% MoM
                        </div>
                      )}
                    </div>
                    {vendor.nextExpectedDate && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        Next: {format(vendor.nextExpectedDate, 'MMM d')}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {data.vendorConcentration > 40 && (
          <p className="text-xs text-muted-foreground mt-4">
            High vendor concentration detected. Top 3 vendors represent {data.vendorConcentration.toFixed(0)}% of spending.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

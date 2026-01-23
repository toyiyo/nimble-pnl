import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useTopVendors } from '@/hooks/useTopVendors';
import { Building2, ArrowRight, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

interface TopVendorsCardProps {
  startDate: Date;
  endDate: Date;
  periodLabel: string;
}

// Clean up messy bank descriptions to readable vendor names
const cleanVendorName = (name: string): string => {
  // Remove common bank prefixes
  let cleaned = name
    .replace(/^(POS DEBIT|ORIG CO NAME:|CO ENTRY DESCR:.*|SEC:.*|IND ID:.*|ORIG ID:.*)/gi, '')
    .replace(/ZELLE PAYMENT TO\s*/gi, '')
    .replace(/Zelle payment to\s*/gi, '')
    .replace(/JPM\w+$/gi, '') // Remove JPM reference codes
    .replace(/\s+[A-Z]{2}\s*$/g, '') // Remove state codes at end
    .replace(/\s{2,}/g, ' ')
    .trim();
  
  // If it's just "CHECK", keep it
  if (cleaned.toUpperCase() === 'CHECK') return 'Check Payment';
  
  // Capitalize properly
  if (cleaned === cleaned.toUpperCase() && cleaned.length > 3) {
    cleaned = cleaned
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  
  // Truncate if still too long
  return cleaned.length > 25 ? cleaned.substring(0, 22) + '...' : cleaned;
};

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const TopVendorsCard = ({ startDate, endDate, periodLabel }: TopVendorsCardProps) => {
  const { data, isLoading, isError, refetch } = useTopVendors(startDate, endDate);
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Top Vendors</CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-3">Failed to load vendors</p>
          <Button onClick={() => refetch()} variant="outline" size="sm">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.topVendors.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Top Vendors</CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center">
          <Building2 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No vendor payments yet</p>
        </CardContent>
      </Card>
    );
  }

  const handleVendorClick = (vendor: string) => {
    navigate('/banking', { state: { filterVendor: vendor } });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium">Top Vendors</CardTitle>
          <span className="text-xs text-muted-foreground">{periodLabel}</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {data.topVendors.map((vendor) => (
            <button
              key={vendor.vendor}
              onClick={() => handleVendorClick(vendor.vendor)}
              className="w-full flex items-center justify-between py-2.5 px-2 -mx-2 rounded-md hover:bg-accent/50 transition-colors group"
              aria-label={`View ${vendor.vendor} transactions`}
            >
              <span className="text-sm font-medium truncate max-w-[60%]">
                {cleanVendorName(vendor.vendor)}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">
                  {formatCurrency(vendor.spend)}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          ))}
        </div>
        
        <button
          onClick={() => navigate('/banking')}
          className="w-full mt-3 pt-3 border-t border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all transactions →
        </button>
      </CardContent>
    </Card>
  );
};

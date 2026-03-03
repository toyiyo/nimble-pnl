import { useMemo } from 'react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

import { Info } from 'lucide-react';

import { useFinancialSettings, COGSMethod } from '@/hooks/useFinancialSettings';
import { useUnifiedCOGS } from '@/hooks/useUnifiedCOGS';

interface COGSPreferenceSettingsProps {
  restaurantId: string;
}

const COGS_OPTIONS: {
  value: COGSMethod;
  label: string;
  description: string;
}[] = [
  {
    value: 'inventory',
    label: 'Inventory (real-time)',
    description:
      'Uses recipe consumption data for real-time food cost tracking',
  },
  {
    value: 'financials',
    label: 'Financials (bank transactions & expenses)',
    description:
      'Uses transactions categorized as COGS for accounting accuracy',
  },
  {
    value: 'combined',
    label: 'Combined',
    description:
      'Sums both sources. May include overlap if purchases also flow through inventory.',
  },
];

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function COGSPreferenceSettings({
  restaurantId,
}: COGSPreferenceSettingsProps) {
  const { cogsMethod, isLoading: settingsLoading, updateSettings } =
    useFinancialSettings(restaurantId);

  const dateFrom = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const dateTo = useMemo(() => new Date(), []);

  const { breakdown, isLoading: cogsLoading } = useUnifiedCOGS(
    restaurantId,
    dateFrom,
    dateTo,
  );

  const handleMethodChange = (value: string) => {
    updateSettings({ cogs_calculation_method: value as COGSMethod });
  };

  if (settingsLoading) {
    return (
      <Card className="shadow-md">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-md hover:shadow-lg transition-shadow duration-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          COGS Settings
        </CardTitle>
        <CardDescription>
          Configure how Cost of Goods Sold is calculated for your P&L reports
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Section header */}
        <div className="space-y-1">
          <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            COGS Calculation Method
          </Label>
          <p className="text-[13px] text-muted-foreground">
            How should we calculate your Cost of Goods Sold?
          </p>
        </div>

        {/* Radio options */}
        <RadioGroup
          value={cogsMethod}
          onValueChange={handleMethodChange}
          className="gap-0"
          aria-label="COGS calculation method"
        >
          <div className="rounded-xl border border-border/40 overflow-hidden divide-y divide-border/40">
            {COGS_OPTIONS.map((option) => (
              <label
                key={option.value}
                htmlFor={`cogs-method-${option.value}`}
                className={`flex items-start gap-4 p-4 cursor-pointer transition-colors hover:bg-muted/30 ${
                  cogsMethod === option.value
                    ? 'bg-muted/30 border-l-2 border-l-foreground'
                    : ''
                }`}
              >
                <RadioGroupItem
                  value={option.value}
                  id={`cogs-method-${option.value}`}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <span className="text-[14px] font-medium text-foreground">
                    {option.label}
                  </span>
                  <p className="text-[13px] text-muted-foreground">
                    {option.description}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </RadioGroup>

        {/* Info box — current month comparison */}
        <div className="rounded-lg bg-muted/30 border border-border/40 p-4">
          <div className="flex items-start gap-3">
            <Info
              className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div className="space-y-2 min-w-0">
              <p className="text-[13px] font-medium text-foreground">
                Current Month Values
              </p>
              {cogsLoading ? (
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-[13px] text-muted-foreground">
                    Inventory COGS:{' '}
                    <span className="text-foreground font-medium">
                      {formatCurrency(breakdown.inventory)}
                    </span>
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    Financial COGS:{' '}
                    <span className="text-foreground font-medium">
                      {formatCurrency(breakdown.financials)}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

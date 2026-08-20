import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { PeriodSelector, Period } from '@/components/PeriodSelector';
import { BankingIntelligenceDashboard } from '@/components/banking/BankingIntelligenceDashboard';
import { BankAccountFilter } from '@/components/banking/BankAccountFilter';
import { useConnectedBanks } from '@/hooks/useConnectedBanks';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { FeatureGate } from '@/components/subscription';
import { Brain } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { presetPeriod, readPeriodParams, writePeriodParams } from '@/lib/periodUrlState';

export default function FinancialIntelligence() {
  const { selectedRestaurant } = useRestaurantContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedPeriod, setSelectedPeriod] = useState<Period>(
    () => readPeriodParams(searchParams) ?? presetPeriod('month'),
  );
  const [selectedBankAccount, setSelectedBankAccount] = useState<string>('all');

  const handlePeriodChange = (period: Period) => {
    setSelectedPeriod(period);
    // Read the live search string, not the hook value. The chart writes its
    // own params and the hook value can lag one render behind.
    const params = new URLSearchParams(window.location.search);
    writePeriodParams(params, period);
    setSearchParams(params, { replace: true });
  };

  const { data: connectedBanks = [], isLoading: banksLoading } = useConnectedBanks(
    selectedRestaurant?.restaurant_id,
    true
  );

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        icon={Brain}
        title="Financial Intelligence"
        subtitle="Deep insights from your banking data"
      />

      <div className="w-full px-4 py-8 space-y-6">
        <FeatureGate featureKey="financial_intelligence">
          <PeriodSelector
            selectedPeriod={selectedPeriod}
            onPeriodChange={handlePeriodChange}
          />

          {banksLoading ? (
            <Skeleton className="h-24" />
          ) : connectedBanks.length > 0 ? (
            <BankAccountFilter
              selectedBankAccount={selectedBankAccount}
              onBankAccountChange={setSelectedBankAccount}
              connectedBanks={connectedBanks}
            />
          ) : null}

          <BankingIntelligenceDashboard
            selectedPeriod={selectedPeriod}
            selectedBankAccount={selectedBankAccount}
            onPeriodChange={handlePeriodChange}
          />
        </FeatureGate>
      </div>
    </div>
  );
}

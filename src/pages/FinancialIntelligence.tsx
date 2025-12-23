import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PeriodSelector, Period } from '@/components/PeriodSelector';
import { BankingIntelligenceDashboard } from '@/components/banking/BankingIntelligenceDashboard';
import { BankAccountFilter } from '@/components/banking/BankAccountFilter';
import { useConnectedBanks } from '@/hooks/useConnectedBanks';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { Brain } from 'lucide-react';
import { startOfMonth, endOfDay } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';

export default function FinancialIntelligence() {
  const today = new Date();
  const { selectedRestaurant } = useRestaurantContext();
  const [selectedPeriod, setSelectedPeriod] = useState<Period>({
    type: 'month',
    from: startOfMonth(today),
    to: endOfDay(today),
    label: 'This Month',
  });
  const [selectedBankAccount, setSelectedBankAccount] = useState<string>('all');

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
        <PeriodSelector 
          selectedPeriod={selectedPeriod} 
          onPeriodChange={setSelectedPeriod} 
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
        />
      </div>
    </div>
  );
}

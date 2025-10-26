import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { PeriodSelector, Period } from '@/components/PeriodSelector';
import { BankingIntelligenceDashboard } from '@/components/banking/BankingIntelligenceDashboard';
import { BankAccountFilter } from '@/components/banking/BankAccountFilter';
import { BankSnapshotSection } from '@/components/BankSnapshotSection';
import { useConnectedBanks } from '@/hooks/useConnectedBanks';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { Brain, Landmark } from 'lucide-react';
import { startOfMonth, endOfDay } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function FinancialIntelligence() {
  const today = new Date();
  const navigate = useNavigate();
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
      
      <div className="container mx-auto px-4 py-8 space-y-6">
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

        {selectedRestaurant && (
          connectedBanks.length > 0 ? (
            <BankSnapshotSection 
              restaurantId={selectedRestaurant.restaurant_id}
              selectedPeriod={selectedPeriod}
            />
          ) : (
            <Card className="border-dashed border-2 border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-transparent">
              <CardContent className="py-12 text-center">
                <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-transparent mb-4">
                  <Landmark className="h-12 w-12 text-cyan-600" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Connect Your Bank for Financial Insights</h3>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  Get real-time cash flow tracking, spending analysis, and AI-powered financial intelligence by connecting your bank account.
                </p>
                <Button 
                  onClick={() => navigate('/banking')} 
                  className="gap-2"
                >
                  <Landmark className="h-4 w-4" />
                  Connect Bank Account
                </Button>
              </CardContent>
            </Card>
          )
        )}
        
        <BankingIntelligenceDashboard 
          selectedPeriod={selectedPeriod} 
          selectedBankAccount={selectedBankAccount}
        />
      </div>
    </div>
  );
}

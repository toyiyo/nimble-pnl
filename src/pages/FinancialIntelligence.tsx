import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PeriodSelector, Period } from '@/components/PeriodSelector';
import { BankingIntelligenceDashboard } from '@/components/banking/BankingIntelligenceDashboard';
import { Brain } from 'lucide-react';
import { startOfMonth, endOfDay } from 'date-fns';

export default function FinancialIntelligence() {
  const today = new Date();
  const [selectedPeriod, setSelectedPeriod] = useState<Period>({
    type: 'month',
    from: startOfMonth(today),
    to: endOfDay(today),
    label: 'This Month',
  });

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
        
        <BankingIntelligenceDashboard selectedPeriod={selectedPeriod} />
      </div>
    </div>
  );
}

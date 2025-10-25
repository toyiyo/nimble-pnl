import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { TrendingUp, DollarSign, PieChart, Sparkles, AlertTriangle } from "lucide-react";
import { FinancialPulseHero } from "./FinancialPulseHero";
import { CashFlowTab } from "./CashFlowTab";
import type { Period } from "@/components/PeriodSelector";

interface BankingIntelligenceDashboardProps {
  selectedPeriod: Period;
}

export function BankingIntelligenceDashboard({ selectedPeriod }: BankingIntelligenceDashboardProps) {
  const [activeTab, setActiveTab] = useState('cash-flow');

  return (
    <div className="space-y-6">
      {/* Hero Section - Financial Pulse */}
      <FinancialPulseHero selectedPeriod={selectedPeriod} />

      {/* Intelligence Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5 h-auto">
          <TabsTrigger value="cash-flow" className="gap-2 py-2.5">
            <TrendingUp className="h-4 w-4" />
            <span className="hidden sm:inline">Cash Flow</span>
            <span className="sm:hidden">Flow</span>
          </TabsTrigger>
          <TabsTrigger value="revenue" className="gap-2 py-2.5">
            <DollarSign className="h-4 w-4" />
            <span className="hidden sm:inline">Revenue</span>
            <span className="sm:hidden">Revenue</span>
          </TabsTrigger>
          <TabsTrigger value="spending" className="gap-2 py-2.5">
            <PieChart className="h-4 w-4" />
            <span className="hidden sm:inline">Spending</span>
            <span className="sm:hidden">Spend</span>
          </TabsTrigger>
          <TabsTrigger value="liquidity" className="gap-2 py-2.5">
            <AlertTriangle className="h-4 w-4" />
            <span className="hidden sm:inline">Liquidity</span>
            <span className="sm:hidden">Runway</span>
          </TabsTrigger>
          <TabsTrigger value="predictions" className="gap-2 py-2.5">
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">Predictions</span>
            <span className="sm:hidden">AI</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cash-flow" className="mt-6">
          <CashFlowTab selectedPeriod={selectedPeriod} />
        </TabsContent>

        <TabsContent value="revenue" className="mt-6">
          <Card className="p-12 text-center">
            <p className="text-muted-foreground">Revenue Health tab coming soon</p>
          </Card>
        </TabsContent>

        <TabsContent value="spending" className="mt-6">
          <Card className="p-12 text-center">
            <p className="text-muted-foreground">Spending Analysis tab coming soon</p>
          </Card>
        </TabsContent>

        <TabsContent value="liquidity" className="mt-6">
          <Card className="p-12 text-center">
            <p className="text-muted-foreground">Liquidity & Runway tab coming soon</p>
          </Card>
        </TabsContent>

        <TabsContent value="predictions" className="mt-6">
          <Card className="p-12 text-center">
            <p className="text-muted-foreground">AI Predictions tab coming soon</p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ComplianceRulesConfig } from '@/components/ComplianceRulesConfig';
import { ComplianceViolationsReport } from '@/components/ComplianceViolationsReport';
import { ComplianceDashboard } from '@/components/ComplianceDashboard';

const Compliance = () => {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-[600px]">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="violations">Violations</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
          <ComplianceDashboard />
        </TabsContent>

        <TabsContent value="rules" className="space-y-6">
          <ComplianceRulesConfig />
        </TabsContent>

        <TabsContent value="violations" className="space-y-6">
          <ComplianceViolationsReport />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Compliance;

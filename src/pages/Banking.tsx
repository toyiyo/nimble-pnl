import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBankTransactions } from "@/hooks/useBankTransactions";
import { BankTransactionList } from "@/components/banking/BankTransactionList";
import { CategoryRulesDialog } from "@/components/banking/CategoryRulesDialog";
import { ReconciliationDialog } from "@/components/banking/ReconciliationDialog";
import { ReconciliationReport } from "@/components/banking/ReconciliationReport";
import { useCategorizeTransactions } from "@/hooks/useCategorizeTransactions";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { Loader2, Building2, Sparkles, CheckCircle2, FileText, Wand2 } from "lucide-react";

export default function Banking() {
  const [activeTab, setActiveTab] = useState<'for_review' | 'categorized' | 'excluded' | 'reconciliation'>('for_review');
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [showReconciliationDialog, setShowReconciliationDialog] = useState(false);
  const { selectedRestaurant } = useRestaurantContext();
  
  const { data: forReviewTransactions, isLoading: isLoadingReview } = useBankTransactions('for_review');
  const { data: categorizedTransactions, isLoading: isLoadingCategorized } = useBankTransactions('categorized');
  const { data: excludedTransactions, isLoading: isLoadingExcluded } = useBankTransactions('excluded');
  const categorizeAll = useCategorizeTransactions();
  
  const handleCategorizeAll = () => {
    if (selectedRestaurant?.restaurant_id) {
      categorizeAll.mutate(selectedRestaurant.restaurant_id);
    }
  };

  const reviewCount = forReviewTransactions?.length || 0;
  const categorizedCount = categorizedTransactions?.length || 0;
  const excludedCount = excludedTransactions?.length || 0;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader 
        icon={Building2} 
        title="Banking"
        actions={
          <div className="flex gap-2">
            {reviewCount > 0 && (
              <Button 
                onClick={handleCategorizeAll} 
                disabled={categorizeAll.isPending}
                variant="default"
              >
                {categorizeAll.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4 mr-2" />
                )}
                Auto-Categorize All
              </Button>
            )}
            <Button onClick={() => setShowReconciliationDialog(true)} variant="outline">
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Reconcile
            </Button>
            <Button onClick={() => setShowRulesDialog(true)} variant="outline">
              <Sparkles className="h-4 w-4 mr-2" />
              Rules
            </Button>
          </div>
        }
      />

      <div className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="for_review" className="relative">
              For Review
              {reviewCount > 0 && (
                <span className="ml-2 bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs">
                  {reviewCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="categorized" className="relative">
              Categorized
              {categorizedCount > 0 && (
                <span className="ml-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                  {categorizedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="excluded" className="relative">
              Excluded
              {excludedCount > 0 && (
                <span className="ml-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                  {excludedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="reconciliation">
              <FileText className="h-4 w-4 mr-2" />
              Reconciliation
            </TabsTrigger>
          </TabsList>

          <TabsContent value="for_review">
            <Card className="p-6">
              {isLoadingReview ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : forReviewTransactions && forReviewTransactions.length > 0 ? (
                <BankTransactionList transactions={forReviewTransactions} status="for_review" />
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="text-lg">No transactions to review</p>
                  <p className="text-sm mt-2">All caught up! 🎉</p>
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="categorized">
            <Card className="p-6">
              {isLoadingCategorized ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : categorizedTransactions && categorizedTransactions.length > 0 ? (
                <BankTransactionList transactions={categorizedTransactions} status="categorized" />
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="text-lg">No categorized transactions</p>
                  <p className="text-sm mt-2">Start categorizing transactions from the "For Review" tab</p>
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="excluded">
            <Card className="p-6">
              {isLoadingExcluded ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : excludedTransactions && excludedTransactions.length > 0 ? (
                <BankTransactionList transactions={excludedTransactions} status="excluded" />
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="text-lg">No excluded transactions</p>
                  <p className="text-sm mt-2">Duplicate or personal transactions will appear here</p>
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="reconciliation">
            <ReconciliationReport />
          </TabsContent>
        </Tabs>
      </div>

      <CategoryRulesDialog
        isOpen={showRulesDialog}
        onClose={() => setShowRulesDialog(false)}
      />

      <ReconciliationDialog
        isOpen={showReconciliationDialog}
        onClose={() => setShowReconciliationDialog(false)}
      />
    </div>
  );
}

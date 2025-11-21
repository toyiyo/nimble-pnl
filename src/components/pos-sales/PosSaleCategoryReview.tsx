import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useCategorizePosSale } from "@/hooks/useCategorizePosSale";
import { Check, X, Sparkles, Split, Settings2 } from "lucide-react";
import { SplitPosSaleDialog } from "./SplitPosSaleDialog";
import { EnhancedCategoryRulesDialog } from "@/components/banking/EnhancedCategoryRulesDialog";

import { UnifiedSaleItem } from "@/types/pos";

interface PosSaleCategoryReviewProps {
  sales: UnifiedSaleItem[];
  restaurantId: string;
  onRefresh: () => void;
}

export function PosSaleCategoryReview({ sales, restaurantId, onRefresh }: PosSaleCategoryReviewProps) {
  const { mutate: categorizeSale } = useCategorizePosSale(restaurantId);
  const [splitDialogSale, setSplitDialogSale] = useState<UnifiedSaleItem | null>(null);
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [ruleFromSale, setRuleFromSale] = useState<UnifiedSaleItem | null>(null);

  const handleApprove = (sale: UnifiedSaleItem) => {
    if (!sale.suggested_category_id) return;
    categorizeSale({
      saleId: sale.id,
      categoryId: sale.suggested_category_id,
      accountInfo: sale.chart_account ? {
        account_name: sale.chart_account.account_name,
        account_code: sale.chart_account.account_code,
      } : undefined
    });
  };

  const handleReject = (sale: UnifiedSaleItem) => {
    if (!sale.suggested_category_id) return;
    // Clear the suggestion by setting it back to null (we'd need a different RPC for this)
    // For now, just close the suggestion without categorizing
    // TODO: Implement a way to reject/hide suggestions
  };

  const getConfidenceBadge = (confidence: string) => {
    const variants = {
      high: "bg-green-500/10 text-green-700 border-green-500/20",
      medium: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
      low: "bg-orange-500/10 text-orange-700 border-orange-500/20",
    };
    
    return variants[confidence as keyof typeof variants] || variants.low;
  };

  const handleSuggestRule = (sale: UnifiedSaleItem) => {
    if (!sale.suggested_category_id) return;
    setRuleFromSale(sale);
    setShowRulesDialog(true);
  };

  const getPrefilledRuleData = () => {
    if (!ruleFromSale || !ruleFromSale.suggested_category_id) return undefined;

    const itemName = ruleFromSale.itemName || '';
    
    return {
      ruleName: itemName 
        ? `Auto-categorize ${itemName.substring(0, 30)}${itemName.length > 30 ? '...' : ''}`
        : 'POS sale categorization rule',
      appliesTo: 'pos_sales' as const,
      itemNamePattern: itemName || '',
      itemNameMatchType: 'contains' as const,
      posCategory: ruleFromSale.posCategory || '',
      categoryId: ruleFromSale.suggested_category_id,
      priority: '5',
      autoApply: true,
    };
  };

  if (sales.length === 0) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle>AI Categorization Suggestions</CardTitle>
          </div>
          <CardDescription>
            Review and approve AI-suggested categories for your POS sales
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sales.map((sale) => (
            <div key={sale.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">{sale.itemName}</h4>
                    <Badge className={getConfidenceBadge(sale.ai_confidence || 'low')}>
                      {sale.ai_confidence || 'low'}
                    </Badge>
                    {sale.item_type && sale.item_type !== 'sale' && (
                      <Badge variant="outline" className="text-xs">
                        {sale.item_type}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    ${(sale.totalPrice || 0).toFixed(2)} • {new Date(sale.saleDate).toLocaleDateString()}
                    {sale.posCategory && ` • ${sale.posCategory}`}
                  </p>
                </div>
              </div>

              <div className="bg-muted/50 p-3 rounded-md space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Suggested Category:</span>
                  <span className="text-sm font-medium">
                    {sale.chart_account?.account_name} ({sale.chart_account?.account_code})
                  </span>
                </div>
                {sale.ai_reasoning && (
                  <>
                    <Separator />
                    <p className="text-xs text-muted-foreground">{sale.ai_reasoning}</p>
                  </>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="default"
                  className="flex-1"
                  onClick={() => handleApprove(sale)}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSplitDialogSale(sale)}
                >
                  <Split className="h-4 w-4 mr-1" />
                  Split
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSuggestRule(sale)}
                  title="Create a rule based on this sale"
                >
                  <Settings2 className="h-4 w-4 mr-1" />
                  Rule
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReject(sale)}
                >
                  <X className="h-4 w-4 mr-1" />
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {splitDialogSale && (
        <SplitPosSaleDialog
          sale={splitDialogSale}
          isOpen={true}
          onClose={() => setSplitDialogSale(null)}
          restaurantId={restaurantId}
        />
      )}

      <EnhancedCategoryRulesDialog
        open={showRulesDialog}
        onOpenChange={setShowRulesDialog}
        defaultTab="pos"
        prefilledRule={getPrefilledRuleData()}
      />
    </>
  );
}

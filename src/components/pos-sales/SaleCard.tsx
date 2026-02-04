import React, { memo } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Check, ExternalLink, Settings2, Sparkles, Split, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { IntegrationLogo } from '@/components/IntegrationLogo';
import { SearchableAccountSelector } from '@/components/banking/SearchableAccountSelector';
import { UnifiedSaleItem } from '@/types/pos';

// Recipe info passed from parent (pre-computed for performance)
export interface RecipeInfo {
  id: string;
  name: string;
  hasIngredients: boolean;
  profitMargin?: number | null;
}

// Account info for categorization
export interface AccountInfo {
  id: string;
  account_name: string;
  account_code: string;
}

export interface SaleCardProps {
  sale: UnifiedSaleItem;
  recipe: RecipeInfo | null;
  isSelected: boolean;
  isSelectionMode: boolean;
  isEditingCategory: boolean;
  accounts: AccountInfo[];
  canEditManualSales: boolean;
  // Handlers - should be stable references from parent
  onCardClick: (id: string, event: React.MouseEvent) => void;
  onCheckboxChange: (id: string) => void;
  onEdit: (sale: UnifiedSaleItem) => void;
  onDelete: (id: string) => void;
  onSimulateDeduction: (name: string, quantity: number) => void;
  onMapPOSItem: (name: string) => void;
  onSetEditingCategory: (id: string | null) => void;
  onSplit: (sale: UnifiedSaleItem) => void;
  onSuggestRule: (sale: UnifiedSaleItem) => void;
  onCategorize: (params: {
    saleId: string;
    categoryId: string;
    accountInfo?: { account_name: string; account_code: string }
  }) => void;
  onNavigateToRecipe: (recipeId: string) => void;
  // Optional style for virtualization positioning
  style?: React.CSSProperties;
}

const posSystemColors: Record<string, string> = {
  "Square": "border-l-blue-500",
  "Clover": "border-l-green-500",
  "Toast": "border-l-orange-500",
  "manual": "border-l-purple-500",
  "manual_upload": "border-l-purple-500",
};

function getIntegrationId(posSystem: string): string {
  let integrationId = posSystem.toLowerCase().replace("_", "-") + "-pos";
  if (integrationId === "lighthouse-pos") integrationId = "shift4-pos";
  return integrationId;
}

function formatSaleDate(saleDate: string): string {
  const [year, month, day] = saleDate.split("-").map(Number);
  const localDate = new Date(year, month - 1, day);
  return format(localDate, "MMM d, yyyy");
}

export const SaleCard = memo(function SaleCard({
  sale,
  recipe,
  isSelected,
  isSelectionMode,
  isEditingCategory,
  accounts,
  canEditManualSales,
  onCardClick,
  onCheckboxChange,
  onEdit,
  onDelete,
  onSimulateDeduction,
  onMapPOSItem,
  onSetEditingCategory,
  onSplit,
  onSuggestRule,
  onCategorize,
  onNavigateToRecipe,
  style,
}: SaleCardProps) {
  const integrationId = getIntegrationId(sale.posSystem);
  const isManualSale = sale.posSystem === "manual" || sale.posSystem === "manual_upload";

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 border-l-4 ${
        posSystemColors[sale.posSystem] || "border-l-gray-500"
      } rounded-lg bg-gradient-to-r from-background to-muted/30 hover:shadow-md hover:scale-[1.01] transition-all duration-300 gap-3 ${
        isSelected ? 'ring-2 ring-primary bg-primary/5' : ''
      } ${isSelectionMode ? 'cursor-pointer' : ''}`}
      style={style}
      onClick={(e) => onCardClick(sale.id, e)}
      onKeyDown={(e) => {
        if (isSelectionMode && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onCardClick(sale.id, e as unknown as React.MouseEvent);
        }
      }}
      role={isSelectionMode ? "button" : undefined}
      tabIndex={isSelectionMode ? 0 : undefined}
      aria-pressed={isSelectionMode ? isSelected : undefined}
    >
      {/* Checkbox for selection mode */}
      {isSelectionMode && (
        <div
          className="flex items-start sm:items-center"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onCheckboxChange(sale.id)}
            aria-label={`Select ${sale.itemName}`}
          />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <IntegrationLogo integrationId={integrationId} size={20} />
          <h3 className="font-semibold text-base truncate">{sale.itemName}</h3>
          <Badge variant="secondary" className="text-xs font-medium">
            Qty: {sale.quantity}
          </Badge>
          {sale.totalPrice && (
            <Badge variant="outline" className="text-xs font-semibold bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
              ${sale.totalPrice.toFixed(2)}
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {sale.posSystem}
          </Badge>

          {/* Recipe badge */}
          {recipe ? (
            <Badge
              variant="outline"
              className="text-xs cursor-pointer hover:scale-105 transition-all bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/20"
              onClick={(e) => {
                e.stopPropagation();
                onNavigateToRecipe(recipe.id);
              }}
            >
              {!recipe.hasIngredients && (
                <AlertTriangle className="h-3 w-3 mr-1 text-amber-500" />
              )}
              <ExternalLink className="h-3 w-3 mr-1" />
              {recipe.name}
              {recipe.profitMargin != null && (
                <span className="ml-1 font-semibold">
                  ({recipe.profitMargin.toFixed(0)}%)
                </span>
              )}
            </Badge>
          ) : (
            <Badge
              variant="destructive"
              className="text-xs cursor-pointer hover:scale-105 transition-transform animate-pulse"
              onClick={(e) => {
                e.stopPropagation();
                onMapPOSItem(sale.itemName);
              }}
            >
              No Recipe
            </Badge>
          )}

          {/* AI suggested badge */}
          {sale.suggested_category_id && !sale.is_categorized && (
            <Badge variant="outline" className="bg-accent/10 text-accent-foreground border-accent/30">
              <Sparkles className="h-3 w-3 mr-1" />
              AI Suggested
            </Badge>
          )}

          {/* Categorized badge with edit/rule buttons */}
          {sale.is_categorized && sale.chart_account && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                {sale.chart_account.account_code} - {sale.chart_account.account_name}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onSetEditingCategory(sale.id);
                }}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onSuggestRule(sale);
                }}
                title="Create a rule based on this sale"
              >
                <Settings2 className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Split button for non-split sales */}
          {!sale.is_split && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onSplit(sale);
              }}
            >
              <Split className="h-3 w-3 mr-1" />
              Split
            </Button>
          )}

          {/* AI confidence badge */}
          {sale.ai_confidence && sale.suggested_category_id && !sale.is_categorized && (
            <Badge
              variant="outline"
              className={
                sale.ai_confidence === 'high'
                  ? 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30'
                  : sale.ai_confidence === 'medium'
                  ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/30'
                  : 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30'
              }
            >
              {sale.ai_confidence}
            </Badge>
          )}

          {/* Categorize button for uncategorized sales */}
          {!sale.is_categorized && !sale.suggested_category_id && !isEditingCategory && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs border-primary/50 hover:bg-primary/10"
              onClick={(e) => {
                e.stopPropagation();
                onSetEditingCategory(sale.id);
              }}
            >
              Categorize
            </Button>
          )}
        </div>

        {/* Date and order info */}
        <div className="text-sm text-muted-foreground">
          {formatSaleDate(sale.saleDate)}
          {sale.saleTime && ` at ${sale.saleTime}`}
          {sale.externalOrderId && (
            <>
              <br className="sm:hidden" />
              <span className="hidden sm:inline"> • </span>
              <span className="font-mono text-xs break-all max-w-full">Order: {sale.externalOrderId}</span>
            </>
          )}
        </div>

        {/* AI suggestion panel */}
        {sale.suggested_category_id && !sale.is_categorized && sale.chart_account && (
          <div className="mt-2 p-2 bg-accent/5 border border-accent/20 rounded-md">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs text-muted-foreground flex-1">
                <span className="font-medium text-foreground">AI Suggestion:</span> {sale.chart_account.account_name} ({sale.chart_account.account_code})
                {sale.ai_reasoning && <div className="mt-1 text-xs">{sale.ai_reasoning}</div>}
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="default"
                  className="text-xs h-7 px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCategorize({
                      saleId: sale.id,
                      categoryId: sale.suggested_category_id!,
                      accountInfo: {
                        account_name: sale.chart_account!.account_name,
                        account_code: sale.chart_account!.account_code,
                      }
                    });
                  }}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSplit(sale);
                  }}
                >
                  <Split className="h-3 w-3 mr-1" />
                  Split
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7 px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetEditingCategory(sale.id);
                  }}
                >
                  <X className="h-3 w-3 mr-1" />
                  Change
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Category editing panel */}
        {isEditingCategory && (
          <div className="mt-2 p-2 bg-muted/50 border border-border rounded-md">
            <div className="flex items-center gap-2">
              <div className="flex-1" onClick={(e) => e.stopPropagation()}>
                <SearchableAccountSelector
                  value={sale.category_id || sale.suggested_category_id || ""}
                  onValueChange={(categoryId) => {
                    const selectedAccount = accounts.find(acc => acc.id === categoryId);
                    onCategorize({
                      saleId: sale.id,
                      categoryId,
                      accountInfo: selectedAccount ? {
                        account_name: selectedAccount.account_name,
                        account_code: selectedAccount.account_code,
                      } : undefined
                    });
                    onSetEditingCategory(null);
                  }}
                  placeholder="Select category"
                  filterByTypes={['revenue', 'liability']}
                  autoOpen
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onSetEditingCategory(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {isManualSale && canEditManualSales && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(sale);
              }}
              className="text-xs hover:bg-blue-500/10 hover:border-blue-500/50 transition-all duration-200"
            >
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(sale.id);
              }}
              className="text-xs text-destructive hover:bg-destructive/10 hover:border-destructive/50 transition-all duration-200"
            >
              Delete
            </Button>
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onSimulateDeduction(sale.itemName, sale.quantity);
          }}
          className="w-full sm:w-auto text-xs hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
        >
          <span className="hidden sm:inline">Simulate Impact</span>
          <span className="sm:hidden">Impact</span>
        </Button>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render when these specific props change
  return (
    prevProps.sale.id === nextProps.sale.id &&
    prevProps.sale.is_categorized === nextProps.sale.is_categorized &&
    prevProps.sale.category_id === nextProps.sale.category_id &&
    prevProps.sale.suggested_category_id === nextProps.sale.suggested_category_id &&
    prevProps.sale.is_split === nextProps.sale.is_split &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isSelectionMode === nextProps.isSelectionMode &&
    prevProps.isEditingCategory === nextProps.isEditingCategory &&
    prevProps.recipe?.id === nextProps.recipe?.id &&
    prevProps.canEditManualSales === nextProps.canEditManualSales
  );
});

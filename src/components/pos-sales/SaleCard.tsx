import React, { memo } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Check, ExternalLink, Settings2, Sparkles, Split, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  const hasSuggestion = sale.suggested_category_id && !sale.is_categorized;

  return (
    <div
      className={`group flex items-start gap-3 px-4 py-3 border-b border-border/40 transition-colors ${
        isSelected ? 'bg-primary/5' : hasSuggestion ? 'bg-amber-500/5' : 'hover:bg-muted/30'
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
          className="pt-0.5"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onCheckboxChange(sale.id)}
            aria-label={`Select ${sale.itemName}`}
            className="data-[state=checked]:bg-foreground data-[state=checked]:border-foreground"
          />
        </div>
      )}

      {/* Integration logo */}
      <div className="pt-0.5 shrink-0">
        <IntegrationLogo integrationId={integrationId} size={18} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-2">
        {/* Top row: Item name + badges */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h3 className="text-[14px] font-medium text-foreground truncate">
              {sale.itemName}
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              {/* Date & time */}
              <span className="text-muted-foreground">
                {formatSaleDate(sale.saleDate)}
                {sale.saleTime && ` · ${sale.saleTime}`}
              </span>

              {/* Recipe badge */}
              {recipe ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateToRecipe(recipe.id);
                  }}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {!recipe.hasIngredients && (
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                  )}
                  <ExternalLink className="h-3 w-3" />
                  <span className="truncate max-w-[120px]">{recipe.name}</span>
                  {recipe.profitMargin != null && (
                    <span className="font-medium">({recipe.profitMargin.toFixed(0)}%)</span>
                  )}
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMapPOSItem(sale.itemName);
                  }}
                  className="text-destructive hover:text-destructive/80 transition-colors"
                >
                  No recipe
                </button>
              )}

              {/* Source badge */}
              <span className="text-muted-foreground/60">{sale.posSystem}</span>
            </div>
          </div>

          {/* Right side: Amount and quantity */}
          <div className="text-right shrink-0">
            {sale.totalPrice != null && (
              <p className="text-[15px] font-semibold text-foreground tabular-nums">
                ${sale.totalPrice.toFixed(2)}
              </p>
            )}
            <p className="text-[12px] text-muted-foreground">
              Qty: {sale.quantity}
            </p>
          </div>
        </div>

        {/* AI suggestion panel */}
        {hasSuggestion && sale.chart_account && (
          <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-[13px] text-foreground truncate">
                {sale.chart_account.account_name}
              </span>
              {sale.ai_confidence && (
                <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
                  sale.ai_confidence === 'high'
                    ? 'bg-green-500/10 text-green-700 dark:text-green-300'
                    : sale.ai_confidence === 'medium'
                    ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300'
                    : 'bg-red-500/10 text-red-700 dark:text-red-300'
                }`}>
                  {sale.ai_confidence}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
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
                className="h-7 px-2.5 text-[12px] font-medium bg-foreground text-background hover:bg-foreground/90"
              >
                <Check className="h-3 w-3 mr-1" />
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onSetEditingCategory(sale.id);
                }}
                className="h-7 px-2 text-[12px] text-muted-foreground hover:text-foreground"
              >
                Change
              </Button>
            </div>
          </div>
        )}

        {/* Categorized badge */}
        {sale.is_categorized && sale.chart_account && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-1 rounded-md bg-muted text-[12px] font-medium text-foreground">
              {sale.chart_account.account_code} · {sale.chart_account.account_name}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSetEditingCategory(sale.id);
              }}
              className="text-[12px] text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
            >
              Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSuggestRule(sale);
              }}
              className="text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
              title="Create rule"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Category editing panel */}
        {isEditingCategory && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border/40">
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
              className="h-8 px-2"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Action buttons - show on hover or when not categorized */}
        {!hasSuggestion && !isEditingCategory && (
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {!sale.is_categorized && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSetEditingCategory(sale.id);
                }}
                className="text-[12px] font-medium text-primary hover:text-primary/80 transition-colors"
              >
                Categorize
              </button>
            )}
            {!sale.is_split && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSplit(sale);
                }}
                className="inline-flex items-center text-[12px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Split className="h-3 w-3 mr-1" />
                Split
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSimulateDeduction(sale.itemName, sale.quantity);
              }}
              className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Check impact
            </button>
            {isManualSale && canEditManualSales && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(sale);
                  }}
                  className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(sale.id);
                  }}
                  className="text-[12px] text-destructive hover:text-destructive/80 transition-colors"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}
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

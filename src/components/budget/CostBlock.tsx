import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2 } from 'lucide-react';
import { CostBreakdownItem } from '@/types/operatingCosts';
import { ExpenseSuggestionBanner } from '@/components/budget/ExpenseSuggestionBanner';
import type { ExpenseSuggestion } from '@/types/operatingCosts';

interface CostBlockProps {
  title: string;
  subtitle?: string;
  totalDaily: number;
  items: CostBreakdownItem[];
  onAddItem?: () => void;
  onEditItem?: (item: CostBreakdownItem) => void;
  onDeleteItem?: (id: string) => void;
  showAddButton?: boolean;
  infoText?: string;
  showPercentages?: boolean;
  suggestions?: ExpenseSuggestion[];
  onAcceptSuggestion?: (suggestion: ExpenseSuggestion) => void;
  onSnoozeSuggestion?: (suggestionId: string) => void;
  onDismissSuggestion?: (suggestionId: string) => void;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCurrencyDetailed(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function CostBlock({
  title,
  subtitle,
  totalDaily,
  items,
  onAddItem,
  onEditItem,
  onDeleteItem,
  showAddButton = false,
  infoText,
  showPercentages = false,
  suggestions,
  onAcceptSuggestion,
  onSnoozeSuggestion,
  onDismissSuggestion,
}: CostBlockProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border rounded-lg bg-card">
        <CollapsibleTrigger asChild>
          <button 
            className="flex items-center justify-between w-full p-4 hover:bg-muted/50 transition-colors text-left"
            type="button"
          >
            <div className="flex items-center gap-2">
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <div>
                <span className="font-medium">{title}</span>
                {subtitle && (
                  <span className="text-sm text-muted-foreground ml-2">
                    ({subtitle})
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">
                {formatCurrency(totalDaily)}/day
              </span>
              {showAddButton && onAddItem && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddItem();
                  }}
                  className="h-8 px-2"
                >
                  <Plus className="h-4 w-4" />
                  <span className="sr-only">Add item</span>
                </Button>
              )}
            </div>
          </button>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-2">
            {suggestions && onAcceptSuggestion && onSnoozeSuggestion && onDismissSuggestion && (
              <ExpenseSuggestionBanner
                suggestions={suggestions}
                onAccept={onAcceptSuggestion}
                onSnooze={onSnoozeSuggestion}
                onDismiss={onDismissSuggestion}
              />
            )}
            {items.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2 text-center">
                No items configured yet.
                {onAddItem && (
                  <Button variant="link" onClick={onAddItem} className="px-1 h-auto">
                    Add one
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                {items.map((item) => (
                  <div 
                    key={item.id}
                    className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 group"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">
                        {item.name}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      {/* Monthly or percentage display */}
                      <div className="text-sm text-muted-foreground w-24 text-right">
                        {item.isPercentage && item.percentage !== undefined ? (
                          <span>{item.percentage.toFixed(1)}% of sales</span>
                        ) : (
                          <span>{formatCurrencyDetailed(item.monthly)}/mo</span>
                        )}
                      </div>
                      
                      {/* Daily equivalent */}
                      <div className="text-sm font-medium w-20 text-right">
                        → {formatCurrency(item.daily)}/day
                      </div>
                      
                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {onEditItem && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEditItem(item)}
                            className="h-7 w-7 p-0"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span className="sr-only">Edit</span>
                          </Button>
                        )}
                        {onDeleteItem && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDeleteItem(item.id)}
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {infoText && (
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <span className="text-muted-foreground">ℹ️</span>
                {infoText}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

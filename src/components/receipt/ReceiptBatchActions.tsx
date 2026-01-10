import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  ChevronDown, ChevronRight, CheckCircle, AlertCircle, Package
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReceiptLineItem } from '@/hooks/useReceiptImport';

interface CategoryGroup {
  category: string;
  icon: string;
  items: ReceiptLineItem[];
  readyCount: number;
  pendingCount: number;
}

interface ReceiptBatchActionsProps {
  lineItems: ReceiptLineItem[];
  onAcceptAll: (itemIds: string[]) => void;
  onSetPackageType: (itemIds: string[], packageType: string) => void;
  isImported: boolean;
}

// Map parsed categories to display names and icons
const CATEGORY_MAP: Record<string, { display: string; icon: string }> = {
  'beverages': { display: 'Beverages', icon: '🥤' },
  'beverage': { display: 'Beverages', icon: '🥤' },
  'drinks': { display: 'Beverages', icon: '🥤' },
  'dairy': { display: 'Dairy', icon: '🥛' },
  'milk': { display: 'Dairy', icon: '🥛' },
  'yogurt': { display: 'Dairy', icon: '🥛' },
  'cheese': { display: 'Dairy', icon: '🧀' },
  'meat': { display: 'Meat & Poultry', icon: '🥩' },
  'poultry': { display: 'Meat & Poultry', icon: '🍗' },
  'chicken': { display: 'Meat & Poultry', icon: '🍗' },
  'beef': { display: 'Meat & Poultry', icon: '🥩' },
  'pork': { display: 'Meat & Poultry', icon: '🥓' },
  'seafood': { display: 'Seafood', icon: '🦐' },
  'fish': { display: 'Seafood', icon: '🐟' },
  'produce': { display: 'Produce', icon: '🥬' },
  'vegetables': { display: 'Produce', icon: '🥕' },
  'fruits': { display: 'Produce', icon: '🍎' },
  'bakery': { display: 'Bakery', icon: '🍞' },
  'bread': { display: 'Bakery', icon: '🍞' },
  'cereal': { display: 'Breakfast', icon: '🥣' },
  'breakfast': { display: 'Breakfast', icon: '🥣' },
  'snacks': { display: 'Snacks', icon: '🍿' },
  'chips': { display: 'Snacks', icon: '🍟' },
  'condiments': { display: 'Condiments', icon: '🧴' },
  'sauces': { display: 'Condiments', icon: '🍯' },
  'pantry': { display: 'Pantry', icon: '🏪' },
  'frozen': { display: 'Frozen', icon: '🧊' },
  'other': { display: 'Other Items', icon: '📦' },
};

const getCategoryInfo = (category: string | null | undefined): { display: string; icon: string } => {
  if (!category) return { display: 'Uncategorized', icon: '📦' };
  const normalized = category.toLowerCase();
  
  // Try direct match
  if (CATEGORY_MAP[normalized]) return CATEGORY_MAP[normalized];
  
  // Try partial match
  for (const [key, value] of Object.entries(CATEGORY_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value;
    }
  }
  
  return { display: category, icon: '📦' };
};

export const ReceiptBatchActions: React.FC<ReceiptBatchActionsProps> = ({
  lineItems,
  onAcceptAll,
  onSetPackageType,
  isImported,
}) => {
  // Group items by category
  const categoryGroups = useMemo(() => {
    const groups: Record<string, CategoryGroup> = {};
    
    lineItems.forEach(item => {
      // Try to extract category from matched product or raw text
      const categoryKey = (item as any).parsed_category || 'other';
      const { display, icon } = getCategoryInfo(categoryKey);
      
      if (!groups[display]) {
        groups[display] = {
          category: display,
          icon,
          items: [],
          readyCount: 0,
          pendingCount: 0,
        };
      }
      
      groups[display].items.push(item);
      if (item.mapping_status === 'mapped' || item.mapping_status === 'new_item') {
        groups[display].readyCount++;
      } else if (item.mapping_status === 'pending') {
        groups[display].pendingCount++;
      }
    });
    
    // Sort by pending count (items needing attention first)
    return Object.values(groups).sort((a, b) => b.pendingCount - a.pendingCount);
  }, [lineItems]);

  // Only show batch actions if there are multiple categories or items
  if (categoryGroups.length <= 1 || lineItems.length < 5 || isImported) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Package className="h-4 w-4" />
        Batch Actions by Category
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {categoryGroups.map((group) => (
          <CategoryCard
            key={group.category}
            group={group}
            onAcceptAll={onAcceptAll}
          />
        ))}
      </div>
    </div>
  );
};

interface CategoryCardProps {
  group: CategoryGroup;
  onAcceptAll: (itemIds: string[]) => void;
}

const CategoryCard: React.FC<CategoryCardProps> = ({ group, onAcceptAll }) => {
  const pendingItems = group.items.filter(i => i.mapping_status === 'pending');
  const hasPending = pendingItems.length > 0;
  
  return (
    <div 
      className={cn(
        "flex items-center justify-between p-3 rounded-lg border transition-colors",
        hasPending ? "bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800" : "bg-muted/30"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{group.icon}</span>
        <div>
          <div className="font-medium text-sm">{group.category}</div>
          <div className="text-xs text-muted-foreground">
            {group.items.length} item{group.items.length > 1 ? 's' : ''}
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        {hasPending ? (
          <>
            <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-300 text-xs">
              {pendingItems.length} to map
            </Badge>
          </>
        ) : (
          <Badge variant="outline" className="bg-green-100 text-green-700 border-green-300 text-xs">
            <CheckCircle className="h-3 w-3 mr-1" />
            Ready
          </Badge>
        )}
      </div>
    </div>
  );
};

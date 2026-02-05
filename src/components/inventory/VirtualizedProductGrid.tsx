import React, { useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Edit, Trash, Trash2, ArrowRightLeft, ChefHat } from 'lucide-react';
import { LazyImage } from '@/components/ui/lazy-image';
import { InventoryValueBadge } from '@/components/InventoryValueBadge';
import { Product } from '@/hooks/useProducts';
import { ProductRecipeMap } from '@/hooks/useAllProductRecipes';
import { cn } from '@/lib/utils';

interface ProductMetrics {
  inventoryCost: number;
  inventoryValue: number;
  calculationMethod: string;
  markupUsed?: number;
}

interface InventoryMetrics {
  productMetrics: Record<string, ProductMetrics>;
}

interface RecipeIngredient {
  id: string;
  recipe_id: string;
  quantity: number;
  unit: string;
  recipe: {
    id: string;
    name: string;
    pos_item_name: string | null;
  };
}

interface VirtualizedProductGridProps {
  products: Product[];
  inventoryMetrics: InventoryMetrics;
  recipesByProduct: ProductRecipeMap;
  canDeleteProducts: boolean;
  onEditProduct: (product: Product) => void;
  onWasteProduct: (product: Product) => void;
  onTransferProduct: (product: Product) => void;
  onDeleteProduct: (product: Product) => void;
}

// Estimated row height - will be measured dynamically
const ESTIMATED_ROW_HEIGHT = 320;
const OVERSCAN = 3;

/**
 * Hook to get responsive column count based on viewport width
 */
function useColumnCount() {
  const [columns, setColumns] = React.useState(3);

  React.useEffect(() => {
    const updateColumns = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setColumns(1);
      } else if (width < 1024) {
        setColumns(2);
      } else {
        setColumns(3);
      }
    };

    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  return columns;
}

/**
 * Individual product card component - extracted for cleaner virtualization
 */
const ProductCard: React.FC<{
  product: Product;
  metrics?: ProductMetrics;
  recipes?: RecipeIngredient[];
  canDelete: boolean;
  onEdit: () => void;
  onWaste: () => void;
  onTransfer: () => void;
  onDelete: () => void;
}> = ({
  product,
  metrics,
  recipes,
  canDelete,
  onEdit,
  onWaste,
  onTransfer,
  onDelete,
}) => {
  const isLowStock = (product.current_stock || 0) <= (product.reorder_point || 0);

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow h-full">
      <CardHeader>
        <div className="flex items-start gap-3">
          {product.image_url && (
            <div className="flex-shrink-0">
              <LazyImage
                src={product.image_url}
                alt={product.name}
                transformWidth={128}
                transformQuality={75}
                className="w-16 h-16 object-cover rounded-lg border"
                containerClassName="w-16 h-16"
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CardTitle className="text-lg line-clamp-2 cursor-help leading-snug">
                        {product.name}
                      </CardTitle>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-md">
                      <p>{product.name}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <CardDescription className="truncate">SKU: {product.sku}</CardDescription>
              </div>
              <div className="flex-shrink-0 flex flex-wrap items-center gap-1 max-w-[120px] sm:max-w-none">
                {isLowStock && (
                  <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  className="h-7 w-7 p-0 flex-shrink-0"
                  title="Edit"
                  aria-label={`Edit ${product.name}`}
                >
                  <Edit className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onWaste();
                  }}
                  className="h-7 w-7 p-0 flex-shrink-0"
                  title="Waste"
                  aria-label={`Record waste for ${product.name}`}
                >
                  <Trash className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTransfer();
                  }}
                  className="h-7 w-7 p-0 flex-shrink-0"
                  title="Transfer"
                  aria-label={`Transfer ${product.name}`}
                >
                  <ArrowRightLeft className="h-3 w-3" />
                </Button>
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    className="h-7 w-7 p-0 flex-shrink-0 text-destructive hover:text-destructive"
                    title="Delete"
                    aria-label={`Delete ${product.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent onClick={onEdit}>
        <div className="space-y-2">
          {product.brand && (
            <p className="text-sm text-muted-foreground">Brand: {product.brand}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {product.category && (
              <Badge variant="secondary">{product.category}</Badge>
            )}
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm">Stock:</span>
            <div
              className={cn(
                'font-medium text-right',
                isLowStock ? 'text-destructive' : 'text-foreground'
              )}
            >
              <span>
                {Number(product.current_stock || 0).toFixed(2)} {product.uom_purchase || 'units'}
              </span>
            </div>
          </div>
          {product.cost_per_unit && (
            <div className="flex justify-between items-center">
              <span className="text-sm">Unit Cost:</span>
              <span className="font-medium">${Number(product.cost_per_unit).toFixed(2)}</span>
            </div>
          )}
          {metrics && (
            <>
              <div className="flex justify-between items-center">
                <span className="text-sm">Inventory Cost:</span>
                <span className="font-medium text-orange-600">
                  ${metrics.inventoryCost.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Inventory Value:</span>
                <span className="font-medium text-green-600">
                  ${metrics.inventoryValue.toFixed(2)}
                </span>
              </div>
              <div className="mt-2">
                <InventoryValueBadge
                  calculationMethod={metrics.calculationMethod}
                  markupUsed={metrics.markupUsed}
                  category={product.category}
                />
              </div>
            </>
          )}
          {/* Recipe Usage - pre-fetched data, no API calls */}
          {recipes && recipes.length > 0 && (
            <Alert variant="default" className="mt-3 py-2 px-3">
              <div className="flex items-start gap-2">
                <ChefHat className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0 space-y-1">
                  <AlertDescription className="text-xs">
                    <div className="font-medium mb-1">
                      Used in {recipes.length} recipe{recipes.length !== 1 ? 's' : ''}:
                    </div>
                    <div className="space-y-1">
                      {recipes.map((ri) => (
                        <div key={ri.id} className="flex items-center gap-2 flex-wrap">
                          <Link
                            to={`/recipes?recipeId=${ri.recipe.id}`}
                            className="text-primary hover:underline font-medium touch-manipulation min-h-[44px] flex items-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {ri.recipe.name}
                          </Link>
                          {ri.recipe.pos_item_name && (
                            <Badge variant="outline" className="text-xs">
                              {ri.recipe.pos_item_name}
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </div>
              </div>
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * VirtualizedProductGrid - Renders a virtualized grid of product cards
 *
 * Only renders visible rows plus overscan, dramatically reducing DOM nodes
 * and improving performance for large inventories (300+ items).
 */
export const VirtualizedProductGrid: React.FC<VirtualizedProductGridProps> = ({
  products,
  inventoryMetrics,
  recipesByProduct,
  canDeleteProducts,
  onEditProduct,
  onWasteProduct,
  onTransferProduct,
  onDeleteProduct,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const columns = useColumnCount();

  // Group products into rows based on column count
  const rows = useMemo(() => {
    const result: Product[][] = [];
    for (let i = 0; i < products.length; i += columns) {
      result.push(products.slice(i, i + columns));
    }
    return result;
  }, [products, columns]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => ESTIMATED_ROW_HEIGHT, []),
    overscan: OVERSCAN,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      className="h-[calc(100vh-400px)] min-h-[400px] overflow-auto"
      style={{ contain: 'strict' }}
    >
      <div
        className="relative w-full"
        style={{ height: `${totalHeight}px` }}
      >
        {virtualRows.map((virtualRow) => {
          const rowProducts = rows[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className={cn(
                'absolute top-0 left-0 w-full grid gap-4 pb-4',
                columns === 1 && 'grid-cols-1',
                columns === 2 && 'grid-cols-2',
                columns === 3 && 'grid-cols-3'
              )}
              style={{
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {rowProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  metrics={inventoryMetrics.productMetrics[product.id]}
                  recipes={recipesByProduct[product.id]}
                  canDelete={canDeleteProducts}
                  onEdit={() => onEditProduct(product)}
                  onWaste={() => onWasteProduct(product)}
                  onTransfer={() => onTransferProduct(product)}
                  onDelete={() => onDeleteProduct(product)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VirtualizedProductGrid;

import { memo, type CSSProperties, type Ref } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AlertTriangle, Clock, DollarSign, Edit, MoreHorizontal, Trash2 } from 'lucide-react';
import { RecipeConversionStatusBadge } from '@/components/RecipeConversionStatusBadge';
import { RECIPE_COLUMN_WIDTHS } from '@/components/recipes/recipeTableColumns';
import type { ConversionValidation } from '@/utils/recipeConversionValidation';

/**
 * Everything a row needs that would otherwise be derived during render.
 *
 * Rows are virtualized and memoized, so they must contain no hooks and do no
 * per-render work: formatting, validation and the empty-ingredient check are
 * computed once per recipe list in the parent and passed down by identity.
 */
export interface RecipeDisplayValues {
  hasNoIngredients: boolean;
  /**
   * Undefined only if a recipe reached the list without a validation entry.
   * The parent builds both maps from the same recipe array in the same render,
   * so that should not happen -- but `strictNullChecks` is off project-wide, so
   * the compiler would not catch it, and a row is not the place to crash over
   * it. Consumers below degrade to "no issues" instead.
   */
  validation: ConversionValidation | undefined;
  formattedCost: string;
  /** null when there are no sales for this recipe. */
  formattedSalePrice: string | null;
  /** null when profit is unknown (no sales data). */
  formattedProfit: string | null;
  profitIsPositive: boolean;
  /** null when margin is unknown. */
  formattedMargin: string | null;
  /**
   * The mobile card treats a zero margin as "no profit data" while the desktop
   * row prints "0.0%". Kept as two fields rather than unified, so this change
   * stays a pure perf refactor.
   */
  marginBadgeLabel: string;
  marginIsPositive: boolean;
  formattedDate: string;
}

interface RecipeRowProps<TRecipe> {
  recipe: TRecipe;
  displayValues: RecipeDisplayValues;
  onEdit: (recipe: TRecipe) => void;
  onDelete: (recipe: TRecipe) => void;
  onCreateFromBase?: (recipe: TRecipe) => void;
  /** Virtualizer plumbing: absolute offset, measurement ref and row index. */
  style: CSSProperties;
  measureRef: Ref<HTMLDivElement>;
  index: number;
}

/**
 * A row only changes when its recipe, its precomputed display values or one of
 * its callbacks changes. Scrolling re-runs the parent constantly, so without
 * this every visible row re-renders on every scroll frame.
 */
function areRowPropsEqual<TRecipe extends { id: string }>(
  prev: RecipeRowProps<TRecipe>,
  next: RecipeRowProps<TRecipe>
) {
  return (
    prev.recipe.id === next.recipe.id &&
    prev.displayValues === next.displayValues &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete &&
    prev.onCreateFromBase === next.onCreateFromBase &&
    prev.index === next.index &&
    prev.style.transform === next.style.transform
  );
}

interface RecipeShape {
  id: string;
  name: string;
  description?: string | null;
  pos_item_name?: string | null;
  serving_size?: number | null;
}

/** Identical in the desktop row and the mobile card, so it lives once here. */
function NoIngredientsBadge() {
  return (
    <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30">
      <AlertTriangle className="h-3 w-3 mr-1" aria-hidden="true" />
      No ingredients
    </Badge>
  );
}

function RecipeRow<TRecipe extends RecipeShape>({
  recipe,
  displayValues,
  onEdit,
  onDelete,
  onCreateFromBase,
  style,
  measureRef,
  index,
}: RecipeRowProps<TRecipe>) {
  return (
    <div
      role="row"
      // Only the visible window is mounted, so without an explicit index a
      // screen reader would announce row 3 of 3 while 130 recipes exist.
      // 1-based, and row 1 is the header.
      aria-rowindex={index + 2}
      data-index={index}
      ref={measureRef}
      style={style}
      className="flex items-center gap-2 px-4 py-3 border-b hover:bg-accent/50 transition-colors"
    >
      <div role="cell" className={RECIPE_COLUMN_WIDTHS.name}>
        <div className="flex items-center gap-2">
          <span className="font-medium" data-testid="recipe-name">{recipe.name}</span>
          {displayValues.hasNoIngredients && <NoIngredientsBadge />}
        </div>
        {recipe.description && (
          <div className="text-sm text-muted-foreground">{recipe.description}</div>
        )}
      </div>
      <div role="cell" className={RECIPE_COLUMN_WIDTHS.posItem}>
        {recipe.pos_item_name ? (
          <Badge variant="secondary">{recipe.pos_item_name}</Badge>
        ) : (
          <Badge variant="outline">Not mapped</Badge>
        )}
      </div>
      <div role="cell" className={RECIPE_COLUMN_WIDTHS.conversions}>
        <RecipeConversionStatusBadge
          hasIssues={displayValues.validation?.hasIssues ?? false}
          issueCount={displayValues.validation?.issueCount ?? 0}
          size="sm"
          showText={true}
        />
      </div>
      <div role="cell" className={RECIPE_COLUMN_WIDTHS.servingSize}>{recipe.serving_size || 1}</div>
      <div role="cell" className={RECIPE_COLUMN_WIDTHS.cost}>
        <div className="flex items-center">
          <DollarSign className="w-4 h-4 mr-1" aria-hidden="true" />
          {displayValues.formattedCost}
        </div>
      </div>
      <div role="cell" className={RECIPE_COLUMN_WIDTHS.salePrice}>
        {displayValues.formattedSalePrice ? (
          <div className="flex items-center">
            <DollarSign className="w-4 h-4 mr-1" aria-hidden="true" />
            {displayValues.formattedSalePrice}
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">No sales data</span>
        )}
      </div>
      <div role="cell" className={RECIPE_COLUMN_WIDTHS.profit}>
        {displayValues.formattedProfit !== null ? (
          <div className={`flex items-center ${displayValues.profitIsPositive ? 'text-green-600' : 'text-red-600'}`}>
            <DollarSign className="w-4 h-4 mr-1" aria-hidden="true" />
            {displayValues.formattedProfit}
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )}
      </div>
      <div role="cell" className={RECIPE_COLUMN_WIDTHS.margin}>
        {displayValues.formattedMargin !== null ? (
          <Badge variant={displayValues.marginIsPositive ? 'default' : 'destructive'}>
            {displayValues.formattedMargin}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )}
      </div>
      <div role="cell" className={RECIPE_COLUMN_WIDTHS.created}>
        <div className="flex items-center text-sm text-muted-foreground">
          <Clock className="w-4 h-4 mr-1" aria-hidden="true" />
          {displayValues.formattedDate}
        </div>
      </div>
      <div role="cell" className={RECIPE_COLUMN_WIDTHS.actions}>
        <div className="flex items-center justify-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={`Recipe actions for ${recipe.name}`}>
                <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-background">
              <DropdownMenuItem onClick={() => onEdit(recipe)}>Edit</DropdownMenuItem>
              {onCreateFromBase && (
                <DropdownMenuItem onClick={() => onCreateFromBase(recipe)}>
                  Create variation
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onDelete(recipe)} className="text-destructive focus:text-destructive">
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function RecipeCard<TRecipe extends RecipeShape>({
  recipe,
  displayValues,
  onEdit,
  onDelete,
  onCreateFromBase,
  style,
  measureRef,
  index,
}: RecipeRowProps<TRecipe>) {
  return (
    <div
      data-index={index}
      ref={measureRef}
      style={style}
      className="p-4 border-b hover:bg-accent/50 transition-colors"
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium truncate" data-testid="recipe-name">{recipe.name}</h3>
              {displayValues.hasNoIngredients && <NoIngredientsBadge />}
            </div>
            {recipe.description && (
              <p className="text-sm text-muted-foreground line-clamp-2">{recipe.description}</p>
            )}
          </div>
          <div className="flex gap-1 ml-2">
            <Button variant="ghost" size="sm" onClick={() => onEdit(recipe)} className="h-8 w-8 p-0" aria-label={`Edit recipe ${recipe.name}`}>
              <Edit className="w-3 h-3" aria-hidden="true" />
            </Button>
            {onCreateFromBase && (
              <Button variant="ghost" size="sm" onClick={() => onCreateFromBase(recipe)} className="h-8 px-2 text-xs">
                Create variation
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => onDelete(recipe)} className="h-8 w-8 p-0" aria-label={`Delete recipe ${recipe.name}`}>
              <Trash2 className="w-3 h-3" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {recipe.pos_item_name ? (
            <Badge variant="secondary" className="text-xs">{recipe.pos_item_name}</Badge>
          ) : (
            <Badge variant="outline" className="text-xs">Not mapped</Badge>
          )}
          <RecipeConversionStatusBadge
            hasIssues={displayValues.validation?.hasIssues ?? false}
            issueCount={displayValues.validation?.issueCount ?? 0}
            size="sm"
            showText={false}
          />
          <Badge variant="outline" className="text-xs">Size: {recipe.serving_size || 1}</Badge>
          <Badge variant="outline" className="text-xs">Cost: {displayValues.formattedCost}</Badge>
          {displayValues.formattedSalePrice && (
            <>
              <Badge variant="outline" className="text-xs">Sale: {displayValues.formattedSalePrice}</Badge>
              <Badge
                variant={displayValues.marginIsPositive ? 'default' : 'destructive'}
                className="text-xs"
              >
                {displayValues.marginBadgeLabel}
              </Badge>
            </>
          )}
        </div>

        <div className="text-xs text-muted-foreground">{displayValues.formattedDate}</div>
      </div>
    </div>
  );
}

export const MemoizedRecipeRow = memo(RecipeRow, areRowPropsEqual) as typeof RecipeRow;
export const MemoizedRecipeCard = memo(RecipeCard, areRowPropsEqual) as typeof RecipeCard;

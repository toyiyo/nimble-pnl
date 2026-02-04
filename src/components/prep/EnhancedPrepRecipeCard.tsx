import { PrepRecipe } from '@/hooks/usePrepRecipes';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  ChefHat,
  Clock,
  Edit,
  Package,
  Snowflake,
  Thermometer,
  Layers,
  Sparkles,
  Utensils,
  DollarSign,
  ArrowRight,
  CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { RecipeConversionStatusBadge } from '@/components/RecipeConversionStatusBadge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Category configuration matching the dialog
const CATEGORY_CONFIG = {
  prep: { icon: Utensils, color: 'bg-amber-500', lightColor: 'bg-amber-50', textColor: 'text-amber-700', borderColor: 'border-amber-200' },
  sauces: { icon: Package, color: 'bg-red-500', lightColor: 'bg-red-50', textColor: 'text-red-700', borderColor: 'border-red-200' },
  proteins: { icon: ChefHat, color: 'bg-rose-500', lightColor: 'bg-rose-50', textColor: 'text-rose-700', borderColor: 'border-rose-200' },
  dough: { icon: Layers, color: 'bg-yellow-600', lightColor: 'bg-yellow-50', textColor: 'text-yellow-700', borderColor: 'border-yellow-200' },
  desserts: { icon: Sparkles, color: 'bg-pink-500', lightColor: 'bg-pink-50', textColor: 'text-pink-700', borderColor: 'border-pink-200' },
  soup: { icon: Package, color: 'bg-orange-500', lightColor: 'bg-orange-50', textColor: 'text-orange-700', borderColor: 'border-orange-200' },
} as const;

interface EnhancedPrepRecipeCardProps {
  recipe: PrepRecipe & {
    category?: string;
    shelf_life_days?: number;
    oven_temp?: number;
    oven_temp_unit?: 'F' | 'C';
    procedure_steps?: Array<{ instruction: string }>;
  };
  costPerBatch?: number;
  costPerUnit?: number;
  onEdit?: () => void;
  onStartBatch?: () => void;
  conversionStatus?: { hasIssues: boolean; issueCount: number };
}

export function EnhancedPrepRecipeCard({
  recipe,
  costPerBatch = 0,
  costPerUnit = 0,
  onEdit,
  onStartBatch,
  conversionStatus
}: Readonly<EnhancedPrepRecipeCardProps>) {
  const ingredientCount = recipe.ingredients?.length || 0;
  const hasNoIngredients = ingredientCount === 0;
  const stockDisplay = recipe.output_product?.current_stock ?? null;
  const stockUnit = recipe.output_product?.uom_purchase || recipe.default_yield_unit;

  const category = recipe.category || 'prep';
  const categoryConfig = CATEGORY_CONFIG[category as keyof typeof CATEGORY_CONFIG] || CATEGORY_CONFIG.prep;
  const CategoryIcon = categoryConfig.icon;

  const procedureStepCount = recipe.procedure_steps?.length || 0;

  return (
    <Card className={cn(
      "group relative overflow-hidden transition-all duration-300",
      "hover:shadow-lg hover:shadow-primary/5",
      "border-l-4",
      categoryConfig.borderColor.replace('border-', 'border-l-')
    )}>
      {/* Subtle gradient background */}
      <div className={cn(
        "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
        "bg-gradient-to-r from-transparent via-transparent to-primary/5"
      )} />

      <CardContent className="relative p-5">
        <div className="flex gap-4">
          {/* Left: Category Icon */}
          <div className="hidden sm:flex flex-col items-center gap-2">
            <div className={cn(
              "p-3 rounded-xl shadow-sm transition-transform duration-300 group-hover:scale-105",
              categoryConfig.color
            )}>
              <CategoryIcon className="h-6 w-6 text-white" />
            </div>
            {!!recipe.shelf_life_days && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Snowflake className="h-3 w-3" />
                      {recipe.shelf_life_days}d
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Shelf life: {recipe.shelf_life_days} days</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {/* Center: Main Content */}
          <div className="flex-1 min-w-0 space-y-3">
            {/* Header row */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <h3 className="text-lg font-bold tracking-tight truncate group-hover:text-primary transition-colors">
                  {recipe.name}
                </h3>
                {recipe.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {recipe.description}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                {onEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-3 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={onEdit}
                  >
                    <Edit className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                )}
                {onStartBatch && (
                  <Button
                    size="sm"
                    className="h-8 px-3 gap-1.5"
                    onClick={onStartBatch}
                  >
                    <ChefHat className="h-3.5 w-3.5" />
                    Cook Now
                  </Button>
                )}
              </div>
            </div>

            {/* Stats row */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Yield badge */}
              <Badge className={cn(
                "gap-1.5 font-semibold",
                categoryConfig.lightColor,
                categoryConfig.textColor,
                "border",
                categoryConfig.borderColor
              )}>
                <Package className="h-3.5 w-3.5" />
                {recipe.default_yield} {recipe.default_yield_unit}
              </Badge>

              {/* Prep time */}
              {!!recipe.prep_time_minutes && (
                <Badge variant="outline" className="gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {recipe.prep_time_minutes} min
                </Badge>
              )}

              {/* Oven temp */}
              {!!recipe.oven_temp && (
                <Badge variant="outline" className="gap-1.5">
                  <Thermometer className="h-3.5 w-3.5" />
                  {recipe.oven_temp}°{recipe.oven_temp_unit || 'F'}
                </Badge>
              )}

              {/* Ingredients count */}
              <Badge variant="outline" className="gap-1.5">
                {ingredientCount} ingredient{ingredientCount !== 1 ? 's' : ''}
              </Badge>

              {/* Procedure steps */}
              {procedureStepCount > 0 && (
                <Badge variant="outline" className="gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {procedureStepCount} step{procedureStepCount !== 1 ? 's' : ''}
                </Badge>
              )}

              {/* Conversion status */}
              {conversionStatus && (
                <RecipeConversionStatusBadge
                  hasIssues={conversionStatus.hasIssues}
                  issueCount={conversionStatus.issueCount}
                  size="sm"
                  showText={true}
                />
              )}

              {/* No ingredients warning */}
              {hasNoIngredients && (
                <Badge
                  variant="outline"
                  className="gap-1.5 bg-amber-50 text-amber-700 border-amber-300"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  No ingredients
                </Badge>
              )}
            </div>

            {/* Cost & Stock row */}
            <div className="flex items-center justify-between pt-2 border-t border-dashed">
              {/* Cost info */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-primary/10">
                    <DollarSign className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Per Batch</p>
                    <p className="text-sm font-bold tabular-nums">${costPerBatch.toFixed(2)}</p>
                  </div>
                </div>
                <div className="h-8 w-px bg-border" />
                <div>
                  <p className="text-xs text-muted-foreground">Per {recipe.default_yield_unit}</p>
                  <p className="text-sm font-bold tabular-nums">${costPerUnit.toFixed(2)}</p>
                </div>
              </div>

              {/* Stock info */}
              {stockDisplay !== null && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">In Stock</p>
                  <p className={cn(
                    "text-sm font-bold tabular-nums",
                    stockDisplay > 0 ? "text-success" : "text-muted-foreground"
                  )}>
                    {stockDisplay} {stockUnit}
                  </p>
                </div>
              )}
            </div>

            {/* Output product */}
            {recipe.output_product?.name && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ArrowRight className="h-3 w-3" />
                <span>Outputs to:</span>
                <Badge variant="secondary" className="font-medium">
                  {recipe.output_product.name}
                </Badge>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Compact variant for list views
export function EnhancedPrepRecipeCardCompact({
  recipe,
  costPerBatch = 0,
  onEdit,
  onStartBatch,
  conversionStatus
}: Readonly<EnhancedPrepRecipeCardProps>) {
  const ingredientCount = recipe.ingredients?.length || 0;
  const category = recipe.category || 'prep';
  const categoryConfig = CATEGORY_CONFIG[category as keyof typeof CATEGORY_CONFIG] || CATEGORY_CONFIG.prep;
  const CategoryIcon = categoryConfig.icon;

  return (
    <div className={cn(
      "group flex items-center gap-4 p-4 rounded-xl border bg-card",
      "hover:shadow-md hover:border-primary/20 transition-all duration-200"
    )}>
      {/* Category indicator */}
      <div className={cn(
        "p-2.5 rounded-lg shrink-0 transition-transform duration-200 group-hover:scale-105",
        categoryConfig.color
      )}>
        <CategoryIcon className="h-5 w-5 text-white" />
      </div>

      {/* Content */}
      <button
        type="button"
        className="flex-1 min-w-0 cursor-pointer text-left bg-transparent border-none p-0"
        onClick={onEdit}
      >
        <div className="flex items-center gap-2">
          <h4 className="font-semibold truncate group-hover:text-primary transition-colors">
            {recipe.name}
          </h4>
          {conversionStatus?.hasIssues && (
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
          <span>{recipe.default_yield} {recipe.default_yield_unit}</span>
          <span>•</span>
          <span>{ingredientCount} ingredients</span>
          {!!recipe.prep_time_minutes && (
            <>
              <span>•</span>
              <span>{recipe.prep_time_minutes} min</span>
            </>
          )}
        </div>
      </button>

      {/* Cost */}
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-primary tabular-nums">${costPerBatch.toFixed(2)}</p>
        <p className="text-xs text-muted-foreground">per batch</p>
      </div>

      {/* Cook Now button */}
      {onStartBatch && (
        <Button
          size="sm"
          className="h-8 px-3 gap-1.5 shrink-0"
          onClick={onStartBatch}
        >
          <ChefHat className="h-3.5 w-3.5" />
          Cook
        </Button>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Search } from "lucide-react";
import type { Recipe, RecipeIngredient } from "@/hooks/useRecipes";
import type { Product } from "@/hooks/useProducts";
import { validateRecipeConversions } from "@/utils/recipeConversionValidation";
import { RecipeConversionStatusBadge } from "@/components/RecipeConversionStatusBadge";
import { buildRecipePrefill, type RecipeCopyOptions, type RecipePrefill } from "@/utils/recipePrefill";

interface RecipeCreateFromExistingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  recipes: Recipe[];
  products: Product[];
  fetchRecipeIngredients: (recipeId: string) => Promise<RecipeIngredient[]>;
  onConfirm: (payload: { prefill: RecipePrefill; basedOn: { id: string; name: string } }) => void;
  initialRecipeId?: string | null;
}

export function RecipeCreateFromExistingDialog({
  isOpen,
  onClose,
  recipes,
  products,
  fetchRecipeIngredients,
  onConfirm,
  initialRecipeId,
}: RecipeCreateFromExistingDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [options, setOptions] = useState<RecipeCopyOptions>({
    includeName: false,
    includeDescription: false,
    includePosMapping: false,
    includeServingSize: true,
    includeIngredients: true,
  });

  useEffect(() => {
    if (!isOpen) {
      setStep("choose");
      setSelectedRecipe(null);
      setSearchTerm("");
      setIngredients([]);
      setFetchError(null);
      setOptions({
        includeName: false,
        includeDescription: false,
        includePosMapping: false,
        includeServingSize: true,
        includeIngredients: true,
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !initialRecipeId) return;
    const match = recipes.find((recipe) => recipe.id === initialRecipeId);
    if (match) {
      setSelectedRecipe(match);
      setStep("confirm");
    }
  }, [isOpen, initialRecipeId, recipes]);

  useEffect(() => {
    if (step !== "confirm" || !selectedRecipe) return;

    let isActive = true;
    fetchRecipeIngredients(selectedRecipe.id)
      .then((data) => {
        if (!isActive) return;
        setIngredients(data);
        setFetchError(null);
      })
      .catch(() => {
        if (!isActive) return;
        setFetchError("Could not load ingredients from base recipe.");
        setIngredients([]);
        setOptions((prev) => ({
          ...prev,
          includeIngredients: false,
        }));
      });

    return () => {
      isActive = false;
    };
  }, [step, selectedRecipe, fetchRecipeIngredients]);

  const filteredRecipes = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return recipes;
    return recipes.filter((recipe) =>
      recipe.name.toLowerCase().includes(term) ||
      recipe.pos_item_name?.toLowerCase().includes(term)
    );
  }, [recipes, searchTerm]);

  const recipeValidationById = useMemo(() => {
    const map = new Map<string, { hasIssues: boolean; issueCount: number }>();
    recipes.forEach((recipe) => {
      const validation = validateRecipeConversions(recipe.ingredients || [], products);
      map.set(recipe.id, validation);
    });
    return map;
  }, [recipes, products]);

  const handleSelectRecipe = (recipe: Recipe) => {
    setSelectedRecipe(recipe);
    setStep("confirm");
  };

  const handleConfirm = () => {
    if (!selectedRecipe) return;

    const prefill = buildRecipePrefill(selectedRecipe, ingredients, options);
    onConfirm({ prefill, basedOn: { id: selectedRecipe.id, name: selectedRecipe.name } });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create from existing recipe</DialogTitle>
          <DialogDescription>
            Start from a base recipe to create a variation.
          </DialogDescription>
        </DialogHeader>

        {step === "choose" && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="Search recipes..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="pl-9"
              />
            </div>

            <ScrollArea className="max-h-[360px] pr-2">
              <div className="space-y-2">
                {filteredRecipes.map((recipe) => {
                  const validation = recipeValidationById.get(recipe.id);
                  const hasNoIngredients = !recipe.ingredients || recipe.ingredients.length === 0;

                  return (
                    <button
                      type="button"
                      key={recipe.id}
                      onClick={() => handleSelectRecipe(recipe)}
                      className="w-full rounded-lg border border-border/60 p-3 text-left transition-colors hover:bg-accent/40"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{recipe.name}</p>
                          {recipe.pos_item_name && (
                            <p className="text-xs text-muted-foreground truncate">{recipe.pos_item_name}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {hasNoIngredients && (
                            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-700 border-amber-500/30">
                              <AlertTriangle className="h-3 w-3 mr-1" aria-hidden="true" />
                              No ingredients
                            </Badge>
                          )}
                          {validation && (
                            <RecipeConversionStatusBadge
                              hasIssues={validation.hasIssues}
                              issueCount={validation.issueCount}
                              size="sm"
                              showText={false}
                            />
                          )}
                          <Badge variant="secondary" className="text-xs">
                            ${recipe.estimated_cost?.toFixed(2) || "0.00"}
                          </Badge>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        {step === "confirm" && selectedRecipe && (
          <div className="space-y-6">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">Base recipe</p>
              <p className="text-lg font-semibold">{selectedRecipe.name}</p>
              {selectedRecipe.pos_item_name && (
                <p className="text-sm text-muted-foreground">POS: {selectedRecipe.pos_item_name}</p>
              )}
            </div>

            <div className="space-y-3">
              <p className="font-medium">What do you want to reuse?</p>
              <label className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                <span>Copy ingredients and units</span>
                <Checkbox
                  checked={options.includeIngredients}
                  onCheckedChange={(value) =>
                    setOptions((prev) => ({ ...prev, includeIngredients: Boolean(value) }))
                  }
                  aria-label="Copy ingredients and units"
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                <span>Copy serving size</span>
                <Checkbox
                  checked={options.includeServingSize}
                  onCheckedChange={(value) =>
                    setOptions((prev) => ({ ...prev, includeServingSize: Boolean(value) }))
                  }
                  aria-label="Copy serving size"
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                <span>Copy description</span>
                <Checkbox
                  checked={options.includeDescription}
                  onCheckedChange={(value) =>
                    setOptions((prev) => ({ ...prev, includeDescription: Boolean(value) }))
                  }
                  aria-label="Copy description"
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                <span>Copy POS mapping</span>
                <Checkbox
                  checked={options.includePosMapping}
                  onCheckedChange={(value) =>
                    setOptions((prev) => ({ ...prev, includePosMapping: Boolean(value) }))
                  }
                  aria-label="Copy POS mapping"
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                <span>Copy name</span>
                <Checkbox
                  checked={options.includeName}
                  onCheckedChange={(value) =>
                    setOptions((prev) => ({ ...prev, includeName: Boolean(value) }))
                  }
                  aria-label="Copy name"
                />
              </label>
              {fetchError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                  {fetchError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" onClick={() => setStep("choose")}>
                Back
              </Button>
              <Button type="button" onClick={handleConfirm}>
                Create from base
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

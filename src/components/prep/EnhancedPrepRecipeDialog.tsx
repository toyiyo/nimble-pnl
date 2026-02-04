import { useEffect, useMemo, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertTriangle,
  Plus,
  Trash2,
  ChefHat,
  Clock,
  Thermometer,
  Package,
  ListOrdered,
  Snowflake,
  GripVertical,
  Calculator,
  BookOpen,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Layers,
  Utensils
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { GroupedUnitSelector } from '@/components/GroupedUnitSelector';
import { calculateIngredientsCost } from '@/lib/prepCostCalculation';
import { validateRecipeConversions } from '@/utils/recipeConversionValidation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { WEIGHT_UNITS, VOLUME_UNITS, COUNT_UNITS } from '@/lib/enhancedUnitConversion';
import { PrepRecipe } from '@/hooks/usePrepRecipes';
import { Product } from '@/hooks/useProducts';
import { IngredientUnit } from '@/lib/recipeUnits';

// Combined units from enhanced unit conversion system
const MEASUREMENT_UNITS = [...WEIGHT_UNITS, ...VOLUME_UNITS, ...COUNT_UNITS] as const;

// Categories matching the PDF recipe book structure
const PREP_CATEGORIES = [
  { value: 'prep', label: 'Prep', icon: Utensils, color: 'bg-amber-500' },
  { value: 'sauces', label: 'Sauces & Dressings', icon: Package, color: 'bg-red-500' },
  { value: 'proteins', label: 'Proteins', icon: ChefHat, color: 'bg-rose-500' },
  { value: 'dough', label: 'Dough & Bread', icon: Layers, color: 'bg-yellow-600' },
  { value: 'desserts', label: 'Desserts', icon: Sparkles, color: 'bg-pink-500' },
  { value: 'soup', label: 'Soups', icon: Package, color: 'bg-orange-500' },
] as const;

const SHELF_LIFE_OPTIONS = [
  { value: 1, label: '1 day' },
  { value: 2, label: '2 days' },
  { value: 3, label: '3 days' },
  { value: 5, label: '5 days' },
  { value: 7, label: '7 days' },
  { value: 14, label: '2 weeks' },
  { value: 30, label: '1 month' },
];

const STORAGE_OPTIONS = [
  { value: 'refrigerate', label: 'Refrigerate', icon: '❄️' },
  { value: 'freeze', label: 'Freeze', icon: '🧊' },
  { value: 'room_temp', label: 'Room Temp', icon: '🌡️' },
];

export interface EnhancedPrepRecipeFormValues {
  name: string;
  description?: string;
  output_product_id?: string | null;
  default_yield: number;
  default_yield_unit: IngredientUnit;
  prep_time_minutes?: number | null;
  category?: string;
  shelf_life_days?: number | null;
  storage_instructions?: string;
  oven_temp?: number | null;
  oven_temp_unit?: 'F' | 'C';
  equipment_notes?: string;
  ingredients: Array<{
    id?: string;
    product_id: string;
    quantity: number;
    quantity_2x?: number;
    unit: IngredientUnit;
    notes?: string;
    sort_order?: number;
  }>;
  procedure_steps: Array<{
    id?: string;
    step_number: number;
    instruction: string;
    timer_minutes?: number | null;
    critical_point?: boolean;
  }>;
}

interface EnhancedPrepRecipeDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (values: EnhancedPrepRecipeFormValues) => Promise<void>;
  readonly products: Product[];
  readonly editingRecipe?: PrepRecipe | null;
}

const defaultForm: EnhancedPrepRecipeFormValues = {
  name: '',
  description: '',
  output_product_id: undefined,
  default_yield: 1,
  default_yield_unit: 'lb' as IngredientUnit,
  prep_time_minutes: null,
  category: 'prep',
  shelf_life_days: 3,
  storage_instructions: '',
  oven_temp: null,
  oven_temp_unit: 'F',
  equipment_notes: '',
  ingredients: [
    { product_id: '', quantity: 1, quantity_2x: 2, unit: 'lb' as IngredientUnit, sort_order: 0 },
  ],
  procedure_steps: [
    { step_number: 1, instruction: '', timer_minutes: null, critical_point: false },
  ],
};

export function EnhancedPrepRecipeDialog({
  open,
  onOpenChange,
  onSubmit,
  products,
  editingRecipe,
}: EnhancedPrepRecipeDialogProps) {
  const [formValues, setFormValues] = useState<EnhancedPrepRecipeFormValues>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const [batchMultiplier, setBatchMultiplier] = useState(1);
  const { toast } = useToast();

  useEffect(() => {
    if (editingRecipe) {
      setFormValues({
        name: editingRecipe.name,
        description: editingRecipe.description || '',
        output_product_id: editingRecipe.output_product_id || undefined,
        default_yield: editingRecipe.default_yield || 1,
        default_yield_unit: editingRecipe.default_yield_unit || 'unit',
        prep_time_minutes: editingRecipe.prep_time_minutes ?? null,
        category: editingRecipe.category || 'prep',
        shelf_life_days: editingRecipe.shelf_life_days ?? 3,
        storage_instructions: editingRecipe.storage_instructions || '',
        oven_temp: editingRecipe.oven_temp ?? null,
        oven_temp_unit: editingRecipe.oven_temp_unit || 'F',
        equipment_notes: editingRecipe.equipment_notes || '',
        ingredients: (editingRecipe.ingredients || []).map((ing, index) => ({
          id: ing.id,
          product_id: ing.product_id,
          quantity: ing.quantity,
          quantity_2x: ing.quantity * 2,
          unit: ing.unit,
          notes: ing.notes,
          sort_order: ing.sort_order ?? index,
        })),
        procedure_steps: (editingRecipe.procedure_steps || []).length > 0
          ? editingRecipe.procedure_steps!.map((step) => ({
              id: step.id,
              step_number: step.step_number,
              instruction: step.instruction,
              timer_minutes: step.timer_minutes ?? null,
              critical_point: step.critical_point ?? false,
            }))
          : [{ step_number: 1, instruction: '', timer_minutes: null, critical_point: false }],
      });
    } else {
      setFormValues(defaultForm);
    }
    setActiveTab('details');
    setBatchMultiplier(1);
  }, [editingRecipe, open]);

  const productLookup = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const previewCost = useMemo(() => {
    const ingredientInfos = formValues.ingredients.map((ing) => {
      const product = productLookup.get(ing.product_id);
      const scaledQuantity = ing.quantity * batchMultiplier;
      return {
        product_id: ing.product_id,
        quantity: scaledQuantity,
        unit: ing.unit,
        product: product
          ? {
              id: product.id,
              name: product.name,
              cost_per_unit: product.cost_per_unit ?? 0,
              uom_purchase: product.uom_purchase,
              size_value: product.size_value,
              size_unit: product.size_unit,
              current_stock: product.current_stock,
            }
          : undefined,
      };
    });

    return calculateIngredientsCost(ingredientInfos);
  }, [formValues.ingredients, productLookup, batchMultiplier]);

  const conversionValidation = useMemo(() => {
    return validateRecipeConversions(formValues.ingredients, products);
  }, [formValues.ingredients, products]);

  const selectedCategory = PREP_CATEGORIES.find(c => c.value === formValues.category) || PREP_CATEGORIES[0];

  const handleIngredientChange = <K extends keyof EnhancedPrepRecipeFormValues['ingredients'][number]>(
    index: number,
    field: K,
    value: EnhancedPrepRecipeFormValues['ingredients'][number][K],
  ) => {
    const updated = [...formValues.ingredients];
    updated[index] = { ...updated[index], [field]: value };

    // Auto-calculate 2x quantity when 1x changes
    if (field === 'quantity' && typeof value === 'number') {
      updated[index].quantity_2x = value * 2;
    }

    setFormValues({ ...formValues, ingredients: updated });
  };

  const addIngredientRow = () => {
    setFormValues({
      ...formValues,
      ingredients: [
        ...formValues.ingredients,
        {
          product_id: '',
          quantity: 1,
          quantity_2x: 2,
          unit: formValues.default_yield_unit || 'unit',
          sort_order: formValues.ingredients.length,
        },
      ],
    });
  };

  const removeIngredientRow = (index: number) => {
    const updated = formValues.ingredients.filter((_, i) => i !== index);
    setFormValues({ ...formValues, ingredients: updated });
  };

  const handleProcedureStepChange = <K extends keyof EnhancedPrepRecipeFormValues['procedure_steps'][number]>(
    index: number,
    field: K,
    value: EnhancedPrepRecipeFormValues['procedure_steps'][number][K],
  ) => {
    const updated = [...formValues.procedure_steps];
    updated[index] = { ...updated[index], [field]: value };
    setFormValues({ ...formValues, procedure_steps: updated });
  };

  const addProcedureStep = () => {
    setFormValues({
      ...formValues,
      procedure_steps: [
        ...formValues.procedure_steps,
        {
          step_number: formValues.procedure_steps.length + 1,
          instruction: '',
          timer_minutes: null,
          critical_point: false,
        },
      ],
    });
  };

  const removeProcedureStep = (index: number) => {
    const updated = formValues.procedure_steps
      .filter((_, i) => i !== index)
      .map((step, i) => ({ ...step, step_number: i + 1 }));
    setFormValues({ ...formValues, procedure_steps: updated });
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await onSubmit({
        ...formValues,
        output_product_id: formValues.output_product_id || undefined,
        ingredients: formValues.ingredients.filter((ing) => ing.product_id),
        procedure_steps: formValues.procedure_steps.filter((step) => step.instruction.trim()),
      });
      onOpenChange(false);
    } catch (err: unknown) {
      console.error('Error saving prep recipe:', err);
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      toast({
        title: 'Failed to save recipe',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const completionScore = useMemo(() => {
    let score = 0;
    const total = 8;

    if (formValues.name) score++;
    if (formValues.description) score++;
    if (formValues.ingredients.some(i => i.product_id)) score++;
    if (formValues.procedure_steps.some(s => s.instruction.trim())) score++;
    if (formValues.shelf_life_days) score++;
    if (formValues.category) score++;
    if (formValues.output_product_id) score++;
    if (formValues.prep_time_minutes) score++;

    return { score, total, percentage: Math.round((score / total) * 100) };
  }, [formValues]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[98vw] max-w-6xl h-[95dvh] max-h-[95dvh] overflow-hidden p-0 flex flex-col bg-gradient-to-br from-background via-background to-secondary/20">
        {/* Decorative header accent */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-accent to-primary" />

        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-6 pt-6 pb-4">
            <DialogHeader className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-2.5 rounded-xl shadow-lg",
                    selectedCategory.color
                  )}>
                    <selectedCategory.icon className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl md:text-2xl font-bold tracking-tight">
                      {editingRecipe ? 'Edit Recipe' : 'Create Prep Recipe'}
                    </DialogTitle>
                    <DialogDescription className="text-sm mt-0.5">
                      Standardized recipe for consistent prep production
                    </DialogDescription>
                  </div>
                </div>

                {/* Completion indicator */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border">
                        <div className="relative w-8 h-8">
                          <svg className="w-8 h-8 -rotate-90">
                            <circle
                              cx="16"
                              cy="16"
                              r="12"
                              stroke="currentColor"
                              strokeWidth="3"
                              fill="none"
                              className="text-muted"
                            />
                            <circle
                              cx="16"
                              cy="16"
                              r="12"
                              stroke="currentColor"
                              strokeWidth="3"
                              fill="none"
                              strokeDasharray={75.4}
                              strokeDashoffset={75.4 - (75.4 * completionScore.percentage) / 100}
                              className="text-primary transition-all duration-500"
                              strokeLinecap="round"
                            />
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                            {completionScore.percentage}%
                          </span>
                        </div>
                        <span className="text-xs font-medium text-muted-foreground hidden sm:inline">
                          Recipe completeness
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{completionScore.score} of {completionScore.total} fields completed</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {/* Navigation Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3 h-11 p-1 bg-muted/50">
                  <TabsTrigger
                    value="details"
                    className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    <BookOpen className="h-4 w-4" />
                    <span className="hidden sm:inline">Details</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="ingredients"
                    className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    <Package className="h-4 w-4" />
                    <span className="hidden sm:inline">Ingredients</span>
                    {formValues.ingredients.filter(i => i.product_id).length > 0 && (
                      <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                        {formValues.ingredients.filter(i => i.product_id).length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="procedure"
                    className="gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    <ListOrdered className="h-4 w-4" />
                    <span className="hidden sm:inline">Procedure</span>
                    {formValues.procedure_steps.filter(s => s.instruction.trim()).length > 0 && (
                      <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                        {formValues.procedure_steps.filter(s => s.instruction.trim()).length}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </DialogHeader>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="px-6 py-5">
                  {/* Details Tab */}
                  {activeTab === 'details' && (
                    <div
                      className="space-y-6 animate-in fade-in slide-in-from-left-2 duration-200"
                    >
                      {/* Recipe Identity Card */}
                      <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-5">
                        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                          <ChefHat className="h-4 w-4" />
                          Recipe Identity
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                          <div className="space-y-2">
                            <Label htmlFor="name" className="text-sm font-medium">
                              Recipe Name <span className="text-destructive">*</span>
                            </Label>
                            <Input
                              id="name"
                              value={formValues.name}
                              onChange={(e) => setFormValues({ ...formValues, name: e.target.value })}
                              placeholder="e.g., Roasted Garlic, Caesar Dressing"
                              className="h-11 text-base font-medium"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="category" className="text-sm font-medium">Category</Label>
                            <Select
                              value={formValues.category}
                              onValueChange={(value) => setFormValues({ ...formValues, category: value })}
                            >
                              <SelectTrigger id="category" className="h-11">
                                <SelectValue placeholder="Select category" />
                              </SelectTrigger>
                              <SelectContent>
                                {PREP_CATEGORIES.map((cat) => (
                                  <SelectItem key={cat.value} value={cat.value}>
                                    <div className="flex items-center gap-2">
                                      <div className={cn("w-2 h-2 rounded-full", cat.color)} />
                                      {cat.label}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="description" className="text-sm font-medium">Description</Label>
                          <Textarea
                            id="description"
                            value={formValues.description}
                            onChange={(e) => setFormValues({ ...formValues, description: e.target.value })}
                            placeholder="Brief description of what this prep item is and when it's used..."
                            className="min-h-[80px] resize-none"
                          />
                        </div>
                      </div>

                      {/* Yield & Timing Card */}
                      <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-5">
                        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                          <Calculator className="h-4 w-4" />
                          Yield & Timing
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="default_yield" className="text-sm font-medium">
                              1X Yield
                            </Label>
                            <Input
                              id="default_yield"
                              type="number"
                              min="0"
                              step="0.01"
                              value={formValues.default_yield}
                              onChange={(e) =>
                                setFormValues({ ...formValues, default_yield: Number.parseFloat(e.target.value) || 0 })
                              }
                              className="h-11 text-lg font-semibold"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="default_yield_unit" className="text-sm font-medium">Yield Unit</Label>
                            <Select
                              value={formValues.default_yield_unit}
                              onValueChange={(value) =>
                                setFormValues({ ...formValues, default_yield_unit: value as IngredientUnit })
                              }
                            >
                              <SelectTrigger id="default_yield_unit" className="h-11">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {MEASUREMENT_UNITS.map((unit) => (
                                  <SelectItem key={unit} value={unit}>
                                    {unit}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="prep_time" className="text-sm font-medium flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5" />
                              Prep Time
                            </Label>
                            <div className="relative">
                              <Input
                                id="prep_time"
                                type="number"
                                min="0"
                                value={formValues.prep_time_minutes ?? ''}
                                onChange={(e) =>
                                  setFormValues({
                                    ...formValues,
                                    prep_time_minutes: e.target.value ? Number.parseInt(e.target.value, 10) : null,
                                  })
                                }
                                placeholder="30"
                                className="h-11 pr-12"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                min
                              </span>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="shelf_life" className="text-sm font-medium flex items-center gap-1.5">
                              <Snowflake className="h-3.5 w-3.5" />
                              Shelf Life
                            </Label>
                            <Select
                              value={formValues.shelf_life_days?.toString() || ''}
                              onValueChange={(value) =>
                                setFormValues({ ...formValues, shelf_life_days: Number.parseInt(value, 10) || null })
                              }
                            >
                              <SelectTrigger id="shelf_life" className="h-11">
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                              <SelectContent>
                                {SHELF_LIFE_OPTIONS.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value.toString()}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* 2X Yield Preview */}
                        <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Calculator className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium">Batch Scaling</p>
                            <p className="text-xs text-muted-foreground">
                              2X Yield: <span className="font-semibold text-foreground">{formValues.default_yield * 2} {formValues.default_yield_unit}</span>
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Equipment & Storage Card */}
                      <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-5">
                        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                          <Thermometer className="h-4 w-4" />
                          Equipment & Storage
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="oven_temp" className="text-sm font-medium">
                              Oven Temperature
                            </Label>
                            <div className="flex gap-2">
                              <Input
                                id="oven_temp"
                                type="number"
                                min="0"
                                value={formValues.oven_temp ?? ''}
                                onChange={(e) =>
                                  setFormValues({
                                    ...formValues,
                                    oven_temp: e.target.value ? Number.parseInt(e.target.value, 10) : null,
                                  })
                                }
                                placeholder="350"
                                className="h-11 flex-1"
                              />
                              <Select
                                value={formValues.oven_temp_unit}
                                onValueChange={(value: 'F' | 'C') =>
                                  setFormValues({ ...formValues, oven_temp_unit: value })
                                }
                              >
                                <SelectTrigger className="w-20 h-11">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="F">°F</SelectItem>
                                  <SelectItem value="C">°C</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="output" className="text-sm font-medium">Output Item</Label>
                            <Select
                              value={formValues.output_product_id || ''}
                              onValueChange={(value) => setFormValues({ ...formValues, output_product_id: value || undefined })}
                            >
                              <SelectTrigger id="output" className="h-11">
                                <SelectValue placeholder="Select inventory item" />
                              </SelectTrigger>
                              <SelectContent>
                                {products.map((product) => (
                                  <SelectItem key={product.id} value={product.id}>
                                    <div className="flex items-center gap-2">
                                      {product.name}
                                      <Badge variant="outline" className="ml-1 text-xs">
                                        {product.uom_purchase || 'unit'}
                                      </Badge>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Storage Method</Label>
                            <div className="flex gap-2">
                              {STORAGE_OPTIONS.map((opt) => (
                                <Button
                                  key={opt.value}
                                  type="button"
                                  variant={formValues.storage_instructions === opt.value ? 'default' : 'outline'}
                                  className={cn(
                                    "flex-1 h-11",
                                    formValues.storage_instructions === opt.value && "ring-2 ring-primary ring-offset-2"
                                  )}
                                  onClick={() => setFormValues({ ...formValues, storage_instructions: opt.value })}
                                >
                                  <span className="mr-1">{opt.icon}</span>
                                  <span className="text-xs">{opt.label}</span>
                                </Button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="equipment_notes" className="text-sm font-medium">Equipment Notes</Label>
                          <Input
                            id="equipment_notes"
                            value={formValues.equipment_notes}
                            onChange={(e) => setFormValues({ ...formValues, equipment_notes: e.target.value })}
                            placeholder="e.g., Pizza oven, food processor, dough mixer on speed 2"
                            className="h-11"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Ingredients Tab */}
                  {activeTab === 'ingredients' && (
                    <div
                      className="space-y-5 animate-in fade-in slide-in-from-left-2 duration-200"
                    >
                      {/* Batch multiplier control */}
                      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-gradient-to-r from-primary/5 via-transparent to-accent/5 border">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Calculator className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-semibold">Batch Calculator</p>
                            <p className="text-xs text-muted-foreground">Preview scaled quantities</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant={batchMultiplier === 1 ? 'default' : 'outline'}
                            size="sm"
                            className="h-9 px-4 font-semibold"
                            onClick={() => setBatchMultiplier(1)}
                          >
                            1X
                          </Button>
                          <Button
                            type="button"
                            variant={batchMultiplier === 2 ? 'default' : 'outline'}
                            size="sm"
                            className="h-9 px-4 font-semibold"
                            onClick={() => setBatchMultiplier(2)}
                          >
                            2X
                          </Button>
                          <Button
                            type="button"
                            variant={batchMultiplier === 3 ? 'default' : 'outline'}
                            size="sm"
                            className="h-9 px-4 font-semibold"
                            onClick={() => setBatchMultiplier(3)}
                          >
                            3X
                          </Button>
                        </div>
                      </div>

                      {/* Cost summary */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="p-4 rounded-xl bg-card border shadow-sm">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Cost</p>
                          <p className="text-2xl font-bold text-primary tabular-nums">
                            ${previewCost.totalCost.toFixed(2)}
                          </p>
                          {batchMultiplier > 1 && (
                            <p className="text-xs text-muted-foreground">
                              for {batchMultiplier}X batch
                            </p>
                          )}
                        </div>
                        <div className="p-4 rounded-xl bg-card border shadow-sm">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cost per Unit</p>
                          <p className="text-2xl font-bold tabular-nums">
                            ${formValues.default_yield > 0
                              ? (previewCost.totalCost / (formValues.default_yield * batchMultiplier)).toFixed(2)
                              : '0.00'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            per {formValues.default_yield_unit}
                          </p>
                        </div>
                        <div className="p-4 rounded-xl bg-card border shadow-sm">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Yield</p>
                          <p className="text-2xl font-bold tabular-nums">
                            {formValues.default_yield * batchMultiplier}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formValues.default_yield_unit}
                          </p>
                        </div>
                        <div className="p-4 rounded-xl bg-card border shadow-sm">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ingredients</p>
                          <p className="text-2xl font-bold tabular-nums">
                            {formValues.ingredients.filter(i => i.product_id).length}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            items
                          </p>
                        </div>
                      </div>

                      {/* Ingredient table header */}
                      <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b">
                        <div className="col-span-5">Ingredient</div>
                        <div className="col-span-2 text-center">1X Qty</div>
                        <div className="col-span-2 text-center">
                          {batchMultiplier}X Qty
                        </div>
                        <div className="col-span-2">Unit</div>
                        <div className="col-span-1 text-right">Cost</div>
                      </div>

                      {/* Ingredient rows */}
                      <div className="space-y-3">
                        {formValues.ingredients.map((ingredient, index) => {
                          const selectedProduct = productLookup.get(ingredient.product_id);
                          const conversionIssue = conversionValidation.issues.find(
                            (issue) => issue.ingredientIndex === index
                          );
                          const costData = previewCost.ingredients[index];

                          return (
                            <div
                              key={ingredient.id || `temp-${index}`}
                              className={cn(
                                "rounded-xl border bg-card p-4 shadow-sm transition-all animate-in fade-in slide-in-from-bottom-2",
                                conversionIssue && "border-amber-300 bg-amber-50/50"
                              )}
                              style={{ animationDelay: `${index * 50}ms` }}
                            >
                              <div className="grid grid-cols-12 gap-3 items-start">
                                {/* Drag handle & index */}
                                <div className="col-span-12 md:col-span-5 flex items-center gap-3">
                                  <div className="flex items-center gap-2">
                                    <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab" />
                                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                                      {index + 1}
                                    </span>
                                  </div>
                                  <div className="flex-1">
                                    <Select
                                      value={ingredient.product_id}
                                      onValueChange={(value) => handleIngredientChange(index, 'product_id', value)}
                                    >
                                      <SelectTrigger className="h-11 bg-background">
                                        <SelectValue placeholder="Select ingredient" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {products.map((product) => (
                                          <SelectItem key={product.id} value={product.id}>
                                            {product.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>

                                {/* 1X Quantity */}
                                <div className="col-span-4 md:col-span-2">
                                  <Label className="md:hidden text-xs text-muted-foreground mb-1 block">1X Qty</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={ingredient.quantity}
                                    onChange={(e) => handleIngredientChange(index, 'quantity', Number.parseFloat(e.target.value) || 0)}
                                    className="h-11 text-center font-semibold bg-background"
                                  />
                                </div>

                                {/* Scaled Quantity */}
                                <div className="col-span-4 md:col-span-2">
                                  <Label className="md:hidden text-xs text-muted-foreground mb-1 block">{batchMultiplier}X Qty</Label>
                                  <div className="h-11 flex items-center justify-center rounded-md bg-muted/50 border font-semibold text-muted-foreground tabular-nums">
                                    {(ingredient.quantity * batchMultiplier).toFixed(ingredient.quantity % 1 === 0 ? 0 : 2)}
                                  </div>
                                </div>

                                {/* Unit */}
                                <div className="col-span-4 md:col-span-2">
                                  <Label className="md:hidden text-xs text-muted-foreground mb-1 block">Unit</Label>
                                  <GroupedUnitSelector
                                    value={ingredient.unit}
                                    onValueChange={(value) => handleIngredientChange(index, 'unit', value as IngredientUnit)}
                                    placeholder="Unit"
                                    productName={selectedProduct?.name}
                                    productSizeUnit={selectedProduct?.size_unit || selectedProduct?.uom_purchase}
                                    className="w-full h-11"
                                  />
                                </div>

                                {/* Cost & Actions */}
                                <div className="col-span-12 md:col-span-1 flex items-center justify-between md:justify-end gap-2">
                                  {costData && (
                                    <span className="text-sm font-semibold text-primary tabular-nums">
                                      ${costData.costImpact.toFixed(2)}
                                    </span>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                    onClick={() => removeIngredientRow(index)}
                                    aria-label="Remove ingredient"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              {/* Notes row */}
                              <div className="mt-3 pt-3 border-t border-dashed">
                                <Input
                                  value={ingredient.notes || ''}
                                  onChange={(e) => handleIngredientChange(index, 'notes', e.target.value)}
                                  placeholder="Notes: prep method, alternates, trim percentage..."
                                  className="h-9 text-sm bg-muted/30 border-0"
                                />
                              </div>

                              {/* Conversion warning */}
                              {conversionIssue && (
                                <div className="mt-3 flex items-start gap-2 p-2 rounded-lg bg-amber-100 text-amber-800">
                                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                                  <p className="text-xs">{conversionIssue.message}</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-12 border-dashed border-2 hover:border-primary hover:bg-primary/5"
                        onClick={addIngredientRow}
                      >
                        <Plus className="h-5 w-5 mr-2" />
                        Add Ingredient
                      </Button>
                    </div>
                  )}

                  {/* Procedure Tab */}
                  {activeTab === 'procedure' && (
                    <div
                      className="space-y-5 animate-in fade-in slide-in-from-left-2 duration-200"
                    >
                      {/* Procedure intro */}
                      <div className="flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-accent/5 via-transparent to-primary/5 border">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-accent/10">
                            <ListOrdered className="h-5 w-5 text-accent" />
                          </div>
                          <div>
                            <p className="font-semibold">Preparation Steps</p>
                            <p className="text-xs text-muted-foreground">
                              Clear, numbered instructions for consistent results
                            </p>
                          </div>
                        </div>
                        <Badge variant="outline" className="gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {formValues.prep_time_minutes || 0} min total
                        </Badge>
                      </div>

                      {/* Procedure steps */}
                      <div className="space-y-4">
                        {formValues.procedure_steps.map((step, index) => (
                          <div
                            key={step.id || `step-${index}`}
                            className={cn(
                              "rounded-xl border bg-card shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2",
                              step.critical_point && "border-amber-300 ring-2 ring-amber-200"
                            )}
                            style={{ animationDelay: `${index * 50}ms` }}
                          >
                            <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 border-b">
                              <div className={cn(
                                "flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm",
                                step.critical_point
                                  ? "bg-amber-500 text-white"
                                  : "bg-primary text-primary-foreground"
                              )}>
                                {step.step_number}
                              </div>

                              <div className="flex-1 flex items-center gap-2">
                                {step.critical_point && (
                                  <Badge className="bg-amber-500 text-white gap-1">
                                    <AlertCircle className="h-3 w-3" />
                                    Critical Point
                                  </Badge>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant={step.critical_point ? 'default' : 'ghost'}
                                        size="icon"
                                        className={cn(
                                          "h-8 w-8",
                                          step.critical_point && "bg-amber-500 hover:bg-amber-600"
                                        )}
                                        onClick={() => handleProcedureStepChange(index, 'critical_point', !step.critical_point)}
                                      >
                                        <AlertCircle className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Mark as critical quality point</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => removeProcedureStep(index)}
                                  aria-label="Remove step"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>

                            <div className="p-4 space-y-3">
                              <Textarea
                                value={step.instruction}
                                onChange={(e) => handleProcedureStepChange(index, 'instruction', e.target.value)}
                                placeholder="Describe this step clearly..."
                                className="min-h-[80px] resize-none text-base"
                              />

                              <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                  <Clock className="h-4 w-4 text-muted-foreground" />
                                  <Input
                                    type="number"
                                    min="0"
                                    value={step.timer_minutes ?? ''}
                                    onChange={(e) =>
                                      handleProcedureStepChange(
                                        index,
                                        'timer_minutes',
                                        e.target.value ? Number.parseInt(e.target.value, 10) : null
                                      )
                                    }
                                    placeholder="Timer"
                                    className="w-20 h-9"
                                  />
                                  <span className="text-sm text-muted-foreground">min</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-12 border-dashed border-2 hover:border-accent hover:bg-accent/5"
                        onClick={addProcedureStep}
                      >
                        <Plus className="h-5 w-5 mr-2" />
                        Add Step
                      </Button>

                      {/* Storage reminder */}
                      <div className="p-4 rounded-xl bg-muted/50 border border-dashed space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <CheckCircle2 className="h-4 w-4 text-success" />
                          Standard Closing Step
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Cover, label, date, {formValues.storage_instructions || 'refrigerate'}, and rotate.
                        </p>
                      </div>
                    </div>
                  )}
              </div>
            </ScrollArea>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 z-20 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-6 py-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              {/* Quick stats */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Package className="h-4 w-4" />
                  <span>{formValues.ingredients.filter(i => i.product_id).length} ingredients</span>
                </div>
                <Separator orientation="vertical" className="h-4" />
                <div className="flex items-center gap-1.5">
                  <ListOrdered className="h-4 w-4" />
                  <span>{formValues.procedure_steps.filter(s => s.instruction.trim()).length} steps</span>
                </div>
                <Separator orientation="vertical" className="h-4" />
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-primary">${previewCost.totalCost.toFixed(2)}</span>
                  <span>cost</span>
                </div>
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                  className="flex-1 sm:flex-none"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={saving || !formValues.name}
                  className="flex-1 sm:flex-none min-w-[140px] gap-2"
                >
                  {saving ? (
                    <>
                      <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      {editingRecipe ? 'Save Changes' : 'Create Recipe'}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

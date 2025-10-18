import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useInventoryDeduction, DeductionResult } from '@/hooks/useInventoryDeduction';
import { Calculator, TrendingDown, Package, ChefHat, AlertTriangle } from 'lucide-react';

interface InventoryDeductionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  restaurantId: string;
  posItemName: string;
  quantitySold: number;
}

export function InventoryDeductionDialog({
  isOpen,
  onClose,
  restaurantId,
  posItemName,
  quantitySold,
}: InventoryDeductionDialogProps) {
  const { simulateDeduction, processDeduction, loading } = useInventoryDeduction();
  const [simulationResult, setSimulationResult] = useState<DeductionResult | null>(null);
  const [hasProcessed, setHasProcessed] = useState(false);

  const handleSimulate = async () => {
    const result = await simulateDeduction(restaurantId, posItemName, quantitySold);
    setSimulationResult(result);
  };

  const handleProcess = async () => {
    const result = await processDeduction(
      restaurantId,
      posItemName,
      quantitySold,
      new Date().toISOString().split('T')[0]
    );
    if (result) {
      setSimulationResult(result);
      setHasProcessed(true);
    }
  };

  const handleClose = () => {
    setSimulationResult(null);
    setHasProcessed(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Calculator className="w-4 h-4 sm:w-5 sm:h-5" />
            Inventory Deduction Calculator
          </DialogTitle>
          <DialogDescription className="text-sm">
            {hasProcessed 
              ? `Successfully processed inventory deduction for ${quantitySold}x ${posItemName}`
              : `Preview and process inventory deduction for ${quantitySold}x ${posItemName}`
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {!simulationResult && (
            <div className="text-center py-6 sm:py-8">
              <ChefHat className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground mx-auto mb-3 sm:mb-4" />
              <h3 className="text-base sm:text-lg font-semibold mb-2">Calculate Recipe Impact</h3>
              <p className="text-sm text-muted-foreground mb-4 px-4">
                See how this sale will affect your inventory levels
              </p>
              <Button onClick={handleSimulate} disabled={loading} className="w-full sm:w-auto">
                {loading ? 'Calculating...' : 'Simulate Deduction'}
              </Button>
            </div>
          )}

          {simulationResult?.already_processed && (
            <Card className="border-orange-200 bg-orange-50">
              <CardContent className="text-center py-6 sm:py-8 px-4">
                <ChefHat className="w-10 h-10 sm:w-12 sm:h-12 text-orange-500 mx-auto mb-3 sm:mb-4" />
                <h3 className="text-base sm:text-lg font-semibold mb-2 text-orange-700">Sale Already Processed</h3>
                <p className="text-sm text-orange-600 mb-4">
                  This sale has already been deducted from inventory on {new Date().toLocaleDateString()}
                </p>
                <div className="text-xs sm:text-sm text-orange-500">
                  Duplicate processing is prevented to maintain inventory accuracy
                </div>
              </CardContent>
            </Card>
          )}

          {simulationResult && !simulationResult.already_processed && (
            <>
              {/* Conversion Warnings Alert */}
              {simulationResult.conversion_warnings && simulationResult.conversion_warnings.length > 0 && (
                <Alert variant="destructive" className="border-amber-500 bg-amber-50">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  <AlertTitle className="text-amber-900 font-semibold">
                    {simulationResult.conversion_warnings.length} Conversion {simulationResult.conversion_warnings.length === 1 ? 'Warning' : 'Warnings'}
                  </AlertTitle>
                  <AlertDescription className="text-amber-800">
                    <p className="mb-2">
                      The following ingredients are using 1:1 fallback ratio which may over-deduct inventory:
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                      {simulationResult.conversion_warnings.map((warning, idx) => (
                        <li key={idx} className="text-sm">
                          <span className="font-medium">{warning.product_name}</span>: {warning.message}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-sm font-medium">
                      💡 Fix by adding size information (e.g., "5 lb" or "750 ml") to these products in your inventory.
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              {/* Summary Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                    <Package className="w-4 h-4 sm:w-5 sm:h-5" />
                    Deduction Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs sm:text-sm text-muted-foreground">Recipe</div>
                      <div className="text-sm sm:text-base font-medium break-words">{simulationResult.recipe_name || 'No recipe found'}</div>
                    </div>
                    <div>
                      <div className="text-xs sm:text-sm text-muted-foreground">Quantity Sold</div>
                      <div className="text-sm sm:text-base font-medium break-words">{quantitySold}x {posItemName}</div>
                    </div>
                    <div>
                      <div className="text-xs sm:text-sm text-muted-foreground">Total Cost</div>
                      <div className="text-sm sm:text-base font-medium text-green-600">
                        ${(simulationResult.total_cost || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Ingredients Deduction Table */}
              {simulationResult.ingredients_deducted.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                      <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5" />
                      Ingredient Deductions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto -mx-2 sm:mx-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[100px] text-xs sm:text-sm">Ingredient</TableHead>
                          <TableHead className="min-w-[90px] text-xs sm:text-sm">Recipe</TableHead>
                          <TableHead className="min-w-[100px] text-xs sm:text-sm">Deduction</TableHead>
                          <TableHead className="min-w-[130px] hidden lg:table-cell text-xs sm:text-sm">Conversion</TableHead>
                          <TableHead className="min-w-[100px] text-xs sm:text-sm">Remaining</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {simulationResult.ingredients_deducted.map((ingredient, index) => (
                          <TableRow key={index}>
                            <TableCell className="font-medium text-xs sm:text-sm">
                              <div className="max-w-[120px] truncate">{ingredient.product_name}</div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs whitespace-nowrap">
                                {ingredient.quantity_recipe_units} {ingredient.recipe_unit}
                              </Badge>
                            </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs whitespace-nowrap">
                              {(ingredient.quantity_purchase_units || 0).toFixed(3)} {ingredient.purchase_unit}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <div className="flex items-center gap-2">
                              <div className="text-xs sm:text-sm whitespace-nowrap">
                                {ingredient.quantity_recipe_units} {ingredient.recipe_unit} → {(ingredient.quantity_purchase_units || 0).toFixed(3)} {ingredient.purchase_unit}
                              </div>
                              {ingredient.conversion_method === 'fallback_1:1' && (
                                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 text-xs">
                                  ⚠️ 1:1
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className={`font-medium text-xs sm:text-sm ${
                              (ingredient.remaining_stock_purchase_units || 0) < 1 ? 'text-red-600' : 'text-green-600'
                            }`}>
                              {(ingredient.remaining_stock_purchase_units || 0).toFixed(2)} {ingredient.purchase_unit}
                            </div>
                            {(ingredient.remaining_stock_purchase_units || 0) < 1 && (
                              <div className="text-xs text-red-500 mt-1">Low stock!</div>
                            )}
                          </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {simulationResult.ingredients_deducted.length === 0 && (
                <Card>
                  <CardContent className="text-center py-6 sm:py-8 px-4">
                    <ChefHat className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground mx-auto mb-3 sm:mb-4" />
                    <h3 className="text-base sm:text-lg font-semibold mb-2">No Recipe Found</h3>
                    <p className="text-sm text-muted-foreground">
                      No recipe is mapped to "{posItemName}". Create a recipe to enable inventory deduction.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-4">
                <Button variant="outline" onClick={handleClose} className="w-full sm:w-auto">
                  Close
                </Button>
                {!hasProcessed && !simulationResult.already_processed && simulationResult.ingredients_deducted.length > 0 && (
                  <Button onClick={handleProcess} disabled={loading} className="w-full sm:w-auto">
                    {loading ? 'Processing...' : 'Process Deduction'}
                  </Button>
                )}
                {(hasProcessed || simulationResult.already_processed) && (
                  <Badge variant="default" className="px-4 py-2">
                    ✓ {simulationResult.already_processed ? 'Previously Processed' : 'Processed Successfully'}
                  </Badge>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
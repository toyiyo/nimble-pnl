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
import { useInventoryDeduction, DeductionResult } from '@/hooks/useInventoryDeduction';
import { Calculator, TrendingDown, Package, ChefHat } from 'lucide-react';

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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            Inventory Deduction Calculator
          </DialogTitle>
          <DialogDescription>
            {hasProcessed 
              ? `Successfully processed inventory deduction for ${quantitySold}x ${posItemName}`
              : `Preview and process inventory deduction for ${quantitySold}x ${posItemName}`
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {!simulationResult && (
            <div className="text-center py-8">
              <ChefHat className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Calculate Recipe Impact</h3>
              <p className="text-muted-foreground mb-4">
                See how this sale will affect your inventory levels
              </p>
              <Button onClick={handleSimulate} disabled={loading}>
                {loading ? 'Calculating...' : 'Simulate Deduction'}
              </Button>
            </div>
          )}

          {simulationResult?.already_processed && (
            <Card className="border-orange-200 bg-orange-50">
              <CardContent className="text-center py-8">
                <ChefHat className="w-12 h-12 text-orange-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2 text-orange-700">Sale Already Processed</h3>
                <p className="text-orange-600 mb-4">
                  This sale has already been deducted from inventory on {new Date().toLocaleDateString()}
                </p>
                <div className="text-sm text-orange-500">
                  Duplicate processing is prevented to maintain inventory accuracy
                </div>
              </CardContent>
            </Card>
          )}

          {simulationResult && !simulationResult.already_processed && (
            <>
              {/* Summary Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="w-5 h-5" />
                    Deduction Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Recipe</div>
                      <div className="font-medium">{simulationResult.recipe_name || 'No recipe found'}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Quantity Sold</div>
                      <div className="font-medium">{quantitySold}x {posItemName}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Total Cost</div>
                      <div className="font-medium text-green-600">
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
                    <CardTitle className="flex items-center gap-2">
                      <TrendingDown className="w-5 h-5" />
                      Ingredient Deductions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ingredient</TableHead>
                          <TableHead>Recipe Usage</TableHead>
                          <TableHead>Purchase Deduction</TableHead>
                          <TableHead>Conversion</TableHead>
                          <TableHead>Remaining Stock</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {simulationResult.ingredients_deducted.map((ingredient, index) => (
                          <TableRow key={index}>
                            <TableCell className="font-medium">
                              {ingredient.product_name}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">
                                {ingredient.quantity_recipe_units} {ingredient.recipe_unit}
                              </Badge>
                            </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {(ingredient.quantity_purchase_units || 0).toFixed(3)} {ingredient.purchase_unit}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <div>1 {ingredient.purchase_unit} = </div>
                              <div>{ingredient.conversion_factor || 1} {ingredient.recipe_unit}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className={`font-medium ${
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
                  <CardContent className="text-center py-8">
                    <ChefHat className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No Recipe Found</h3>
                    <p className="text-muted-foreground">
                      No recipe is mapped to "{posItemName}". Create a recipe to enable inventory deduction.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-4">
                <Button variant="outline" onClick={handleClose}>
                  Close
                </Button>
                {!hasProcessed && !simulationResult.already_processed && simulationResult.ingredients_deducted.length > 0 && (
                  <Button onClick={handleProcess} disabled={loading}>
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
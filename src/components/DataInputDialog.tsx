import { useState, useEffect } from 'react';
import { CalendarIcon, DollarSign, ShoppingCart, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDailyPnL, DailySales, DailyFoodCosts, DailyLaborCosts } from '@/hooks/useDailyPnL';
import { supabase } from '@/integrations/supabase/client';

interface DataInputDialogProps {
  restaurantId: string;
  onDataUpdated?: () => void;
  className?: string;
}

export function DataInputDialog({ restaurantId, onDataUpdated, className }: DataInputDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedSource, setSelectedSource] = useState('manual');
  const [loading, setLoading] = useState(false);
  const [loadingExistingData, setLoadingExistingData] = useState(false);
  const [hasExistingData, setHasExistingData] = useState({ sales: false, food: false, labor: false });
  const { upsertSales, upsertFoodCosts, upsertLaborCosts } = useDailyPnL(restaurantId);

  const [salesData, setSalesData] = useState<Partial<DailySales>>({
    gross_revenue: undefined,
    discounts: undefined,
    comps: undefined,
    transaction_count: undefined,
  });

  const [foodCostsData, setFoodCostsData] = useState<Partial<DailyFoodCosts>>({
    purchases: undefined,
    inventory_adjustments: undefined,
  });

  const [laborCostsData, setLaborCostsData] = useState<Partial<DailyLaborCosts>>({
    hourly_wages: undefined,
    salary_wages: undefined,
    benefits: undefined,
    total_hours: undefined,
  });

  // Load existing data for the selected date
  const loadExistingData = async (date: string, source: string) => {
    if (!restaurantId) return;
    
    setLoadingExistingData(true);
    try {
      // Check for existing sales data
      const { data: salesData } = await supabase
        .from('daily_sales')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('date', date)
        .eq('source', source)
        .single();

      // Check for existing food costs data
      const { data: foodData } = await supabase
        .from('daily_food_costs')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('date', date)
        .eq('source', source)
        .single();

      // Check for existing labor costs data
      const { data: laborData } = await supabase
        .from('daily_labor_costs')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('date', date)
        .eq('source', source)
        .single();

      // Update form data if existing data is found
      if (salesData) {
        setSalesData({
          gross_revenue: salesData.gross_revenue,
          discounts: salesData.discounts,
          comps: salesData.comps,
          transaction_count: salesData.transaction_count,
        });
      } else {
        setSalesData({
          gross_revenue: undefined,
          discounts: undefined,
          comps: undefined,
          transaction_count: undefined,
        });
      }

      if (foodData) {
        setFoodCostsData({
          purchases: foodData.purchases,
          inventory_adjustments: foodData.inventory_adjustments,
        });
      } else {
        setFoodCostsData({
          purchases: undefined,
          inventory_adjustments: undefined,
        });
      }

      if (laborData) {
        setLaborCostsData({
          hourly_wages: laborData.hourly_wages,
          salary_wages: laborData.salary_wages,
          benefits: laborData.benefits,
          total_hours: laborData.total_hours,
        });
      } else {
        setLaborCostsData({
          hourly_wages: undefined,
          salary_wages: undefined,
          benefits: undefined,
          total_hours: undefined,
        });
      }

      setHasExistingData({
        sales: !!salesData,
        food: !!foodData,
        labor: !!laborData,
      });

    } catch (error) {
      // Reset to empty form if no existing data found
      setSalesData({
        gross_revenue: undefined,
        discounts: undefined,
        comps: undefined,
        transaction_count: undefined,
      });
      setFoodCostsData({
        purchases: undefined,
        inventory_adjustments: undefined,
      });
      setLaborCostsData({
        hourly_wages: undefined,
        salary_wages: undefined,
        benefits: undefined,
        total_hours: undefined,
      });
      setHasExistingData({ sales: false, food: false, labor: false });
    } finally {
      setLoadingExistingData(false);
    }
  };

  // Load existing data when date or source changes
  useEffect(() => {
    if (open && restaurantId) {
      loadExistingData(selectedDate, selectedSource);
    }
  }, [selectedDate, selectedSource, open, restaurantId]);

  const handleSalesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate and sanitize numeric inputs to prevent overflow
      const grossRevenue = Math.round((Number(salesData.gross_revenue) || 0) * 100) / 100;
      const discounts = Math.round((Number(salesData.discounts) || 0) * 100) / 100;
      const comps = Math.round((Number(salesData.comps) || 0) * 100) / 100;
      const transactionCount = Math.floor(Number(salesData.transaction_count) || 0);

      // Validate reasonable ranges to prevent database overflow
      if (grossRevenue > 999999999.99 || grossRevenue < 0) {
        throw new Error('Gross revenue must be between $0 and $999,999,999.99');
      }
      if (discounts > 999999999.99 || discounts < 0) {
        throw new Error('Discounts must be between $0 and $999,999,999.99');
      }
      if (comps > 999999999.99 || comps < 0) {
        throw new Error('Comps must be between $0 and $999,999,999.99');
      }
      if (transactionCount > 999999 || transactionCount < 0) {
        throw new Error('Transaction count must be between 0 and 999,999');
      }

      await upsertSales({
        restaurant_id: restaurantId,
        date: selectedDate,
        source: selectedSource,
        gross_revenue: grossRevenue,
        discounts: discounts,
        comps: comps,
        transaction_count: transactionCount,
      });

      onDataUpdated?.();
    } catch (error: any) {
      console.error('Sales submit error:', error);
      // Error will be handled by the useDailyPnL hook
    } finally {
      setLoading(false);
    }
  };

  const handleFoodCostsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    await upsertFoodCosts({
      restaurant_id: restaurantId,
      date: selectedDate,
      source: selectedSource,
      purchases: Number(foodCostsData.purchases) || 0,
      inventory_adjustments: Number(foodCostsData.inventory_adjustments) || 0,
    });

    setLoading(false);
    onDataUpdated?.();
  };

  const handleLaborCostsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    await upsertLaborCosts({
      restaurant_id: restaurantId,
      date: selectedDate,
      source: selectedSource,
      hourly_wages: Number(laborCostsData.hourly_wages) || 0,
      salary_wages: Number(laborCostsData.salary_wages) || 0,
      benefits: Number(laborCostsData.benefits) || 0,
      total_hours: Number(laborCostsData.total_hours) || 0,
    });

    setLoading(false);
    onDataUpdated?.();
  };

  return (
    <>
      <Button className={className} onClick={() => setOpen(true)}>
        <DollarSign className="mr-2 h-4 w-4" />
        Add Daily Data
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Daily Operations Data</DialogTitle>
          <DialogDescription>
            Input your daily sales, food costs, and labor data to generate P&L insights.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="source">Data Source</Label>
              <Select value={selectedSource} onValueChange={setSelectedSource}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual Entry</SelectItem>
                  <SelectItem value="square">Square POS</SelectItem>
                  <SelectItem value="toast">Toast POS</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {loadingExistingData && (
            <div className="text-center text-sm text-muted-foreground">
              Loading existing data...
            </div>
          )}

          <Tabs defaultValue="sales" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="sales">Sales Data</TabsTrigger>
              <TabsTrigger value="food">Food Costs</TabsTrigger>
              <TabsTrigger value="labor">Labor Costs</TabsTrigger>
            </TabsList>

            <TabsContent value="sales">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5" />
                    Daily Sales
                  </CardTitle>
                  <CardDescription>
                    {hasExistingData.sales ? 
                      `Updating existing sales data for ${selectedDate}` : 
                      `Enter new sales data for ${selectedDate}`
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSalesSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="gross_revenue">Gross Revenue ($)</Label>
                        <Input
                          id="gross_revenue"
                          type="number"
                          step="0.01"
                          value={salesData.gross_revenue ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setSalesData({ ...salesData, gross_revenue: value === '' ? undefined : Number(value) });
                          }}
                          placeholder="0.00"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="discounts">Discounts ($)</Label>
                        <Input
                          id="discounts"
                          type="number"
                          step="0.01"
                          value={salesData.discounts ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setSalesData({ ...salesData, discounts: value === '' ? undefined : Number(value) });
                          }}
                          placeholder="0.00"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="comps">Comps ($)</Label>
                        <Input
                          id="comps"
                          type="number"
                          step="0.01"
                          value={salesData.comps ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setSalesData({ ...salesData, comps: value === '' ? undefined : Number(value) });
                          }}
                          placeholder="0.00"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="transaction_count">Transaction Count</Label>
                        <Input
                          id="transaction_count"
                          type="number"
                          value={salesData.transaction_count ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setSalesData({ ...salesData, transaction_count: value === '' ? undefined : Number(value) });
                          }}
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <Button type="submit" disabled={loading}>
                      {loading ? "Updating..." : "Update Sales Data"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="food">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5" />
                    Food Costs
                  </CardTitle>
                  <CardDescription>
                    {hasExistingData.food ? 
                      `Updating existing food costs for ${selectedDate}` : 
                      `Enter new food costs for ${selectedDate}`
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleFoodCostsSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="purchases">Purchases ($)</Label>
                        <Input
                          id="purchases"
                          type="number"
                          step="0.01"
                          value={foodCostsData.purchases ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setFoodCostsData({ ...foodCostsData, purchases: value === '' ? undefined : Number(value) });
                          }}
                          placeholder="0.00"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="inventory_adjustments">Inventory Adjustments ($)</Label>
                        <Input
                          id="inventory_adjustments"
                          type="number"
                          step="0.01"
                          value={foodCostsData.inventory_adjustments ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setFoodCostsData({ ...foodCostsData, inventory_adjustments: value === '' ? undefined : Number(value) });
                          }}
                          placeholder="0.00"
                        />
                        <p className="text-xs text-muted-foreground">
                          Positive for waste/loss, negative for found inventory
                        </p>
                      </div>
                    </div>
                    <Button type="submit" disabled={loading}>
                      {loading ? "Updating..." : "Update Food Costs"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="labor">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Labor Costs
                  </CardTitle>
                  <CardDescription>
                    {hasExistingData.labor ? 
                      `Updating existing labor costs for ${selectedDate}` : 
                      `Enter total amounts paid for labor on ${selectedDate}`
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 p-3 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      <strong>Important:</strong> Enter total dollar amounts paid, not hourly rates. 
                      For example, if you paid $15/hour × 32 hours = $480 total.
                    </p>
                  </div>
                  <form onSubmit={handleLaborCostsSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="hourly_wages">Total Hourly Wages Paid ($)</Label>
                        <Input
                          id="hourly_wages"
                          type="number"
                          step="0.01"
                          value={laborCostsData.hourly_wages ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setLaborCostsData({ ...laborCostsData, hourly_wages: value === '' ? undefined : Number(value) });
                          }}
                          placeholder="0.00"
                        />
                        <p className="text-xs text-muted-foreground">
                          Total amount paid to hourly employees
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="salary_wages">Total Salary Wages Paid ($)</Label>
                        <Input
                          id="salary_wages"
                          type="number"
                          step="0.01"
                          value={laborCostsData.salary_wages ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setLaborCostsData({ ...laborCostsData, salary_wages: value === '' ? undefined : Number(value) });
                          }}
                          placeholder="0.00"
                        />
                        <p className="text-xs text-muted-foreground">
                          Daily portion of salaried employee costs
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="benefits">Total Benefits Cost ($)</Label>
                        <Input
                          id="benefits"
                          type="number"
                          step="0.01"
                          value={laborCostsData.benefits ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setLaborCostsData({ ...laborCostsData, benefits: value === '' ? undefined : Number(value) });
                          }}
                          placeholder="0.00"
                        />
                        <p className="text-xs text-muted-foreground">
                          Health insurance, taxes, other benefits
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="total_hours">Total Hours Worked</Label>
                        <Input
                          id="total_hours"
                          type="number"
                          step="0.25"
                          value={laborCostsData.total_hours ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setLaborCostsData({ ...laborCostsData, total_hours: value === '' ? undefined : Number(value) });
                          }}
                          placeholder="0"
                        />
                        <p className="text-xs text-muted-foreground">
                          For tracking labor efficiency (optional)
                        </p>
                      </div>
                    </div>
                    <Button type="submit" disabled={loading}>
                      {loading ? "Updating..." : "Update Labor Costs"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
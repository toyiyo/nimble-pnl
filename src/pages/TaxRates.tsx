import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useTaxRates } from '@/hooks/useTaxRates';
import { useChartOfAccounts } from '@/hooks/useChartOfAccounts';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { MetricIcon } from '@/components/MetricIcon';
import { Plus, Percent, Calendar, FileText, Edit, Trash2, AlertCircle } from 'lucide-react';
import { TaxRateDialog } from '@/components/tax-rates/TaxRateDialog';
import { TaxReportDialog } from '@/components/tax-rates/TaxReportDialog';
import { TaxRate } from '@/types/taxRates';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function TaxRates() {
  const {
    selectedRestaurant,
    setSelectedRestaurant,
    restaurants,
    loading: restaurantsLoading,
    createRestaurant,
  } = useRestaurantContext();

  const {
    taxRates,
    isLoading,
    createTaxRate,
    updateTaxRate,
    deleteTaxRate,
    isCreating,
    isUpdating,
    isDeleting,
    getTaxRateWithCategories,
  } = useTaxRates(selectedRestaurant?.restaurant_id || null);

  const { accounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || null);

  const [showTaxRateDialog, setShowTaxRateDialog] = useState(false);
  const [showTaxReportDialog, setShowTaxReportDialog] = useState(false);
  const [editingTaxRate, setEditingTaxRate] = useState<TaxRateWithCategories | null>(null);
  const [deletingTaxRate, setDeletingTaxRate] = useState<TaxRate | null>(null);

  // Filter revenue accounts for categorization
  const revenueAccounts = useMemo(() => {
    return accounts.filter(acc => acc.account_type === 'revenue');
  }, [accounts]);

  const handleCreateTaxRate = () => {
    setEditingTaxRate(null);
    setShowTaxRateDialog(true);
  };

  const handleEditTaxRate = async (taxRate: TaxRate) => {
    try {
      const taxRateWithCategories = await getTaxRateWithCategories(taxRate.id);
      if (taxRateWithCategories) {
        setEditingTaxRate(taxRateWithCategories);
        setShowTaxRateDialog(true);
      }
    } catch (error) {
      console.error('Error fetching tax rate details:', error);
    }
  };

  const handleDeleteTaxRate = (taxRate: TaxRate) => {
    setDeletingTaxRate(taxRate);
  };

  const confirmDelete = () => {
    if (deletingTaxRate) {
      deleteTaxRate(deletingTaxRate.id);
      setDeletingTaxRate(null);
    }
  };

  const handleRestaurantSelect = (restaurant: any) => {
    setSelectedRestaurant(restaurant);
  };

  const activeTaxRates = taxRates.filter(tr => tr.is_active);
  const inactiveTaxRates = taxRates.filter(tr => !tr.is_active);

  return (
    <>
      {!selectedRestaurant ? (
        <div className="space-y-6">
          <div className="text-center p-8 rounded-lg bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50">
            <MetricIcon icon={Percent} variant="emerald" className="mx-auto mb-4" />
            <h2 className="text-2xl md:text-3xl font-bold mb-2">Tax Rates & Categories</h2>
            <p className="text-sm md:text-base text-muted-foreground">
              Please select a restaurant to manage tax rates
            </p>
          </div>
          <RestaurantSelector
            selectedRestaurant={selectedRestaurant}
            onSelectRestaurant={handleRestaurantSelect}
            restaurants={restaurants}
            loading={restaurantsLoading}
            createRestaurant={createRestaurant}
          />
        </div>
      ) : (
        <div className="space-y-6 md:space-y-8">
          {/* Hero Section */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-500/20 p-8">
            <div className="relative z-10">
              <div className="flex items-center gap-4">
                <MetricIcon icon={Percent} variant="emerald" />
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold">Tax Rates & Categories</h1>
                  <p className="text-sm md:text-base text-muted-foreground mt-1">
                    Configure tax rates and generate compliance reports
                  </p>
                </div>
              </div>
            </div>
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl -z-0" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-green-500/5 rounded-full blur-3xl -z-0" />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={handleCreateTaxRate} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Tax Rate
            </Button>
            <Button variant="outline" onClick={() => setShowTaxReportDialog(true)} className="gap-2">
              <FileText className="h-4 w-4" />
              Generate Tax Report
            </Button>
          </div>

          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="hover:shadow-lg transition-all duration-200 hover:scale-[1.02]">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={Percent} variant="emerald" />
                  <div>
                    <div className="text-3xl font-bold">{activeTaxRates.length}</div>
                    <div className="text-sm text-muted-foreground">Active Tax Rates</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-all duration-200 hover:scale-[1.02]">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={Calendar} variant="blue" />
                  <div>
                    <div className="text-3xl font-bold">{taxRates.length}</div>
                    <div className="text-sm text-muted-foreground">Total Tax Rates</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-all duration-200 hover:scale-[1.02]">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={FileText} variant="purple" />
                  <div>
                    <div className="text-3xl font-bold">{revenueAccounts.length}</div>
                    <div className="text-sm text-muted-foreground">Revenue Categories</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tax Rates List */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Configured Tax Rates</h2>

            {isLoading ? (
              <div className="text-center p-8 text-muted-foreground">Loading tax rates...</div>
            ) : taxRates.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                  <MetricIcon icon={Percent} variant="emerald" className="mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Tax Rates Configured</h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-md">
                    Start by creating your first tax rate. You can optionally associate it with specific revenue
                    categories to automatically calculate taxes on matching transactions.
                  </p>
                  <Button onClick={handleCreateTaxRate}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create First Tax Rate
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {activeTaxRates.map((taxRate) => (
                  <Card key={taxRate.id} className="hover:shadow-md transition-all duration-200">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-3">
                            <CardTitle className="text-lg">{taxRate.name}</CardTitle>
                            <Badge className="bg-gradient-to-r from-emerald-500 to-green-600">
                              {taxRate.rate}%
                            </Badge>
                            {taxRate.is_active && (
                              <Badge variant="outline" className="text-emerald-600 border-emerald-600">
                                Active
                              </Badge>
                            )}
                          </div>
                          {taxRate.description && (
                            <CardDescription>{taxRate.description}</CardDescription>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditTaxRate(taxRate)}
                            aria-label={`Edit ${taxRate.name}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteTaxRate(taxRate)}
                            aria-label={`Delete ${taxRate.name}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                ))}

                {inactiveTaxRates.length > 0 && (
                  <>
                    <h3 className="text-lg font-semibold mt-6">Inactive Tax Rates</h3>
                    {inactiveTaxRates.map((taxRate) => (
                      <Card key={taxRate.id} className="opacity-60 hover:shadow-md transition-all duration-200">
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div className="space-y-1 flex-1">
                              <div className="flex items-center gap-3">
                                <CardTitle className="text-lg">{taxRate.name}</CardTitle>
                                <Badge variant="secondary">{taxRate.rate}%</Badge>
                                <Badge variant="outline" className="text-muted-foreground">
                                  Inactive
                                </Badge>
                              </div>
                              {taxRate.description && (
                                <CardDescription>{taxRate.description}</CardDescription>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleEditTaxRate(taxRate)}
                                aria-label={`Edit ${taxRate.name}`}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteTaxRate(taxRate)}
                                aria-label={`Delete ${taxRate.name}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                      </Card>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tax Rate Dialog */}
      <TaxRateDialog
        open={showTaxRateDialog}
        onOpenChange={setShowTaxRateDialog}
        taxRate={editingTaxRate}
        restaurantId={selectedRestaurant?.restaurant_id || ''}
        onSave={(data) => {
          if (editingTaxRate) {
            updateTaxRate({ id: editingTaxRate.id, input: data });
          } else {
            createTaxRate({
              ...data,
              restaurant_id: selectedRestaurant?.restaurant_id || '',
            });
          }
          setShowTaxRateDialog(false);
        }}
        accounts={revenueAccounts}
      />

      {/* Tax Report Dialog */}
      <TaxReportDialog
        open={showTaxReportDialog}
        onOpenChange={setShowTaxReportDialog}
        restaurantId={selectedRestaurant?.restaurant_id || ''}
        restaurantName={selectedRestaurant?.name || ''}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingTaxRate} onOpenChange={() => setDeletingTaxRate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Delete Tax Rate
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingTaxRate?.name}"? This action cannot be undone and will remove
              all associated category mappings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

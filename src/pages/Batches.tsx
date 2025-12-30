import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useProductionRuns, ProductionRun, ProductionRunStatus, CompleteRunPayload } from '@/hooks/useProductionRuns';
import { usePrepRecipes, PrepRecipe } from '@/hooks/usePrepRecipes';
import { IngredientUnit } from '@/lib/recipeUnits';
import { UserRestaurant } from '@/hooks/useRestaurants';
import { PageHeader } from '@/components/PageHeader';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ProductionRunCard } from '@/components/prep/ProductionRunCard';
import { NewProductionRunDialog } from '@/components/prep/NewProductionRunDialog';
import { ProductionRunDetailDialog } from '@/components/prep/ProductionRunDetailDialog';
import { ClipboardList, Plus, Search } from 'lucide-react';

export default function Batches() {
  const { user } = useAuth();
  const {
    selectedRestaurant,
    setSelectedRestaurant,
    restaurants,
    loading: restaurantsLoading,
    createRestaurant,
    canCreateRestaurant,
  } = useRestaurantContext();

  const { prepRecipes, loading: prepLoading } = usePrepRecipes(selectedRestaurant?.restaurant_id || null);
  const { runs, loading, createProductionRun, saveRunActuals, statusCounts } = useProductionRuns(
    selectedRestaurant?.restaurant_id || null
  );

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProductionRunStatus | 'all'>('all');
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<ProductionRun | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleRestaurantSelect = (restaurant: UserRestaurant) => {
    setSelectedRestaurant(restaurant);
  };

  const filteredRuns = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return runs.filter((run) => {
      const matchesStatus = statusFilter === 'all' || run.status === statusFilter;
      const matchesSearch =
        run.prep_recipe?.name?.toLowerCase().includes(term) ||
        run.prep_recipe?.description?.toLowerCase().includes(term) ||
        run.prep_recipe?.output_product?.name?.toLowerCase().includes(term);
      return matchesStatus && (!term || matchesSearch);
    });
  }, [runs, searchTerm, statusFilter]);

  const handleCreateRun = async (params: {
    prep_recipe: PrepRecipe;
    target_yield: number;
    target_yield_unit: IngredientUnit;
    scheduled_for?: string;
    notes?: string;
  }) => {
    if (!selectedRestaurant) return;
    await createProductionRun({
      restaurant_id: selectedRestaurant.restaurant_id,
      ...params,
    });
  };

  const handleSaveActuals = async (payload: CompleteRunPayload) => {
    setSaving(true);
    try {
      await saveRunActuals(payload);
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md bg-gradient-to-br from-destructive/5 via-destructive/10 to-transparent border-destructive/20">
          <CardContent className="p-6 text-center space-y-2">
            <ClipboardList className="h-8 w-8 text-destructive mx-auto" />
            <p className="text-lg font-semibold">Access Denied</p>
            <p className="text-muted-foreground text-sm">Please log in to access batches.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (restaurantsLoading) {
    return (
      <div className="space-y-6 p-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!selectedRestaurant) {
    return (
      <div className="space-y-6 p-4">
        <div className="text-center p-8 rounded-lg bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50">
          <ClipboardList className="h-8 w-8 text-primary mx-auto mb-3" />
          <h1 className="text-2xl font-bold mb-2">Batches</h1>
          <p className="text-muted-foreground mb-6">Pick a restaurant to schedule and track batches.</p>
          <RestaurantSelector
            restaurants={restaurants}
            selectedRestaurant={selectedRestaurant}
            onSelectRestaurant={handleRestaurantSelect}
            loading={restaurantsLoading}
            canCreateRestaurant={canCreateRestaurant}
            createRestaurant={createRestaurant}
          />
        </div>
      </div>
    );
  }

  const tabs: Array<{ key: ProductionRunStatus | 'all'; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'planned', label: 'Planned' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'completed', label: 'Completed' },
  ];

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        icon={ClipboardList}
        iconVariant="amber"
        title="Batches"
        restaurantName={selectedRestaurant.restaurant?.name}
        subtitle="Track production runs and keep variance visible"
        actions={
          <Button onClick={() => setNewRunOpen(true)} className="gap-2" disabled={prepLoading || prepRecipes.length === 0}>
            <Plus className="h-4 w-4" /> New batch
          </Button>
        }
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search batches..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Badge variant="secondary">{filteredRuns.length} batches</Badge>
      </div>

      <Tabs value={statusFilter} onValueChange={(value) => setStatusFilter(value as ProductionRunStatus | 'all')}>
        <TabsList className="w-full justify-start overflow-x-auto">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} className="flex items-center gap-2">
              {tab.label}
              <Badge variant="outline" className="rounded-full">
                {statusCounts[tab.key as ProductionRunStatus] ?? (tab.key === 'all' ? statusCounts.all || 0 : 0)}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={statusFilter} className="mt-4 space-y-3">
          {filteredRuns.map((run) => (
            <ProductionRunCard
              key={run.id}
              run={run}
              onClick={() => {
                setSelectedRun(run);
                setDetailOpen(true);
              }}
            />
          ))}

          {!loading && filteredRuns.length === 0 && (
            <Card className="border-dashed border-2">
              <CardContent className="p-6 text-center space-y-2">
                <p className="font-semibold">No batches</p>
                <p className="text-sm text-muted-foreground">Plan a batch to start tracking production.</p>
                <Button onClick={() => setNewRunOpen(true)} className="mt-2" disabled={prepLoading || prepRecipes.length === 0}>
                  <Plus className="h-4 w-4 mr-2" />
                  New batch
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <NewProductionRunDialog
        open={newRunOpen}
        onOpenChange={setNewRunOpen}
        prepRecipes={prepRecipes}
        onCreate={handleCreateRun}
      />

      <ProductionRunDetailDialog
        run={selectedRun}
        open={detailOpen}
        saving={saving}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setSelectedRun(null);
        }}
        onSave={handleSaveActuals}
      />
    </div>
  );
}

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Settings, Info, Plus, X } from 'lucide-react';
import { useInventorySettings } from '@/hooks/useInventorySettings';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface InventorySettingsProps {
  restaurantId: string;
}

export const InventorySettings: React.FC<InventorySettingsProps> = ({ restaurantId }) => {
  const { settings, loading, updateSettings, getMarkupForCategory } = useInventorySettings(restaurantId);
  const [defaultMarkup, setDefaultMarkup] = useState<string>('');
  const [newCategory, setNewCategory] = useState('');
  const [newCategoryMarkup, setNewCategoryMarkup] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  React.useEffect(() => {
    if (settings && !isEditing) {
      setDefaultMarkup(settings.default_markup_multiplier.toString());
    }
  }, [settings, isEditing]);

  const handleSaveSettings = async () => {
    const markup = parseFloat(defaultMarkup);
    if (isNaN(markup) || markup <= 0) {
      return;
    }

    await updateSettings({
      default_markup_multiplier: markup
    });
    setIsEditing(false);
  };

  const handleAddCategory = async () => {
    if (!newCategory.trim() || !newCategoryMarkup.trim() || !settings) return;
    
    const markup = parseFloat(newCategoryMarkup);
    if (isNaN(markup) || markup <= 0) return;

    const updatedCategories = {
      ...settings.markup_by_category,
      [newCategory.trim()]: markup
    };

    await updateSettings({
      markup_by_category: updatedCategories
    });

    setNewCategory('');
    setNewCategoryMarkup('');
  };

  const handleRemoveCategory = async (category: string) => {
    if (!settings) return;

    const updatedCategories = { ...settings.markup_by_category };
    delete updatedCategories[category];

    await updateSettings({
      markup_by_category: updatedCategories
    });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            <CardTitle>Inventory Valuation Settings</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-10 bg-muted rounded"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            <CardTitle>Inventory Valuation Settings</CardTitle>
          </div>
          <CardDescription>
            Configure how inventory values are calculated when no recipe or sales data is available
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              When a product has no recipe or sales history, its inventory value is estimated using cost × markup multiplier. 
              Recipe-based products use actual sales data for more accurate valuations.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="default-markup">Default Markup Multiplier</Label>
              <div className="flex gap-2 items-center">
                <Input
                  id="default-markup"
                  type="number"
                  step="0.1"
                  min="1"
                  value={defaultMarkup}
                  onChange={(e) => {
                    setDefaultMarkup(e.target.value);
                    setIsEditing(true);
                  }}
                  placeholder="2.5"
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">
                  (e.g., 2.5 = 250% of cost)
                </span>
                {isEditing && (
                  <Button onClick={handleSaveSettings} size="sm">
                    Save
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Current default: {settings?.default_markup_multiplier || 2.5}x markup
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Category-Specific Markups</CardTitle>
          <CardDescription>
            Set different markup multipliers for specific product categories
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings?.markup_by_category && Object.keys(settings.markup_by_category).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(settings.markup_by_category).map(([category, markup]) => (
                <div key={category} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{category}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {markup}x markup
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveCategory(category)}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No category-specific markups configured. All products will use the default markup.
            </p>
          )}

          <div className="border-t pt-4">
            <div className="space-y-2">
              <Label>Add Category Markup</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Category name"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="number"
                  step="0.1"
                  min="1"
                  placeholder="Markup"
                  value={newCategoryMarkup}
                  onChange={(e) => setNewCategoryMarkup(e.target.value)}
                  className="w-24"
                />
                <Button
                  onClick={handleAddCategory}
                  disabled={!newCategory.trim() || !newCategoryMarkup.trim()}
                  size="sm"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
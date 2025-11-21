import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { TaxRate, UpdateTaxRateInput } from '@/types/taxRates';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TaxRateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taxRate: (TaxRate & { categories?: Array<{ id: string; account_name: string }> }) | null;
  restaurantId: string;
  onSave: (data: UpdateTaxRateInput & { category_ids?: string[] }) => void;
  accounts: Array<{ id: string; account_name: string; account_code: string }>;
}

export function TaxRateDialog({ open, onOpenChange, taxRate, restaurantId, onSave, accounts }: TaxRateDialogProps) {
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);

  useEffect(() => {
    if (taxRate) {
      setName(taxRate.name);
      setRate(taxRate.rate.toString());
      setDescription(taxRate.description || '');
      setIsActive(taxRate.is_active);
      setSelectedCategoryIds(taxRate.categories?.map(c => c.id) || []);
    } else {
      setName('');
      setRate('');
      setDescription('');
      setIsActive(true);
      setSelectedCategoryIds([]);
    }
  }, [taxRate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const data: UpdateTaxRateInput & { category_ids?: string[] } = {
      name,
      rate: parseFloat(rate),
      description: description || undefined,
      is_active: isActive,
      category_ids: selectedCategoryIds,
    };

    onSave(data);
  };

  const handleCategoryToggle = (categoryId: string, checked: boolean) => {
    if (checked) {
      setSelectedCategoryIds([...selectedCategoryIds, categoryId]);
    } else {
      setSelectedCategoryIds(selectedCategoryIds.filter(id => id !== categoryId));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{taxRate ? 'Edit Tax Rate' : 'Create Tax Rate'}</DialogTitle>
            <DialogDescription>
              {taxRate
                ? 'Update the tax rate configuration and category associations.'
                : 'Create a new tax rate. Optionally associate it with revenue categories.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Tax Rate Name */}
            <div className="grid gap-2">
              <Label htmlFor="name">
                Tax Rate Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Sales Tax, Alcohol Tax"
                required
              />
            </div>

            {/* Tax Rate Percentage */}
            <div className="grid gap-2">
              <Label htmlFor="rate">
                Rate (%) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="rate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="e.g., 8.25"
                required
              />
              <p className="text-xs text-muted-foreground">Enter the tax rate as a percentage (0-100)</p>
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add additional details about this tax rate"
                rows={2}
              />
            </div>

            {/* Active Status */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="is-active">Active</Label>
                <p className="text-sm text-muted-foreground">
                  Enable this tax rate for calculations
                </p>
              </div>
              <Switch id="is-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>

            {/* Category Selection */}
            <div className="space-y-3">
              <div>
                <Label>Revenue Categories (Optional)</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Select categories to apply this tax rate. If none selected, it applies to all sales.
                </p>
              </div>

              <ScrollArea className="h-[200px] rounded-md border p-4">
                {accounts.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    No revenue categories available
                  </div>
                ) : (
                  <div className="space-y-3">
                    {accounts.map((account) => (
                      <div key={account.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`category-${account.id}`}
                          checked={selectedCategoryIds.includes(account.id)}
                          onCheckedChange={(checked) =>
                            handleCategoryToggle(account.id, checked as boolean)
                          }
                        />
                        <Label
                          htmlFor={`category-${account.id}`}
                          className="text-sm font-normal cursor-pointer flex-1"
                        >
                          {account.account_code} - {account.account_name}
                        </Label>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              {taxRate ? 'Update' : 'Create'} Tax Rate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

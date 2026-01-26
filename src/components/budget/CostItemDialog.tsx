import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CostType, EntryType, OperatingCostInput, CostBreakdownItem } from '@/types/operatingCosts';

interface CostItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: OperatingCostInput) => void;
  editingItem?: CostBreakdownItem | null;
  costType?: CostType;
  title?: string;
}

export function CostItemDialog({
  open,
  onOpenChange,
  onSave,
  editingItem,
  costType = 'custom',
  title = 'Add Cost Item',
}: CostItemDialogProps) {
  const [name, setName] = useState(editingItem?.name || '');
  const [entryType, setEntryType] = useState<EntryType>(
    editingItem?.isPercentage ? 'percentage' : 'value'
  );
  const [monthlyAmount, setMonthlyAmount] = useState(
    editingItem && !editingItem.isPercentage ? (editingItem.monthly).toFixed(2) : ''
  );
  const [percentageValue, setPercentageValue] = useState(
    editingItem?.percentage?.toString() || ''
  );
  const [selectedCostType, setSelectedCostType] = useState<CostType>(costType);

  const handleSave = () => {
    if (!name.trim()) return;

    const data: OperatingCostInput = {
      costType: selectedCostType,
      category: name.toLowerCase().replace(/\s+/g, '_'),
      name: name.trim(),
      entryType,
      manualOverride: true, // User-set values are always manual overrides
    };

    if (entryType === 'value') {
      data.monthlyValue = Math.round(parseFloat(monthlyAmount || '0') * 100); // Convert to cents
    } else {
      data.percentageValue = parseFloat(percentageValue || '0') / 100; // Convert to decimal
    }

    onSave(data);
    onOpenChange(false);
    
    // Reset form
    setName('');
    setMonthlyAmount('');
    setPercentageValue('');
  };

  const dailyEstimate = entryType === 'value' 
    ? parseFloat(monthlyAmount || '0') / 30 
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingItem ? 'Edit Cost Item' : title}</DialogTitle>
          <DialogDescription>
            {editingItem ? 'Update the details for this cost item.' : 'Add a new operating cost to your budget.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="cost-name">Name</Label>
            <Input
              id="cost-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Franchise Royalties"
            />
          </div>

          {/* Cost Type (only for custom items) */}
          {costType === 'custom' && !editingItem && (
            <div className="space-y-2">
              <Label>Cost Type</Label>
              <Select value={selectedCostType} onValueChange={(v) => setSelectedCostType(v as CostType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed (same every month)</SelectItem>
                  <SelectItem value="variable">Variable (scales with sales)</SelectItem>
                  <SelectItem value="custom">Custom / Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Entry Type Toggle */}
          <div className="space-y-2">
            <Label>How is this cost calculated?</Label>
            <RadioGroup
              value={entryType}
              onValueChange={(v) => setEntryType(v as EntryType)}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="value" id="entry-value" />
                <Label htmlFor="entry-value" className="font-normal cursor-pointer">
                  Fixed Amount
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="percentage" id="entry-percentage" />
                <Label htmlFor="entry-percentage" className="font-normal cursor-pointer">
                  % of Sales
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Value Input */}
          {entryType === 'value' ? (
            <div className="space-y-2">
              <Label htmlFor="monthly-amount">Monthly Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="monthly-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={monthlyAmount}
                  onChange={(e) => setMonthlyAmount(e.target.value)}
                  placeholder="0.00"
                  className="pl-7"
                />
              </div>
              {parseFloat(monthlyAmount || '0') > 0 && (
                <p className="text-sm text-muted-foreground">
                  Daily: ${dailyEstimate.toFixed(2)}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="percentage-value">Percentage</Label>
              <div className="relative">
                <Input
                  id="percentage-value"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={percentageValue}
                  onChange={(e) => setPercentageValue(e.target.value)}
                  placeholder="0"
                  className="pr-7"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Daily cost will be calculated based on average sales
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            {editingItem ? 'Save Changes' : 'Add Cost'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

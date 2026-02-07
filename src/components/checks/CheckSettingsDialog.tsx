import { useState, useEffect } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { Settings, Loader2 } from 'lucide-react';

import { useCheckSettings } from '@/hooks/useCheckSettings';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

import type { UpsertCheckSettingsInput } from '@/hooks/useCheckSettings';

interface CheckSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CheckSettingsDialog({ open, onOpenChange }: CheckSettingsDialogProps) {
  const { selectedRestaurant } = useRestaurantContext();
  const { settings, saveSettings } = useCheckSettings();

  const [form, setForm] = useState<UpsertCheckSettingsInput>({
    business_name: '',
    business_address_line1: '',
    business_address_line2: '',
    business_city: '',
    business_state: '',
    business_zip: '',
    bank_name: '',
    next_check_number: 1001,
  });

  // Populate form from existing settings or restaurant defaults
  useEffect(() => {
    if (settings) {
      setForm({
        business_name: settings.business_name,
        business_address_line1: settings.business_address_line1 ?? '',
        business_address_line2: settings.business_address_line2 ?? '',
        business_city: settings.business_city ?? '',
        business_state: settings.business_state ?? '',
        business_zip: settings.business_zip ?? '',
        bank_name: settings.bank_name ?? '',
        next_check_number: settings.next_check_number,
      });
    } else if (selectedRestaurant) {
      setForm((prev) => ({
        ...prev,
        business_name: selectedRestaurant.name || '',
      }));
    }
  }, [settings, selectedRestaurant]);

  const handleSave = async () => {
    try {
      await saveSettings.mutateAsync(form);
      onOpenChange(false);
    } catch {
      // Error toast is handled by the mutation's onError callback
    }
  };

  const update = (field: keyof UpsertCheckSettingsInput, value: string | number) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Settings className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Check Settings
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                Configure business information and check numbering
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {/* Business Information */}
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
              <h3 className="text-[13px] font-semibold text-foreground">Business Information</h3>
            </div>
            <div className="p-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="check-business-name" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Business Name
                </Label>
                <Input
                  id="check-business-name"
                  value={form.business_name}
                  onChange={(e) => update('business_name', e.target.value)}
                  className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="check-address-line1" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Address Line 1
                  </Label>
                  <Input
                    id="check-address-line1"
                    value={form.business_address_line1 ?? ''}
                    onChange={(e) => update('business_address_line1', e.target.value)}
                    className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="check-address-line2" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Address Line 2
                  </Label>
                  <Input
                    id="check-address-line2"
                    value={form.business_address_line2 ?? ''}
                    onChange={(e) => update('business_address_line2', e.target.value)}
                    placeholder="Suite, unit, etc."
                    className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="check-city" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    City
                  </Label>
                  <Input
                    id="check-city"
                    value={form.business_city ?? ''}
                    onChange={(e) => update('business_city', e.target.value)}
                    className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="check-state" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    State
                  </Label>
                  <Input
                    id="check-state"
                    value={form.business_state ?? ''}
                    onChange={(e) => update('business_state', e.target.value.toUpperCase())}
                    maxLength={2}
                    placeholder="CA"
                    className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border uppercase"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="check-zip" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    ZIP
                  </Label>
                  <Input
                    id="check-zip"
                    value={form.business_zip ?? ''}
                    onChange={(e) => update('business_zip', e.target.value)}
                    maxLength={10}
                    placeholder="90210"
                    className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Bank Information */}
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
              <h3 className="text-[13px] font-semibold text-foreground">Bank Information</h3>
            </div>
            <div className="p-4 space-y-2">
              <Label htmlFor="check-bank-name" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Bank Name
              </Label>
              <Input
                id="check-bank-name"
                value={form.bank_name ?? ''}
                onChange={(e) => update('bank_name', e.target.value)}
                placeholder="First National Bank"
                className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
              />
            </div>
          </div>

          {/* Check Numbering */}
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
              <h3 className="text-[13px] font-semibold text-foreground">Check Numbering</h3>
            </div>
            <div className="p-4 space-y-2">
              <Label htmlFor="check-next-number" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Next Check Number
              </Label>
              <Input
                id="check-next-number"
                type="number"
                min="1"
                value={form.next_check_number ?? 1001}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value);
                  update('next_check_number', parsed > 0 ? parsed : 1001);
                }}
                className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
              />
              <p className="text-[11px] text-muted-foreground">
                This should match the first check number on your pre-printed check stock.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/40 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saveSettings.isPending}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveSettings.isPending || !form.business_name.trim()}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {saveSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

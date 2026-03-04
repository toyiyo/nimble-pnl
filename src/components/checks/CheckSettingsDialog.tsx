import { useState, useEffect, useCallback } from 'react';

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
import { Switch } from '@/components/ui/switch';

import { Settings, Loader2, Building2, Plus, Pencil, Trash2 } from 'lucide-react';

import { useCheckSettings } from '@/hooks/useCheckSettings';
import { useCheckBankAccounts } from '@/hooks/useCheckBankAccounts';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

import type { UpsertCheckSettingsInput } from '@/hooks/useCheckSettings';
import type { UpsertCheckBankAccountInput, CheckBankAccount } from '@/hooks/useCheckBankAccounts';

interface CheckSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AccountFormState {
  id?: string;
  account_name: string;
  bank_name: string;
  next_check_number: number;
  is_default: boolean;
}

const emptyAccountForm: AccountFormState = {
  account_name: '',
  bank_name: '',
  next_check_number: 1001,
  is_default: false,
};

export function CheckSettingsDialog({ open, onOpenChange }: CheckSettingsDialogProps) {
  const { selectedRestaurant } = useRestaurantContext();
  const { settings, saveSettings } = useCheckSettings();
  const { accounts, saveAccount, deleteAccount } = useCheckBankAccounts();

  const [form, setForm] = useState<UpsertCheckSettingsInput>({
    business_name: '',
    business_address_line1: '',
    business_address_line2: '',
    business_city: '',
    business_state: '',
    business_zip: '',
  });

  // Bank account inline form state
  const [editingAccount, setEditingAccount] = useState<AccountFormState | null>(null);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);

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
      });
    } else if (selectedRestaurant) {
      const r = selectedRestaurant.restaurant;
      setForm((prev) => ({
        ...prev,
        business_name: r?.legal_name || r?.name || '',
        business_address_line1: r?.address_line1 || '',
        business_address_line2: r?.address_line2 || '',
        business_city: r?.city || '',
        business_state: r?.state || '',
        business_zip: r?.zip || '',
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

  // ---------- Bank account handlers ----------

  const handleStartAdd = useCallback(() => {
    setEditingAccount(null);
    setIsAddingAccount(true);
  }, []);

  const handleStartEdit = useCallback((account: CheckBankAccount) => {
    setIsAddingAccount(false);
    setEditingAccount({
      id: account.id,
      account_name: account.account_name,
      bank_name: account.bank_name ?? '',
      next_check_number: account.next_check_number,
      is_default: account.is_default,
    });
  }, []);

  const handleCancelAccountForm = useCallback(() => {
    setEditingAccount(null);
    setIsAddingAccount(false);
  }, []);

  const handleSaveAccount = useCallback(
    async (formData: AccountFormState) => {
      const input: UpsertCheckBankAccountInput = {
        id: formData.id,
        account_name: formData.account_name,
        bank_name: formData.bank_name || null,
        next_check_number: formData.next_check_number,
        is_default: formData.is_default,
      };
      try {
        await saveAccount.mutateAsync(input);
        setEditingAccount(null);
        setIsAddingAccount(false);
      } catch {
        // Error toast is handled by the mutation's onError callback
      }
    },
    [saveAccount],
  );

  const handleConfirmDelete = useCallback(
    async (accountId: string) => {
      try {
        await deleteAccount.mutateAsync(accountId);
        setDeletingAccountId(null);
      } catch {
        // Error toast is handled by the mutation's onError callback
      }
    },
    [deleteAccount],
  );

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
                Configure business information and bank accounts
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

          {/* Bank Accounts */}
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
              <h3 className="text-[13px] font-semibold text-foreground">Bank Accounts</h3>
            </div>
            <div className="p-4 space-y-3">
              {/* Account list */}
              {accounts.map((account) => {
                // Delete confirmation for this account
                if (deletingAccountId === account.id) {
                  return (
                    <div
                      key={account.id}
                      className="flex items-center justify-between p-4 rounded-xl border border-destructive/40 bg-destructive/5"
                    >
                      <p className="text-[13px] text-foreground">
                        Delete <span className="font-medium">{account.account_name}</span>?
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => setDeletingAccountId(null)}
                          disabled={deleteAccount.isPending}
                          className="h-8 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => handleConfirmDelete(account.id)}
                          disabled={deleteAccount.isPending}
                          className="h-8 px-3 rounded-lg text-[13px] font-medium"
                        >
                          {deleteAccount.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                }

                // Edit inline form for this account
                if (editingAccount?.id === account.id) {
                  return (
                    <AccountInlineForm
                      key={account.id}
                      initial={editingAccount}
                      isSaving={saveAccount.isPending}
                      onSave={handleSaveAccount}
                      onCancel={handleCancelAccountForm}
                    />
                  );
                }

                // Normal account row
                return (
                  <div
                    key={account.id}
                    className="group flex items-center justify-between p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-medium text-foreground truncate">
                            {account.account_name}
                          </span>
                          {account.is_default && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
                              Default
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {account.bank_name && (
                            <span className="text-[13px] text-muted-foreground truncate">
                              {account.bank_name}
                            </span>
                          )}
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
                            Next #{account.next_check_number}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleStartEdit(account)}
                        aria-label={`Edit ${account.account_name}`}
                        className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (accounts.length <= 1) return;
                          setDeletingAccountId(account.id);
                        }}
                        disabled={accounts.length <= 1}
                        aria-label={`Delete ${account.account_name}`}
                        className="h-8 w-8 rounded-lg text-destructive hover:text-destructive/80 disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}

              {/* Add new account inline form */}
              {isAddingAccount && (
                <AccountInlineForm
                  initial={emptyAccountForm}
                  isSaving={saveAccount.isPending}
                  onSave={handleSaveAccount}
                  onCancel={handleCancelAccountForm}
                />
              )}

              {/* Empty state */}
              {accounts.length === 0 && !isAddingAccount && (
                <p className="text-[13px] text-muted-foreground text-center py-4">
                  No bank accounts configured. Add one to start printing checks.
                </p>
              )}

              {/* Add Account button */}
              {!isAddingAccount && !editingAccount && (
                <Button
                  variant="ghost"
                  onClick={handleStartAdd}
                  className="w-full h-9 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground border border-dashed border-border/40 hover:border-border"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add Account
                </Button>
              )}
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

// ---------- Inline account form ----------

interface AccountInlineFormProps {
  initial: AccountFormState;
  isSaving: boolean;
  onSave: (data: AccountFormState) => void;
  onCancel: () => void;
}

function AccountInlineForm({ initial, isSaving, onSave, onCancel }: AccountInlineFormProps) {
  const [local, setLocal] = useState<AccountFormState>(initial);
  const isEdit = !!initial.id;

  const updateLocal = (field: keyof AccountFormState, value: string | number | boolean) =>
    setLocal((prev) => ({ ...prev, [field]: value }));

  const formId = isEdit ? `edit-account-${initial.id}` : 'new-account';

  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
        <h4 className="text-[13px] font-semibold text-foreground">
          {isEdit ? 'Edit Account' : 'New Account'}
        </h4>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${formId}-name`} className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Account Name
            </Label>
            <Input
              id={`${formId}-name`}
              value={local.account_name}
              onChange={(e) => updateLocal('account_name', e.target.value)}
              placeholder="Operating Account"
              className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-bank`} className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Bank Name
            </Label>
            <Input
              id={`${formId}-bank`}
              value={local.bank_name}
              onChange={(e) => updateLocal('bank_name', e.target.value)}
              placeholder="First National Bank"
              className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${formId}-next-num`} className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Next Check Number
            </Label>
            <Input
              id={`${formId}-next-num`}
              type="number"
              min="1"
              value={local.next_check_number}
              onChange={(e) => {
                const parsed = parseInt(e.target.value);
                updateLocal('next_check_number', parsed > 0 ? parsed : 1001);
              }}
              className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>
          <div className="flex items-end pb-2">
            <div className="flex items-center gap-2">
              <Switch
                id={`${formId}-default`}
                checked={local.is_default}
                onCheckedChange={(checked) => updateLocal('is_default', checked)}
                className="data-[state=checked]:bg-foreground"
              />
              <Label htmlFor={`${formId}-default`} className="text-[13px] text-foreground cursor-pointer">
                Default account
              </Label>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={isSaving}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onSave(local)}
            disabled={isSaving || !local.account_name.trim()}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {isSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {isEdit ? 'Update' : 'Add'}
          </Button>
        </div>
      </div>
    </div>
  );
}

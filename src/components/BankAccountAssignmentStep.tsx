import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeftRight, Info, CheckCircle, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  ExtractedAccountInfo,
  AccountBankMatch,
  TransferPairCandidate,
} from '@/utils/bankTransactionColumnMapping';

interface ConnectedBankOption {
  id: string;
  institution_name: string;
}

/** Per-account assignment: either an existing bank id or '__new__' with a name */
export interface AccountAssignment {
  accountInfo: ExtractedAccountInfo;
  bankId: string;
  newBankName?: string;
}

export interface BankAccountAssignmentStepProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountBankMatch[];
  transferPairs: TransferPairCandidate[];
  connectedBanks: ConnectedBankOption[];
  onConfirm: (assignments: AccountAssignment[]) => void;
}

export const BankAccountAssignmentStep: React.FC<BankAccountAssignmentStepProps> = ({
  open,
  onOpenChange,
  accounts,
  transferPairs,
  connectedBanks,
  onConfirm,
}) => {
  // Per-account state: bankId selection and optional new name
  const [assignments, setAssignments] = useState<
    Record<string, { bankId: string; newBankName: string }>
  >({});

  // Pre-populate from auto-matches
  useEffect(() => {
    const initial: Record<string, { bankId: string; newBankName: string }> = {};
    for (const match of accounts) {
      const key = match.accountInfo.rawValue;
      if (match.matchedBank && match.confidence === 'high') {
        initial[key] = { bankId: match.matchedBank.id, newBankName: '' };
      } else {
        // Pre-populate new bank name suggestion
        const suggestedName = buildSuggestedName(match.accountInfo);
        initial[key] = { bankId: '__new__', newBankName: suggestedName };
      }
    }
    setAssignments(initial);
  }, [accounts]);

  const handleBankChange = (rawValue: string, bankId: string) => {
    setAssignments((prev) => ({
      ...prev,
      [rawValue]: {
        bankId,
        newBankName: bankId === '__new__' ? (prev[rawValue]?.newBankName || '') : '',
      },
    }));
  };

  const handleNewNameChange = (rawValue: string, name: string) => {
    setAssignments((prev) => ({
      ...prev,
      [rawValue]: { ...prev[rawValue], newBankName: name },
    }));
  };

  const allAssigned = accounts.every((match) => {
    const a = assignments[match.accountInfo.rawValue];
    if (!a) return false;
    if (a.bankId === '__new__') return a.newBankName.trim().length > 0;
    return a.bankId.length > 0;
  });

  const handleConfirm = () => {
    const result: AccountAssignment[] = accounts.map((match) => {
      const a = assignments[match.accountInfo.rawValue];
      return {
        accountInfo: match.accountInfo,
        bankId: a.bankId,
        newBankName: a.bankId === '__new__' ? a.newBankName.trim() : undefined,
      };
    });
    onConfirm(result);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <ArrowLeftRight className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Assign Accounts
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                Match each source account to an existing bank or create a new one
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          {/* Transfer pairs alert */}
          {transferPairs.length > 0 && (
            <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
              <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="text-[13px] text-amber-700 dark:text-amber-300">
                <strong>{transferPairs.length} potential inter-account transfer{transferPairs.length !== 1 ? 's' : ''} detected.</strong>{' '}
                These will be flagged after import so you can review them.
              </AlertDescription>
            </Alert>
          )}

          {/* Per-account cards */}
          {accounts.map((match) => {
            const { accountInfo } = match;
            const a = assignments[accountInfo.rawValue] || { bankId: '', newBankName: '' };

            return (
              <div
                key={accountInfo.rawValue}
                className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[14px] font-medium text-foreground truncate">
                      {accountInfo.rawValue}
                    </span>
                    <Badge variant="secondary" className="text-[11px] shrink-0">
                      {accountInfo.rowCount} txn{accountInfo.rowCount !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  {match.confidence === 'high' && match.matchedBank && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[11px] shrink-0 gap-1',
                        'bg-green-50 text-green-700 border-green-200',
                        'dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
                      )}
                    >
                      <CheckCircle className="w-3 h-3" />
                      Auto-matched
                    </Badge>
                  )}
                </div>

                <div className="p-4 space-y-3">
                  {/* Parsed info badges */}
                  <div className="flex flex-wrap gap-1.5">
                    {accountInfo.institutionName && (
                      <Badge variant="outline" className="text-[11px] bg-muted/30">
                        {accountInfo.institutionName}
                      </Badge>
                    )}
                    {accountInfo.accountMask && (
                      <Badge variant="outline" className="text-[11px] bg-muted/30 font-mono">
                        ****{accountInfo.accountMask}
                      </Badge>
                    )}
                    {accountInfo.accountType && (
                      <Badge variant="outline" className="text-[11px] bg-muted/30">
                        {accountInfo.accountType.replace('_', ' ')}
                      </Badge>
                    )}
                  </div>

                  {/* Bank selector */}
                  <div className="space-y-2">
                    <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                      Assign to Bank
                    </Label>
                    <Select
                      value={a.bankId}
                      onValueChange={(val) => handleBankChange(accountInfo.rawValue, val)}
                    >
                      <SelectTrigger className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                        <SelectValue placeholder="Choose a bank account..." />
                      </SelectTrigger>
                      <SelectContent>
                        {connectedBanks.map((bank) => (
                          <SelectItem key={bank.id} value={bank.id}>
                            {bank.institution_name}
                          </SelectItem>
                        ))}
                        <SelectItem value="__new__">
                          <div className="flex items-center gap-1.5">
                            <Plus className="h-3.5 w-3.5" />
                            Create New Bank
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* New bank name input */}
                  {a.bankId === '__new__' && (
                    <div className="space-y-2">
                      <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        New Bank Name
                      </Label>
                      <Input
                        value={a.newBankName}
                        onChange={(e) =>
                          handleNewNameChange(accountInfo.rawValue, e.target.value)
                        }
                        placeholder="e.g., Mercury Checking ****7138"
                        className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/40">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-lg text-[13px] font-medium"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!allAssigned}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            Continue with Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function buildSuggestedName(info: ExtractedAccountInfo): string {
  const parts: string[] = [];
  if (info.institutionName) parts.push(info.institutionName);
  if (info.accountType) {
    const formatted = info.accountType
      .replace('_', ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    parts.push(formatted);
  }
  if (info.accountMask) parts.push(`****${info.accountMask}`);

  return parts.length > 0 ? parts.join(' ') : info.rawValue;
}

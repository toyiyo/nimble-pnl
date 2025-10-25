import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface BankAccount {
  id: string;
  institution_name: string;
  bank_account_balances: Array<{
    id: string;
    account_name: string;
    account_mask: string | null;
  }>;
}

interface BankAccountFilterProps {
  selectedBankAccount: string;
  onBankAccountChange: (value: string) => void;
  connectedBanks: BankAccount[];
}

export function BankAccountFilter({ 
  selectedBankAccount, 
  onBankAccountChange, 
  connectedBanks 
}: BankAccountFilterProps) {
  const selectedBank = connectedBanks.find(b => b.id === selectedBankAccount);
  const totalAccounts = connectedBanks.reduce((sum, bank) => sum + (bank.bank_account_balances?.length || 0), 0);

  return (
    <Card className="p-4 bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <Building2 className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <Label className="text-sm font-medium mb-2 block">Filter by Bank Account</Label>
            <Select value={selectedBankAccount} onValueChange={onBankAccountChange}>
              <SelectTrigger className="w-full max-w-[400px]">
                <SelectValue placeholder="All Accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">All Accounts</span>
                    <Badge variant="secondary" className="text-xs">{totalAccounts} accounts</Badge>
                  </div>
                </SelectItem>
                {connectedBanks.map(bank => (
                  <SelectItem key={bank.id} value={bank.id}>
                    <div className="flex items-center gap-2">
                      <span>{bank.institution_name}</span>
                      {bank.bank_account_balances?.[0]?.account_mask && (
                        <span className="text-xs text-muted-foreground">
                          ••{bank.bank_account_balances[0].account_mask}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {selectedBankAccount !== 'all' && (
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => onBankAccountChange('all')}
            className="gap-2"
          >
            <X className="h-4 w-4" />
            Clear Filter
          </Button>
        )}
      </div>

      {/* Active Filter Display */}
      {selectedBankAccount === 'all' ? (
        <div className="mt-3 text-sm text-muted-foreground flex items-center gap-2">
          <span>Showing data from all {totalAccounts} connected accounts</span>
        </div>
      ) : selectedBank && (
        <div className="mt-3 flex items-center gap-2">
          <Badge variant="default" className="gap-1">
            <Building2 className="h-3 w-3" />
            {selectedBank.institution_name}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Metrics filtered to this account only
          </span>
        </div>
      )}
    </Card>
  );
}

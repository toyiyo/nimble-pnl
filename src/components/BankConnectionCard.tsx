import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, Wallet, TrendingUp, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BankBalance {
  id: string;
  account_name: string;
  account_type: string | null;
  account_mask: string | null;
  current_balance: number;
  available_balance: number | null;
  currency: string;
  as_of_date: string;
  is_active: boolean;
}

interface BankConnectionCardProps {
  bank: {
    id: string;
    stripe_financial_account_id: string;
    institution_name: string;
    institution_logo_url: string | null;
    status: 'connected' | 'disconnected' | 'error' | 'requires_reauth';
    connected_at: string;
    disconnected_at: string | null;
    last_sync_at: string | null;
    sync_error: string | null;
    balances: BankBalance[];
  };
  restaurantId: string;
  onRefreshBalance?: (bankId: string) => Promise<void>;
  onSyncTransactions?: (bankId: string) => Promise<void>;
}

export const BankConnectionCard = ({ bank, onRefreshBalance, onSyncTransactions }: BankConnectionCardProps) => {
  const totalBalance = bank.balances.reduce((sum, balance) => sum + balance.current_balance, 0);
  const activeAccounts = bank.balances.filter(b => b.is_active).length;

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <Card className={cn(
      "hover:shadow-lg transition-all duration-300 relative overflow-hidden",
      bank.status === 'connected' && "border-emerald-500/20"
    )}>
      {bank.status === 'connected' && (
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none" />
      )}

      <CardHeader className="relative">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-12 h-12 rounded-lg flex items-center justify-center",
              bank.status === 'connected' ? "bg-emerald-500/10" : "bg-muted"
            )}>
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                {bank.institution_name}
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-xs",
                    bank.status === 'connected' && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
                    bank.status === 'error' && "bg-destructive/10 text-destructive border-destructive/20"
                  )}
                >
                  {bank.status === 'connected' ? 'Active' : bank.status === 'error' ? 'Error' : 'Disconnected'}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Connected {formatDate(bank.connected_at)}
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 relative">
        {/* Total Balance */}
        <div className="p-4 rounded-lg bg-gradient-to-br from-primary/5 to-transparent border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Wallet className="h-4 w-4" />
            Total Balance
          </div>
          <div className="text-2xl font-bold">
            {formatCurrency(totalBalance)}
          </div>
        </div>

        {/* Account Summary */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{activeAccounts} Active Account{activeAccounts !== 1 ? 's' : ''}</span>
          </div>
          {bank.last_sync_at && (
            <span className="text-xs text-muted-foreground">
              Synced {formatDate(bank.last_sync_at)}
            </span>
          )}
        </div>

        {/* Individual Accounts */}
        {bank.balances.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Accounts</p>
            {bank.balances.map((balance) => (
              <div 
                key={balance.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{balance.account_name}</span>
                    {balance.account_mask && (
                      <span className="text-xs text-muted-foreground">••••{balance.account_mask}</span>
                    )}
                  </div>
                  {balance.account_type && (
                    <span className="text-xs text-muted-foreground capitalize">{balance.account_type}</span>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">
                    {formatCurrency(balance.current_balance, balance.currency)}
                  </div>
                  {balance.available_balance !== null && balance.available_balance !== balance.current_balance && (
                    <div className="text-xs text-muted-foreground">
                      {formatCurrency(balance.available_balance, balance.currency)} available
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error Message */}
        {bank.sync_error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{bank.sync_error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="pt-2 space-y-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full"
            onClick={() => onRefreshBalance?.(bank.id)}
          >
            Refresh Balance
          </Button>
          <Button 
            variant="default" 
            size="sm" 
            className="w-full"
            onClick={() => onSyncTransactions?.(bank.id)}
          >
            Sync Transactions
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

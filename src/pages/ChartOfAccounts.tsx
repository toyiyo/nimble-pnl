import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useChartOfAccounts } from '@/hooks/useChartOfAccounts';
import { Plus, Wallet, TrendingDown, TrendingUp, DollarSign, ShoppingCart, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const accountTypeIcons = {
  asset: Wallet,
  liability: TrendingDown,
  equity: Users,
  revenue: TrendingUp,
  expense: ShoppingCart,
  cogs: DollarSign,
};

const accountTypeColors = {
  asset: 'text-emerald-600 dark:text-emerald-400',
  liability: 'text-red-600 dark:text-red-400',
  equity: 'text-purple-600 dark:text-purple-400',
  revenue: 'text-blue-600 dark:text-blue-400',
  expense: 'text-orange-600 dark:text-orange-400',
  cogs: 'text-amber-600 dark:text-amber-400',
};

export default function ChartOfAccounts() {
  const { selectedRestaurant } = useRestaurantContext();
  const { accounts, loading, createDefaultAccounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || null);

  const groupedAccounts = accounts.reduce((acc, account) => {
    if (!acc[account.account_type]) {
      acc[account.account_type] = [];
    }
    acc[account.account_type].push(account);
    return acc;
  }, {} as Record<string, typeof accounts>);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="p-8">
        <PageHeader 
          icon={Wallet}
          iconVariant="emerald"
          title="Chart of Accounts" 
          subtitle="Manage your accounting categories"
        />
        <div className="mt-8">Loading...</div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="p-8">
        <PageHeader 
          icon={Wallet}
          iconVariant="emerald"
          title="Chart of Accounts" 
          subtitle="Manage your accounting categories"
        />
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Set Up Your Chart of Accounts</CardTitle>
            <CardDescription>
              Create a standard chart of accounts with categories specifically designed for restaurants
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={createDefaultAccounts} size="lg">
              <Plus className="mr-2 h-5 w-5" />
              Create Default Accounts
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8">
      <PageHeader 
        icon={Wallet}
        iconVariant="emerald"
        title="Chart of Accounts" 
        subtitle="Your accounting categories and current balances"
      />

      <div className="mt-8 space-y-6">
        {Object.entries(groupedAccounts).map(([type, typeAccounts]) => {
          const Icon = accountTypeIcons[type as keyof typeof accountTypeIcons];
          const colorClass = accountTypeColors[type as keyof typeof accountTypeColors];
          const totalBalance = typeAccounts.reduce((sum, acc) => sum + acc.current_balance, 0);

          return (
            <Card key={type}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center bg-muted", colorClass)}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="capitalize">{type}</CardTitle>
                      <CardDescription>{typeAccounts.length} accounts</CardDescription>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-muted-foreground">Total Balance</div>
                    <div className="text-xl font-bold">{formatCurrency(totalBalance)}</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {typeAccounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="font-mono">
                          {account.account_code}
                        </Badge>
                        <div>
                          <div className="font-medium">{account.account_name}</div>
                          {account.description && (
                            <div className="text-sm text-muted-foreground">{account.description}</div>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold">{formatCurrency(account.current_balance)}</div>
                        {account.is_system_account && (
                          <Badge variant="secondary" className="text-xs">System</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface TrialBalanceProps {
  restaurantId: string;
  asOfDate: Date;
}

export function TrialBalance({ restaurantId, asOfDate }: TrialBalanceProps) {
  const { toast } = useToast();

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['trial-balance', restaurantId, asOfDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type, current_balance, normal_balance')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('account_code');

      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurantId,
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  // Calculate debit and credit totals
  const totalDebits = accounts?.reduce((sum, acc) => {
    return sum + (acc.normal_balance === 'debit' ? acc.current_balance : 0);
  }, 0) || 0;

  const totalCredits = accounts?.reduce((sum, acc) => {
    return sum + (acc.normal_balance === 'credit' ? acc.current_balance : 0);
  }, 0) || 0;

  const handleExport = () => {
    const csvContent = [
      ['Trial Balance'],
      [`As of: ${format(asOfDate, 'MMM dd, yyyy')}`],
      [''],
      ['Account Code', 'Account Name', 'Debit', 'Credit'],
      ...accounts!.map(acc => [
        acc.account_code,
        acc.account_name,
        acc.normal_balance === 'debit' ? acc.current_balance : '',
        acc.normal_balance === 'credit' ? acc.current_balance : '',
      ]),
      ['', 'TOTALS', totalDebits, totalCredits],
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trial-balance-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: 'Export successful',
      description: 'Trial balance exported to CSV',
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Trial Balance</CardTitle>
            <CardDescription>As of {format(asOfDate, 'MMM dd, yyyy')}</CardDescription>
          </div>
          <Button onClick={handleExport} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-3 font-semibold">Code</th>
                <th className="text-left py-3 px-3 font-semibold">Account Name</th>
                <th className="text-right py-3 px-3 font-semibold">Debit</th>
                <th className="text-right py-3 px-3 font-semibold">Credit</th>
              </tr>
            </thead>
            <tbody>
              {accounts?.map((account) => (
                <tr key={account.id} className="border-b hover:bg-muted/50">
                  <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{account.account_code}</td>
                  <td className="py-2 px-3">{account.account_name}</td>
                  <td className="py-2 px-3 text-right font-medium">
                    {account.normal_balance === 'debit' ? formatCurrency(account.current_balance) : '—'}
                  </td>
                  <td className="py-2 px-3 text-right font-medium">
                    {account.normal_balance === 'credit' ? formatCurrency(account.current_balance) : '—'}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 font-bold">
                <td colSpan={2} className="py-3 px-3">TOTALS</td>
                <td className="py-3 px-3 text-right">{formatCurrency(totalDebits)}</td>
                <td className="py-3 px-3 text-right">{formatCurrency(totalCredits)}</td>
              </tr>
            </tbody>
          </table>

          {/* Balance Check */}
          {Math.abs(totalDebits - totalCredits) > 0.01 && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                ⚠️ Trial Balance doesn't balance! Difference: {formatCurrency(Math.abs(totalDebits - totalCredits))}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
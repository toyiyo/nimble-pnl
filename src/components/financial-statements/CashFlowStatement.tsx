import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface CashFlowStatementProps {
  restaurantId: string;
  dateFrom: Date;
  dateTo: Date;
}

export function CashFlowStatement({ restaurantId, dateFrom, dateTo }: CashFlowStatementProps) {
  const { toast } = useToast();

  const { data: cashFlowData, isLoading } = useQuery({
    queryKey: ['cash-flow', restaurantId, dateFrom, dateTo],
    queryFn: async () => {
      // Get cash accounts (asset type, cash subtype)
      const { data: cashAccounts, error: accountsError } = await supabase
        .from('chart_of_accounts')
        .select('id, account_name')
        .eq('restaurant_id', restaurantId)
        .eq('account_type', 'asset')
        .eq('account_subtype', 'cash')
        .eq('is_active', true);

      if (accountsError) throw accountsError;

      if (!cashAccounts || cashAccounts.length === 0) {
        return { operating: 0, investing: 0, financing: 0, netChange: 0, cashAccounts: [] };
      }

      const cashAccountIds = cashAccounts.map(a => a.id);

      // Get journal entry lines for cash accounts in the date range
      const { data: cashLines, error: linesError } = await supabase
        .from('journal_entry_lines')
        .select(`
          debit_amount,
          credit_amount,
          journal_entry:journal_entries!inner(
            entry_date,
            restaurant_id,
            description
          )
        `)
        .in('account_id', cashAccountIds)
        .gte('journal_entry.entry_date', dateFrom.toISOString().split('T')[0])
        .lte('journal_entry.entry_date', dateTo.toISOString().split('T')[0])
        .eq('journal_entry.restaurant_id', restaurantId);

      if (linesError) throw linesError;

      // Calculate net cash change (debits increase cash, credits decrease cash)
      const netChange = (cashLines || []).reduce((sum, line: any) => {
        return sum + (line.debit_amount || 0) - (line.credit_amount || 0);
      }, 0);

      // For now, show all cash movement as operating activities
      // In a full implementation, you'd categorize by transaction type
      return {
        operating: netChange,
        investing: 0,
        financing: 0,
        netChange,
        cashAccounts: cashAccounts.map(a => a.account_name),
      };
    },
    enabled: !!restaurantId,
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const handleExport = () => {
    const csvContent = [
      ['Cash Flow Statement'],
      [`Period: ${format(dateFrom, 'MMM dd, yyyy')} - ${format(dateTo, 'MMM dd, yyyy')}`],
      [''],
      ['Operating Activities', cashFlowData?.operating || 0],
      ['Investing Activities', cashFlowData?.investing || 0],
      ['Financing Activities', cashFlowData?.financing || 0],
      [''],
      ['Net Change in Cash', cashFlowData?.netChange || 0],
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cash-flow-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: 'Export successful',
      description: 'Cash flow statement exported to CSV',
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

  const operating = cashFlowData?.operating || 0;
  const investing = cashFlowData?.investing || 0;
  const financing = cashFlowData?.financing || 0;
  const netChange = cashFlowData?.netChange || 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Cash Flow Statement</CardTitle>
            <CardDescription>
              For the period {format(dateFrom, 'MMM dd, yyyy')} - {format(dateTo, 'MMM dd, yyyy')}
            </CardDescription>
          </div>
          <Button onClick={handleExport} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Cash Accounts Info */}
          {cashFlowData?.cashAccounts && cashFlowData.cashAccounts.length > 0 && (
            <div className="text-sm text-muted-foreground mb-4">
              Tracking cash accounts: {cashFlowData.cashAccounts.join(', ')}
            </div>
          )}

          {/* Operating Activities */}
          <div>
            <h3 className="font-semibold text-lg mb-3">Cash Flow from Operating Activities</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50">
                <span>Net cash from operations</span>
                <span className="font-medium">{formatCurrency(operating)}</span>
              </div>
              <div className="flex justify-between items-center py-2 px-3 border-t font-semibold">
                <span>Net Operating Cash Flow</span>
                <span className={operating >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatCurrency(operating)}
                </span>
              </div>
            </div>
          </div>

          {/* Investing Activities */}
          <div>
            <h3 className="font-semibold text-lg mb-3">Cash Flow from Investing Activities</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center py-2 px-3 border-t font-semibold">
                <span>Net Investing Cash Flow</span>
                <span className={investing >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatCurrency(investing)}
                </span>
              </div>
            </div>
          </div>

          {/* Financing Activities */}
          <div>
            <h3 className="font-semibold text-lg mb-3">Cash Flow from Financing Activities</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center py-2 px-3 border-t font-semibold">
                <span>Net Financing Cash Flow</span>
                <span className={financing >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatCurrency(financing)}
                </span>
              </div>
            </div>
          </div>

          {/* Net Change in Cash */}
          <div className="flex justify-between items-center py-4 px-3 bg-primary/10 border border-primary/20 rounded-lg font-bold text-xl">
            <span>Net Change in Cash</span>
            <span className={netChange >= 0 ? 'text-green-600' : 'text-red-600'}>
              {formatCurrency(netChange)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
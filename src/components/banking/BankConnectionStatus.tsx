import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useSyncBankTransactions } from "@/hooks/useSyncBankTransactions";
import { Loader2, RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";

export function BankConnectionStatus() {
  const { selectedRestaurant } = useRestaurantContext();
  const syncTransactions = useSyncBankTransactions();

  const { data: banks, isLoading } = useQuery({
    queryKey: ['connected-banks', selectedRestaurant?.restaurant_id],
    queryFn: async () => {
      if (!selectedRestaurant?.restaurant_id) return [];

      const { data, error } = await supabase
        .from('connected_banks')
        .select('*, bank_account_balances(account_name, account_mask)')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!selectedRestaurant?.restaurant_id,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!banks || banks.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="text-lg font-semibold mb-4">Connected Bank Accounts</h3>
        <div className="space-y-3">
          {banks.map((bank) => (
            <div key={bank.id} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                {bank.institution_logo_url ? (
                  <img 
                    src={bank.institution_logo_url} 
                    alt={bank.institution_name}
                    className="h-10 w-10 rounded-lg object-contain"
                  />
                ) : (
                  bank.status === 'connected' ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )
                )}
                <div>
                  <div className="font-medium">{bank.institution_name}</div>
                  {bank.bank_account_balances && bank.bank_account_balances.length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      {bank.bank_account_balances[0].account_name} ••••
                      {bank.bank_account_balances[0].account_mask}
                    </div>
                  )}
                  {bank.last_sync_at && (
                    <div className="text-xs text-muted-foreground">
                      Last synced: {format(new Date(bank.last_sync_at), 'MMM dd, yyyy h:mm a')}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={bank.status === 'connected' ? 'default' : 'destructive'}>
                  {bank.status}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncTransactions.mutate(bank.id)}
                  disabled={syncTransactions.isPending}
                >
                  {syncTransactions.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Sync
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

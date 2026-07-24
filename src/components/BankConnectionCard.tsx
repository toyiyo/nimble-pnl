import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Wallet, TrendingUp, AlertCircle, Loader2, MoreVertical, ChevronDown, RefreshCw, Database, Unplug, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMemo, useState, type CSSProperties } from 'react';
import { useToast } from '@/hooks/use-toast';
import { DisconnectBankDialog } from '@/components/banking/DisconnectBankDialog';
import { FreshnessStamp } from '@/components/banking/FreshnessStamp';
import type { GroupedBank } from '@/utils/financialConnections';

interface BankConnectionCardProps {
  bank: GroupedBank;
  onRefreshBalance?: (bankId: string) => Promise<void>;
  onSyncTransactions?: (bankId: string) => Promise<void>;
  onDisconnect?: (bankId: string, deleteData: boolean) => Promise<void>;
  onReconnect?: (connectedBankId: string) => Promise<void>;
}

// Contrast-safe historical-row treatment (design §5.3): texture, not opacity.
// opacity-50 on text-foreground over bg-background drops below the WCAG
// 1.4.3 4.5:1 floor for normal-size text — the hatch plus the muted token
// and the literal "Historical" chip carry the meaning instead.
const HISTORICAL_HATCH_STYLE: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, hsl(var(--muted-foreground) / 0.06) 0 1px, transparent 1px 8px)',
};

export const BankConnectionCard = ({ bank, onRefreshBalance, onSyncTransactions, onDisconnect, onReconnect }: BankConnectionCardProps) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);
  const [showAccounts, setShowAccounts] = useState(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<{ name: string; ids: string | string[] } | null>(null);
  const { toast } = useToast();
  const totalBalance = useMemo(
    () => bank.balances.reduce((sum, balance) => sum + balance.current_balance, 0),
    [bank.balances]
  );
  const activeAccounts = useMemo(
    () => bank.balances.filter(b => b.is_active).length,
    [bank.balances]
  );
  const primaryAccount = bank.balances[0];

  // The group's own freshness stamp is the oldest `dataCurrentThrough` across
  // every balance it holds — the same worst-of convention STATUS_PRIORITY
  // already uses for the headline status badge, applied to freshness too.
  const dataCurrentThrough = useMemo(() => {
    const values = bank.balances
      .map((balance) => balance.dataCurrentThrough)
      .filter((value): value is string => Boolean(value));
    if (values.length === 0) return null;
    return values.reduce((oldest, value) => (new Date(value) < new Date(oldest) ? value : oldest));
  }, [bank.balances]);

  const handleSyncTransactions = async (targetBankId?: string) => {
    if (!onSyncTransactions) return;
    setIsSyncing(true);
    const targets = targetBankId ? [targetBankId] : bank.healthyBankIds;
    try {
      for (const id of targets) {
        await onSyncTransactions(id);
      }
      toast({
        title: "Success",
        description: targets.length > 1 ? "Transactions synced for all accounts" : "Transactions synced successfully",
      });
    } catch (error) {
      console.error('Transaction sync error:', error);
      toast({
        variant: "destructive",
        title: "Sync Failed",
        description: error instanceof Error ? error.message : "Failed to sync transactions. Please try again.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRefreshBalance = async (targetBankId?: string) => {
    if (!onRefreshBalance) return;
    setIsRefreshing(true);
    const targets = targetBankId ? [targetBankId] : bank.healthyBankIds;
    try {
      for (const id of targets) {
        await onRefreshBalance(id);
      }
      toast({
        title: "Success",
        description: targets.length > 1 ? "Balances refreshed for all accounts" : "Balance refreshed successfully",
      });
    } catch (error) {
      console.error('Balance refresh error:', error);
      toast({
        variant: "destructive",
        title: "Refresh Failed",
        description: error instanceof Error ? error.message : "Failed to refresh balance. Please try again.",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleReconnect = async (targetBankId: string) => {
    if (!onReconnect) return;
    setReconnectingId(targetBankId);
    try {
      await onReconnect(targetBankId);
      toast({
        title: "Success",
        description: "Reconnected successfully",
      });
    } catch (error) {
      console.error('Reconnect error:', error);
      toast({
        variant: "destructive",
        title: "Reconnect Failed",
        description: error instanceof Error ? error.message : "Failed to reconnect. Please try again.",
      });
    } finally {
      setReconnectingId(null);
    }
  };

  // A single quarantined account is targeted directly; more than one opens
  // the accounts list so the user picks — never a silent "first of N"
  // (design §5.3).
  const handleTopLevelReconnect = () => {
    if (bank.reauthBankIds.length === 1) {
      handleReconnect(bank.reauthBankIds[0]);
    } else {
      setShowAccounts(true);
    }
  };

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
    <Card className="border-border/70 bg-card/80 backdrop-blur-sm shadow-sm hover:border-primary/40 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12 rounded-xl border border-border/70">
            {bank.institution_logo_url ? (
              <AvatarImage src={bank.institution_logo_url} alt={bank.institution_name} />
            ) : (
              <AvatarFallback className="bg-muted text-primary">
                {bank.institution_name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            )}
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-semibold text-base leading-tight truncate">{bank.institution_name}</div>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  bank.status === 'connected' && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
                  bank.status === 'error' && "bg-destructive/10 text-destructive border-destructive/20",
                  bank.status === 'requires_reauth' && "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                )}
              >
                {bank.status === 'connected' ? 'Active' : bank.status === 'error' ? 'Error' : bank.status === 'requires_reauth' ? 'Requires Reauth' : 'Disconnected'}
              </Badge>
              <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">
                {bank.balances.length} account{bank.balances.length !== 1 ? 's' : ''}
              </Badge>
            </div>
            <div className="mt-1 flex items-center gap-1 flex-wrap">
              <span className="text-xs text-muted-foreground">Connected {formatDate(bank.connected_at)}</span>
              <span className="text-xs text-muted-foreground/70">&bull;</span>
              <FreshnessStamp dataCurrentThrough={dataCurrentThrough} />
            </div>
            {primaryAccount && (
              <div className="text-sm text-muted-foreground mt-1 line-clamp-1">
                {primaryAccount.account_name}
                {primaryAccount.account_mask && ` ••••${primaryAccount.account_mask}`}
                {primaryAccount.account_type && ` • ${primaryAccount.account_type}`}
              </div>
            )}
          </div>

          <div className="text-right min-w-[140px]">
            <div className="text-lg font-semibold tracking-tight">{formatCurrency(totalBalance)}</div>
            <div className="text-xs text-muted-foreground flex items-center justify-end gap-1">
              <TrendingUp className="h-3.5 w-3.5" />
              {activeAccounts} active
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Open bank options">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {bank.healthyBankIds.length > 0 && (
                <>
                  <DropdownMenuItem onClick={() => handleRefreshBalance()} disabled={isRefreshing} className="flex items-center gap-2">
                    {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Refresh balance
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSyncTransactions()} disabled={isSyncing} className="flex items-center gap-2">
                    {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                    Sync transactions
                  </DropdownMenuItem>
                </>
              )}
              {bank.reauthBankIds.length > 0 && onReconnect && (
                <DropdownMenuItem
                  onClick={handleTopLevelReconnect}
                  disabled={reconnectingId !== null}
                  className="flex items-center gap-2 text-amber-700 dark:text-amber-400 focus:text-amber-700 dark:focus:text-amber-400"
                >
                  {reconnectingId !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  Reconnect
                </DropdownMenuItem>
              )}
              {onDisconnect && (
                <DropdownMenuItem
                  className="flex items-center gap-2 text-destructive focus:text-destructive"
                  onSelect={(e) => {
                    e.preventDefault();
                    setDisconnectTarget({ name: bank.institution_name, ids: bank.bankIds });
                    setDisconnectDialogOpen(true);
                  }}
                >
                  <Unplug className="h-4 w-4" />
                  Disconnect
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-3 border-t border-border/60 pt-3">
          <Collapsible open={showAccounts} onOpenChange={setShowAccounts}>
            <CollapsibleTrigger className="w-full flex items-center justify-between text-sm text-muted-foreground hover:text-foreground transition-colors">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                <span>{bank.balances.length} account{bank.balances.length !== 1 ? 's' : ''}</span>
              </div>
              <ChevronDown className={cn("h-4 w-4 transition-transform", showAccounts ? "rotate-180" : "")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 mt-3">
              {bank.balances.map((balance) => {
                const isHistorical = balance.bankStatus !== 'connected';
                const targetBankId = balance.connected_bank_id || bank.bankIds[0];

                return (
                  <div
                    key={balance.id}
                    className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 bg-background/60"
                    style={isHistorical ? HISTORICAL_HATCH_STYLE : undefined}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium truncate">
                        {balance.account_name}
                        {balance.account_mask && (
                          <span className="text-xs text-muted-foreground">••••{balance.account_mask}</span>
                        )}
                        {isHistorical && (
                          <Badge variant="outline" className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border-border/40">
                            Historical
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {balance.account_type || 'account'} • As of {formatDate(balance.as_of_date)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="text-right">
                        <div className={cn("text-sm font-semibold", isHistorical && "text-muted-foreground")}>
                          {formatCurrency(balance.current_balance, balance.currency)}
                        </div>
                        {balance.available_balance !== null && balance.available_balance !== balance.current_balance && (
                          <div className="text-xs text-muted-foreground">
                            {formatCurrency(balance.available_balance, balance.currency)} available
                          </div>
                        )}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Open account options">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          {isHistorical ? (
                            onReconnect && (
                              <DropdownMenuItem
                                onClick={() => handleReconnect(targetBankId)}
                                disabled={reconnectingId !== null}
                                className="flex items-center gap-2 text-amber-700 dark:text-amber-400 focus:text-amber-700 dark:focus:text-amber-400"
                              >
                                {reconnectingId === targetBankId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                                Reconnect
                              </DropdownMenuItem>
                            )
                          ) : (
                            <>
                              <DropdownMenuItem
                                onClick={() => handleRefreshBalance(targetBankId)}
                                disabled={isRefreshing}
                                className="flex items-center gap-2"
                              >
                                {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                Refresh balance
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleSyncTransactions(targetBankId)}
                                disabled={isSyncing}
                                className="flex items-center gap-2"
                              >
                                {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                                Sync transactions
                              </DropdownMenuItem>
                            </>
                          )}
                          {onDisconnect && (
                            <DropdownMenuItem
                              className="flex items-center gap-2 text-destructive focus:text-destructive"
                              onSelect={(e) => {
                                e.preventDefault();
                                setDisconnectTarget({ name: balance.account_name, ids: targetBankId });
                                setDisconnectDialogOpen(true);
                              }}
                            >
                              <Unplug className="h-4 w-4" />
                              Disconnect account
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        </div>

        {bank.sync_error && (
          <div className="flex items-start gap-2 p-3 mt-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" focusable="false" />
            <span>{bank.sync_error}</span>
          </div>
        )}
      </CardContent>

      {/* Disconnect dialog - rendered outside dropdown to avoid Radix focus trap issues */}
      {onDisconnect && disconnectTarget && (
        <DisconnectBankDialog
          bankName={disconnectTarget.name}
          bankIds={disconnectTarget.ids}
          onDisconnect={onDisconnect}
          open={disconnectDialogOpen}
          onOpenChange={(open) => {
            setDisconnectDialogOpen(open);
            if (!open) setDisconnectTarget(null);
          }}
        />
      )}
    </Card>
  );
};

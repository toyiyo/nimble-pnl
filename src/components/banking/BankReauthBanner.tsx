import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { BankStatus } from '@/utils/financialConnections';

/**
 * The subset of `connected_banks` fields this banner needs. Deliberately
 * per-account (not `GroupedBank`) — Reconnect always targets a single
 * `connected_bank_id` (design §5.4), and the banner names one institution +
 * masked account + stop date per quarantined row.
 */
export interface BankReauthBannerBank {
  id: string;
  institution_name: string;
  account_mask: string | null;
  status: BankStatus;
  /** `connected_banks.deactivated_at` — when this outage started. */
  deactivated_at: string | null;
  sync_error: string | null;
}

interface BankReauthBannerProps {
  banks: BankReauthBannerBank[];
  /** True while the owning query is still loading. Never a skeleton here. */
  loading: boolean;
  onReconnect?: (connectedBankId: string) => Promise<void> | void;
  className?: string;
}

function formatStopDate(dateString: string | null): string | null {
  if (!dateString) return null;
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function BankReauthBanner({ banks, loading, onReconnect, className }: BankReauthBannerProps) {
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);
  const { toast } = useToast();

  if (loading) {
    return null;
  }

  const quarantined = banks.filter(
    (bank) => bank.status === 'requires_reauth' || bank.status === 'error'
  );

  if (quarantined.length === 0) {
    return null;
  }

  const handleReconnect = async (bankId: string) => {
    if (!onReconnect) return;
    setReconnectingId(bankId);
    try {
      await onReconnect(bankId);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to Reconnect',
        description: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setReconnectingId(null);
    }
  };

  return (
    <div role="status" className={cn('space-y-2', className)}>
      {quarantined.map((bank) => {
        const isError = bank.status === 'error';
        const stopDate = formatStopDate(bank.deactivated_at);
        const isReconnecting = reconnectingId === bank.id;

        return (
          <div
            key={bank.id}
            data-bank-row
            className={cn(
              'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-xl border',
              isError
                ? 'bg-destructive/10 border-destructive/20'
                : 'bg-amber-500/10 border-amber-500/20'
            )}
          >
            <div className="flex items-start gap-2 min-w-0">
              <AlertCircle
                className={cn(
                  'h-4 w-4 mt-0.5 flex-shrink-0',
                  isError ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'
                )}
                aria-hidden="true"
                focusable="false"
              />
              <div className="min-w-0 text-[13px]">
                <p
                  className={cn(
                    'font-medium',
                    isError ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'
                  )}
                >
                  <span className="truncate inline-block max-w-full align-bottom">
                    {bank.institution_name}
                  </span>
                  {bank.account_mask && <span className="ml-1">&bull;&bull;{bank.account_mask}</span>}
                  {' — '}
                  {isError ? 'Connection error' : 'Needs reauthorization'}
                </p>
                <p className="text-muted-foreground">
                  {isError
                    ? bank.sync_error || 'Sync failed'
                    : stopDate
                      ? `Data stopped ${stopDate}`
                      : 'Data stopped'}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              disabled={isReconnecting}
              onClick={() => handleReconnect(bank.id)}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium flex-shrink-0 self-start sm:self-center"
            >
              {isReconnecting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />}
              Reconnect
            </Button>
          </div>
        );
      })}
    </div>
  );
}

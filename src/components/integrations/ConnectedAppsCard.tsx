import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { Check, Copy, Link2, Sparkles } from 'lucide-react';

import { useAuth } from '@/hooks/useAuth';
import { useOAuthGrants } from '@/hooks/useOAuthGrants';

import { SUPABASE_URL } from '@/integrations/supabase/client';

export const CLAUDE_CONNECTOR_URL = `${SUPABASE_URL}/functions/v1/mcp`;

const GRANT_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * The grant date in the viewer's time zone. A grant belongs to the user, not
 * to a restaurant, so the restaurant clock does not apply.
 */
function formatGrantDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : GRANT_DATE_FORMAT.format(date);
}

/**
 * The Claude connector URL, and the applications that the user allowed
 * through the OAuth server. Revoke stops the access of an application.
 */
export function ConnectedAppsCard() {
  const { user } = useAuth();
  const { grants, revoke } = useOAuthGrants(user?.id ?? null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [confirmClientId, setConfirmClientId] = useState<string | null>(null);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(CLAUDE_CONNECTOR_URL);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  };

  const revokingId = revoke.isPending ? revoke.variables : null;

  return (
    <section
      aria-labelledby="connected-apps-heading"
      className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-foreground" aria-hidden="true" />
        <h2 id="connected-apps-heading" className="text-[13px] font-semibold text-foreground">
          Claude and connected apps
        </h2>
      </div>

      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <p className="text-[14px] text-foreground">
            Ask Claude about your sales, P&amp;L, labor, and inventory. In Claude, add a custom connector with
            this URL, then sign in to EasyShiftHQ.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-[13px] px-3 py-2 rounded-lg bg-background border border-border/40 text-foreground">
              {CLAUDE_CONNECTOR_URL}
            </code>
            <Button
              type="button"
              variant="ghost"
              onClick={copyUrl}
              aria-label="Copy the Claude connector URL"
              className="h-9 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
          {copyFailed && (
            <p role="alert" className="text-[13px] text-destructive">
              We could not copy the URL. Select it and copy it by hand.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Connected apps</h3>

          {grants.isLoading && (
            <div data-testid="connected-apps-loading" className="space-y-2">
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          )}

          {grants.isError && (
            <p role="alert" className="text-[13px] text-destructive">
              We could not load your connected apps. Reload the page to try again.
            </p>
          )}

          {grants.data && grants.data.length === 0 && (
            <p className="text-[13px] text-muted-foreground">No app has access to your account.</p>
          )}

          {grants.data && grants.data.length > 0 && (
            <ul className="space-y-2">
              {grants.data.map((grant) => {
                const name = grant.client.name || 'An application';
                const confirming = confirmClientId === grant.client.id;
                return (
                  <li
                    key={grant.client.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/40 bg-background"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                        <Link2 className="h-4 w-4 text-foreground" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-foreground truncate">{name}</p>
                        <p className="text-[13px] text-muted-foreground">Allowed {formatGrantDate(grant.granted_at)}</p>
                      </div>
                    </div>
                    {confirming ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setConfirmClientId(null)}
                          disabled={revoke.isPending}
                          className="h-9 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => revoke.mutate(grant.client.id, { onSettled: () => setConfirmClientId(null) })}
                          disabled={revoke.isPending}
                          aria-label={`Confirm: revoke access for ${name}`}
                          className="h-9 px-3 rounded-lg text-[13px] font-medium text-destructive hover:text-destructive/80"
                        >
                          {revokingId === grant.client.id ? 'Revoking…' : 'Confirm revoke'}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setConfirmClientId(grant.client.id)}
                        disabled={revoke.isPending}
                        aria-label={`Revoke access for ${name}`}
                        className="h-9 px-3 rounded-lg text-[13px] font-medium text-destructive hover:text-destructive/80"
                      >
                        Revoke
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {revoke.isError && (
            <p role="alert" className="text-[13px] text-destructive">
              We could not revoke the access. Try again.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

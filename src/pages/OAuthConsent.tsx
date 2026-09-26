import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { AlertTriangle, BarChart3, Link2, PencilLine, ShieldCheck, UserRound } from 'lucide-react';

import { useAuth } from '@/hooks/useAuth';
import { useOAuthConsent } from '@/hooks/useOAuthConsent';

import type { ConsentAction } from '@/lib/oauthConsentApi';

import {
  ConsentApiError,
  goToClientRedirect,
  isTrustedRedirectHost,
  redirectHost,
} from '@/lib/oauthConsentApi';
import {
  clearConsentReturnPath,
  consentPathFor,
  sanitizeConsentPath,
  saveConsentReturnPath,
} from '@/lib/oauthReturnPath';

const START_AGAIN = 'Start the connection again in Claude.';

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <main className="w-full max-w-md rounded-xl border border-border/40 bg-background shadow-sm">
        {children}
      </main>
    </div>
  );
}

function LoadingCard() {
  return (
    <PageShell>
      <div data-testid="oauth-consent-loading" aria-busy="true" aria-label="Loading" className="px-6 py-6 space-y-4">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
    </PageShell>
  );
}

function ErrorCard({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  return (
    <PageShell>
      <div className="px-6 py-6 space-y-4">
        <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center">
          <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
        </div>
        <div role="alert" className="space-y-1">
          <h1 className="text-[17px] font-semibold text-foreground">{title}</h1>
          <p className="text-[14px] text-muted-foreground">{message}</p>
        </div>
        {action}
      </div>
    </PageShell>
  );
}

function lookupErrorMessage(error: unknown): { title: string; message: string; signInAgain: boolean } {
  if (error instanceof ConsentApiError && error.status === 401) {
    return { title: 'Your session ended', message: 'Sign in again to continue.', signInAgain: true };
  }
  if (error instanceof ConsentApiError && (error.status === 400 || error.status === 404 || error.status === 410)) {
    return {
      title: 'This request expired',
      message: `The connection request expired or it was used. ${START_AGAIN}`,
      signInAgain: false,
    };
  }
  return {
    title: 'We could not load this request',
    message: `Check your connection and reload the page. If the problem continues, start the connection again in Claude.`,
    signInAgain: false,
  };
}

export default function OAuthConsent() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [pendingAction, setPendingAction] = useState<ConsentAction | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const consentPath = sanitizeConsentPath(
    `/oauth/consent?${searchParams.toString()}`,
    window.location.origin,
  );
  const authorizationId = consentPath ? new URL(consentPath, window.location.origin).searchParams.get('authorization_id') : null;

  const { authorization, connectorRestaurantCount, decision } = useOAuthConsent(
    authorizationId,
    user?.id ?? null,
  );

  // Signed out: keep the request and sign in first.
  useEffect(() => {
    if (authLoading || user || !authorizationId) return;
    saveConsentReturnPath(consentPathFor(authorizationId));
    navigate('/auth', { replace: true });
  }, [authLoading, user, authorizationId, navigate]);

  // Signed in: the saved return path has done its job.
  useEffect(() => {
    if (user) clearConsentReturnPath();
  }, [user]);

  // Consent exists already: go back to the client at once.
  const existingRedirect = authorization.data?.kind === 'redirect' ? authorization.data.redirectUrl : null;
  useEffect(() => {
    if (existingRedirect && goToClientRedirect(existingRedirect)) setRedirecting(true);
  }, [existingRedirect]);

  const details = authorization.data?.kind === 'consent' ? authorization.data.details : null;
  useEffect(() => {
    if (details) headingRef.current?.focus();
  }, [details]);

  const decide = (action: ConsentAction) => {
    setPendingAction(action);
    decision.mutate(action, {
      onSuccess: (redirectUrl) => {
        if (goToClientRedirect(redirectUrl)) setRedirecting(true);
      },
      onSettled: () => setPendingAction(null),
    });
  };

  const useDifferentAccount = async () => {
    if (!authorizationId) return;
    await signOut();
    saveConsentReturnPath(consentPathFor(authorizationId));
    navigate('/auth', { replace: true });
  };

  if (!authorizationId) {
    return (
      <ErrorCard
        title="This link is not valid"
        message={`The link has no connection request. ${START_AGAIN}`}
      />
    );
  }

  if (authLoading || !user || authorization.isLoading || existingRedirect) {
    return <LoadingCard />;
  }

  if (authorization.isError || !details) {
    const { title, message, signInAgain } = lookupErrorMessage(authorization.error);
    return (
      <ErrorCard
        title={title}
        message={message}
        action={
          signInAgain ? (
            <Button
              onClick={useDifferentAccount}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              Sign in again
            </Button>
          ) : undefined
        }
      />
    );
  }

  const clientName = details.client.name || 'An application';
  const host = redirectHost(details.redirect_uri);
  const trustedHost = isTrustedRedirectHost(details.redirect_uri);
  const busy = decision.isPending || redirecting;

  return (
    <PageShell>
      <div className="px-6 pt-6 pb-4 border-b border-border/40">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center shrink-0">
            <Link2 className="h-5 w-5 text-foreground" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-[17px] font-semibold text-foreground outline-none"
            >
              Connect {clientName} to EasyShiftHQ
            </h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Sends you back to <span className="font-medium text-foreground">{host ?? 'an unknown site'}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4" aria-live="polite">
        {!trustedHost && (
          <div
            data-testid="oauth-untrusted-host"
            className="flex gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-[13px] text-foreground"
          >
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
            <p>
              This request sends you to <span className="font-medium">{host ?? 'an unknown site'}</span>, which is
              not a Claude site. Deny it unless you know this application.
            </p>
          </div>
        )}

        {connectorRestaurantCount === 0 && (
          <div
            data-testid="oauth-no-restaurants"
            className="flex gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[13px] text-foreground"
          >
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <p>
              Your account has no restaurant where you are an owner, manager, chef, or collaborator.{' '}
              {clientName} will not see any restaurant data.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
            <h2 className="text-[13px] font-semibold text-foreground">If you allow, {clientName} can</h2>
          </div>
          <ul className="p-4 space-y-3 text-[14px] text-foreground">
            <li className="flex gap-3">
              <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
              <span>Read sales, P&amp;L, labor, inventory, recipe, and banking data that your role can see.</span>
            </li>
            <li className="flex gap-3">
              <PencilLine className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
              <span>Change the categories of bank transactions and POS sales when you ask it to.</span>
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
              <span>Act as you, with your access. Sign out of all devices to stop the access.</span>
            </li>
          </ul>
        </div>

        <div className="flex items-center justify-between gap-3 text-[13px]">
          <div className="flex items-center gap-2 min-w-0 text-muted-foreground">
            <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate text-foreground">{details.user.email || user.email}</span>
          </div>
          <button
            type="button"
            onClick={useDifferentAccount}
            disabled={busy}
            className="shrink-0 font-medium text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors disabled:opacity-50"
          >
            Use a different account
          </button>
        </div>

        <p className="text-[13px] text-muted-foreground">Allow only if you started this connection from Claude.</p>

        {decision.isError && (
          <p role="alert" className="text-[13px] text-destructive">
            We could not save your decision. Try again.
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            onClick={() => decide('deny')}
            disabled={busy}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            {pendingAction === 'deny' ? 'Denying…' : 'Deny'}
          </Button>
          <Button
            type="button"
            onClick={() => decide('approve')}
            disabled={busy}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {pendingAction === 'approve' ? 'Allowing…' : 'Allow'}
          </Button>
        </div>
      </div>
    </PageShell>
  );
}

import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CreditCard, Clock, CheckCircle2, Loader2, type LucideIcon } from 'lucide-react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import type { PaymentSetup } from '@/hooks/usePaymentSetup';
import type { PaymentSetupState } from '@/lib/paymentSetupState';
import { cn } from '@/lib/utils';

interface PaymentSetupCardProps {
  setup: PaymentSetup;
  canManage: boolean;
  hideWhenReady?: boolean;
}

const primaryButton =
  'h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium';
const secondaryButton =
  'h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground';

const COPY: Record<PaymentSetupState, { title: string; text: string; Icon: LucideIcon }> = {
  not_started: {
    title: 'Turn on payments',
    text: 'Customers pay invoices by card or bank (ACH). Setup takes about 5 minutes.',
    Icon: CreditCard,
  },
  pending: {
    title: 'Finish payment setup',
    text: 'Stripe needs more details, or Stripe is checking them.',
    Icon: Clock,
  },
  ready: {
    title: 'Payments are on',
    text: 'Customers can pay your invoices online.',
    Icon: CheckCircle2,
  },
};

export function PaymentSetupCard({ setup, canManage, hideWhenReady }: PaymentSetupCardProps) {
  const { selectedRestaurant } = useRestaurantContext();
  const titleId = useId();
  const { state, isLoading, error, refetch, openSetup, checkStatus, isStarting, isChecking } = setup;

  if (!selectedRestaurant?.restaurant_id) return null;
  if (isLoading) return <Skeleton className="h-[116px] w-full rounded-xl" />;
  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border/40 bg-background">
        <p className="text-[13px] text-muted-foreground" role="status">
          Payment status is not available.
        </p>
        <Button variant="ghost" className={secondaryButton} onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (state === 'ready' && hideWhenReady) return null;

  const copy = COPY[state];

  const startButton = (label: string) => (
    <Button
      className={primaryButton}
      onClick={() => void openSetup()}
      disabled={isStarting}
      aria-busy={isStarting}
    >
      {isStarting && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
      {label}
    </Button>
  );

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'flex flex-col gap-4 p-4 rounded-xl border border-border/40 sm:flex-row sm:items-center sm:justify-between',
        state === 'pending' ? 'bg-muted/30' : 'bg-background',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-xl bg-muted/50 flex items-center justify-center">
          <copy.Icon className="h-5 w-5 text-foreground" aria-hidden="true" />
        </div>
        <div aria-live="polite">
          <h3 id={titleId} className="text-[17px] font-semibold text-foreground">
            {copy.title}
          </h3>
          <p className="text-[13px] text-muted-foreground mt-0.5">{copy.text}</p>
          {!canManage && state === 'not_started' && (
            <p className="text-[13px] text-muted-foreground mt-1">
              Ask the restaurant owner to turn on payments.
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {canManage && state === 'not_started' && startButton('Turn on payments')}
        {canManage && state === 'pending' && (
          <>
            {startButton('Continue setup')}
            <Button
              variant="ghost"
              className={secondaryButton}
              onClick={() => void checkStatus()}
              disabled={isChecking}
            >
              Check now
            </Button>
          </>
        )}
        {canManage && state === 'ready' && (
          <Link
            to="/stripe-account"
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Manage
          </Link>
        )}
      </div>
    </section>
  );
}

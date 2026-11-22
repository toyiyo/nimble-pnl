import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';

import { Loader2 } from 'lucide-react';

import {
  DISCONNECT_REASON_LABELS,
  type DisconnectReason,
} from '@/lib/integrationDisconnect';
import { cn } from '@/lib/utils';

export interface DisconnectIntegrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integrationName: string;
  restaurantName: string;
  kind: 'pos' | 'bank';
  onConfirm: (r: {
    reason: DisconnectReason | null;
    reasonText: string | null;
  }) => Promise<void>;
  onReconnect?: () => void;
  extraConfirmContent?: ReactNode;
  confirmDisabled?: boolean;
  confirmLabel?: string;
}

const REASONS: DisconnectReason[] = [
  'switching_pos',
  'credentials_changed',
  'temporary_close',
  'no_value',
  'too_expensive',
  'other',
];

const STEP_LABELS = ['Impact', 'Reason', 'Confirm'] as const;
const MAX_TEXT = 500;

const POS_IMPACT = [
  'P&L and daily sales',
  'Food cost % and labor %',
  'Tip pooling and break-even',
];
const BANK_IMPACT = [
  'Bank balances',
  'Cash flow',
  'Expense categorization',
];

const labelClass =
  'text-[12px] font-medium text-muted-foreground uppercase tracking-wider';

export function DisconnectIntegrationDialog({
  open,
  onOpenChange,
  integrationName,
  restaurantName,
  kind,
  onConfirm,
  onReconnect,
  extraConfirmContent,
  confirmDisabled = false,
  confirmLabel = 'Disconnect anyway',
}: DisconnectIntegrationDialogProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reason, setReason] = useState<DisconnectReason | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const reset = useCallback(() => {
    setStep(1);
    setReason(null);
    setReasonText('');
    setError(null);
    setPending(false);
    inFlight.current = false;
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const close = useCallback(() => {
    if (inFlight.current) return;
    onOpenChange(false);
  }, [onOpenChange]);

  const handleOpenChange = (next: boolean) => {
    if (!next && inFlight.current) return;
    onOpenChange(next);
  };

  const bookingUrl = (import.meta.env.VITE_CS_BOOKING_URL as string | undefined) || '';

  const handleConfirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm({
        reason,
        reasonText: reason === 'other' && reasonText.trim() ? reasonText.trim() : null,
      });
      inFlight.current = false;
      onOpenChange(false);
    } catch (e) {
      inFlight.current = false;
      setPending(false);
      setError(e instanceof Error ? e.message : 'Disconnect failed. Try again.');
      return;
    }
    setPending(false);
  };

  const impact = kind === 'pos' ? POS_IMPACT : BANK_IMPACT;

  const nextStepPanel = () => {
    switch (reason) {
      case 'switching_pos':
        return (
          <NextStep text="Keep your history when you switch.">
            <Button variant="outline" size="sm" onClick={close}>
              Keep my connection
            </Button>
          </NextStep>
        );
      case 'credentials_changed':
        return (
          <NextStep text="Reconnect instead.">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                close();
                onReconnect?.();
              }}
            >
              Update credentials
            </Button>
          </NextStep>
        );
      case 'temporary_close':
        return <NextStep text="Pause the sync instead. Pause is coming soon." />;
      case 'no_value':
        return (
          <NextStep text="Talk to us for 15 minutes.">
            {bookingUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(bookingUrl, '_blank', 'noopener,noreferrer')}
              >
                Book a call
              </Button>
            )}
          </NextStep>
        );
      case 'too_expensive':
        return (
          <NextStep text="See a smaller plan.">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                close();
                navigate('/settings?tab=subscription');
              }}
            >
              Compare plans
            </Button>
          </NextStep>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[80vh] flex flex-col p-0 gap-0 border-border/40"
        onEscapeKeyDown={(e) => {
          if (inFlight.current) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (inFlight.current) e.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-border/40">
          <DialogTitle
            ref={headingRef}
            tabIndex={-1}
            className="text-[17px] font-semibold text-foreground outline-none"
          >
            {step === 1 && `Disconnect ${integrationName}?`}
            {step === 2 && 'Why are you disconnecting?'}
            {step === 3 && 'Confirm disconnect'}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
            {restaurantName}
          </DialogDescription>
          <ol className="flex items-center gap-4 pt-3" aria-label="Progress">
            {STEP_LABELS.map((label, i) => {
              const n = i + 1;
              const isCurrent = n === step;
              return (
                <li
                  key={label}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cn(
                    'text-[12px] font-medium uppercase tracking-wider border-b-2 pb-1',
                    isCurrent
                      ? 'text-foreground border-foreground'
                      : 'text-muted-foreground border-transparent',
                  )}
                >
                  {n}. {label}
                </li>
              );
            })}
          </ol>
          <p className="sr-only">Step {step} of 3</p>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-[14px] font-medium text-foreground">
                {kind === 'pos'
                  ? 'Sales stop syncing today. These reports stop updating:'
                  : 'Transactions stop syncing today. These items stop updating:'}
              </p>
              <ul className="list-disc pl-5 space-y-1 text-[13px] text-muted-foreground">
                {impact.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <RadioGroup
                value={reason ?? ''}
                onValueChange={(v) => setReason(v as DisconnectReason)}
                className="gap-2"
                aria-label="Reason for disconnecting"
              >
                {REASONS.map((r) => (
                  <div key={r}>
                    <Label
                      htmlFor={`disconnect-reason-${r}`}
                      className="flex min-h-11 items-center gap-3 rounded-lg border border-border/40 px-3 text-[14px] font-medium text-foreground cursor-pointer hover:border-border transition-colors"
                    >
                      <RadioGroupItem id={`disconnect-reason-${r}`} value={r} />
                      {DISCONNECT_REASON_LABELS[r]}
                    </Label>
                    {reason === r && r !== 'other' && nextStepPanel()}
                    {reason === r && r === 'other' && (
                      <div className="mt-2 space-y-1">
                        <Label htmlFor="disconnect-reason-text" className={labelClass}>
                          Tell us more
                        </Label>
                        <Textarea
                          id="disconnect-reason-text"
                          value={reasonText}
                          maxLength={MAX_TEXT}
                          onChange={(e) => setReasonText(e.target.value)}
                          className="text-[14px] bg-muted/30 border-border/40 rounded-lg"
                        />
                        <p className="text-[11px] text-muted-foreground text-right">
                          {reasonText.length}/{MAX_TEXT}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <dl className="rounded-xl border border-border/40 bg-muted/30 p-4 space-y-3">
                <SummaryRow label="Integration" value={integrationName} />
                <SummaryRow label="Restaurant" value={restaurantName} />
                <SummaryRow
                  label="Reason"
                  value={reason ? DISCONNECT_REASON_LABELS[reason] : 'Not given'}
                />
              </dl>
              {extraConfirmContent}
              {error && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end px-6 py-4 border-t border-border/40">
          {step === 1 && (
            <>
              <GhostButton onClick={close}>Cancel</GhostButton>
              <Button className="h-9 px-4 rounded-lg text-[13px]" onClick={() => setStep(2)}>
                Continue
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <GhostButton onClick={() => setStep(1)}>Back</GhostButton>
              <GhostButton
                onClick={() => {
                  setReason(null);
                  setReasonText('');
                  setStep(3);
                }}
              >
                Skip
              </GhostButton>
              <Button className="h-9 px-4 rounded-lg text-[13px]" onClick={() => setStep(3)}>
                Continue
              </Button>
            </>
          )}
          {step === 3 && (
            <>
              <GhostButton onClick={() => setStep(2)} disabled={pending}>
                Back
              </GhostButton>
              <Button
                variant="destructive"
                className="h-9 px-4 rounded-lg text-[13px]"
                onClick={handleConfirm}
                disabled={pending || confirmDisabled}
              >
                {pending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Disconnecting…
                  </>
                ) : (
                  confirmLabel
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GhostButton(props: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
      {...props}
    />
  );
}

function NextStep({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border/40 bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[13px] text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={labelClass}>{label}</dt>
      <dd className="text-[14px] font-medium text-foreground">{value}</dd>
    </div>
  );
}

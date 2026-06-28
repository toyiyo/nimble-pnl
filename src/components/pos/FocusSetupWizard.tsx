/**
 * FocusSetupWizard.tsx
 *
 * Apple/Notion-style Dialog for connecting a restaurant to Focus POS.
 * Design doc §10 + F1–F8.
 *
 * Steps:
 *   1. instructions  — how to get the report URL (informational Alert, no alarm)
 *   2. url-entry     — paste URL; client-side parseFocusReportUrl preview
 *   2b. url-confirmed — show detected storeId / brand; "Save & Connect"
 *   3. done          — "Sync now" / close
 *
 * F1: wizard owns DialogContent + DialogHeader + DialogTitle + DialogDescription.
 * F2: URL input has aria-invalid + aria-describedby → inline error id.
 * F3: testConnection failure → stays on url-confirmed, keeps URL, shows inline error + Retry.
 * F4: two-phase step 2 (url-entry → url-confirmed) with client preview.
 * F7: max-h-[80vh] + sticky footer.
 * F8: DialogDescription (not bare <p>), step indicator aria-current="step".
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useFocusConnection } from '@/hooks/useFocusConnection';
import { parseFocusReportUrl } from '@/lib/focusUrlParser';
import { CheckCircle2, AlertCircle, ExternalLink, Link, Loader2, Info } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep =
  | 'instructions'  // step 1: how to get the URL
  | 'url-entry'     // step 2a: paste URL
  | 'url-confirmed' // step 2b: show detected params, "Save & Connect"
  | 'done';         // step 3: complete

interface FocusSetupWizardProps {
  restaurantId: string;
  onComplete: () => void;
  /** Called by IntegrationCard to close the outer <Dialog> */
  onOpenChange?: (open: boolean) => void;
}

// ─── Step indicator ────────────────────────────────────────────────────────────

const STEPS: { id: string; label: string }[] = [
  { id: 'instructions', label: 'Instructions' },
  { id: 'url',          label: 'Paste URL' },
  { id: 'done',         label: 'Done' },
];

function stepIndex(step: WizardStep): number {
  if (step === 'instructions') return 0;
  if (step === 'url-entry' || step === 'url-confirmed') return 1;
  return 2;
}

interface StepIndicatorProps {
  current: WizardStep;
}

function StepIndicator({ current }: StepIndicatorProps) {
  const idx = stepIndex(current);
  return (
    <div className="flex items-center gap-0" role="list" aria-label="Setup progress">
      {STEPS.map((s, i) => {
        const isActive = i === idx;
        const isComplete = i < idx;
        return (
          <div key={s.id} className="flex items-center" role="listitem">
            <div
              aria-current={isActive ? 'step' : undefined}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[12px] font-medium transition-colors ${
                isActive
                  ? 'bg-foreground text-background'
                  : isComplete
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground/50'
              }`}
            >
              {isComplete ? (
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              ) : (
                <span
                  className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center text-[10px] leading-none ${
                    isActive ? 'border-background' : 'border-current'
                  }`}
                >
                  {i + 1}
                </span>
              )}
              {s.label}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`w-6 h-px mx-0.5 ${i < idx ? 'bg-foreground/40' : 'bg-border/40'}`}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function FocusSetupWizard({ restaurantId, onComplete, onOpenChange }: FocusSetupWizardProps) {
  const [step, setStep] = useState<WizardStep>('instructions');
  const [reportUrl, setReportUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [parsedParams, setParsedParams] = useState<ReturnType<typeof parseFocusReportUrl> | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const { toast } = useToast();
  const { saveConnection, testConnection } = useFocusConnection(restaurantId);

  // ── Step 1 → 2 ─────────────────────────────────────────────────────────────

  function handleGetStarted() {
    setStep('url-entry');
  }

  // ── Step 2a: Verify URL (client-side parse) ─────────────────────────────────

  function handleVerifyUrl() {
    setUrlError(null);
    const parsed = parseFocusReportUrl(reportUrl);
    if (!parsed) {
      setUrlError(
        'Could not parse this URL. Paste the full address bar URL from the Focus Revenue Center report page (must be an https://...myfocuspos.com URL containing a StoreID).'
      );
      return;
    }
    setParsedParams(parsed);
    setStep('url-confirmed');
  }

  // ── Step 2b: Save & Connect ─────────────────────────────────────────────────

  async function handleSaveAndConnect() {
    setConnectError(null);
    setIsConnecting(true);
    try {
      await saveConnection(restaurantId, reportUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save connection';
      setConnectError(msg);
      setIsConnecting(false);
      return;
    }

    try {
      await testConnection(restaurantId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      // Partial failure (F3): saved but test failed → stay on step 2b, show error + Retry
      setConnectError(msg);
      setIsConnecting(false);
      return;
    }

    setIsConnecting(false);
    setStep('done');
    toast({ title: 'Focus POS connected', description: 'Daily reports will sync every 6 hours.' });
  }

  // ── Retry after partial failure ─────────────────────────────────────────────

  async function handleRetry() {
    setConnectError(null);
    setIsConnecting(true);
    try {
      await testConnection(restaurantId);
      setIsConnecting(false);
      setStep('done');
      toast({ title: 'Focus POS connected', description: 'Daily reports will sync every 6 hours.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      setConnectError(msg);
      setIsConnecting(false);
    }
  }

  // ── Dialog description text per step ──────────────────────────────────────

  function dialogDescription(): string {
    if (step === 'instructions') return 'Follow these steps to find and copy your Focus Revenue Center report URL.';
    if (step === 'url-entry' || step === 'url-confirmed') return 'Paste your Focus report URL so we can detect your store settings.';
    return 'Your Focus POS connection is ready.';
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40 flex flex-col">
      {/* Header — F1: wizard owns its DialogHeader + DialogTitle + DialogDescription */}
      <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
            <Link className="h-5 w-5 text-foreground" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-4">
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Focus POS Setup
              </DialogTitle>
              <StepIndicator current={step} />
            </div>
            {/* F8: DialogDescription — never a bare <p> */}
            <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
              {dialogDescription()}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {/* ── Step 1: Instructions ─────────────────────────────── */}
        {step === 'instructions' && (
          <>
            {/* F8: informational Alert — non-alarming, no variant="destructive" */}
            <Alert className="border-border/40 bg-muted/30">
              <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <AlertDescription className="text-[13px]">
                <span className="font-medium text-foreground">No password required.</span>{' '}
                Focus report URLs contain no credentials. Note: anyone who knows your Store ID can
                read this report — we only fetch data for the store you authorize. If you're
                concerned, you can{' '}
                <a
                  href="https://www.shift4.com/contact"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  report this to Focus/Shift4
                  <ExternalLink className="inline h-3 w-3 ml-0.5" aria-hidden="true" />
                </a>
                .
              </AlertDescription>
            </Alert>

            <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                <h3 className="text-[13px] font-semibold text-foreground">
                  How to get your report URL
                </h3>
              </div>
              <div className="p-4">
                <ol className="space-y-3 text-[13px] text-muted-foreground list-decimal list-inside">
                  <li>
                    Log in to your Focus POS portal at{' '}
                    <a
                      href="https://my.focuspos.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline underline-offset-2 hover:text-foreground/80 inline-flex items-center gap-0.5"
                    >
                      my.focuspos.com
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </li>
                  <li>Navigate to <strong className="text-foreground">Reports</strong> → <strong className="text-foreground">Revenue Center</strong></li>
                  <li>Run the report for any date range</li>
                  <li>Copy the <strong className="text-foreground">full URL</strong> from your browser&apos;s address bar</li>
                  <li>Paste it on the next screen</li>
                </ol>
              </div>
            </div>
          </>
        )}

        {/* ── Step 2a: URL entry ───────────────────────────────── */}
        {step === 'url-entry' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              {/* F2: htmlFor wired to input id */}
              <Label
                htmlFor="focus-report-url"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Report URL
              </Label>
              <Input
                id="focus-report-url"
                type="url"
                value={reportUrl}
                onChange={(e) => {
                  setReportUrl(e.target.value);
                  if (urlError) setUrlError(null);
                }}
                placeholder="https://mfprod-1.myfocuspos.com/ReportServer?/generalstorereports/..."
                className={`h-10 text-[13px] bg-muted/30 border-border/40 rounded-lg font-mono text-xs focus-visible:ring-1 focus-visible:ring-border ${
                  urlError ? 'border-destructive focus-visible:ring-destructive' : ''
                }`}
                // F2: aria-invalid + aria-describedby
                aria-invalid={urlError ? 'true' : undefined}
                aria-describedby={urlError ? 'focus-url-error' : undefined}
              />
              {/* F2: inline error element with matching id */}
              {urlError && (
                <p
                  id="focus-url-error"
                  className="text-[12px] text-destructive flex items-start gap-1.5 mt-1"
                  role="alert"
                >
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  {urlError}
                </p>
              )}
            </div>
            <p className="text-[12px] text-muted-foreground">
              Paste the full address bar URL from the Focus Revenue Center report. We extract your
              Store ID and brand from it — no passwords are sent.
            </p>
          </div>
        )}

        {/* ── Step 2b: Confirmation ─────────────────────────────── */}
        {step === 'url-confirmed' && parsedParams && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                <h3 className="text-[13px] font-semibold text-foreground">Detected settings</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Confirm these look correct for your store.
                </p>
              </div>
              <div className="p-4 space-y-3">
                <Row label="Store ID" value={parsedParams.storeId} />
                {parsedParams.dbCatalog && <Row label="Brand" value={parsedParams.dbCatalog} />}
                {parsedParams.dbServer && <Row label="DB Server" value={parsedParams.dbServer} />}
                <Row label="Host" value={parsedParams.baseUrl} />
              </div>
            </div>

            {/* Partial failure error (F3) */}
            {connectError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription className="text-[13px]">
                  <span className="font-medium">Connection test failed:</span> {connectError}
                  <br />
                  <span className="text-[12px] text-destructive/80">
                    Your URL was saved. Click Retry to test again, or go back to change the URL.
                  </span>
                </AlertDescription>
              </Alert>
            )}

            {/* Show the URL input (read-only) so user can confirm/edit */}
            <div className="space-y-1.5">
              <Label
                htmlFor="focus-report-url"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Report URL
              </Label>
              <Input
                id="focus-report-url"
                type="url"
                value={reportUrl}
                onChange={(e) => {
                  setReportUrl(e.target.value);
                  setConnectError(null);
                }}
                className="h-10 text-[13px] bg-muted/30 border-border/40 rounded-lg font-mono text-xs focus-visible:ring-1 focus-visible:ring-border"
                aria-label="Report URL"
              />
            </div>
          </div>
        )}

        {/* ── Step 3: Done ─────────────────────────────────────── */}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-foreground" aria-hidden="true" />
            </div>
            <div>
              <p className="text-[17px] font-semibold text-foreground">Setup complete!</p>
              <p className="text-[13px] text-muted-foreground mt-1">
                Focus POS is connected. Daily reports sync automatically every 6 hours.
                You can also trigger a manual sync from the dashboard.
              </p>
            </div>
            <Alert className="text-left border-border/40 bg-muted/30">
              <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <AlertDescription className="text-[13px] text-muted-foreground">
                The first sync will backfill the last 90 days of daily reports (one day per call).
                Use <strong className="text-foreground">Sync Now</strong> to accelerate the backfill.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>

      {/* Sticky footer — F7 */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-border/40 bg-background flex items-center justify-between gap-3">
        {/* Left: Back button (steps 2a/2b only) */}
        <div>
          {(step === 'url-entry') && (
            <button
              type="button"
              onClick={() => { setUrlError(null); setStep('instructions'); }}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Back
            </button>
          )}
          {step === 'url-confirmed' && (
            <button
              type="button"
              onClick={() => { setConnectError(null); setStep('url-entry'); }}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Back
            </button>
          )}
        </div>

        {/* Right: primary action */}
        <div className="flex items-center gap-2">
          {step === 'instructions' && (
            <Button
              onClick={handleGetStarted}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              Get Started
            </Button>
          )}

          {step === 'url-entry' && (
            <Button
              onClick={handleVerifyUrl}
              disabled={!reportUrl.trim()}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium disabled:opacity-50"
            >
              Verify URL
            </Button>
          )}

          {step === 'url-confirmed' && (
            <>
              {connectError && (
                <Button
                  onClick={handleRetry}
                  disabled={isConnecting}
                  variant="outline"
                  className="h-9 px-4 rounded-lg text-[13px] font-medium border-border/40"
                >
                  {isConnecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : null}
                  Retry
                </Button>
              )}
              <Button
                onClick={handleSaveAndConnect}
                disabled={isConnecting}
                className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium disabled:opacity-50"
              >
                {isConnecting && <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />}
                Save &amp; Connect
              </Button>
            </>
          )}

          {step === 'done' && (
            <>
              <Button
                onClick={onComplete}
                variant="outline"
                className="h-9 px-4 rounded-lg text-[13px] font-medium border-border/40 text-muted-foreground hover:text-foreground"
              >
                Close
              </Button>
              <Button
                onClick={() => { onComplete(); }}
                className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
              >
                Sync Now
              </Button>
            </>
          )}
        </div>
      </div>
    </DialogContent>
  );
}

// ── Helper ─────────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider flex-shrink-0">
        {label}
      </span>
      <span className="text-[13px] text-foreground font-mono text-right break-all">{value}</span>
    </div>
  );
}

/**
 * FocusSetupWizard.tsx
 *
 * Apple/Notion-style Dialog for connecting a restaurant to Focus POS.
 * Design doc §10 + F1–F8.
 *
 * Steps:
 *   1. instructions — informational step; how to prepare credentials
 *   2. credentials  — enter username, password, store ID; click Continue to preview
 *   2b. confirmed   — show detected storeId and username; "Save & Connect"
 *   3. done         — "Sync now" / close
 *
 * F1: wizard owns DialogContent + DialogHeader + DialogTitle + DialogDescription.
 * F2: credential inputs have aria-invalid + aria-describedby → inline error ids.
 * F3: testConnection failure → stays on confirmed, shows inline error + Retry.
 * F4: two-phase step 2 (credentials → confirmed) with preview.
 * F7: max-h-[80vh] + sticky footer.
 * F8: DialogDescription (not bare <p>), step indicator aria-current="step".
 */

import { useState } from 'react';
import {
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
import { CheckCircle2, AlertCircle, Loader2, Info, Link } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep =
  | 'instructions'  // step 1: how to get credentials
  | 'credentials'   // step 2a: enter username/password/storeId
  | 'confirmed'     // step 2b: preview storeId + username, "Save & Connect"
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
  { id: 'credentials',  label: 'Credentials' },
  { id: 'done',         label: 'Done' },
];

function stepIndex(step: WizardStep): number {
  if (step === 'instructions') return 0;
  if (step === 'credentials' || step === 'confirmed') return 1;
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

export function FocusSetupWizard({ restaurantId, onComplete, onOpenChange: _onOpenChange }: FocusSetupWizardProps) {
  const [step, setStep] = useState<WizardStep>('instructions');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [storeId, setStoreId] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [storeIdError, setStoreIdError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const { toast } = useToast();
  const { saveConnection, testConnection } = useFocusConnection(restaurantId);

  // ── Step 1 → 2 ─────────────────────────────────────────────────────────────

  function handleGetStarted() {
    setStep('credentials');
  }

  // ── Step 2a: Validate credentials (client-side) ─────────────────────────────

  function handleContinue() {
    let hasError = false;

    if (!username.trim()) {
      setUsernameError('Username is required');
      hasError = true;
    } else {
      setUsernameError(null);
    }

    if (!password.trim()) {
      setPasswordError('Password is required');
      hasError = true;
    } else {
      setPasswordError(null);
    }

    if (!storeId.trim()) {
      setStoreIdError('Store ID is required');
      hasError = true;
    } else {
      setStoreIdError(null);
    }

    if (hasError) return;

    setStep('confirmed');
  }

  // ── Step 2b: Save & Connect ─────────────────────────────────────────────────

  async function handleSaveAndConnect() {
    setConnectError(null);
    setIsConnecting(true);
    try {
      await saveConnection(restaurantId, username, password, storeId);
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
      // Partial failure (F3): saved but test failed → stay on confirmed, show error + Retry
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
    if (step === 'instructions') return 'Follow these steps to connect your Focus POS account.';
    if (step === 'credentials') return 'Enter your Focus POS credentials to authenticate and connect.';
    if (step === 'confirmed') return 'Review your settings and save the connection.';
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
                <span className="font-medium text-foreground">Credentials are encrypted before storage.</span>{' '}
                Your Focus POS username and password are used to authenticate and discover your
                report settings. They are encrypted with AES-GCM before being stored.
              </AlertDescription>
            </Alert>

            <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                <h3 className="text-[13px] font-semibold text-foreground">
                  How to connect your Focus POS account
                </h3>
              </div>
              <div className="p-4">
                <ol className="space-y-3 text-[13px] text-muted-foreground list-decimal list-inside">
                  <li>
                    Have your Focus POS portal credentials ready (username and password from{' '}
                    <span className="text-foreground font-medium">my.focuspos.com</span>)
                  </li>
                  <li>
                    Know your <strong className="text-foreground">Store ID</strong> (from your Focus
                    contract or admin — usually a 4–6 digit number)
                  </li>
                  <li>Click <strong className="text-foreground">Get Started</strong> to enter your credentials and connect</li>
                </ol>
              </div>
            </div>
          </>
        )}

        {/* ── Step 2a: Credentials entry ──────────────────────── */}
        {step === 'credentials' && (
          <div className="space-y-4">
            {/* Username */}
            <div className="space-y-1.5">
              <Label
                htmlFor="focus-username"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Username
              </Label>
              <Input
                id="focus-username"
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (usernameError) setUsernameError(null);
                }}
                placeholder="your.username"
                className={`h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border ${
                  usernameError ? 'border-destructive focus-visible:ring-destructive' : ''
                }`}
                aria-invalid={usernameError ? 'true' : undefined}
                aria-describedby={usernameError ? 'focus-username-error' : undefined}
              />
              {usernameError && (
                <p
                  id="focus-username-error"
                  className="text-[12px] text-destructive flex items-start gap-1.5 mt-1"
                  role="alert"
                >
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  {usernameError}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label
                htmlFor="focus-password"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Password
              </Label>
              <Input
                id="focus-password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError(null);
                }}
                placeholder="••••••••"
                className={`h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border ${
                  passwordError ? 'border-destructive focus-visible:ring-destructive' : ''
                }`}
                aria-invalid={passwordError ? 'true' : undefined}
                aria-describedby={passwordError ? 'focus-password-error' : undefined}
              />
              {passwordError && (
                <p
                  id="focus-password-error"
                  className="text-[12px] text-destructive flex items-start gap-1.5 mt-1"
                  role="alert"
                >
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  {passwordError}
                </p>
              )}
            </div>

            {/* Store ID */}
            <div className="space-y-1.5">
              <Label
                htmlFor="focus-store-id"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Store ID
              </Label>
              <Input
                id="focus-store-id"
                type="text"
                value={storeId}
                onChange={(e) => {
                  setStoreId(e.target.value);
                  if (storeIdError) setStoreIdError(null);
                }}
                placeholder="99999"
                className={`h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border ${
                  storeIdError ? 'border-destructive focus-visible:ring-destructive' : ''
                }`}
                aria-invalid={storeIdError ? 'true' : undefined}
                aria-describedby={storeIdError ? 'focus-store-id-error' : undefined}
              />
              {storeIdError && (
                <p
                  id="focus-store-id-error"
                  className="text-[12px] text-destructive flex items-start gap-1.5 mt-1"
                  role="alert"
                >
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  {storeIdError}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2b: Confirmation ─────────────────────────────── */}
        {step === 'confirmed' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                <h3 className="text-[13px] font-semibold text-foreground">Connection settings</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Confirm these look correct before connecting.
                </p>
              </div>
              <div className="p-4 space-y-3">
                <Row label="Store ID" value={storeId} />
                <Row label="Username" value={username} />
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
                    Your credentials were saved. Click Retry to test again, or go back to change them.
                  </span>
                </AlertDescription>
              </Alert>
            )}
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
          {(step === 'credentials' || step === 'confirmed') && (
            <button
              type="button"
              onClick={() => {
                if (step === 'credentials') {
                  setUsernameError(null);
                  setPasswordError(null);
                  setStoreIdError(null);
                  setStep('instructions');
                } else {
                  setConnectError(null);
                  setStep('credentials');
                }
              }}
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

          {step === 'credentials' && (
            <Button
              onClick={handleContinue}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              Continue
            </Button>
          )}

          {step === 'confirmed' && (
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
                onClick={onComplete}
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

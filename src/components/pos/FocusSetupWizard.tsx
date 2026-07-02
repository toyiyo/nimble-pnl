/**
 * FocusSetupWizard.tsx
 *
 * Apple/Notion-style Dialog for connecting a restaurant to Focus POS (Shift4).
 * Collects: API Key, API Secret, Environment; then auto-fetches restaurant list.
 *
 * Steps:
 *   1. instructions — informational step; rewritten: no GUID / no GET /api/restaurants
 *   2. credentials  — enter API Key, API Secret, Environment; "Find my restaurant(s)"
 *   3. select       — pick restaurant from server-fetched list (or auto-select if 1)
 *   4. done         — background 90-day import copy
 *
 * F1: wizard owns DialogContent + DialogHeader + DialogTitle + DialogDescription.
 * F2: credential inputs have aria-invalid + aria-describedby → inline error ids.
 * F3: testConnection failure → stays on select, shows inline "Connection test failed" error.
 *     saveConnection failure → shows "Failed to save" (distinct from test failure).
 * F4: picker flow (credentials → select) replaces old two-phase (credentials → confirmed).
 * F7: max-h-[80vh] + sticky footer.
 * F8: DialogDescription (not bare <p>), step indicator aria-current="step" on listitem.
 */

import { useState, useRef, useEffect } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useFocusConnection, FocusRestaurantOption } from '@/hooks/useFocusConnection';
import { CheckCircle2, AlertCircle, Loader2, Info, Link } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep =
  | 'instructions'  // step 1: how to get credentials
  | 'credentials'   // step 2: enter API Key/Secret/Environment; "Find my restaurant(s)"
  | 'select'        // step 3: pick from fetched list (or auto-select if 1)
  | 'done';         // step 4: complete

/** Distinguish save failure from test failure in error state */
type ConnectErrorKind = 'save' | 'test';

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
  if (step === 'credentials' || step === 'select') return 1;
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
          // F8: aria-current="step" on role="listitem" (design §8.5 Frontend minor)
          <div
            key={s.id}
            className="flex items-center"
            role="listitem"
            aria-current={isActive ? 'step' : undefined}
          >
            <div
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

  // Credential fields (Lynk API) — no restaurantGuid state (fetched from server)
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'sandbox'>('production');

  // Validation errors for credential fields
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiSecretError, setApiSecretError] = useState<string | null>(null);

  // Picker state (step 3: select)
  const [restaurants, setRestaurants] = useState<FocusRestaurantOption[]>([]);
  const [selectedGuid, setSelectedGuid] = useState<string>('');

  // listRestaurants error shown inline on credentials step (null = no error)
  const [listError, setListError] = useState<string | null>(null);
  // True when listRestaurants succeeded but returned zero locations
  const [listEmpty, setListEmpty] = useState(false);
  const [isListing, setIsListing] = useState(false);

  // Connection error — distinguished by kind (save vs test)
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectErrorKind, setConnectErrorKind] = useState<ConnectErrorKind>('test');
  const [isConnecting, setIsConnecting] = useState(false);

  // Focus management on step change (design §8.5 — ref+useEffect keyed on step)
  const stepHeadingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (stepHeadingRef.current) {
      stepHeadingRef.current.focus();
    }
  }, [step]);

  const { toast } = useToast();
  const { saveConnection, testConnection, listRestaurants, triggerManualSync } = useFocusConnection(restaurantId);

  // ── Step 1 → 2 ─────────────────────────────────────────────────────────────

  function handleGetStarted() {
    setStep('credentials');
  }

  // ── Step 2: "Find my restaurant(s)" ────────────────────────────────────────

  async function handleFindRestaurants() {
    let hasError = false;

    const trimmedApiKey = apiKey.trim();
    const trimmedApiSecret = apiSecret.trim();

    if (!trimmedApiKey) {
      setApiKeyError('API Key is required');
      hasError = true;
    } else {
      setApiKeyError(null);
    }

    if (!trimmedApiSecret) {
      setApiSecretError('API Secret is required');
      hasError = true;
    } else {
      setApiSecretError(null);
    }

    if (hasError) return;

    setApiKey(trimmedApiKey);
    setApiSecret(trimmedApiSecret);
    setListError(null);
    setListEmpty(false);
    setIsListing(true);

    try {
      const results = await listRestaurants(restaurantId, trimmedApiKey, trimmedApiSecret, environment);

      if (results.length === 0) {
        setListEmpty(true);
        setIsListing(false);
        return;
      }

      setRestaurants(results);
      // Auto-select when exactly 1 restaurant
      setSelectedGuid(results.length === 1 ? results[0].restaurant_guid : '');
      setIsListing(false);
      setStep('select');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch restaurants';
      setListError(msg);
      setIsListing(false);
    }
  }

  // ── Step 3: Save & Connect ──────────────────────────────────────────────────

  async function handleSaveAndConnect() {
    setConnectError(null);
    setIsConnecting(true);

    const guidToUse = selectedGuid;

    try {
      await saveConnection(restaurantId, apiKey, apiSecret, guidToUse, environment);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save connection';
      setConnectError(msg);
      setConnectErrorKind('save');
      setIsConnecting(false);
      return;
    }

    try {
      await testConnection(restaurantId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      setConnectError(msg);
      setConnectErrorKind('test');
      setIsConnecting(false);
      return;
    }

    onConnectSuccess();
  }

  // ── Retry after test failure ────────────────────────────────────────────────

  async function handleRetry() {
    setConnectError(null);
    setIsConnecting(true);
    try {
      await testConnection(restaurantId);
      onConnectSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      setConnectError(msg);
      setConnectErrorKind('test');
      setIsConnecting(false);
    }
  }

  function onConnectSuccess() {
    setIsConnecting(false);
    setStep('done');
    toast({ title: 'Focus POS connected', description: 'Transactions will sync automatically.' });
  }

  async function handleSyncNow() {
    try {
      await triggerManualSync(restaurantId);
      toast({
        title: 'Import started',
        description: 'Running in the background. You can leave this page; it keeps going.',
      });
      onComplete();
    } catch {
      toast({
        title: 'Sync could not be started',
        description: 'Automatic sync will retry on schedule.',
        variant: 'destructive',
      });
    }
  }

  // ── Dialog description text per step ──────────────────────────────────────

  function dialogDescription(): string {
    if (step === 'instructions') return 'Follow these steps to connect your Focus POS account.';
    if (step === 'credentials') return 'Enter your Focus POS API credentials to look up your restaurant.';
    if (step === 'select') return 'Select your restaurant and save the connection.';
    return 'Your Focus POS connection is ready.';
  }

  // Helper to get display name for a restaurant
  function displayName(r: FocusRestaurantOption): string {
    return r.restaurant_name?.trim() || '(name unavailable)';
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

      {/* Scrollable body — ref used for focus management on step change */}
      <div
        className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
        ref={stepHeadingRef}
        tabIndex={-1}
        aria-label={`Step: ${step}`}
      >

        {/* ── Step 1: Instructions ─────────────────────────────── */}
        {step === 'instructions' && (
          <>
            <Alert className="border-border/40 bg-muted/30">
              <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <AlertDescription className="text-[13px]">
                <span className="font-medium text-foreground">Credentials are encrypted before storage.</span>{' '}
                Your Focus POS API Key and Secret are used to authenticate with the Shift4 API.
                The secret is encrypted with AES-GCM before being stored.
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
                    Log in to the{' '}
                    <span className="text-foreground font-medium">Shift4/Focus POS portal</span> and
                    generate an{' '}
                    <strong className="text-foreground">API Key + Secret</strong>{' '}
                    for your account group.
                  </li>
                  <li>
                    Click{' '}
                    <strong className="text-foreground">Get Started</strong>{' '}
                    and enter your credentials. We'll{' '}
                    <strong className="text-foreground">Find my restaurant(s)</strong>{' '}
                    for you automatically — no GUID required.
                  </li>
                  <li>
                    Pick your location and click{' '}
                    <strong className="text-foreground">Save &amp; Connect</strong>.
                  </li>
                </ol>
              </div>
            </div>
          </>
        )}

        {/* ── Step 2: Credentials entry ──────────────────────────── */}
        {step === 'credentials' && (
          <div className="space-y-4">
            {/* API Key */}
            <div className="space-y-1.5">
              <Label
                htmlFor="focus-api-key"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                API Key
              </Label>
              <Input
                id="focus-api-key"
                type="text"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (apiKeyError) setApiKeyError(null);
                  if (listError) setListError(null);
                  if (listEmpty) setListEmpty(false);
                }}
                placeholder="Enter your Focus POS API Key"
                className={`h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border font-mono ${
                  apiKeyError ? 'border-destructive focus-visible:ring-destructive' : ''
                }`}
                aria-invalid={apiKeyError ? 'true' : undefined}
                aria-describedby={apiKeyError ? 'focus-api-key-error' : undefined}
              />
              {apiKeyError && (
                <p
                  id="focus-api-key-error"
                  className="text-[12px] text-destructive flex items-start gap-1.5 mt-1"
                  role="alert"
                >
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  {apiKeyError}
                </p>
              )}
            </div>

            {/* API Secret */}
            <div className="space-y-1.5">
              <Label
                htmlFor="focus-api-secret"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                API Secret
              </Label>
              <Input
                id="focus-api-secret"
                type="password"
                value={apiSecret}
                onChange={(e) => {
                  setApiSecret(e.target.value);
                  if (apiSecretError) setApiSecretError(null);
                  if (listError) setListError(null);
                  if (listEmpty) setListEmpty(false);
                }}
                placeholder="••••••••"
                className={`h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border ${
                  apiSecretError ? 'border-destructive focus-visible:ring-destructive' : ''
                }`}
                aria-invalid={apiSecretError ? 'true' : undefined}
                aria-describedby={apiSecretError ? 'focus-api-secret-error' : undefined}
              />
              {apiSecretError && (
                <p
                  id="focus-api-secret-error"
                  className="text-[12px] text-destructive flex items-start gap-1.5 mt-1"
                  role="alert"
                >
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  {apiSecretError}
                </p>
              )}
            </div>

            {/* Environment */}
            <div className="space-y-1.5">
              <Label
                htmlFor="focus-environment"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Environment
              </Label>
              <Select
                value={environment}
                onValueChange={(v) => setEnvironment(v as 'production' | 'sandbox')}
              >
                <SelectTrigger
                  id="focus-environment"
                  className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Production</SelectItem>
                  <SelectItem value="sandbox">Sandbox</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[12px] text-muted-foreground mt-1">
                Use <strong className="text-foreground">Production</strong> for live data.
                Sandbox is for development testing.
              </p>
            </div>

            {/* Inline list error — stays on credentials step */}
            {listError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription className="text-[13px]">
                  {listError}
                </AlertDescription>
              </Alert>
            )}
            {listEmpty && (
              <Alert className="border-border/40 bg-muted/30">
                <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <AlertDescription className="text-[13px] text-muted-foreground">
                  No restaurants were found for these credentials. Double-check the key/secret.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* ── Step 3: Select restaurant ─────────────────────────── */}
        {step === 'select' && (
          <div className="space-y-4">
            {/* Read-back: environment + masked API key */}
            <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                <h3 className="text-[13px] font-semibold text-foreground">Connection settings</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Confirm these look correct before connecting.
                </p>
              </div>
              <div className="p-4 space-y-3">
                <Row label="Environment" value={environment} />
                <Row label="API Key" value={`${apiKey.slice(0, 6)}••••••`} />
              </div>
            </div>

            {/* Restaurant picker — single vs multiple */}
            {restaurants.length === 1 ? (
              /* Auto-selected: show as confirmed read-back */
              <div className="space-y-1.5">
                <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Restaurant
                </p>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border/40 bg-muted/30">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                  <span className="text-[14px] text-foreground">{displayName(restaurants[0])}</span>
                </div>
              </div>
            ) : (
              /* Multiple restaurants: labelled Select */
              <div className="space-y-1.5">
                <Label
                  htmlFor="focus-restaurant"
                  className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Restaurant
                </Label>
                <Select
                  value={selectedGuid}
                  onValueChange={setSelectedGuid}
                >
                  <SelectTrigger
                    id="focus-restaurant"
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  >
                    <SelectValue placeholder="Select a restaurant…" />
                  </SelectTrigger>
                  <SelectContent>
                    {restaurants.map((r) => (
                      <SelectItem key={r.restaurant_guid} value={r.restaurant_guid}>
                        <span>{displayName(r)}</span>
                        {!r.restaurant_name?.trim() && (
                          <span className="ml-2 text-[11px] text-muted-foreground font-mono">
                            {r.restaurant_guid}
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Error alert — distinguish save failure from test failure (F3) */}
            {connectError && connectErrorKind === 'save' && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription className="text-[13px]">
                  <span className="font-medium">Failed to save:</span> {connectError}
                  <br />
                  <span className="text-[12px] text-destructive/80">
                    Please check your credentials and try again.
                  </span>
                </AlertDescription>
              </Alert>
            )}

            {connectError && connectErrorKind === 'test' && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription className="text-[13px]">
                  <span className="font-medium">Connection test failed:</span> {connectError}
                  <br />
                  <span className="text-[12px] text-destructive/80">
                    Your API credentials were saved. Click Retry to test again, or go back to change them.
                  </span>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* ── Step 4: Done ─────────────────────────────────────── */}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-foreground" aria-hidden="true" />
            </div>
            <div>
              <p className="text-[17px] font-semibold text-foreground">Setup complete!</p>
              <p className="text-[13px] text-muted-foreground mt-1">
                Focus POS is connected. Transactions sync automatically every 6 hours.
              </p>
            </div>
            <Alert className="text-left border-border/40 bg-muted/30">
              <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <AlertDescription className="text-[13px] text-muted-foreground">
                The first sync imports your last{' '}
                <strong className="text-foreground">90 days</strong>{' '}
                in the background. You can leave this page; it keeps going.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>

      {/* Sticky footer — F7 */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-border/40 bg-background flex items-center justify-between gap-3">
        {/* Left: Back button */}
        <div>
          {(step === 'credentials' || step === 'select') && (
            <button
              type="button"
              onClick={() => {
                if (step === 'credentials') {
                  setApiKeyError(null);
                  setApiSecretError(null);
                  setListError(null);
                  setListEmpty(false);
                  setStep('instructions');
                } else {
                  // select → credentials: clear connection errors, keep credentials
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
              onClick={handleFindRestaurants}
              disabled={isListing}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium disabled:opacity-50"
            >
              {isListing && <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />}
              Find my restaurant(s)
            </Button>
          )}

          {step === 'select' && (
            <>
              {connectError && connectErrorKind === 'test' && (
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
                disabled={isConnecting || (restaurants.length > 1 && !selectedGuid)}
                aria-label={isConnecting ? 'Saving connection…' : undefined}
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
                onClick={handleSyncNow}
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

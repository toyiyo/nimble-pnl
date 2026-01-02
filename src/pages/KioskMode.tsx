import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useKioskSession } from '@/hooks/useKioskSession';
import { verifyPinForRestaurant, useUpsertEmployeePin } from '@/hooks/useKioskPins';
import { useCreateTimePunch } from '@/hooks/useTimePunches';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { PunchStatus } from '@/types/timeTracking';
import { collectPunchContext } from '@/utils/punchContext';
import { addQueuedPunch, flushQueuedPunches, hasQueuedPunches, isLikelyOffline } from '@/utils/offlineQueue';
import type { QueuedKioskPunch } from '@/utils/offlineQueue';
import { format } from 'date-fns';
import { ImageCapture } from '@/components/ImageCapture';
import { PinChangeDialog } from '@/components/kiosk/PinChangeDialog';
import { Clock, Lock, LogIn, LogOut, Shield, WifiOff, KeyRound, X, Loader2, CheckCircle } from 'lucide-react';

const ATTEMPT_LIMIT = 5;
const LOCKOUT_MS = 60_000;

type PunchAction = 'clock_in' | 'clock_out';
type QueuedPunchPayload = QueuedKioskPunch['payload'] & { photoBlob?: Blob };

const KioskMode = () => {
  const navigate = useNavigate();
  const { selectedRestaurant } = useRestaurantContext();
  const { session: kioskSession, endSession } = useKioskSession();
  const { user, signIn, signOut } = useAuth();
  const createPunch = useCreateTimePunch();
  const upsertPin = useUpsertEmployeePin();

  const restaurantId = kioskSession?.location_id || selectedRestaurant?.restaurant_id || null;
  const locationName = selectedRestaurant?.restaurant?.name || kioskSession?.location_id || 'Location';
  const minLength = kioskSession?.min_length || 4;
  const isKioskServiceAccount = selectedRestaurant?.role === 'kiosk';
  const [currentTime, setCurrentTime] = useState(new Date());
  const [pinInput, setPinInput] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [exitPassword, setExitPassword] = useState('');
  const [exitError, setExitError] = useState<string | null>(null);
  const [exitProcessing, setExitProcessing] = useState(false);
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);
  const [signOutPassword, setSignOutPassword] = useState('');
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signOutProcessing, setSignOutProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<{
    name: string;
    punchType: PunchAction;
    timestamp: string;
    role?: string;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<PunchAction | null>(null);
  const [cameraDialogOpen, setCameraDialogOpen] = useState(false);
  const [capturedPhotoBlob, setCapturedPhotoBlob] = useState<Blob | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState<number>(hasQueuedPunches() ? 1 : 0);
  const [captureFn, setCaptureFn] = useState<(() => Promise<Blob | null>) | null>(null);
  
  // PIN change dialog state
  const [pinChangeDialogOpen, setPinChangeDialogOpen] = useState(false);
  const [pinChangeEmployee, setPinChangeEmployee] = useState<{ id: string; name: string; pinId: string } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Only run flushQueuedPunches on mount, but always use the latest mutateAsync
  const mutateRef = useRef<typeof createPunch.mutateAsync>(createPunch.mutateAsync);
  useEffect(() => {
    mutateRef.current = createPunch.mutateAsync;
  }, [createPunch.mutateAsync]);

  const sendQueuedPunch = useCallback(
    async (payload: QueuedPunchPayload) => {
      await mutateRef.current(payload);
    },
    []
  );

  useEffect(() => {
    flushQueuedPunches(sendQueuedPunch).then((result) => setQueuedCount(result.remaining));
    // Only run on mount
  }, [sendQueuedPunch]);

  const lockSeconds = useMemo(() => {
    if (!lockUntil) return 0;
    return Math.max(0, Math.ceil((lockUntil - currentTime.getTime()) / 1000));
  }, [lockUntil, currentTime]);

  const resetAttempts = () => {
    setFailedAttempts(0);
    setLockUntil(null);
  };

  const startPunchFlow = (action: PunchAction) => {
    setPendingAction(action);
    setCameraDialogOpen(true);
    setCapturedPhotoBlob(null);
    setCameraError(null);
  };

  const handleSkipPhoto = () => {
    if (pendingAction) {
      handlePunch(pendingAction, null);
    } else {
      resetCameraState();
    }
  };

  const handleDigit = (digit: string) => {
    if (processing || (lockUntil && lockUntil > Date.now())) return;
    
    // Haptic feedback on mobile devices
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }
    
    setPinInput((prev) => (prev + digit).slice(0, 6));
    setErrorMessage(null);
  };

  const handleBackspace = () => {
    // Haptic feedback on mobile devices
    if ('vibrate' in navigator) {
      navigator.vibrate(30);
    }
    
    setPinInput((prev) => prev.slice(0, -1));
    setErrorMessage(null);
  };

  const fetchPunchStatus = async (employeeId: string): Promise<PunchStatus | null> => {
    const { data, error } = await supabase.rpc('get_employee_punch_status', {
      p_employee_id: employeeId,
    });
    if (error) throw error;
    return data && data.length > 0 ? (data[0] as PunchStatus) : null;
  };

  const registerFailure = () => {
    const next = failedAttempts + 1;
    if (next >= ATTEMPT_LIMIT) {
      setLockUntil(Date.now() + LOCKOUT_MS);
      setFailedAttempts(0);
      setErrorMessage('Too many attempts. Try again in 60 seconds.');
    } else {
      setFailedAttempts(next);
      setErrorMessage('PIN not recognized for this location.');
    }
  };

  // Helper: Validate PIN and lock state
  const validatePinInput = (): string | null => {
    if (!restaurantId) {
      return 'Kiosk is not tied to a location. Ask a manager to relaunch from Time Punches.';
    }
    if (lockUntil && lockUntil > Date.now()) {
      return 'Locked due to failed attempts. Please wait a moment.';
    }
    if (pinInput.length < minLength) {
      return `PIN must be at least ${minLength} digits.`;
    }
    return null;
  };

  // Helper: Validate punch status
  const validatePunchStatus = (status: PunchStatus | null, action: PunchAction): string | null => {
    if (action === 'clock_in' && status?.is_clocked_in) {
      return 'You are already clocked in.';
    }
    if (action === 'clock_out' && !status?.is_clocked_in) {
      return 'No open shift to clock out.';
    }
    return null;
  };

  // Helper: Handle offline queue
  const handleOfflineQueue = async (
    action: PunchAction,
    pin: string,
    context: Awaited<ReturnType<typeof collectPunchContext>> | null,
    employeeId?: string
  ) => {
    const offline = isLikelyOffline();
    if (offline && pin) {
      await queuePunchOffline(action, pin, context, employeeId);
      return true;
    }
    return false;
  };

  const handlePunch = async (action: PunchAction, photoBlob?: Blob | null) => {
    const pinError = validatePinInput();
    if (pinError) {
      setErrorMessage(pinError);
      return;
    }

    setProcessing(true);
    setErrorMessage(null);
    setStatusMessage(null);

    let pinMatch: Awaited<ReturnType<typeof verifyPinForRestaurant>> = null;
    let context: Awaited<ReturnType<typeof collectPunchContext>> | null = null;

    try {
      pinMatch = await verifyPinForRestaurant(restaurantId, pinInput);
      if (!pinMatch) {
        registerFailure();
        return;
      }

      const status = await fetchPunchStatus(pinMatch.employee_id);
      const statusError = validatePunchStatus(status, action);
      if (statusError) {
        setErrorMessage(statusError);
        return;
      }

      context = await collectPunchContext(3000);

      await createPunch.mutateAsync({
        restaurant_id: restaurantId,
        employee_id: pinMatch.employee_id,
        punch_type: action,
        punch_time: new Date().toISOString(),
        notes: 'Kiosk PIN punch',
        location: context.location,
        device_info: context.device_info,
        photoBlob: photoBlob || undefined,
      });

      const nowIso = new Date().toISOString();

      // Check if this is a force_reset PIN - if so, show PIN change dialog BEFORE clearing force_reset
      if (pinMatch.force_reset) {
        setPinChangeEmployee({
          id: pinMatch.employee_id,
          name: pinMatch.employee?.name || 'Employee',
          pinId: pinMatch.id,
        });
        setPinChangeDialogOpen(true);
        // Do NOT update force_reset yet - will be done after employee sets new PIN
      } else {
        // Normal flow - just update last_used_at
        await supabase
          .from('employee_pins')
          .update({ last_used_at: nowIso })
          .eq('id', pinMatch.id);
      }

      resetAttempts();
      setPinInput('');
      setLastResult({
        name: pinMatch.employee?.name || 'Employee',
        punchType: action,
        timestamp: nowIso,
        role: pinMatch.employee?.position || undefined,
      });
      setStatusMessage(action === 'clock_in' ? 'Clocked in' : 'Clocked out');
      resetCameraState();
      if (queuedCount > 0) {
        flushQueuedPunches(sendQueuedPunch).then((result) => setQueuedCount(result.remaining));
      }
    } catch (error: unknown) {
      const handledOffline = await handleOfflineQueue(action, pinInput, context, pinMatch?.employee_id);
      if (!handledOffline) {
        const message = error instanceof Error ? error.message : 'Unable to record punch.';
        setErrorMessage(message);
        resetCameraState();
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleSaveNewPin = async (newPin: string) => {
    if (!restaurantId || !pinChangeEmployee) {
      throw new Error('Missing restaurant or employee information');
    }

    await upsertPin.mutateAsync({
      restaurant_id: restaurantId,
      employee_id: pinChangeEmployee.id,
      pin: newPin,
      min_length: minLength,
      force_reset: false,
    });

    // Close dialog
    setPinChangeDialogOpen(false);
    setPinChangeEmployee(null);

    // Show success message
    setStatusMessage('PIN updated successfully!');
  };

  const handleManagerExitPassword = async () => {
    if (!user?.email) {
      setExitError('Password exit requires an email account.');
      return;
    }
    setExitError(null);
    const { error } = await signIn(user.email, exitPassword);
    if (error) {
      setExitError('Incorrect password. Managers only can exit kiosk.');
      return;
    }
    endSession();
    navigate('/time-punches');
  };

  const handleKioskSignOut = async () => {
    if (!user?.email) {
      setSignOutError('Sign out requires an email account.');
      return;
    }
    setSignOutProcessing(true);
    setSignOutError(null);
    try {
      const { error } = await signIn(user.email, signOutPassword);
      if (error) {
        setSignOutError('Incorrect password.');
        return;
      }
      endSession();
      signOut();
    } catch {
      setSignOutError('An error occurred. Please try again.');
    } finally {
      setSignOutProcessing(false);
    }
  };

  const resetCameraState = () => {
    setCameraDialogOpen(false);
    setCapturedPhotoBlob(null);
    setPendingAction(null);
    setCameraError(null);
  };

  const queuePunchOffline = async (
    action: PunchAction,
    pin: string,
    context: Awaited<ReturnType<typeof collectPunchContext>> | null,
    employeeId?: string
  ) => {
    if (!restaurantId) return false;
    await addQueuedPunch(
      {
        restaurant_id: restaurantId,
        employee_id: employeeId,
        punch_type: action,
        punch_time: new Date().toISOString(),
        notes: 'Queued offline (kiosk)',
        location: context?.location,
        device_info: context?.device_info,
      },
      capturedPhotoBlob
    );
    setQueuedCount((c) => c + 1);
    setStatusMessage('Saved offline — will sync when online.');
    resetCameraState();
    return true;
  };

  if (!restaurantId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
        <Card className="max-w-md w-full bg-white/10 border-white/20 text-white">
          <CardHeader>
            <CardTitle>Launch kiosk from Time Punches</CardTitle>
            <CardDescription className="text-slate-200">
              Managers should enable kiosk mode from the Time Punches page to lock this device to a location.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button className="w-full" onClick={() => navigate('/time-punches')}>
              Go to Time Punches
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-white">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-300">EasyShiftHQ Timeclock</p>
            <h1 className="text-2xl font-semibold">Kiosk Mode</h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-white/10 text-white border-white/20">
              <Lock className="h-4 w-4 mr-1" />
              {locationName}
            </Badge>
            {isKioskServiceAccount ? (
              <Button variant="ghost" className="text-slate-200" onClick={() => setSignOutDialogOpen(true)}>
                Sign Out
              </Button>
            ) : (
              <Button variant="ghost" className="text-slate-200" onClick={() => setExitDialogOpen(true)}>
                Manager Exit
              </Button>
            )}
          </div>
        </div>

        <Card className="bg-white/5 border-white/10">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-white">Enter PIN</CardTitle>
              <CardDescription className="text-slate-200">
                PINs are tied to this location for clean, fast clock-ins.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-3xl font-mono text-white">{format(currentTime, 'h:mm:ss a')}</div>
                <div className="text-xs text-slate-200">{format(currentTime, 'EEEE, MMM d')}</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-300" />
                <span className="text-sm text-slate-200">
                  {isKioskServiceAccount ? 'Kiosk service account' : 'Device in kiosk mode'}
                </span>
              </div>
              {lockSeconds > 0 && (
                <Badge variant="outline" className="bg-red-500/20 border-red-500/30 text-white">
                  Locked {lockSeconds}s
                </Badge>
              )}
            </div>

            {statusMessage && lastResult && (
              <Alert className="bg-emerald-500/10 border-emerald-500/30 text-white">
                <AlertDescription className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{lastResult.name}</div>
                    <div className="text-sm">
                      {statusMessage} at {format(new Date(lastResult.timestamp), 'h:mm a')}
                      {lastResult.role ? ` • Role: ${lastResult.role}` : ''}
                    </div>
                  </div>
                  <Badge variant="outline" className="bg-emerald-500/20 border-emerald-500/40 text-white">
                    {lastResult.punchType === 'clock_in' ? 'Clocked In' : 'Clocked Out'}
                  </Badge>
                </AlertDescription>
              </Alert>
            )}

            {errorMessage && (
              <Alert className="bg-red-500/10 border-red-500/30 text-white">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <Input
                value={pinInput.replace(/./g, '•')}
                placeholder="PIN"
                readOnly
                className="text-2xl tracking-[0.3em] bg-white/10 border-white/20 text-center text-white"
              />
              <div className="flex items-center gap-3 text-slate-300 text-sm">
                <Clock className="h-4 w-4" />
                <span>Min {minLength} digits</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 xs:gap-3">
              {['1','2','3','4','5','6','7','8','9'].map((digit) => (
                <Button
                  key={digit}
                  size="lg"
                  variant="secondary"
                  className="h-12 xs:h-16 text-xl xs:text-2xl bg-white/10 border-white/10 text-white hover:bg-white/20 transition-colors"
                  onClick={() => handleDigit(digit)}
                  disabled={processing || (lockUntil && lockUntil > Date.now())}
                  aria-label={`Digit ${digit}`}
                >
                  {digit}
                </Button>
              ))}
              <Button
                size="lg"
                variant="secondary"
                className="h-12 xs:h-16 text-sm xs:text-base bg-white/10 border-white/10 text-white hover:bg-white/20 transition-colors"
                onClick={() => setPinInput('')}
                disabled={processing}
                aria-label="Clear PIN"
              >
                Clear
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-12 xs:h-16 text-xl xs:text-2xl bg-white/10 border-white/10 text-white hover:bg-white/20 transition-colors"
                onClick={() => handleDigit('0')}
                disabled={processing || (lockUntil && lockUntil > Date.now())}
                aria-label="Digit 0"
              >
                0
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-12 xs:h-16 bg-white/10 border-white/10 text-white hover:bg-white/20 transition-colors"
                onClick={handleBackspace}
                disabled={processing}
                aria-label="Backspace"
              >
                <X className="h-4 xs:h-5 w-4 xs:w-5" />
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 xs:gap-3">
              <Button
                className="h-12 xs:h-14 text-base xs:text-lg"
                onClick={() => startPunchFlow('clock_in')}
                disabled={processing || (lockUntil && lockUntil > Date.now())}
              >
                {processing ? <Loader2 className="h-4 xs:h-5 w-4 xs:w-5 mr-2 animate-spin" /> : <LogIn className="h-4 xs:h-5 w-4 xs:w-5 mr-2" />}
                Clock In
              </Button>
              <Button
                className="h-12 xs:h-14 text-base xs:text-lg"
                variant="destructive"
                onClick={() => startPunchFlow('clock_out')}
                disabled={processing || (lockUntil && lockUntil > Date.now())}
              >
                {processing ? <Loader2 className="h-4 xs:h-5 w-4 xs:w-5 mr-2 animate-spin" /> : <LogOut className="h-4 xs:h-5 w-4 xs:w-5 mr-2" />}
                Clock Out
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between text-slate-300 text-xs">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            <span>PIN attempts limited for security.</span>
          </div>
          <div className="flex items-center gap-2">
            <WifiOff className="h-4 w-4" />
            <span>
              Offline punches queue and sync when online
              {queuedCount > 0 ? ` • queued: ${queuedCount}` : ''}
            </span>
          </div>
        </div>
      </div>

      <Dialog open={exitDialogOpen} onOpenChange={setExitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manager Exit</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter your account password to exit kiosk mode. For dedicated kiosk devices, use the service account feature instead.
            </p>

            <div className="space-y-2">
              <Label htmlFor="manager_password">Password</Label>
              <Input
                id="manager_password"
                type="password"
                value={exitPassword}
                onChange={(e) => setExitPassword(e.target.value)}
              />
              {exitError && <p className="text-xs text-red-500">{exitError}</p>}
              <Button onClick={handleManagerExitPassword} disabled={exitProcessing}>
                {exitProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Exit with password
              </Button>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExitDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign Out Dialog for Kiosk Service Accounts */}
      <Dialog open={signOutDialogOpen} onOpenChange={setSignOutDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign Out</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter the kiosk service account password to sign out. This will end the kiosk session.
            </p>

            <div className="space-y-2">
              <Label htmlFor="signout_password">Password</Label>
              <Input
                id="signout_password"
                type="password"
                value={signOutPassword}
                onChange={(e) => setSignOutPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleKioskSignOut()}
              />
              {signOutError && <p className="text-xs text-red-500">{signOutError}</p>}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSignOutDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleKioskSignOut} disabled={signOutProcessing || !signOutPassword}>
              {signOutProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Sign Out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cameraDialogOpen}
        onOpenChange={(open) => {
          setCameraDialogOpen(open);
          if (!open) {
            setPendingAction(null);
            setCapturedPhotoBlob(null);
            setCameraError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Verify Your Identity</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Take a quick selfie to confirm it's really you clocking in. This helps prevent time theft and ensures accurate payroll.
            </p>
          </DialogHeader>
          <div className="space-y-4">
            <ImageCapture
              onImageCaptured={(blob) => setCapturedPhotoBlob(blob)}
              onError={(err) => setCameraError(err)}
              disabled={processing}
              autoStart
              allowUpload={false}
              hideControls
              preferredFacingMode="user"
              onCaptureRef={(fn) => setCaptureFn(() => fn)}
            />
            {cameraError && <p className="text-xs text-destructive">{cameraError}</p>}
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                <span><strong>Protects your earnings:</strong> Ensures only you can clock in with your account.</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                <span><strong>Accurate hours:</strong> Helps resolve any disputes about work time.</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                <span><strong>Fair for everyone:</strong> Prevents buddy punching and time theft.</span>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handleSkipPhoto} disabled={processing}>
              Skip photo
            </Button>
            <Button
              onClick={async () => {
                if (!pendingAction) return;
                resetCameraState();
                let blob = capturedPhotoBlob;
                if (!blob && captureFn) {
                  blob = await captureFn();
                }
                handlePunch(pendingAction, blob);
              }}
              disabled={processing || !pendingAction}
            >
              {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Confirm punch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PIN Change Dialog - shown when force_reset is true */}
      <PinChangeDialog
        open={pinChangeDialogOpen}
        employeeName={pinChangeEmployee?.name || 'Employee'}
        minLength={minLength}
        onSave={handleSaveNewPin}
        allowSimpleSequences={false}
      />
    </div>
  );
};

export default KioskMode;

import { useState, useEffect, type KeyboardEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { KeyRound, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isSimpleSequence } from '@/utils/kiosk';

interface PinChangeDialogProps {
  open: boolean;
  employeeName: string;
  minLength: number;
  onSave: (newPin: string) => Promise<void>;
  onClose?: () => void;
  allowSimpleSequences?: boolean;
}

const validatePin = (pin: string, minLength: number, allowSimpleSequences: boolean) => ({
  pinTooShort: pin.length > 0 && pin.length < minLength,
  pinLooksSimple: pin.length >= 3 && !allowSimpleSequences && isSimpleSequence(pin),
});

export const PinChangeDialog = ({
  open,
  employeeName,
  minLength,
  onSave,
  onClose,
  allowSimpleSequences = false,
}: PinChangeDialogProps) => {
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPins, setShowPins] = useState(false);

  const { pinTooShort, pinLooksSimple } = validatePin(newPin, minLength, allowSimpleSequences);
  const pinsMatch = newPin.length >= minLength && newPin === confirmPin;
  const canSave = newPin.length >= minLength && pinsMatch && !pinLooksSimple && !saving;

  useEffect(() => {
    if (open) {
      setNewPin('');
      setConfirmPin('');
      setError(null);
      setShowPins(false);
      setSaving(false);
    }
  }, [open]);

  const handleSave = async () => {
    if (!canSave) return;

    setError(null);
    setSaving(true);

    try {
      await onSave(newPin);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update PIN. Please try again.';
      setError(message);
      setSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && canSave) {
      handleSave();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose ? (open) => !open && onClose() : undefined}>
      <DialogContent 
        className="sm:max-w-md" 
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <KeyRound className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Set Your Personal PIN</DialogTitle>
              <DialogDescription>Welcome, {employeeName}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
          <AlertDescription className="text-amber-800 dark:text-amber-400">
            Your manager gave you a temporary PIN. Please create your own secure PIN now.
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div>
            <Label htmlFor="new-pin">New PIN ({minLength}-6 digits)</Label>
            <Input
              id="new-pin"
              type={showPins ? 'text' : 'password'}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={newPin}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '');
                setNewPin(value);
                setError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder={`Enter ${minLength}-6 digit PIN`}
              className={cn(
                'text-lg tracking-widest',
                pinTooShort && 'border-destructive',
                pinLooksSimple && 'border-amber-500'
              )}
              disabled={saving}
              autoFocus
            />
            {pinTooShort && (
              <p className="text-xs text-destructive mt-1">
                PIN must be at least {minLength} digits
              </p>
            )}
            {pinLooksSimple && (
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                Avoid simple sequences like 1234, 9876, or 1111
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="confirm-pin">Confirm PIN</Label>
            <Input
              id="confirm-pin"
              type={showPins ? 'text' : 'password'}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '');
                setConfirmPin(value);
                setError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Re-enter PIN"
              className={cn(
                'text-lg tracking-widest',
                confirmPin.length > 0 && !pinsMatch && 'border-destructive'
              )}
              disabled={saving}
            />
            {confirmPin.length > 0 && !pinsMatch && (
              <p className="text-xs text-destructive mt-1">PINs do not match</p>
            )}
            {pinsMatch && (
              <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500 mt-1">
                <CheckCircle className="h-3 w-3" />
                <span>PINs match</span>
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setShowPins(!showPins)}
            className="text-xs"
          >
            {showPins ? 'Hide' : 'Show'} PINs
          </Button>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full sm:w-auto"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Save New PIN
              </>
            )}
          </Button>
        </DialogFooter>

        <p className="text-xs text-muted-foreground text-center">
          You cannot proceed until you set your own PIN
        </p>
      </DialogContent>
    </Dialog>
  );
};

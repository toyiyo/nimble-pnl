import { useEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BiometricLockScreenProps {
  onAuthenticate: () => Promise<boolean>;
  failedAttempts: number;
}

export function BiometricLockScreen({ onAuthenticate, failedAttempts }: BiometricLockScreenProps) {
  const onAuthRef = useRef(onAuthenticate);
  onAuthRef.current = onAuthenticate;

  useEffect(() => {
    onAuthRef.current();
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-6 px-8">
      <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center">
        <ShieldCheck className="h-8 w-8 text-foreground" />
      </div>
      <div className="text-center">
        <h1 className="text-[17px] font-semibold text-foreground">EasyShiftHQ</h1>
        <p className="text-[13px] text-muted-foreground mt-1">Verify your identity to continue</p>
      </div>
      {failedAttempts > 0 && (
        <>
          <p className="text-[13px] text-destructive">
            Authentication failed. {3 - failedAttempts} attempts remaining.
          </p>
          <Button
            onClick={onAuthenticate}
            className="h-11 px-8 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[14px] font-medium"
          >
            Try Again
          </Button>
        </>
      )}
    </div>
  );
}

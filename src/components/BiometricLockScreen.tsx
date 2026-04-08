import { useEffect, useRef } from 'react';
import { AppLogo } from '@/components/AppLogo';
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
      <AppLogo size={64} />
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
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            Try Again
          </Button>
        </>
      )}
    </div>
  );
}

// src/components/employee/MobileLayout.tsx
import { ReactNode, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDeviceToken } from '@/hooks/useDeviceToken';
import { useBiometricAuth } from '@/hooks/useBiometricAuth';
import { BiometricLockScreen } from '@/components/BiometricLockScreen';
import { MobileTabBar } from './MobileTabBar';

interface MobileLayoutProps {
  children: ReactNode;
}

export function MobileLayout({ children }: MobileLayoutProps) {
  const { signOut } = useAuth();
  const bio = useBiometricAuth();

  // Register push notification token on mount
  useDeviceToken();

  // Lock on app backgrounding when biometrics are enabled
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && bio.isEnabled) {
        bio.lock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [bio.isEnabled, bio.lock]);

  // Sign out after too many failed biometric attempts
  useEffect(() => {
    if (bio.shouldSignOut) {
      signOut();
    }
  }, [bio.shouldSignOut, signOut]);

  // Handle push notification deep links (native only)
  // Disabled until Firebase is configured — the PushNotifications plugin
  // crashes Android if google-services.json is missing.
  // TODO: Re-enable when PUSH_NOTIFICATIONS_ENABLED is set to true in useDeviceToken.ts

  return (
    <>
      {bio.isLocked && (
        <BiometricLockScreen
          onAuthenticate={bio.authenticate}
          failedAttempts={bio.failedAttempts}
        />
      )}
      <div className="min-h-screen flex flex-col bg-background">
        <main
          className="flex-1 px-4 py-4 max-w-full overflow-x-hidden"
          style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
          role="main"
        >
          {children}
        </main>
        <MobileTabBar />
      </div>
    </>
  );
}

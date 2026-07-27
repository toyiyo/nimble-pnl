// src/components/employee/MobileLayout.tsx
import { ReactNode, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDeviceToken } from '@/hooks/useDeviceToken';
import { useBiometricAuth } from '@/hooks/useBiometricAuth';
import { BiometricLockScreen } from '@/components/BiometricLockScreen';
import { PersonalViewBanner } from '@/components/PersonalViewBanner';
import { useViewMode } from '@/contexts/ViewModeContext';
import { MobileTabBar } from './MobileTabBar';

interface MobileLayoutProps {
  children: ReactNode;
}

export function MobileLayout({ children }: MobileLayoutProps) {
  const { signOut } = useAuth();
  const bio = useBiometricAuth();
  const { viewMode } = useViewMode();

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
          style={{
            // Reserve room for the fixed bottom stack below so content isn't
            // hidden behind it. `MobileTabBar` alone is ~4.25rem tall; in
            // work mode the `PersonalViewBanner` stacks above it and adds
            // ~2rem, so bump the reserve accordingly (both include a small
            // buffer, matching the existing 5rem-for-~4.25rem margin).
            paddingBottom:
              viewMode === 'work'
                ? 'calc(7.5rem + env(safe-area-inset-bottom, 0px))'
                : 'calc(5rem + env(safe-area-inset-bottom, 0px))',
          }}
          role="main"
        >
          {children}
        </main>
        {/* Single fixed bottom stack: banner (work mode only) directly above
            the tab bar, in normal flow within this wrapper — not two
            independently `fixed` siblings, which would both pin to the
            viewport bottom and overlap. */}
        <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col">
          {viewMode === 'work' && <PersonalViewBanner variant="mobile" />}
          <MobileTabBar />
        </div>
      </div>
    </>
  );
}

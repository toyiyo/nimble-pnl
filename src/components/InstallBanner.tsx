import { useState, useEffect } from 'react';
import { X, Download, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Capacitor } from '@capacitor/core';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const InstallBanner = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop' | null>(null);

  useEffect(() => {
    // Don't show banner if already in Capacitor native app
    if (Capacitor.isNativePlatform()) {
      return;
    }

    // Check if already installed as PWA
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return;
    }

    // Check if user dismissed banner before
    const dismissed = localStorage.getItem('install-banner-dismissed');
    if (dismissed) {
      return;
    }

    // Detect platform
    const userAgent = navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(userAgent);
    const isAndroid = /android/.test(userAgent);
    const isSafari = /safari/.test(userAgent) && !/chrome/.test(userAgent);

    if (isIOS && isSafari) {
      setPlatform('ios');
      setShowBanner(true);
    } else if (isAndroid) {
      setPlatform('android');
    } else {
      setPlatform('desktop');
    }

    // Listen for PWA install prompt (Chrome/Edge/Android)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        console.log('User accepted the install prompt');
      }
      setDeferredPrompt(null);
      setShowBanner(false);
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem('install-banner-dismissed', 'true');
  };

  if (!showBanner) return null;

  return (
    <Card className="fixed bottom-4 left-4 right-4 z-50 border-primary/20 bg-card/95 backdrop-blur-sm shadow-lg md:left-auto md:right-4 md:max-w-md">
      <div className="flex items-start gap-3 p-4">
        <div className="flex-shrink-0 rounded-full bg-primary/10 p-2">
          {platform === 'ios' ? (
            <Smartphone className="h-5 w-5 text-primary" />
          ) : (
            <Download className="h-5 w-5 text-primary" />
          )}
        </div>
        
        <div className="flex-1 space-y-2">
          <h3 className="font-semibold text-sm">Install EasyshiftHQ</h3>
          
          {platform === 'ios' && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Tap the Share button <span className="inline-block">⎋</span> then "Add to Home Screen" for quick access.</p>
            </div>
          )}
          
          {platform === 'android' && deferredPrompt && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Install the app for faster access and offline support.</p>
            </div>
          )}
          
          {platform === 'android' && !deferredPrompt && (
            <div className="text-xs text-muted-foreground space-y-2">
              <p>For full Bluetooth scanner support, download the native app:</p>
              <a 
                href="/downloads/easyshifthq.apk" 
                className="inline-flex items-center gap-1 text-primary hover:underline"
                download
              >
                <Download className="h-3 w-3" />
                Download Android App (.apk)
              </a>
            </div>
          )}
          
          {platform === 'desktop' && deferredPrompt && (
            <div className="text-xs text-muted-foreground">
              <p>Install the app for easier access.</p>
            </div>
          )}
          
          <div className="flex gap-2 pt-1">
            {deferredPrompt && (
              <Button 
                size="sm" 
                onClick={handleInstallClick}
                className="h-8 text-xs"
              >
                Install
              </Button>
            )}
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={handleDismiss}
              className="h-8 text-xs"
            >
              Not now
            </Button>
          </div>
        </div>
        
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDismiss}
          className="flex-shrink-0 h-8 w-8 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
};
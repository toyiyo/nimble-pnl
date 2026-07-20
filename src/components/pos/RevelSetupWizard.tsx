import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, Loader2, ExternalLink } from 'lucide-react';
import { useRevelConnection } from '@/hooks/useRevelConnection';

interface RevelSetupWizardProps {
  restaurantId: string;
  onComplete: () => void;
}

type SetupStep = 'instance' | 'complete';

export const RevelSetupWizard = ({ restaurantId, onComplete }: RevelSetupWizardProps) => {
  const [currentStep, setCurrentStep] = useState<SetupStep>('instance');
  const [instance, setInstance] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [establishmentId, setEstablishmentId] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { connect, testConnection, disconnectRevel } = useRevelConnection();

  const handleConnect = async () => {
    if (!instance.trim() || !apiKey.trim() || !apiSecret.trim()) {
      toast({ title: 'Missing information', description: 'Enter your Revel URL, API key, and API secret', variant: 'destructive' });
      return;
    }
    setLoading(true);
    // connect() marks the connection active before we verify it. Track that so any
    // verification failure (testConnection throws, or returns success:false) rolls the
    // connection back instead of leaving a live-but-unusable one behind.
    let connected = false;
    try {
      await connect(restaurantId, instance.trim(), apiKey.trim(), apiSecret.trim(), establishmentId.trim() || undefined);
      connected = true;
      const result = await testConnection(restaurantId);
      if (!result.success) {
        const message = typeof result.error === 'string' && result.error.trim() ? result.error : 'Connection test failed';
        throw new Error(message);
      }
      setCurrentStep('complete');
    } catch (err) {
      if (connected) {
        try { await disconnectRevel(restaurantId); } catch { /* best-effort rollback */ }
      }
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to connect to Revel',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl">Revel POS Setup</CardTitle>
        <CardDescription>Connect your Revel POS to sync sales into your unified dashboard</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {currentStep === 'instance' && (
          <div className="space-y-6">
            <Alert>
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold">Before you connect:</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>In Revel, go to <strong>Settings → API</strong> and create an API key + secret (or use an existing one)</li>
                    <li>Copy your Revel URL — it looks like <code className="bg-muted px-1 rounded">yourname.revelup.com</code></li>
                    <li>Enter the URL, API key, and API secret below</li>
                  </ol>
                  <a
                    href="https://support.revelsystems.com/s/partner-integrations"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline inline-flex items-center gap-1 text-sm"
                  >
                    Revel partner integrations help <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <div>
                <Label htmlFor="revel-instance">Revel URL or subdomain</Label>
                <Input
                  id="revel-instance"
                  value={instance}
                  onChange={(e) => setInstance(e.target.value)}
                  placeholder="yourname.revelup.com"
                />
              </div>
              <div>
                <Label htmlFor="revel-api-key">API key</Label>
                <Input
                  id="revel-api-key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Your Revel API key"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="revel-api-secret">API secret</Label>
                <Input
                  id="revel-api-secret"
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="Your Revel API secret"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="revel-establishment">Establishment ID (optional)</Label>
                <Input
                  id="revel-establishment"
                  value={establishmentId}
                  onChange={(e) => setEstablishmentId(e.target.value)}
                  placeholder="Leave blank if you have a single establishment"
                />
              </div>
              <Button onClick={handleConnect} disabled={loading || !instance.trim() || !apiKey.trim() || !apiSecret.trim()} className="w-full">
                {loading ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Connecting...</>) : 'Connect & Verify'}
              </Button>
            </div>
          </div>
        )}

        {currentStep === 'complete' && (
          <div className="space-y-6 text-center py-8">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="text-2xl font-semibold mb-2">Setup Complete!</h3>
              <p className="text-muted-foreground">Revel is connected. Your sales history is importing now.</p>
            </div>
            <Alert>
              <AlertDescription>
                <p className="font-semibold mb-2">How syncing works:</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-left">
                  <li>Your last 90 days of sales start importing right away in the background</li>
                  <li>After that, new sales are pulled automatically about every 30 minutes</li>
                  <li>You can also run a sync for any date range yourself from the integration page</li>
                </ul>
              </AlertDescription>
            </Alert>
            <Button onClick={onComplete} className="w-full">Go to Dashboard</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

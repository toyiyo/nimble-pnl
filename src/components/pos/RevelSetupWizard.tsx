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
  const [establishmentId, setEstablishmentId] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { connect, testConnection } = useRevelConnection();

  const handleConnect = async () => {
    if (!instance.trim()) {
      toast({ title: 'Missing information', description: 'Enter your Revel URL or subdomain', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      await connect(restaurantId, instance.trim(), establishmentId.trim() || undefined);
      const result = await testConnection(restaurantId);
      if (result.success) {
        setCurrentStep('complete');
      } else {
        throw new Error(String(result.error) || 'Connection test failed');
      }
    } catch (err) {
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
                    <li>Log in to your Revel account and authorize <strong>EasyShiftHQ</strong> as an integration partner</li>
                    <li>Copy your Revel URL — it looks like <code className="bg-muted px-1 rounded">yourname.revelup.com</code></li>
                    <li>Paste the URL (or just the <strong>yourname</strong> part) below</li>
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
                <Label htmlFor="revel-establishment">Establishment ID (optional)</Label>
                <Input
                  id="revel-establishment"
                  value={establishmentId}
                  onChange={(e) => setEstablishmentId(e.target.value)}
                  placeholder="Leave blank if you have a single establishment"
                />
              </div>
              <Button onClick={handleConnect} disabled={loading || !instance.trim()} className="w-full">
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
              <p className="text-muted-foreground">Revel is connected. Sales will sync in real time via webhooks.</p>
            </div>
            <Alert>
              <AlertDescription>
                <p className="font-semibold mb-2">How syncing works:</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-left">
                  <li>New orders arrive in real time as Revel finalizes them</li>
                  <li>Historical data (last 90 days) imports on the first background sync</li>
                  <li>A scheduled job reconciles any missed events every 6 hours</li>
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

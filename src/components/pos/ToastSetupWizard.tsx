import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, Circle, ExternalLink, Loader2, Info } from 'lucide-react';
import { useToastConnection } from '@/hooks/useToastConnection';

interface ToastSetupWizardProps {
  restaurantId: string;
  onComplete: () => void;
}

type SetupStep = 'credentials' | 'location' | 'complete';

export const ToastSetupWizard = ({ restaurantId, onComplete }: ToastSetupWizardProps) => {
  const [currentStep, setCurrentStep] = useState<SetupStep>('credentials');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [locationId, setLocationId] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { saveCredentials, testConnection } = useToastConnection();

  const steps: { id: SetupStep; label: string; completed: boolean }[] = [
    { id: 'credentials', label: 'API Credentials', completed: currentStep !== 'credentials' },
    { id: 'location', label: 'Select Location', completed: currentStep === 'complete' },
    { id: 'complete', label: 'Complete', completed: false }
  ];

  const handleContinueToLocation = () => {
    if (!clientId || !clientSecret) {
      toast({
        title: 'Missing information',
        description: 'Please enter your Client ID and Client Secret',
        variant: 'destructive'
      });
      return;
    }
    setCurrentStep('location');
  };

  const handleSaveLocation = async () => {
    if (!locationId) {
      toast({
        title: 'Missing location',
        description: 'Please select or enter a location ID',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      await saveCredentials(restaurantId, clientId, clientSecret, locationId);

      toast({
        title: 'Credentials saved',
        description: 'Testing connection...'
      });

      const result = await testConnection(restaurantId);
      if (result.success) {
        toast({
          title: 'Connection successful!',
          description: `Connected to ${result.restaurantName || 'Toast'}`
        });
        setCurrentStep('complete');
      } else {
        throw new Error(String(result.error) || 'Connection test failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save credentials';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl">Toast POS Setup</CardTitle>
        <CardDescription>
          Connect your Toast POS system to sync orders and menu data
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress Steps */}
        <div className="flex items-center justify-between mb-8">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
                  step.completed
                    ? 'bg-primary border-primary text-primary-foreground'
                    : currentStep === step.id
                    ? 'border-primary text-primary'
                    : 'border-muted-foreground text-muted-foreground'
                }`}>
                  {step.completed ? <CheckCircle className="w-6 h-6" /> : <Circle className="w-6 h-6" />}
                </div>
                <span className="text-xs mt-2 text-center">{step.label}</span>
              </div>
              {index < steps.length - 1 && (
                <div className={`w-32 h-0.5 mx-2 ${
                  step.completed ? 'bg-primary' : 'bg-muted-foreground'
                }`} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Credentials */}
        {currentStep === 'credentials' && (
          <div className="space-y-6">
            <Alert>
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold">Before you begin:</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Log in to your <a href="https://www.toasttab.com/restaurants/admin/api-access/" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">Toast API Access page<ExternalLink className="w-3 h-3" /></a></li>
                    <li>Click <strong>Create credential</strong> and give it a name (e.g., "EasyShiftHQ")</li>
                    <li>Select the required API scopes (orders:read, menus:read, restaurants:read)</li>
                    <li>Select the location(s) this credential will have access to</li>
                    <li>Copy the generated <strong>Client ID</strong> and <strong>Client Secret</strong></li>
                  </ol>
                </div>
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <div>
                <Label htmlFor="client-id">Client ID</Label>
                <Input
                  id="client-id"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Enter your Toast Client ID"
                />
              </div>

              <div>
                <Label htmlFor="client-secret">Client Secret</Label>
                <Input
                  id="client-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Enter your Toast Client Secret"
                />
              </div>

              <Button
                onClick={handleContinueToLocation}
                disabled={!clientId || !clientSecret}
                className="w-full"
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Enter Location ID */}
        {currentStep === 'location' && (
          <div className="space-y-6">
            <Alert className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertDescription>
                <p className="font-semibold text-blue-900 dark:text-blue-100">How to find your Restaurant External ID:</p>

                <div className="mt-3 p-3 bg-green-100 dark:bg-green-900/50 rounded-md border border-green-200 dark:border-green-800">
                  <p className="font-medium text-green-900 dark:text-green-100 text-sm">Easiest: Check your email from Toast</p>
                  <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                    When you created your API credentials, Toast sent an email with the Restaurant GUIDs for all your locations. Search your inbox for "Toast API" or "API credentials".
                  </p>
                </div>

                <p className="font-medium text-blue-900 dark:text-blue-100 text-sm mt-3">Alternative: Find it in Toast Portal</p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800 dark:text-blue-200 mt-1">
                  <li>Go to your <a href="https://www.toasttab.com/restaurants/admin/api-access/" target="_blank" rel="noopener noreferrer" className="underline font-medium">Toast API Access page</a></li>
                  <li>Click on your credential name to view details</li>
                  <li>Look in the <strong>"Edit Location IDs"</strong> section for the GUID</li>
                </ol>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-3">
                  Format: <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code> (36 characters with dashes)
                </p>
              </AlertDescription>
            </Alert>

            <div>
              <Label htmlFor="location-id">Restaurant External ID (GUID)</Label>
              <Input
                id="location-id"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                placeholder="a1b2c3d4-e5f6-7890-abcd-ef1234567890"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">
                36 characters with dashes (e.g., xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setCurrentStep('credentials')}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={handleSaveLocation}
                disabled={loading || !locationId}
                className="flex-1"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Connect'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Complete */}
        {currentStep === 'complete' && (
          <div className="space-y-6 text-center py-8">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" />
            </div>

            <div>
              <h3 className="text-2xl font-semibold mb-2">Setup Complete!</h3>
              <p className="text-muted-foreground">
                Your Toast POS is now connected and will start syncing orders automatically
              </p>
            </div>

            <Alert>
              <AlertDescription>
                <p className="font-semibold mb-2">How syncing works:</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-left">
                  <li>Orders are synced automatically every night at 3 AM</li>
                  <li>Historical data (last 90 days) will be imported on the first sync</li>
                  <li>You can trigger a manual sync anytime from the POS settings</li>
                  <li>Order data will appear in your unified sales dashboard</li>
                </ul>
              </AlertDescription>
            </Alert>

            <Button onClick={onComplete} className="w-full">
              Go to Dashboard
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

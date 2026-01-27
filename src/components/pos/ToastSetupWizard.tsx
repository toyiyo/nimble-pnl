import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, Circle, ExternalLink, Copy, Check, MapPin, Loader2 } from 'lucide-react';
import { useToastConnection } from '@/hooks/useToastConnection';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface ToastSetupWizardProps {
  restaurantId: string;
  onComplete: () => void;
}

type SetupStep = 'credentials' | 'location' | 'webhook' | 'complete';

interface ToastLocation {
  guid: string;
  name: string;
  location: string;
}

export const ToastSetupWizard = ({ restaurantId, onComplete }: ToastSetupWizardProps) => {
  const [currentStep, setCurrentStep] = useState<SetupStep>('credentials');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [locations, setLocations] = useState<ToastLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [manualLocationId, setManualLocationId] = useState('');
  const [useManualEntry, setUseManualEntry] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);
  const { toast } = useToast();
  const { saveCredentials, testConnection, saveWebhookSecret, fetchLocations } = useToastConnection();

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const webhookUrl = `${supabaseUrl}/functions/v1/toast-webhook`;

  const steps: { id: SetupStep; label: string; completed: boolean }[] = [
    { id: 'credentials', label: 'API Credentials', completed: currentStep !== 'credentials' },
    { id: 'location', label: 'Select Location', completed: ['webhook', 'complete'].includes(currentStep) },
    { id: 'webhook', label: 'Webhook Setup', completed: currentStep === 'complete' },
    { id: 'complete', label: 'Complete', completed: false }
  ];

  const handleFetchLocations = async () => {
    if (!clientId || !clientSecret) {
      toast({
        title: 'Missing information',
        description: 'Please enter your Client ID and Client Secret',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const result = await fetchLocations(restaurantId, clientId, clientSecret);

      if (result.locations && result.locations.length > 0) {
        setLocations(result.locations);
        setUseManualEntry(false);
        if (result.locations.length === 1) {
          setSelectedLocationId(result.locations[0].guid);
        }
      } else {
        setUseManualEntry(true);
        toast({
          title: 'Manual entry required',
          description: result.message || 'Could not fetch locations automatically. Please enter your Location ID manually.',
        });
      }
      setCurrentStep('location');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to validate credentials';
      toast({
        title: 'Error validating credentials',
        description: errorMessage,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveLocation = async () => {
    const locationId = useManualEntry ? manualLocationId : selectedLocationId;

    if (!locationId) {
      toast({
        title: 'Missing location',
        description: 'Please select or enter a location',
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
        setCurrentStep('webhook');
      } else {
        throw new Error(result.error || 'Connection test failed');
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save credentials';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveWebhook = async () => {
    if (!webhookSecret) {
      toast({
        title: 'Missing webhook secret',
        description: 'Please enter the webhook secret from Toast',
        variant: 'destructive'
      });
      return;
    }

    try {
      await saveWebhookSecret(restaurantId, webhookSecret);
      setCurrentStep('complete');
      toast({
        title: 'Setup complete!',
        description: 'Toast integration is now active'
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save webhook secret';
      toast({
        title: 'Error saving webhook secret',
        description: errorMessage,
        variant: 'destructive'
      });
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhookUrl(true);
    setTimeout(() => setCopiedWebhookUrl(false), 2000);
    toast({
      title: 'Copied!',
      description: 'Webhook URL copied to clipboard'
    });
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
                <div className={`w-24 h-0.5 mx-2 ${
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
                onClick={handleFetchLocations}
                disabled={loading || !clientId || !clientSecret}
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Validating...
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Select Location */}
        {currentStep === 'location' && (
          <div className="space-y-6">
            {!useManualEntry && locations.length > 0 ? (
              <>
                <Alert>
                  <AlertDescription>
                    <p className="font-semibold">Select the location to connect:</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      These are the locations your API credentials have access to.
                    </p>
                  </AlertDescription>
                </Alert>

                <RadioGroup value={selectedLocationId} onValueChange={setSelectedLocationId}>
                  <div className="space-y-3">
                    {locations.map((loc) => (
                      <div
                        key={loc.guid}
                        role="button"
                        tabIndex={0}
                        className={`flex items-center space-x-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                          selectedLocationId === loc.guid
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                        onClick={() => setSelectedLocationId(loc.guid)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedLocationId(loc.guid);
                          }
                        }}
                      >
                        <RadioGroupItem value={loc.guid} id={loc.guid} />
                        <div className="flex-1">
                          <Label htmlFor={loc.guid} className="font-medium cursor-pointer">
                            {loc.name}
                          </Label>
                          {loc.location && (
                            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                              <MapPin className="w-3 h-3" />
                              {loc.location}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </RadioGroup>

                <Button
                  variant="link"
                  className="text-sm p-0 h-auto"
                  onClick={() => setUseManualEntry(true)}
                >
                  Enter Location ID manually instead
                </Button>
              </>
            ) : (
              <>
                <Alert>
                  <AlertDescription>
                    <p className="font-semibold">Enter your Location ID:</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Find this in your Toast credential details as "Restaurant External ID" or in the URL when viewing your restaurant.
                    </p>
                  </AlertDescription>
                </Alert>

                <div>
                  <Label htmlFor="manual-location-id">Location ID (Restaurant External ID)</Label>
                  <Input
                    id="manual-location-id"
                    value={manualLocationId}
                    onChange={(e) => setManualLocationId(e.target.value)}
                    placeholder="e.g., abc123-def456-ghi789"
                  />
                </div>

                {locations.length > 0 && (
                  <Button
                    variant="link"
                    className="text-sm p-0 h-auto"
                    onClick={() => setUseManualEntry(false)}
                  >
                    Select from available locations instead
                  </Button>
                )}
              </>
            )}

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
                disabled={loading || (!selectedLocationId && !manualLocationId)}
                className="flex-1"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Webhook Setup */}
        {currentStep === 'webhook' && (
          <div className="space-y-6">
            <Alert>
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold">Configure webhooks in Toast:</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>In Toast Web, go to <strong>Integrations → Toast API access</strong></li>
                    <li>Click <strong>Manage credentials</strong> and find your credential</li>
                    <li>Click <strong>Configure webhooks</strong></li>
                    <li>Add a new webhook subscription with this URL:</li>
                  </ol>
                </div>
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <div>
                <Label>Webhook URL</Label>
                <div className="flex gap-2">
                  <Input
                    value={webhookUrl}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={copyWebhookUrl}
                    aria-label={copiedWebhookUrl ? 'Copied webhook URL' : 'Copy webhook URL'}
                  >
                    {copiedWebhookUrl ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <Alert>
                <AlertDescription className="text-sm">
                  <p className="font-semibold mb-2">Select these event types:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Order Created</li>
                    <li>Order Updated</li>
                    <li>Order Deleted</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div>
                <Label htmlFor="webhook-secret">Webhook Secret</Label>
                <Input
                  id="webhook-secret"
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="Enter the webhook secret provided by Toast"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Copy this from the webhook configuration page in Toast
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep('location')}
                  className="flex-1"
                >
                  Back
                </Button>
                <Button
                  onClick={handleSaveWebhook}
                  disabled={!webhookSecret}
                  className="flex-1"
                >
                  Complete Setup
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Complete */}
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
                <p className="font-semibold mb-2">Next steps:</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-left">
                  <li>A bulk sync will run nightly at 3 AM to import recent orders</li>
                  <li>Webhooks will push real-time updates as orders come in</li>
                  <li>Order data will appear in your unified sales dashboard</li>
                  <li>Historical data (last 90 days) will be imported on first sync</li>
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

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, Circle, ExternalLink, Copy, Check } from 'lucide-react';
import { useToastConnection } from '@/hooks/useToastConnection';

interface ToastSetupWizardProps {
  restaurantId: string;
  onComplete: () => void;
}

type SetupStep = 'credentials' | 'test' | 'webhook' | 'complete';

export const ToastSetupWizard = ({ restaurantId, onComplete }: ToastSetupWizardProps) => {
  const [currentStep, setCurrentStep] = useState<SetupStep>('credentials');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [restaurantGuid, setRestaurantGuid] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [testing, setTesting] = useState(false);
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);
  const { toast } = useToast();
  const { saveCredentials, testConnection, saveWebhookSecret } = useToastConnection();

  // Use the actual Supabase project URL for Edge Functions
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const webhookUrl = `${supabaseUrl}/functions/v1/toast-webhook`;

  const steps: { id: SetupStep; label: string; completed: boolean }[] = [
    { id: 'credentials', label: 'API Credentials', completed: currentStep !== 'credentials' },
    { id: 'test', label: 'Test Connection', completed: ['webhook', 'complete'].includes(currentStep) },
    { id: 'webhook', label: 'Webhook Setup', completed: currentStep === 'complete' },
    { id: 'complete', label: 'Complete', completed: false }
  ];

  const handleSaveCredentials = async () => {
    if (!clientId || !clientSecret || !restaurantGuid) {
      toast({
        title: 'Missing information',
        description: 'Please fill in all credential fields',
        variant: 'destructive'
      });
      return;
    }

    setTesting(true);
    try {
      await saveCredentials(restaurantId, clientId, clientSecret, restaurantGuid);
      setCurrentStep('test');
      toast({
        title: 'Credentials saved',
        description: 'Now testing your connection...'
      });
      
      // Automatically test connection
      setTimeout(() => handleTestConnection(), 500);
    } catch (error: any) {
      toast({
        title: 'Error saving credentials',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setTesting(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
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
    } catch (error: any) {
      toast({
        title: 'Connection test failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setTesting(false);
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
    } catch (error: any) {
      toast({
        title: 'Error saving webhook secret',
        description: error.message,
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
                    <li>Log in to your <a href="https://www.toasttab.com/" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">Toast Web<ExternalLink className="w-3 h-3" /></a></li>
                    <li>Navigate to <strong>Integrations → Toast API access</strong></li>
                    <li>Click <strong>Manage credentials</strong> and then <strong>Create credential</strong></li>
                    <li>Select scopes: <strong>orders:read</strong> and <strong>menus:read</strong></li>
                    <li>Copy the generated <strong>Client ID</strong> and <strong>Client Secret</strong></li>
                    <li>Find your <strong>Restaurant GUID</strong> in the Toast Web URL or API documentation</li>
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

              <div>
                <Label htmlFor="restaurant-guid">Restaurant GUID</Label>
                <Input
                  id="restaurant-guid"
                  value={restaurantGuid}
                  onChange={(e) => setRestaurantGuid(e.target.value)}
                  placeholder="Enter your Toast Restaurant GUID"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  This is your unique restaurant identifier in the Toast system
                </p>
              </div>

              <Button 
                onClick={handleSaveCredentials} 
                disabled={testing || !clientId || !clientSecret || !restaurantGuid}
                className="w-full"
              >
                {testing ? 'Saving...' : 'Continue'}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Test Connection */}
        {currentStep === 'test' && (
          <div className="space-y-6">
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                Testing your connection to Toast API...
              </AlertDescription>
            </Alert>
            
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
              <p className="mt-4 text-muted-foreground">Validating credentials...</p>
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
                  onClick={() => setCurrentStep('credentials')}
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
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-12 h-12 text-green-600" />
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

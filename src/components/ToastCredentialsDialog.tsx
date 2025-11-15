import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ExternalLink, Info, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ToastCredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (credentials: {
    clientId: string;
    clientSecret: string;
    apiUrl: string;
    restaurantGuid?: string;
  }) => Promise<void>;
  onTest?: (credentials: {
    clientId: string;
    clientSecret: string;
    apiUrl: string;
  }) => Promise<{
    success?: boolean;
    message?: string;
    restaurantGuid?: string;
    restaurantData?: {
      name?: string;
      guid?: string;
    };
  }>;
}

export const ToastCredentialsDialog = ({
  open,
  onOpenChange,
  onConnect,
  onTest,
}: ToastCredentialsDialogProps) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [apiUrl, setApiUrl] = useState('https://ws-api.toasttab.com');
  const [restaurantGuid, setRestaurantGuid] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success?: boolean;
    message?: string;
    restaurantGuid?: string;
    restaurantData?: {
      name?: string;
      guid?: string;
    };
  } | null>(null);
  const { toast } = useToast();

  const handleTest = async () => {
    if (!clientId || !clientSecret || !apiUrl) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await onTest?.({
        clientId,
        clientSecret,
        apiUrl,
      });

      setTestResult(result);
      
      if (result?.restaurantGuid) {
        setRestaurantGuid(result.restaurantGuid);
      }

      toast({
        title: "Connection Test Successful",
        description: "Your Toast credentials are valid!",
      });
    } catch (error) {
      toast({
        title: "Connection Test Failed",
        description: error instanceof Error ? error.message : "Please check your credentials and try again.",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleConnect = async () => {
    if (!clientId || !clientSecret || !apiUrl) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    setIsConnecting(true);

    try {
      await onConnect({
        clientId,
        clientSecret,
        apiUrl,
        restaurantGuid: restaurantGuid || undefined,
      });

      // Clear form and close dialog on success
      setClientId('');
      setClientSecret('');
      setApiUrl('https://ws-api.toasttab.com');
      setRestaurantGuid('');
      setTestResult(null);
      onOpenChange(false);
    } catch (error) {
      // Error handling is done in the parent component
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect Toast POS</DialogTitle>
          <DialogDescription>
            Enter your Toast API credentials to connect your restaurant
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Instructions */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm space-y-2">
              <p className="font-medium">How to get your Toast API credentials:</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Contact your Toast rep to enable "Standard API Access" for your account</li>
                <li>Log in to Toast Web and go to <strong>Integrations → Toast API Access</strong></li>
                <li>Click <strong>Manage credentials</strong></li>
                <li>Create a new "Toast Read Only API" credential set</li>
                <li>Copy the Client ID, Client Secret, and API URL here</li>
              </ol>
              <a
                href="https://doc.toasttab.com/doc/devguide/devApiAccessUserGuide.html"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline text-xs mt-2"
              >
                View Toast documentation <ExternalLink className="h-3 w-3" />
              </a>
            </AlertDescription>
          </Alert>

          {/* Form Fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiUrl">API URL *</Label>
              <Input
                id="apiUrl"
                placeholder="https://ws-api.toasttab.com"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Use the API URL provided in your Toast credential set
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientId">Client ID *</Label>
              <Input
                id="clientId"
                placeholder="Enter your Toast Client ID"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientSecret">Client Secret *</Label>
              <Input
                id="clientSecret"
                type="password"
                placeholder="Enter your Toast Client Secret"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="restaurantGuid">Restaurant GUID (Optional)</Label>
              <Input
                id="restaurantGuid"
                placeholder="Will be auto-detected if left blank"
                value={restaurantGuid}
                onChange={(e) => setRestaurantGuid(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to auto-detect from your credentials
              </p>
            </div>
          </div>

          {/* Test Result */}
          {testResult && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <p className="font-medium mb-1">Connection test successful!</p>
                {testResult.restaurantData && (
                  <p className="text-xs">
                    Restaurant: {testResult.restaurantData.name || 'N/A'}
                  </p>
                )}
                {testResult.restaurantGuid && (
                  <p className="text-xs">
                    GUID: {testResult.restaurantGuid}
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={isTesting || isConnecting || !clientId || !clientSecret || !apiUrl}
          >
            {isTesting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              'Test Connection'
            )}
          </Button>
          <Button
            onClick={handleConnect}
            disabled={isConnecting || isTesting || !clientId || !clientSecret || !apiUrl}
          >
            {isConnecting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Connecting...
              </>
            ) : (
              'Connect'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

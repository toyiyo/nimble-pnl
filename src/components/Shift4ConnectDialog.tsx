import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Key, ShieldCheck } from 'lucide-react';

interface Shift4ConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (secretKey: string, environment: 'production' | 'sandbox') => Promise<void>;
  isLoading: boolean;
}

export const Shift4ConnectDialog = ({ open, onOpenChange, onConnect, isLoading }: Shift4ConnectDialogProps) => {
  const [secretKey, setSecretKey] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'sandbox'>('production');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!secretKey.trim()) {
      setError('Please enter your Shift4 Secret Key');
      return;
    }

    if (!secretKey.startsWith('sk_')) {
      setError('Invalid Secret Key format. Shift4 Secret Keys start with "sk_"');
      return;
    }

    setError('');

    try {
      await onConnect(secretKey, environment);
      // Reset form on success
      setSecretKey('');
      setEnvironment('production');
    } catch (err: any) {
      setError(err.message || 'Failed to connect to Shift4');
    }
  };

  const handleClose = () => {
    setSecretKey('');
    setEnvironment('production');
    setError('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Connect to Shift4
          </DialogTitle>
          <DialogDescription>
            Enter your Shift4 API credentials to connect your account
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="secretKey">Secret Key</Label>
            <Input
              id="secretKey"
              type="password"
              placeholder="sk_live_..."
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              disabled={isLoading}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Your Secret Key starts with "sk_live_" (production) or "sk_test_" (sandbox)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="environment">Environment</Label>
            <Select
              value={environment}
              onValueChange={(value) => setEnvironment(value as 'production' | 'sandbox')}
              disabled={isLoading}
            >
              <SelectTrigger id="environment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="production">Production</SelectItem>
                <SelectItem value="sandbox">Sandbox (Testing)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Use Sandbox for testing, Production for live transactions
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <div className="space-y-1">
                <div className="font-medium">Security Information</div>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Your Secret Key is encrypted before storage</li>
                  <li>We never store credentials in plain text</li>
                  <li>You can rotate your keys at any time</li>
                  <li>Find your keys in Shift4 Dashboard → Developers → API Keys</li>
                </ul>
              </div>
            </AlertDescription>
          </Alert>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Connecting...' : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

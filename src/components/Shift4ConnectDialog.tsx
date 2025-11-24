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
  onConnect: (
    secretKey: string,
    merchantId: string | undefined,
    environment: 'production' | 'sandbox',
    email: string,
    password: string
  ) => Promise<void>;
  isLoading: boolean;
}

export const Shift4ConnectDialog = ({ open, onOpenChange, onConnect, isLoading }: Shift4ConnectDialogProps) => {
  const [secretKey, setSecretKey] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [environment, setEnvironment] = useState<'production' | 'sandbox'>('production');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please enter your Lighthouse username/email');
      return;
    }
    if (!password.trim()) {
      setError('Please enter your Lighthouse password');
      return;
    }
    // Secret key validation removed for Lighthouse-only flow
    setError('');
    try {
      await onConnect(secretKey, merchantId.trim() || undefined, environment, email.trim(), password.trim());
      // Reset form on success
      setSecretKey('');
      setMerchantId('');
      setEnvironment('production');
      setEmail('');
      setPassword('');
    } catch (err: any) {
      setError(err.message || 'Failed to connect to Shift4');
    }
  };

  const handleClose = () => {
    setSecretKey('');
    setMerchantId('');
    setEnvironment('production');
    setEmail('');
    setPassword('');
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
          {/* API Key input removed for Lighthouse-only flow */}

          <div className="space-y-2">
            <Label htmlFor="email">Lighthouse Username/Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="user@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Enter your Lighthouse account email (used for authentication)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Lighthouse Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Enter your Lighthouse account password (stored encrypted)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="merchantId">Merchant ID (Optional)</Label>
            <Input
              id="merchantId"
              type="text"
              placeholder="Optional - for tracking purposes"
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Optional: Enter a merchant identifier for easier tracking in your dashboard
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
              Select based on your API key type (sk_live_ = Production, sk_test_ = Sandbox)
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
                  <li>Your Lighthouse username/email and password are encrypted before storage</li>
                  <li>We never store credentials in plain text</li>
                  <li>You can update or rotate your credentials at any time</li>
                  <li>Credentials are only used for secure authentication to Lighthouse API</li>
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

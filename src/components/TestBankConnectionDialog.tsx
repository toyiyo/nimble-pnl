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
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface TestBankConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
}

export const TestBankConnectionDialog = ({
  open,
  onOpenChange,
  restaurantId,
}: TestBankConnectionDialogProps) => {
  const [bankType, setBankType] = useState('checking');
  const [balance, setBalance] = useState('5000.00');
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();

  const handleCreateTestConnection = async () => {
    setIsCreating(true);
    
    try {
      // This is a placeholder for test mode
      // In production, you'd use Stripe's test mode
      if (import.meta.env.DEV) {
        console.log('[TEST-BANK] Creating test bank connection:', {
          restaurantId,
          bankType,
          balance,
        });
      }
      
      // Simulate async operation
      await new Promise(resolve => setTimeout(resolve, 500));
      
      toast({
        title: "Test Connection Created",
        description: `Successfully created ${bankType} account with balance $${balance}`,
      });
      
      // Only close dialog on success
      onOpenChange(false);
    } catch (error) {
      console.error('[TEST-BANK] Error creating test connection:', error);
      
      toast({
        title: "Failed to Create Test Connection",
        description: error instanceof Error ? error.message : "An error occurred while creating the test connection",
        variant: "destructive",
      });
    } finally {
      // Always clear loading state
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Test Bank Connection</DialogTitle>
          <DialogDescription>
            Create a simulated bank connection for testing purposes
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            This creates a test bank connection. For real connections, use the "Connect Bank" button
            and complete Stripe's Financial Connections flow.
          </AlertDescription>
        </Alert>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="bank-name">Bank Name</Label>
            <Input
              id="bank-name"
              placeholder="Test Bank"
              defaultValue="Test Bank"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account-type">Account Type</Label>
            <Select value={bankType} onValueChange={setBankType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="checking">Checking</SelectItem>
                <SelectItem value="savings">Savings</SelectItem>
                <SelectItem value="credit">Credit Card</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="balance">Starting Balance</Label>
            <Input
              id="balance"
              type="number"
              step="0.01"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="5000.00"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreateTestConnection} disabled={isCreating}>
            {isCreating ? 'Creating...' : 'Create Test Connection'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

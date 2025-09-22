import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { TestTube, Play, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

interface WebhookTesterProps {
  restaurantId: string;
}

interface TestResult {
  test: string;
  success: boolean;
  message: string;
  details?: any;
}

export const WebhookTester = ({ restaurantId }: WebhookTesterProps) => {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const { toast } = useToast();

  const runTests = async () => {
    setIsRunning(true);
    setResults([]);
    
    const testResults: TestResult[] = [];

    try {
      // Test 1: Register webhook
      console.log('Testing webhook registration...');
      testResults.push({ test: 'Webhook Registration', success: false, message: 'Running...' });
      setResults([...testResults]);
      
      const { data: registerData, error: registerError } = await supabase.functions.invoke('square-webhook-register', {
        body: { restaurantId }
      });

      if (registerError) {
        testResults[0] = {
          test: 'Webhook Registration',
          success: false,
          message: `Failed: ${registerError.message}`,
          details: registerError
        };
      } else {
        testResults[0] = {
          test: 'Webhook Registration',
          success: true,
          message: `Success! Webhook ID: ${registerData?.webhookId || 'N/A'}`,
          details: registerData
        };
      }
      setResults([...testResults]);

      // Test 2: Test webhook endpoint directly
      console.log('Testing webhook endpoint...');
      testResults.push({ test: 'Webhook Endpoint', success: false, message: 'Running...' });
      setResults([...testResults]);

      const testPayload = {
        merchant_id: 'MLGJF14V2M88Z',
        type: 'order.updated',
        data: {
          id: `test-order-${Date.now()}`,
          type: 'order'
        },
        event_id: `test-event-${Date.now()}`
      };

      const webhookResponse = await fetch('https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testPayload)
      });

      const webhookResult = await webhookResponse.text();
      
      if (webhookResponse.ok) {
        testResults[1] = {
          test: 'Webhook Endpoint',
          success: true,
          message: `Success! Status: ${webhookResponse.status}`,
          details: { status: webhookResponse.status, response: webhookResult }
        };
      } else {
        testResults[1] = {
          test: 'Webhook Endpoint',
          success: false,
          message: `Failed: Status ${webhookResponse.status}`,
          details: { status: webhookResponse.status, response: webhookResult }
        };
      }
      setResults([...testResults]);

      // Test 3: Check Square connection
      console.log('Testing Square connection...');
      testResults.push({ test: 'Square Connection', success: false, message: 'Running...' });
      setResults([...testResults]);

      const { data: connectionData, error: connectionError } = await supabase
        .from('square_connections')
        .select('merchant_id, connected_at, scopes')
        .eq('restaurant_id', restaurantId)
        .single();

      if (connectionError) {
        testResults[2] = {
          test: 'Square Connection',
          success: false,
          message: `Connection not found: ${connectionError.message}`,
          details: connectionError
        };
      } else {
        testResults[2] = {
          test: 'Square Connection',
          success: true,
          message: `Connected! Merchant: ${connectionData.merchant_id}`,
          details: connectionData
        };
      }
      setResults([...testResults]);

      // Show summary toast
      const successCount = testResults.filter(r => r.success).length;
      const totalTests = testResults.length;
      
      toast({
        title: "Webhook Setup Complete",
        description: `${successCount}/${totalTests} steps completed successfully`,
        variant: successCount === totalTests ? "default" : "destructive",
      });

    } catch (error: any) {
      console.error('Test suite error:', error);
      toast({
        title: "Test Error",
        description: error.message || "Failed to run webhook tests",
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (result: TestResult) => {
    if (result.message === 'Running...') {
      return <AlertCircle className="h-4 w-4 text-yellow-500 animate-pulse" />;
    }
    return result.success 
      ? <CheckCircle2 className="h-4 w-4 text-green-500" />
      : <XCircle className="h-4 w-4 text-red-500" />;
  };

  const getStatusBadge = (result: TestResult) => {
    if (result.message === 'Running...') {
      return <Badge variant="secondary">Running</Badge>;
    }
    return result.success 
      ? <Badge variant="default">Pass</Badge>
      : <Badge variant="destructive">Fail</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TestTube className="h-5 w-5" />
          Webhook Testing
        </CardTitle>
        <CardDescription>
          Set up application-wide webhook to receive Square events from all connected restaurants. 
          This creates a single webhook that routes events based on merchant ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={runTests}
          disabled={isRunning}
          className="w-full"
        >
          <Play className="h-4 w-4 mr-2" />
          {isRunning ? 'Setting up Webhooks...' : 'Setup Square Webhooks'}
        </Button>

        {results.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-medium">Test Results</h4>
            {results.map((result, index) => (
              <div key={index} className="flex items-center justify-between p-3 border rounded">
                <div className="flex items-center gap-3">
                  {getStatusIcon(result)}
                  <div>
                    <div className="font-medium">{result.test}</div>
                    <div className="text-sm text-muted-foreground">{result.message}</div>
                  </div>
                </div>
                {getStatusBadge(result)}
              </div>
            ))}
          </div>
        )}

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <div className="font-medium">How it works</div>
              <div className="text-sm space-y-1">
                <div><strong>Application Webhook:</strong> Creates one webhook for your entire application that receives events from all Square merchants</div>
                <div><strong>Event Routing:</strong> Events are automatically routed to the correct restaurant based on the merchant_id in the webhook payload</div>
                <div><strong>Real-time Updates:</strong> Once configured, your P&L data will automatically update when Square events occur</div>
              </div>
              <div className="text-sm">
                Check the browser console and Supabase logs for detailed setup information.
              </div>
            </div>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
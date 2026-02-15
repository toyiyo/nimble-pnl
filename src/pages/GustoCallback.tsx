import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

const GustoCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing Gusto connection...');

  useEffect(() => {
    const handleCallback = async () => {
      // Get search params from URL
      const urlSearchParams = new URLSearchParams(window.location.search);
      const code = urlSearchParams.get('code');
      const state = urlSearchParams.get('state');
      const error = urlSearchParams.get('error');
      const errorDescription = urlSearchParams.get('error_description');

      console.log('Gusto callback - URL search params:', {
        fullUrl: window.location.href,
        search: window.location.search,
        code: code ? code.substring(0, 20) + '...' : null,
        state,
        error,
        errorDescription,
        origin: window.location.origin,
      });

      // Handle OAuth errors
      if (error) {
        setStatus('error');
        setMessage(`Gusto connection failed: ${errorDescription || error}`);
        toast({
          title: 'Connection Failed',
          description: errorDescription || 'Gusto authorization was denied or failed',
          variant: 'destructive',
        });

        // Redirect back to integrations after delay
        setTimeout(() => navigate('/integrations'), 3000);
        return;
      }

      // Validate required parameters
      if (!code || !state) {
        setStatus('error');
        setMessage('Missing authorization code or state parameter');
        toast({
          title: 'Connection Failed',
          description: 'Invalid callback parameters',
          variant: 'destructive',
        });

        setTimeout(() => navigate('/integrations'), 3000);
        return;
      }

      try {
        // State contains the restaurant ID
        const restaurantId = state;

        console.log('Gusto callback processing:', {
          code: code.substring(0, 20) + '...',
          state,
          restaurantId,
          callingFrom: window.location.origin,
        });

        // Call the gusto-oauth edge function to exchange code for tokens
        const { data, error: callbackError } = await supabase.functions.invoke('gusto-oauth', {
          body: {
            action: 'callback',
            code: code,
            state: state,
          },
        });

        console.log('Edge function response:', { data, error: callbackError });

        if (callbackError) {
          console.error('Edge function error details:', callbackError);
          throw callbackError;
        }

        if (data?.error) {
          throw new Error(data.error);
        }

        setStatus('success');
        setMessage(`Successfully connected to ${data?.companyName || 'Gusto'}!`);
        toast({
          title: 'Connection Successful',
          description: 'Gusto connected! You can now sync employees and run payroll.',
        });

        // Redirect to Gusto payroll page after success
        setTimeout(() => navigate('/payroll/gusto'), 2000);

      } catch (error) {
        console.error('Gusto callback error:', error);
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Failed to complete Gusto connection');
        toast({
          title: 'Connection Failed',
          description: error instanceof Error ? error.message : 'An error occurred while connecting to Gusto',
          variant: 'destructive',
        });

        setTimeout(() => navigate('/integrations'), 3000);
      }
    };

    handleCallback();
  }, [searchParams, navigate, toast]);

  const getIcon = () => {
    switch (status) {
      case 'loading':
        return <Loader2 className="h-12 w-12 animate-spin text-primary" />;
      case 'success':
        return <CheckCircle className="h-12 w-12 text-green-500" />;
      case 'error':
        return <XCircle className="h-12 w-12 text-destructive" />;
    }
  };

  const getTitle = () => {
    switch (status) {
      case 'loading':
        return 'Connecting to Gusto...';
      case 'success':
        return 'Connection Successful!';
      case 'error':
        return 'Connection Failed';
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            {getIcon()}
          </div>
          <CardTitle className="text-xl">{getTitle()}</CardTitle>
          <CardDescription>
            Gusto Payroll Integration
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-muted-foreground mb-4">
            {message}
          </p>
          {status !== 'loading' && (
            <p className="text-xs text-muted-foreground">
              Redirecting...
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GustoCallback;

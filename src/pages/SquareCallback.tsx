import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

const SquareCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing Square connection...');

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      if (error) {
        setStatus('error');
        setMessage(`Square connection failed: ${error}`);
        toast({
          title: "Connection Failed",
          description: "Square authorization was denied or failed",
          variant: "destructive",
        });
        
        // Redirect back to integrations after delay
        setTimeout(() => navigate('/integrations'), 3000);
        return;
      }

      if (!code || !state) {
        setStatus('error');
        setMessage('Missing authorization code or state parameter');
        toast({
          title: "Connection Failed",
          description: "Invalid callback parameters",
          variant: "destructive",
        });
        
        setTimeout(() => navigate('/integrations'), 3000);
        return;
      }

      try {
        // Extract restaurant ID from state parameter
        const restaurantId = state;

        console.log('Square callback processing:', { code, state, restaurantId });

        // Call the square-oauth edge function to exchange code for tokens
        const { data, error: callbackError } = await supabase.functions.invoke('square-oauth', {
          body: {
            action: 'callback',
            code: code,
            restaurantId: restaurantId
          }
        });

        console.log('Edge function response:', { data, error: callbackError });

        if (callbackError) {
          console.error('Edge function error details:', callbackError);
          throw callbackError;
        }

        setStatus('success');
        setMessage('Successfully connected to Square!');
        toast({
          title: "Connection Successful",
          description: "Your Square account has been connected and data sync will begin shortly",
        });

        // Redirect to integrations page after success
        setTimeout(() => navigate('/integrations'), 2000);
        
      } catch (error) {
        console.error('Square callback error:', error);
        setStatus('error');
        setMessage('Failed to complete Square connection');
        toast({
          title: "Connection Failed",
          description: "An error occurred while connecting to Square",
          variant: "destructive",
        });
        
        setTimeout(() => navigate('/integrations'), 3000);
      }
    };

    handleCallback();
  }, [searchParams, navigate, toast]);

  const getIcon = () => {
    switch (status) {
      case 'loading':
        return <Loader2 className="h-12 w-12 animate-spin text-blue-500" />;
      case 'success':
        return <CheckCircle className="h-12 w-12 text-green-500" />;
      case 'error':
        return <XCircle className="h-12 w-12 text-red-500" />;
    }
  };

  const getTitle = () => {
    switch (status) {
      case 'loading':
        return "Connecting to Square...";
      case 'success':
        return "Connection Successful!";
      case 'error':
        return "Connection Failed";
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
            Square Integration Setup
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-muted-foreground mb-4">
            {message}
          </p>
          {status !== 'loading' && (
            <p className="text-xs text-muted-foreground">
              Redirecting to integrations page...
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SquareCallback;
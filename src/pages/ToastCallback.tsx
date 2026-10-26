import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import posthog from 'posthog-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { recordPosIntegrationCompleted } from '@/lib/analytics';
import { describeOAuthCallbackError } from '@/lib/oauthCallbackError';

const ToastCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing Toast connection...');

  useEffect(() => {
    const handleCallback = async () => {
      // Get search params from URL
      const urlSearchParams = new URLSearchParams(window.location.search);
      const code = urlSearchParams.get('code');
      const state = urlSearchParams.get('state'); 
      const error = urlSearchParams.get('error');

      if (error) {
        setStatus('error');
        setMessage(`Toast connection failed: ${error}`);
        toast({
          title: "Connection Failed",
          description: "Toast authorization was denied or failed",
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
        // Call the toast-oauth edge function to exchange code for tokens
        const { error: callbackError } = await supabase.functions.invoke('toast-oauth', {
          body: {
            action: 'callback',
            code: code,
            state: state
          }
        });

        if (callbackError) {
          console.error('Edge function error details:', callbackError);
          throw callbackError;
        }

        setStatus('success');
        setMessage('Successfully connected to Toast!');
        toast({
          title: "Connection Successful",
          description: "Toast connected! You can now sync your data.",
        });

        // Redirect to integrations page after success
        setTimeout(() => navigate('/integrations'), 2000);
        
      } catch (error) {
        console.error('Toast callback error:', error);
        setStatus('error');
        const description = describeOAuthCallbackError(error, 'Toast');
        setMessage(description);
        toast({
          title: "Connection Failed",
          description,
          variant: "destructive",
        });
        
        setTimeout(() => navigate('/integrations'), 3000);
      }
    };

    handleCallback();
  }, [searchParams, navigate, toast]);

  // Fire analytics once both the OAuth exchange succeeded AND user is resolved.
  // useRef guard prevents duplicate sends if the user object identity changes
  // (e.g. background token refresh) while status is still 'success'.
  const analyticsFiredRef = useRef(false);
  useEffect(() => {
    if (status !== 'success' || !user || analyticsFiredRef.current) return;
    analyticsFiredRef.current = true;
    recordPosIntegrationCompleted({
      userId: user.id,
      posProvider: 'toast',
      userCreatedAt: user.created_at,
      posthog,
    });
  }, [status, user]);

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
        return "Connecting to Toast...";
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
            Toast Integration Setup
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

export default ToastCallback;

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function CloverCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connecting to Clover...');

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      if (error) {
        setStatus('error');
        setMessage(`Connection failed: ${error}`);
        toast({
          title: "Connection Failed",
          description: `Unable to connect to Clover: ${error}`,
          variant: "destructive",
        });
        setTimeout(() => navigate('/integrations'), 3000);
        return;
      }

      if (!code || !state) {
        setStatus('error');
        setMessage('Missing authorization data');
        setTimeout(() => navigate('/integrations'), 3000);
        return;
      }

      try {
        setMessage('Exchanging authorization code...');

        const { data, error: callbackError } = await supabase.functions.invoke('clover-oauth', {
          body: {
            action: 'callback',
            code,
            state
          }
        });

        if (callbackError) {
          throw callbackError;
        }

        setStatus('success');
        setMessage('Successfully connected to Clover!');
        
        toast({
          title: "Connection Successful",
          description: "Your Clover account has been connected",
        });

        setTimeout(() => navigate('/integrations'), 2000);
      } catch (error: any) {
        console.error('Clover callback error:', error);
        setStatus('error');
        setMessage(error.message || 'Failed to complete connection');
        
        toast({
          title: "Connection Failed",
          description: error.message || 'Failed to complete Clover connection',
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
        return <Loader2 className="h-12 w-12 animate-spin text-primary" />;
      case 'success':
        return <CheckCircle2 className="h-12 w-12 text-green-600" />;
      case 'error':
        return <XCircle className="h-12 w-12 text-red-600" />;
    }
  };

  const getTitle = () => {
    switch (status) {
      case 'loading':
        return 'Connecting to Clover';
      case 'success':
        return 'Connection Successful';
      case 'error':
        return 'Connection Failed';
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">{getTitle()}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center">
            {getIcon()}
          </div>
          <p className="text-center text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}

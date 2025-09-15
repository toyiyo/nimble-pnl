import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';

interface SSOProviderButtonsProps {
  onSuccess?: () => void;
}

export const SSOProviderButtons = ({ onSuccess }: SSOProviderButtonsProps) => {
  const [loading, setLoading] = useState<string | null>(null);
  const { toast } = useToast();

  const handleOAuthSignIn = async (provider: 'google' | 'github' | 'azure' | 'linkedin_oidc') => {
    setLoading(provider);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        }
      });

      if (error) {
        throw error;
      }

      toast({
        title: "Redirecting...",
        description: `Signing in with ${provider}`,
      });

      onSuccess?.();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-center text-sm text-muted-foreground mb-4">
        Or sign in with your organization's SSO provider:
      </div>
      
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => handleOAuthSignIn('google')}
        disabled={loading === 'google'}
      >
        {loading === 'google' ? 'Redirecting...' : 'Continue with Google'}
      </Button>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => handleOAuthSignIn('github')}
        disabled={loading === 'github'}
      >
        {loading === 'github' ? 'Redirecting...' : 'Continue with GitHub'}
      </Button>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => handleOAuthSignIn('azure')}
        disabled={loading === 'azure'}
      >
        {loading === 'azure' ? 'Redirecting...' : 'Continue with Microsoft'}
      </Button>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => handleOAuthSignIn('linkedin_oidc')}
        disabled={loading === 'linkedin_oidc'}
      >
        {loading === 'linkedin_oidc' ? 'Redirecting...' : 'Continue with LinkedIn'}
      </Button>
    </div>
  );
};
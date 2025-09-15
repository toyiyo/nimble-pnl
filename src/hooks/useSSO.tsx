import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface SSOConfig {
  sso_enabled: boolean;
  sso_provider: string;
  sso_domain: string;
  auto_provisioning: boolean;
  default_role: string;
}

export const useSSO = () => {
  const [ssoConfigs, setSSOConfigs] = useState<SSOConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSSOConfigs();
  }, []);

  const fetchSSOConfigs = async () => {
    try {
      // In a real implementation, this would fetch from enterprise_settings table
      // For now, we'll simulate with a hardcoded config for toyiyo.com
      const mockConfigs: SSOConfig[] = [
        {
          sso_enabled: true,
          sso_provider: 'google',
          sso_domain: 'toyiyo.com',
          auto_provisioning: true,
          default_role: 'staff',
        }
      ];
      setSSOConfigs(mockConfigs);
    } catch (error) {
      console.error('Error fetching SSO configs:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkSSORequired = (email: string): SSOConfig | null => {
    if (!email) return null;
    
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return null;

    return ssoConfigs.find(config => 
      config.sso_enabled && config.sso_domain.toLowerCase() === domain
    ) || null;
  };

  const initiateSSO = async (email: string, provider: string) => {
    try {
      console.log(`Initiating SSO for ${email} with provider ${provider}`);
      
      // Use Supabase's built-in OAuth providers
      let oauthProvider: any;
      
      switch (provider.toLowerCase()) {
        case 'google':
          oauthProvider = 'google';
          break;
        case 'microsoft':
        case 'azure':
          oauthProvider = 'azure';
          break;
        case 'github':
          oauthProvider = 'github';
          break;
        case 'linkedin':
          oauthProvider = 'linkedin_oidc';
          break;
        case 'saml':
        case 'oauth':
        case 'oidc':
        default:
          // For generic SAML/OIDC, we'll use Google as an example
          // In production, you'd configure custom OIDC providers in Supabase
          oauthProvider = 'google';
          break;
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: oauthProvider,
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

      return {
        success: true,
        message: `Redirecting to ${provider.toUpperCase()} authentication`,
        data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  };

  return {
    checkSSORequired,
    initiateSSO,
    loading,
  };
};
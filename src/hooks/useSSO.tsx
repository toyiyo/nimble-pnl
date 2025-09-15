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
          sso_provider: 'saml',
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
      
      // For SAML/OIDC providers, you would redirect to the identity provider
      // For now, we'll show an informative message
      const domain = email.split('@')[1];
      const redirectUrl = `https://sso.${domain}/auth/saml/login?email=${encodeURIComponent(email)}`;
      
      // In a real implementation, you would:
      // window.location.href = redirectUrl;
      
      return {
        success: true,
        redirectUrl,
        message: `Redirecting to ${provider.toUpperCase()} authentication for ${domain}`,
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
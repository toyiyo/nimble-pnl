import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService, logSecurityEvent } from "../_shared/encryption.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EnterpriseConfig {
  scim_enabled: boolean;
  scim_endpoint: string;
  scim_token: string;
  sso_enabled: boolean;
  sso_provider: string;
  sso_domain: string;
  auto_provisioning: boolean;
  default_role: string;
}

interface RequestBody {
  restaurantId: string;
  config: EnterpriseConfig;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get the authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Set auth for supabase client
    const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !userData.user) {
      throw new Error('Invalid authentication token');
    }

    const { restaurantId, config }: RequestBody = await req.json();

    if (!restaurantId || !config) {
      throw new Error('Missing restaurantId or config');
    }

    // Verify user is owner of the restaurant
    const { data: ownership, error: ownershipError } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('restaurant_id', restaurantId)
      .eq('user_id', userData.user.id)
      .eq('role', 'owner')
      .single();

    if (ownershipError || !ownership) {
      throw new Error('Unauthorized: Only restaurant owners can update enterprise settings');
    }

    console.log('Updating enterprise settings for restaurant:', restaurantId);
    
    // Get encryption service for sensitive data
    const encryptionService = getEncryptionService();
    
    // Encrypt SCIM token if provided
    let encryptedScimToken = config.scim_token;
    if (config.scim_token && config.scim_token.trim() !== '') {
      encryptedScimToken = await encryptionService.encrypt(config.scim_token);
    }

    // Save enterprise settings to database
    const { data: existingSettings } = await supabase
      .from('enterprise_settings')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .single();

    let settings;
    if (existingSettings) {
      // Update existing settings
      const { data, error: updateError } = await supabase
        .from('enterprise_settings')
        .update({
          scim_enabled: config.scim_enabled,
          scim_endpoint: config.scim_endpoint,
          scim_token: encryptedScimToken,
          sso_enabled: config.sso_enabled,
          sso_provider: config.sso_provider,
          sso_domain: config.sso_domain,
          auto_provisioning: config.auto_provisioning,
          default_role: config.default_role,
        })
        .eq('restaurant_id', restaurantId)
        .select()
        .single();

      if (updateError) throw updateError;
      settings = data;
    } else {
      // Create new settings
      const { data, error: insertError } = await supabase
        .from('enterprise_settings')
        .insert({
          restaurant_id: restaurantId,
          scim_enabled: config.scim_enabled,
          scim_endpoint: config.scim_endpoint,
          scim_token: encryptedScimToken,
          sso_enabled: config.sso_enabled,
          sso_provider: config.sso_provider,
          sso_domain: config.sso_domain,
          auto_provisioning: config.auto_provisioning,
          default_role: config.default_role,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      settings = data;
    }

    console.log('Enterprise settings saved for restaurant:', restaurantId);

    // Log security event for audit trail
    await logSecurityEvent(
      supabase,
      'enterprise_settings_updated',
      userData.user.id,
      restaurantId,
      {
        scim_enabled: config.scim_enabled,
        sso_enabled: config.sso_enabled,
        auto_provisioning: config.auto_provisioning,
        sso_provider: config.sso_provider,
        sso_domain: config.sso_domain
      }
    );

    // Return settings without sensitive data
    const sanitizedSettings = {
      ...settings,
      scim_token: settings?.scim_token ? '[ENCRYPTED]' : null
    };

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Enterprise settings updated successfully',
        settings: sanitizedSettings 
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error('Error updating enterprise settings:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        success: false 
      }),
      {
        status: 500,
        headers: { 
          'Content-Type': 'application/json', 
          ...corsHeaders 
        },
      }
    );
  }
};

serve(handler);
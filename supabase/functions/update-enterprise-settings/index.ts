import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    supabase.auth.setSession({
      access_token: authHeader.replace('Bearer ', ''),
      refresh_token: '',
    });

    const { restaurantId, config }: RequestBody = await req.json();

    if (!restaurantId || !config) {
      throw new Error('Missing restaurantId or config');
    }

    console.log('Updating enterprise settings for restaurant:', restaurantId);
    console.log('Config:', config);

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
          scim_token: config.scim_token,
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
          scim_token: config.scim_token,
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

    console.log('Enterprise settings saved:', settings);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Enterprise settings updated successfully',
        settings 
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
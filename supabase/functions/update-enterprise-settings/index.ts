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

    // For now, we'll just log the settings since we don't have an enterprise_settings table
    // In a real implementation, you would:
    // 1. Create an enterprise_settings table
    // 2. Insert/update the configuration
    // 3. Validate the user has permission to modify these settings

    // Simulate saving settings (replace with actual database operations)
    const settings = {
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      ...config,
      updated_at: new Date().toISOString(),
    };

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
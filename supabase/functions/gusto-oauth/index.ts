// Gusto OAuth Edge Function
// Handles OAuth flow for connecting restaurants to Gusto Embedded Payroll

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  getGustoConfig,
  exchangeCodeForToken,
  encryptTokens,
  GustoClient,
} from '../_shared/gustoClient.ts';
import { logSecurityEvent } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GustoOAuthRequest {
  action: 'authorize' | 'callback' | 'create-company';
  restaurantId?: string;
  code?: string;
  state?: string;
  // For create-company action
  companyName?: string;
  adminFirstName?: string;
  adminLastName?: string;
  adminEmail?: string;
  ein?: string;
  contractorOnly?: boolean;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    console.log('[GUSTO-OAUTH] Supabase config:', {
      hasUrl: !!supabaseUrl,
      urlStart: supabaseUrl?.substring(0, 30),
      hasServiceKey: !!serviceRoleKey,
      keyLength: serviceRoleKey?.length,
    });

    const supabase = createClient(
      supabaseUrl ?? '',
      serviceRoleKey ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const body: GustoOAuthRequest = await req.json();
    const { action, restaurantId, code, state } = body;

    // Get origin for environment detection
    const origin = req.headers.get('origin') || req.headers.get('referer')?.split('/').slice(0, 3).join('/');

    // Get Gusto configuration based on environment
    const gustoConfig = getGustoConfig(origin || undefined);

    console.log('[GUSTO-OAUTH] Action:', action, 'Environment:', gustoConfig.environment);

    if (action === 'authorize') {
      // ====================================================================
      // AUTHORIZE: Generate OAuth URL and redirect user to Gusto
      // ====================================================================

      if (!restaurantId) {
        throw new Error('Restaurant ID is required for authorization');
      }

      // Verify user authentication
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        throw new Error('No authorization header');
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        throw new Error('Invalid authentication');
      }

      // Verify user has access to this restaurant (owner or manager)
      const { data: userRestaurant, error: accessError } = await supabase
        .from('user_restaurants')
        .select('role')
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId)
        .in('role', ['owner', 'manager'])
        .single();

      if (accessError || !userRestaurant) {
        throw new Error('Access denied to restaurant');
      }

      // Check if already connected
      const { data: existingConnection } = await supabase
        .from('gusto_connections')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (existingConnection) {
        throw new Error('Restaurant is already connected to Gusto. Please disconnect first.');
      }

      // Generate authorization URL with required scopes
      // Scopes for Embedded Payroll (Partner Managed Companies)
      const scopes = [
        'companies:read',
        'companies:write',
        'employees:read',
        'employees:write',
        'payrolls:read',
        'payrolls:write',
        'contractors:read',
        'contractors:write',
        'time_activities:read',
        'time_activities:write',
        'company_benefits:read',
        'company_benefits:write',
        'employee_benefits:read',
        'employee_benefits:write',
        'flows:write',
      ].join(' ');

      const authUrl = new URL(`${gustoConfig.baseUrl}/oauth/authorize`);
      authUrl.searchParams.set('client_id', gustoConfig.clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', gustoConfig.redirectUri);
      authUrl.searchParams.set('scope', scopes);
      authUrl.searchParams.set('state', restaurantId); // Pass restaurant ID in state

      console.log('[GUSTO-OAUTH] Generated auth URL for restaurant:', restaurantId);
      console.log('[GUSTO-OAUTH] Redirect URI:', gustoConfig.redirectUri);

      // Log security event
      await logSecurityEvent(supabase, 'GUSTO_OAUTH_INITIATED', user.id, restaurantId, {
        environment: gustoConfig.environment,
      });

      return new Response(JSON.stringify({
        authorizationUrl: authUrl.toString(),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'callback') {
      // ====================================================================
      // CALLBACK: Exchange code for token and store connection
      // ====================================================================

      if (!code || !state) {
        console.error('[GUSTO-OAUTH] Missing callback parameters:', { code: !!code, state: !!state });
        throw new Error('Missing authorization code or state');
      }

      const restaurantIdFromState = state;
      console.log('[GUSTO-OAUTH] Processing callback for restaurant:', restaurantIdFromState);

      // Exchange authorization code for access token
      const tokenData = await exchangeCodeForToken(code, gustoConfig);
      console.log('[GUSTO-OAUTH] Token exchange successful');

      // Encrypt tokens before storage
      const { encryptedAccessToken, encryptedRefreshToken } = await encryptTokens(tokenData);

      // Create Gusto client to get company info
      const gustoClient = new GustoClient(tokenData.access_token, gustoConfig.baseUrl);

      // Get the current user's company info
      // For embedded payroll, we need to get the company UUID from the token response
      // or make a call to get companies the user has access to
      let companyUuid: string;
      let companyName: string | null = null;

      try {
        // Try to get companies - the token should give us access to one company
        const meResponse = await fetch(`${gustoConfig.baseUrl}/v1/me`, {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json',
          },
        });

        if (meResponse.ok) {
          const meData = await meResponse.json();
          console.log('[GUSTO-OAUTH] Me response:', JSON.stringify(meData, null, 2));

          // The /v1/me endpoint returns current user info including roles
          // For partner managed companies, we need to use the company from roles
          if (meData.roles && meData.roles.length > 0) {
            // Find the first company role
            for (const role of meData.roles) {
              if (role.companies && role.companies.length > 0) {
                const company = role.companies[0];
                companyUuid = company.uuid;
                companyName = company.name || null;
                break;
              }
            }
          }
        }

        // If we didn't get company from /me, try alternative approach
        if (!companyUuid) {
          // For embedded payroll, the company UUID might be in the token scope
          // or we need to create a partner-managed company
          console.log('[GUSTO-OAUTH] Could not get company from /me endpoint');
          throw new Error('Could not determine Gusto company. Please ensure your Gusto account has a company set up.');
        }

        // Get full company details
        const company = await gustoClient.getCompany(companyUuid);
        companyName = company.name;

        console.log('[GUSTO-OAUTH] Company retrieved:', companyUuid, companyName);
      } catch (error) {
        console.error('[GUSTO-OAUTH] Error getting company info:', error);
        throw new Error('Failed to retrieve Gusto company information');
      }

      // Calculate token expiration
      const expiresAt = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null;

      // Store the connection
      const connectionData = {
        restaurant_id: restaurantIdFromState,
        company_uuid: companyUuid,
        company_name: companyName,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        scopes: tokenData.scope?.split(' ') || [],
        token_type: tokenData.token_type || 'Bearer',
        connected_at: new Date().toISOString(),
        expires_at: expiresAt,
        onboarding_status: 'pending',
      };

      const { error: connectionError } = await supabase
        .from('gusto_connections')
        .upsert(connectionData, {
          onConflict: 'restaurant_id',
        })
        .select()
        .single();

      if (connectionError) {
        console.error('[GUSTO-OAUTH] Error storing connection:', connectionError);
        throw new Error(`Failed to store connection: ${connectionError.message}`);
      }

      // Log security event
      await logSecurityEvent(supabase, 'GUSTO_OAUTH_TOKEN_STORED', undefined, restaurantIdFromState, {
        companyUuid,
        environment: gustoConfig.environment,
        scopes: tokenData.scope?.split(' ') || [],
      });

      console.log('[GUSTO-OAUTH] Connection stored successfully for restaurant:', restaurantIdFromState);

      return new Response(JSON.stringify({
        success: true,
        message: 'Gusto connection established successfully',
        companyUuid,
        companyName,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'create-company') {
      // ====================================================================
      // CREATE-COMPANY: Create a Partner Managed Company (users stay in-app)
      // This is the proper Embedded Payroll flow - no OAuth redirect needed
      // ====================================================================

      const { restaurantId, companyName, adminFirstName, adminLastName, adminEmail, ein, contractorOnly } = body;

      if (!restaurantId || !companyName || !adminFirstName || !adminLastName || !adminEmail) {
        throw new Error('Missing required fields: restaurantId, companyName, adminFirstName, adminLastName, adminEmail');
      }

      // Verify user authentication
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        throw new Error('No authorization header');
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        throw new Error('Invalid authentication');
      }

      console.log('[GUSTO-OAUTH] Creating partner managed company:', {
        restaurantId,
        companyName,
        adminEmail,
        userId: user.id,
      });

      // Check if already connected
      const { data: existingConnection } = await supabase
        .from('gusto_connections')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (existingConnection) {
        throw new Error('Restaurant is already connected to Gusto. Please disconnect first.');
      }

      // Step 1: Get System Access Token
      console.log('[GUSTO-OAUTH] Getting system access token...');
      const systemTokenResponse = await fetch(`${gustoConfig.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: gustoConfig.clientId,
          client_secret: gustoConfig.clientSecret,
          grant_type: 'system_access',
        }),
      });

      if (!systemTokenResponse.ok) {
        const errorText = await systemTokenResponse.text();
        console.error('[GUSTO-OAUTH] System token error:', errorText);
        throw new Error(`Failed to get system access token: ${errorText}`);
      }

      const systemTokenData = await systemTokenResponse.json();
      console.log('[GUSTO-OAUTH] System token obtained');

      // Step 2: Create Partner Managed Company
      console.log('[GUSTO-OAUTH] Creating partner managed company...');
      const createCompanyResponse = await fetch(`${gustoConfig.baseUrl}/v1/partner_managed_companies`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${systemTokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user: {
            first_name: adminFirstName,
            last_name: adminLastName,
            email: adminEmail,
          },
          company: {
            name: companyName,
            ...(ein && { ein }),
            ...(contractorOnly !== undefined && { contractor_only: contractorOnly }),
          },
        }),
      });

      if (!createCompanyResponse.ok) {
        const errorText = await createCompanyResponse.text();
        console.error('[GUSTO-OAUTH] Create company error:', errorText);

        // Parse Gusto's structured error response for user-friendly messages
        try {
          const errorJson = JSON.parse(errorText);
          const errors = errorJson.errors || [];
          const einError = errors.find((e: { error_key?: string }) => e.error_key === 'ein');
          if (einError) {
            throw new Error(
              'A company with this EIN is already registered in Gusto. ' +
              'If you previously started setup, please contact support to link your existing Gusto account.'
            );
          }
          const emailError = errors.find((e: { error_key?: string }) => e.error_key === 'email');
          if (emailError) {
            throw new Error(
              'This email address is already associated with a Gusto account. ' +
              'Please use a different admin email or connect using the OAuth flow instead.'
            );
          }
          // Surface the first error message if available
          if (errors.length > 0 && errors[0].message) {
            throw new Error(errors[0].message);
          }
        } catch (parseErr) {
          // If it's already one of our custom errors, re-throw it
          if (parseErr instanceof Error && !parseErr.message.startsWith('Unexpected')) {
            throw parseErr;
          }
        }
        throw new Error('Failed to create company in Gusto. Please try again or contact support.');
      }

      const companyData = await createCompanyResponse.json();
      console.log('[GUSTO-OAUTH] Partner managed company created:', companyData.company_uuid);

      // Encrypt tokens before storage
      const { encryptedAccessToken, encryptedRefreshToken } = await encryptTokens({
        access_token: companyData.access_token,
        refresh_token: companyData.refresh_token,
        expires_in: companyData.expires_in || 7200,
        token_type: 'Bearer',
      });

      // Calculate token expiration
      const expiresAt = new Date(Date.now() + (companyData.expires_in || 7200) * 1000).toISOString();

      // Store the connection
      const connectionData = {
        restaurant_id: restaurantId,
        company_uuid: companyData.company_uuid,
        company_name: companyName,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        scopes: ['companies:write', 'employees:write', 'payrolls:write'], // Partner managed has full access
        token_type: 'Bearer',
        connected_at: new Date().toISOString(),
        expires_at: expiresAt,
        onboarding_status: 'pending',
      };

      // Use direct REST API call
      const restUrl = supabaseUrl;

      console.log('[GUSTO-OAUTH] Using REST URL:', restUrl);
      console.log('[GUSTO-OAUTH] Service role key available:', !!serviceRoleKey);

      const insertResponse = await fetch(`${restUrl}/rest/v1/gusto_connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceRoleKey!,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(connectionData),
      });

      if (!insertResponse.ok) {
        const errorText = await insertResponse.text();
        console.error('[GUSTO-OAUTH] Error storing connection:', errorText);
        throw new Error(`Failed to store connection: ${errorText}`);
      }

      const insertedConnection = await insertResponse.json();
      console.log('[GUSTO-OAUTH] Connection stored:', insertedConnection);

      // Log security event
      await logSecurityEvent(supabase, 'GUSTO_COMPANY_CREATED', user.id, restaurantId, {
        companyUuid: companyData.company_uuid,
        environment: gustoConfig.environment,
        adminEmail,
      });

      console.log('[GUSTO-OAUTH] Partner managed company created and stored for restaurant:', restaurantId);

      return new Response(JSON.stringify({
        success: true,
        message: 'Gusto company created successfully',
        companyUuid: companyData.company_uuid,
        companyName,
        // User should now complete onboarding via Flows
        nextStep: 'company_onboarding',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Invalid action');

  } catch (error: unknown) {
    console.error('[GUSTO-OAUTH] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    return new Response(JSON.stringify({
      error: errorMessage,
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

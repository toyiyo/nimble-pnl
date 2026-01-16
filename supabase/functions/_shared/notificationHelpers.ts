/**
 * Notification Helper Functions
 * 
 * Shared utilities for managing notifications across all edge functions
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Get all managers for a restaurant
 */
export const getManagerEmails = async (
  supabase: SupabaseClient,
  restaurantId: string
): Promise<string[]> => {
  const { data: managers, error } = await supabase
    .from('user_restaurants')
    .select(`
      user_id,
      profiles:user_id (
        email
      )
    `)
    .eq('restaurant_id', restaurantId)
    .in('role', ['owner', 'manager']);

  if (error || !managers) {
    console.error('Error fetching managers:', error);
    return [];
  }

  const emails: string[] = [];
  managers.forEach((manager: any) => {
    if (manager.profiles?.email) {
      emails.push(manager.profiles.email);
    }
  });

  return [...new Set(emails)]; // Remove duplicates
};

/**
 * Get employee email by ID
 */
export const getEmployeeEmail = async (
  supabase: SupabaseClient,
  employeeId: string
): Promise<string | null> => {
  const { data: employee, error } = await supabase
    .from('employees')
    .select('email')
    .eq('id', employeeId)
    .single();

  if (error || !employee) {
    console.error('Error fetching employee:', error);
    return null;
  }

  return employee.email || null;
};

/**
 * Get multiple employee emails by IDs
 */
export const getEmployeeEmails = async (
  supabase: SupabaseClient,
  employeeIds: string[]
): Promise<string[]> => {
  if (employeeIds.length === 0) return [];

  const { data: employees, error } = await supabase
    .from('employees')
    .select('email')
    .in('id', employeeIds);

  if (error || !employees) {
    console.error('Error fetching employees:', error);
    return [];
  }

  return employees
    .map((emp: any) => emp.email)
    .filter((email: string | null) => email !== null);
};

/**
 * Get all active employee emails for a restaurant
 */
export const getAllActiveEmployeeEmails = async (
  supabase: SupabaseClient,
  restaurantId: string
): Promise<string[]> => {
  const { data: employees, error } = await supabase
    .from('employees')
    .select('email')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true);

  if (error || !employees) {
    console.error('Error fetching employees:', error);
    return [];
  }

  return employees
    .map((emp: any) => emp.email)
    .filter((email: string | null) => email !== null);
};

/**
 * Get restaurant name by ID
 */
export const getRestaurantName = async (
  supabase: SupabaseClient,
  restaurantId: string
): Promise<string> => {
  const { data: restaurant, error } = await supabase
    .from('restaurants')
    .select('name')
    .eq('id', restaurantId)
    .single();

  if (error || !restaurant) {
    console.error('Error fetching restaurant:', error);
    return 'Your Restaurant';
  }

  return restaurant.name;
};

/**
 * Check notification settings for a restaurant
 * Returns true if notification should be sent
 */
export const shouldSendNotification = async (
  supabase: SupabaseClient,
  restaurantId: string,
  settingKey: string
): Promise<boolean> => {
  const { data: settings, error } = await supabase
    .from('notification_settings')
    .select(settingKey)
    .eq('restaurant_id', restaurantId)
    .single();

  if (error) {
    // If no settings found, default to true (send notification)
    console.log('No notification settings found, defaulting to enabled');
    return true;
  }

  return (settings as unknown as Record<string, boolean>)?.[settingKey] !== false;
};

/**
 * Send email using Resend
 * Returns true if successful
 */
export const sendEmail = async (
  resendApiKey: string,
  from: string,
  to: string | string[],
  subject: string,
  html: string
): Promise<boolean> => {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to send email:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};

/**
 * Standard email sender address
 */
export const NOTIFICATION_FROM = "EasyShiftHQ <notifications@easyshifthq.com>";

/**
 * Standard app URL
 */
export const APP_URL = "https://app.easyshifthq.com";

/**
 * Verify user has permission for restaurant
 * Throws error if unauthorized
 */
export const verifyRestaurantPermission = async (
  supabase: SupabaseClient,
  userId: string,
  restaurantId: string,
  requiredRoles: string[] = ['owner', 'manager']
): Promise<void> => {
  const { data: userRestaurant, error } = await supabase
    .from('user_restaurants')
    .select('role')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)
    .single();

  if (error || !userRestaurant || !requiredRoles.includes(userRestaurant.role)) {
    throw new Error('Access denied');
  }
};

/**
 * Create standard CORS headers
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Handle CORS preflight request
 */
export const handleCorsPreflightRequest = (): Response => {
  return new Response(null, { headers: corsHeaders });
};

/**
 * Create authenticated Supabase client
 */
export const createAuthenticatedClient = (authHeader: string | null) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL environment variable is not configured');
  }
  
  if (!supabaseKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not configured');
  }
  
  return createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
};

/**
 * Authenticate and get user from request
 */
export const authenticateRequest = async (
  req: Request
): Promise<{ user: any; supabase: SupabaseClient }> => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new Error('Missing authorization header');
  }

  const supabase = createAuthenticatedClient(authHeader);
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Unauthorized');
  }

  return { user, supabase };
};

/**
 * Standard error response
 */
export const errorResponse = (message: string, status: number = 500): Response => {
  return new Response(
    JSON.stringify({ error: message, success: false }),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
};

/**
 * Standard success response
 */
export const successResponse = (data: any): Response => {
  return new Response(
    JSON.stringify({ ...data, success: true }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
};

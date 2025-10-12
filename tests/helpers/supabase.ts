import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export function getTestSupabaseClient() {
  const url = process.env.SUPABASE_URL || 'http://localhost:54321';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  
  if (!anonKey) {
    throw new Error('SUPABASE_ANON_KEY environment variable is required');
  }
  
  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false, // Don't persist in tests
      autoRefreshToken: false,
    }
  });
}

export function getAdminSupabaseClient() {
  const url = process.env.SUPABASE_URL || 'http://localhost:54321';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  }
  
  return createClient<Database>(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  });
}

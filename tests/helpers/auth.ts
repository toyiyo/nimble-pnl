import { getAdminSupabaseClient } from './supabase';

export async function createTestUser(email: string, password: string, fullName: string) {
  const admin = getAdminSupabaseClient();
  
  // Create auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName }
  });
  
  if (authError) throw authError;
  
  // Create profile
  const { error: profileError } = await admin
    .from('profiles')
    .insert({
      user_id: authData.user.id,
      email,
      full_name: fullName
    });
  
  if (profileError) throw profileError;
  
  return authData.user;
}

export async function createTestRestaurant(userId: string, name: string) {
  const admin = getAdminSupabaseClient();
  
  // Use your existing function
  const { data, error } = await admin.rpc('create_restaurant_with_owner', {
    restaurant_name: name,
    restaurant_timezone: 'America/Chicago'
  });
  
  if (error) throw error;
  return data; // restaurant_id
}

export async function cleanupTestUser(userId: string) {
  const admin = getAdminSupabaseClient();
  await admin.auth.admin.deleteUser(userId);
}

export async function loginTestUser(email: string, password: string) {
  const admin = getAdminSupabaseClient();
  
  const { data, error } = await admin.auth.signInWithPassword({
    email,
    password
  });
  
  if (error) throw error;
  return data;
}

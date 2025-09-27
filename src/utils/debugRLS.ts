import { supabase } from '@/integrations/supabase/client';

export const debugRecipeCreationRLS = async (restaurantId: string) => {
  try {
    // Check current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('❌ No authenticated user');
      return;
    }

    console.log('✅ User authenticated:', user.id);

    // Check user-restaurant relationship
    const { data: userRestaurant, error } = await supabase
      .from('user_restaurants')
      .select('*')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .single();

    if (error) {
      console.log('❌ User not associated with restaurant:', error.message);
      console.log('🔧 Fix: Add user to restaurant with proper role (owner/manager/chef)');
      return;
    }

    console.log('✅ User restaurant relationship:', userRestaurant);

    // Check if role is sufficient
    const validRoles = ['owner', 'manager', 'chef'];
    if (!validRoles.includes(userRestaurant.role)) {
      console.log('❌ Insufficient role:', userRestaurant.role);
      console.log('🔧 Fix: User needs owner, manager, or chef role');
      return;
    }

    console.log('✅ User has valid role for recipe creation');

  } catch (error: any) {
    console.error('Debug error:', error);
  }
};
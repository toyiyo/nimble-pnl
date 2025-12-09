// ⚠️ DEPRECATED: DO NOT USE - This Edge Function is no longer called
// 
// CONTEXT: This was a cron job to maintain daily_labor_allocations aggregation table.
// This pattern has proven problematic (data sync issues, stale data).
// 
// NEW PATTERN: Calculate labor costs on-demand from source tables
// ✅ Use: useLaborCostsFromTimeTracking (src/hooks/useLaborCostsFromTimeTracking.tsx)
// ✅ Pattern: Query time_punches + employees + per-job allocations directly
// 
// See: src/hooks/useLaborCostsFromTimeTracking.tsx for the new approach
// See: src/hooks/usePayroll.tsx for the pattern we're following
// See: docs/INTEGRATIONS.md for data flow architecture
//
// This function remains for backwards compatibility but should not be called.
// The cron job in migration 20251208210000_auto_generate_labor_allocations.sql is disabled.
//
// @deprecated Use useLaborCostsFromTimeTracking instead
//
// Edge Function: Generate Daily Labor Allocations (Cron Job)
// Runs daily at 2 AM to ensure salary/contractor allocations exist
// Schedule: "0 2 * * *" (daily at 2 AM)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AllocationResult {
  restaurant_id: string;
  restaurant_name: string;
  date: string;
  allocations_created: number;
  success: boolean;
  error?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase client with service role (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Get today's date
    const today = new Date().toISOString().split('T')[0];
    
    console.log(`[${new Date().toISOString()}] Starting daily labor allocation generation for ${today}`);

    // Get all active restaurants
    const { data: restaurants, error: restaurantsError } = await supabaseAdmin
      .from('restaurants')
      .select('id, name')
      .order('name');

    if (restaurantsError) {
      throw new Error(`Failed to fetch restaurants: ${restaurantsError.message}`);
    }

    if (!restaurants || restaurants.length === 0) {
      console.log('No restaurants found');
      return new Response(
        JSON.stringify({ message: 'No restaurants found', results: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing ${restaurants.length} restaurant(s)`);

    // Process each restaurant
    const results: AllocationResult[] = [];
    
    for (const restaurant of restaurants) {
      try {
        console.log(`Processing restaurant: ${restaurant.name} (${restaurant.id})`);

        // Call the SQL function to generate allocations for today
        const { data, error } = await supabaseAdmin.rpc(
          'ensure_labor_allocations_for_date',
          {
            p_restaurant_id: restaurant.id,
            p_date: today
          }
        );

        if (error) {
          console.error(`Error for ${restaurant.name}:`, error);
          results.push({
            restaurant_id: restaurant.id,
            restaurant_name: restaurant.name,
            date: today,
            allocations_created: 0,
            success: false,
            error: error.message
          });
          continue;
        }

        const count = data || 0;
        console.log(`✓ Created ${count} allocation(s) for ${restaurant.name}`);

        results.push({
          restaurant_id: restaurant.id,
          restaurant_name: restaurant.name,
          date: today,
          allocations_created: count,
          success: true
        });

      } catch (restaurantError) {
        console.error(`Failed to process restaurant ${restaurant.name}:`, restaurantError);
        results.push({
          restaurant_id: restaurant.id,
          restaurant_name: restaurant.name,
          date: today,
          allocations_created: 0,
          success: false,
          error: restaurantError instanceof Error ? restaurantError.message : 'Unknown error'
        });
      }
    }

    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalAllocations = results.reduce((sum, r) => sum + r.allocations_created, 0);

    console.log(`\n=== Summary ===`);
    console.log(`Date: ${today}`);
    console.log(`Restaurants processed: ${restaurants.length}`);
    console.log(`Successful: ${successful}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total allocations created: ${totalAllocations}`);

    return new Response(
      JSON.stringify({
        success: true,
        date: today,
        summary: {
          total_restaurants: restaurants.length,
          successful,
          failed,
          total_allocations: totalAllocations
        },
        results
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('Fatal error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

/* Schedule this function as a cron job:
 *
 * In Supabase Dashboard → Edge Functions → select this function → Add Schedule:
 * 
 * Schedule: 0 2 * * *
 * Description: Generate daily labor allocations at 2 AM
 * 
 * This ensures that:
 * 1. Allocations are created automatically every day
 * 2. No manual intervention required
 * 3. Payroll data is always up-to-date
 * 4. Dashboard shows accurate labor costs
 * 
 * The function generates allocations for TODAY, respecting:
 * - Employee hire dates (no allocations before hire)
 * - Employee termination dates (no allocations after termination)
 * - Employment type (salary/contractor only, not hourly or per-job)
 */

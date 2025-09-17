import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting periodic Square sync for all connected restaurants');

    // Get all active Square connections
    const { data: connections, error: connectionsError } = await supabase
      .from('square_connections')
      .select('restaurant_id, merchant_id, connected_at')
      .order('connected_at', { ascending: false });

    if (connectionsError) {
      throw new Error(`Failed to fetch connections: ${connectionsError.message}`);
    }

    if (!connections || connections.length === 0) {
      console.log('No Square connections found');
      return new Response(JSON.stringify({
        success: true,
        message: 'No Square connections to sync',
        synced: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${connections.length} Square connections to sync`);

    const results = {
      total: connections.length,
      synced: 0,
      errors: [] as string[]
    };

    // Sync each restaurant
    for (const connection of connections) {
      try {
        console.log(`Syncing restaurant: ${connection.restaurant_id}`);

        // Call the square-sync-data function for daily sync
        const { data, error } = await supabase.functions.invoke('square-sync-data', {
          body: {
            restaurantId: connection.restaurant_id,
            action: 'daily_sync'
          }
        });

        if (error) {
          throw new Error(`Sync failed for ${connection.restaurant_id}: ${error.message}`);
        }

        if (data?.results) {
          const totalSynced = data.results.ordersSynced + data.results.paymentsSynced + 
                             data.results.refundsSynced + data.results.shiftsSynced;
          console.log(`Successfully synced ${totalSynced} records for restaurant ${connection.restaurant_id}`);
        }

        results.synced++;
        
        // Add a small delay between restaurants to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error: any) {
        console.error(`Error syncing restaurant ${connection.restaurant_id}:`, error);
        results.errors.push(`${connection.restaurant_id}: ${error.message}`);
      }
    }

    console.log('Periodic sync completed:', results);

    return new Response(JSON.stringify({
      success: true,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Periodic sync error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
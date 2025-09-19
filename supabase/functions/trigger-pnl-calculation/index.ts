import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CalculatePnLRequest {
  restaurant_id: string
  date: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { restaurant_id, date }: CalculatePnLRequest = await req.json()

    console.log(`Calculating P&L for restaurant ${restaurant_id} on ${date}`)

    // Call the Square P&L calculation function
    const { data, error } = await supabase.rpc('calculate_square_daily_pnl', {
      p_restaurant_id: restaurant_id,
      p_service_date: date
    })

    if (error) {
      console.error('Error calculating P&L:', error)
      return new Response(
        JSON.stringify({ error: error.message }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log(`P&L calculation completed successfully for ${date}`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        pnl_id: data,
        restaurant_id,
        date 
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
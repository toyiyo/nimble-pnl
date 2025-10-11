import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RecalculatePnLRequest {
  restaurant_id?: string  // Optional: specific restaurant, or all if not provided
  start_date?: string     // Optional: date range
  end_date?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { restaurant_id, start_date, end_date }: RecalculatePnLRequest = await req.json()

    console.log('Starting bulk P&L recalculation', { restaurant_id, start_date, end_date })

    // Get all unique restaurant/date combinations that have source data
    let query = supabase
      .from('daily_sales')
      .select('restaurant_id, date')

    if (restaurant_id) {
      query = query.eq('restaurant_id', restaurant_id)
    }
    if (start_date) {
      query = query.gte('date', start_date)
    }
    if (end_date) {
      query = query.lte('date', end_date)
    }

    const { data: salesDates, error: salesError } = await query

    if (salesError) {
      throw salesError
    }

    // Get unique combinations
    const uniqueCombinations = new Map<string, { restaurant_id: string; date: string }>()
    salesDates?.forEach(item => {
      const key = `${item.restaurant_id}-${item.date}`
      uniqueCombinations.set(key, item)
    })

    console.log(`Found ${uniqueCombinations.size} restaurant/date combinations to recalculate`)

    const results = {
      total: uniqueCombinations.size,
      success: 0,
      failed: 0,
      errors: [] as Array<{ restaurant_id: string; date: string; error: string }>
    }

    // Process in batches with concurrency limit to avoid timeouts
    const batch = Array.from(uniqueCombinations.values())
    const CHUNK_SIZE = 10
    
    // Split into chunks for concurrent processing
    for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
      const chunk = batch.slice(i, i + CHUNK_SIZE)
      
      // Process chunk concurrently
      const chunkPromises = chunk.map(item => 
        supabase.rpc('calculate_daily_pnl', {
          p_restaurant_id: item.restaurant_id,
          p_date: item.date
        }).then(result => ({ item, result }))
      )
      
      const settledResults = await Promise.allSettled(chunkPromises)
      
      // Process results
      for (const settled of settledResults) {
        if (settled.status === 'rejected') {
          results.failed++
          results.errors.push({
            restaurant_id: 'unknown',
            date: 'unknown',
            error: settled.reason?.message || String(settled.reason)
          })
        } else {
          const { item, result } = settled.value
          if (result.error) {
            results.failed++
            results.errors.push({
              restaurant_id: item.restaurant_id,
              date: item.date,
              error: result.error.message
            })
            console.error(`Failed to calculate P&L for ${item.restaurant_id} on ${item.date}:`, result.error)
          } else {
            results.success++
            if (results.success % 10 === 0) {
              console.log(`Progress: ${results.success}/${results.total} completed`)
            }
          }
        }
      }
    }

    console.log('Bulk P&L recalculation completed', results)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Recalculated P&L for ${results.success} records`,
        ...results
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Bulk recalculation error:', error)
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

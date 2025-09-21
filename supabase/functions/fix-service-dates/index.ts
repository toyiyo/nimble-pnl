import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FixServiceDatesRequest {
  restaurantId: string;
}

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

    const body: FixServiceDatesRequest = await req.json();
    const { restaurantId } = body;

    console.log('Fixing service dates for restaurant:', restaurantId);

    // Get restaurant timezone from square_locations
    const { data: location, error: locationError } = await supabase
      .from('square_locations')
      .select('timezone')
      .eq('restaurant_id', restaurantId)
      .limit(1)
      .single();

    if (locationError || !location?.timezone) {
      throw new Error('Restaurant timezone not found');
    }

    const timezone = location.timezone;
    console.log('Using timezone:', timezone);

    // Fix Square orders service dates
    const { data: orders, error: ordersError } = await supabase
      .from('square_orders')
      .select('id, closed_at, service_date')
      .eq('restaurant_id', restaurantId)
      .not('closed_at', 'is', null);

    if (ordersError) {
      throw new Error(`Failed to fetch orders: ${ordersError.message}`);
    }

    let ordersFixed = 0;
    for (const order of orders || []) {
      if (!order.closed_at) continue;

      // Convert UTC closed_at to restaurant timezone date
      const closedAtDate = new Date(order.closed_at);
      const offsetMinutes = getTimezoneOffset(timezone, closedAtDate);
      const localDate = new Date(closedAtDate.getTime() + (offsetMinutes * 60 * 1000));
      const newServiceDate = localDate.toISOString().split('T')[0];

      // Only update if the service date has changed
      if (order.service_date !== newServiceDate) {
        const { error: updateError } = await supabase
          .from('square_orders')
          .update({ service_date: newServiceDate })
          .eq('id', order.id);

        if (updateError) {
          console.error(`Failed to update order ${order.id}:`, updateError);
        } else {
          ordersFixed++;
        }
      }
    }

    // Fix Square shifts service dates
    const { data: shifts, error: shiftsError } = await supabase
      .from('square_shifts')
      .select('id, start_at, service_date')
      .eq('restaurant_id', restaurantId)
      .not('start_at', 'is', null);

    if (shiftsError) {
      throw new Error(`Failed to fetch shifts: ${shiftsError.message}`);
    }

    let shiftsFixed = 0;
    for (const shift of shifts || []) {
      if (!shift.start_at) continue;

      // Convert UTC start_at to restaurant timezone date
      const startAtDate = new Date(shift.start_at);
      const offsetMinutes = getTimezoneOffset(timezone, startAtDate);
      const localDate = new Date(startAtDate.getTime() + (offsetMinutes * 60 * 1000));
      const newServiceDate = localDate.toISOString().split('T')[0];

      // Only update if the service date has changed
      if (shift.service_date !== newServiceDate) {
        const { error: updateError } = await supabase
          .from('square_shifts')
          .update({ service_date: newServiceDate })
          .eq('id', shift.id);

        if (updateError) {
          console.error(`Failed to update shift ${shift.id}:`, updateError);
        } else {
          shiftsFixed++;
        }
      }
    }

    // Recalculate P&L for affected dates
    const affectedDates = new Set<string>();
    
    // Collect all unique service dates from both orders and shifts
    for (const order of orders || []) {
      if (order.closed_at) {
        const closedAtDate = new Date(order.closed_at);
        const offsetMinutes = getTimezoneOffset(timezone, closedAtDate);
        const localDate = new Date(closedAtDate.getTime() + (offsetMinutes * 60 * 1000));
        affectedDates.add(localDate.toISOString().split('T')[0]);
      }
    }

    for (const shift of shifts || []) {
      if (shift.start_at) {
        const startAtDate = new Date(shift.start_at);
        const offsetMinutes = getTimezoneOffset(timezone, startAtDate);
        const localDate = new Date(startAtDate.getTime() + (offsetMinutes * 60 * 1000));
        affectedDates.add(localDate.toISOString().split('T')[0]);
      }
    }

    // Recalculate P&L for each affected date
    for (const date of affectedDates) {
      const { error: pnlError } = await supabase.rpc('calculate_daily_pnl', {
        p_restaurant_id: restaurantId,
        p_date: date
      });

      if (pnlError) {
        console.error(`Failed to recalculate P&L for ${date}:`, pnlError);
      }
    }

    const results = {
      ordersFixed,
      shiftsFixed,
      datesRecalculated: affectedDates.size,
      timezone
    };

    console.log('Service dates fix completed:', results);

    return new Response(JSON.stringify({
      success: true,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Fix service dates error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Get timezone offset in minutes for a specific date
 * Simplified approach for common US timezones
 */
function getTimezoneOffset(timezone: string, date: Date): number {
  // Create a date in the target timezone
  const utcTime = date.getTime();
  const utcDate = new Date(utcTime);
  
  // Use Intl.DateTimeFormat to get the local time in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(utcDate);
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '0');
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '0') - 1;
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '0');
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const second = parseInt(parts.find(p => p.type === 'second')?.value || '0');
  
  const localTime = new Date(year, month, day, hour, minute, second).getTime();
  
  return (localTime - utcTime) / (1000 * 60);
}
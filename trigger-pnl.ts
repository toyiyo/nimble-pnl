// Temporary script to trigger P&L calculations
import { supabase } from './src/integrations/supabase/client'

async function triggerPnLCalculations() {
  const restaurantId = 'bfa36fd2-0aa6-45e3-9faa-bca0c853827c'
  
  // Calculate for Sep 18, 2025
  const sep18Result = await supabase.functions.invoke('trigger-pnl-calculation', {
    body: {
      restaurant_id: restaurantId,
      date: '2025-09-18'
    }
  })
  
  console.log('Sep 18 result:', sep18Result)
  
  // Calculate for Sep 16, 2025
  const sep16Result = await supabase.functions.invoke('trigger-pnl-calculation', {
    body: {
      restaurant_id: restaurantId,
      date: '2025-09-16'
    }
  })
  
  console.log('Sep 16 result:', sep16Result)
}

triggerPnLCalculations()
/**
 * Bulk P&L Recalculation Script
 * 
 * This script triggers the bulk-recalculate-pnl edge function to regenerate
 * all P&L data from existing sales and cost records.
 * 
 * Usage:
 *   bun run trigger-bulk-pnl-recalc.ts
 * 
 * Options (modify the payload below):
 *   - restaurant_id: Specific restaurant (optional, omit to process all)
 *   - start_date: Start date YYYY-MM-DD (optional)
 *   - end_date: End date YYYY-MM-DD (optional)
 */

const SUPABASE_URL = 'https://ncdujvdgqtaunuyigflp.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZHVqdmRncXRhdW51eWlnZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjgyMTYsImV4cCI6MjA3MzU0NDIxNn0.mlrSpU6RgiQLzLmYgtwcEBpOgoju9fow-_8xv4KRSZw'

async function triggerBulkRecalculation() {
  console.log('🔄 Starting bulk P&L recalculation...')
  
  // Customize these parameters as needed:
  const payload = {
    // restaurant_id: 'your-restaurant-uuid-here',  // Optional: specific restaurant
    // start_date: '2024-01-01',                    // Optional: start date
    // end_date: '2024-12-31',                      // Optional: end date
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/bulk-recalculate-pnl`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(payload),
      }
    )

    const result = await response.json()

    if (response.ok) {
      console.log('✅ Bulk recalculation completed successfully!')
      console.log(`📊 Results:`)
      console.log(`   Total records: ${result.total}`)
      console.log(`   Success: ${result.success}`)
      console.log(`   Failed: ${result.failed}`)
      
      if (result.errors && result.errors.length > 0) {
        console.log(`\n⚠️  Errors:`)
        result.errors.slice(0, 10).forEach((err: any) => {
          console.log(`   - ${err.restaurant_id} on ${err.date}: ${err.error}`)
        })
        if (result.errors.length > 10) {
          console.log(`   ... and ${result.errors.length - 10} more errors`)
        }
      }
    } else {
      console.error('❌ Recalculation failed:', result.error)
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ Error triggering recalculation:', error)
    process.exit(1)
  }
}

// Run the recalculation
triggerBulkRecalculation()

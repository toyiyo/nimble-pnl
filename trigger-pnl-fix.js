console.log('Triggering P&L recalculation for 9/20...');

fetch('https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-sync-data', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZHVqdmRncXRhdW51eWlnZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjgyMTYsImV4cCI6MjA3MzU0NDIxNn0.mlrSpU6RgiQLzLmYgtwcEBpOgoju9fow-_8xv4KRSZw'
  },
  body: JSON.stringify({
    restaurantId: 'bfa36fd2-0aa6-45e3-9faa-bca0c853827c',
    action: 'calculate_pnl',
    dateRange: {
      startDate: '2025-09-20',
      endDate: '2025-09-20'
    }
  })
})
.then(response => response.text())
.then(data => console.log('P&L recalculation response:', data))
.catch(error => console.error('Error:', error));
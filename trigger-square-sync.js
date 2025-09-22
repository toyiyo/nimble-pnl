// Temporary script to trigger Square sync
const response = await fetch('https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-sync-data', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZHVqdmRncXRhdW51eWlnZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjgyMTYsImV4cCI6MjA3MzU0NDIxNn0.mlrSpU6RgiQLzLmYgtwcEBpOgoju9fow-_8xv4KRSZw'
  },
  body: JSON.stringify({
    restaurantId: 'bfa36fd2-0aa6-45e3-9faa-bca0c853827c',
    action: 'daily_sync'
  })
});

const result = await response.json();
console.log('Square sync triggered:', result);
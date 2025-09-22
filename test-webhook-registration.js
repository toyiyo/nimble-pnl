// Test webhook registration
console.log('Testing Square webhook registration...');

const testWebhookRegistration = async () => {
  try {
    const response = await fetch('https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-webhook-register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZHVqdmRncXRhdW51eWlnZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjgyMTYsImV4cCI6MjA3MzU0NDIxNn0.mlrSpU6RgiQLzLmYgtwcEBpOgoju9fow-_8xv4KRSZw'
      },
      body: JSON.stringify({
        restaurantId: 'bfa36fd2-0aa6-45e3-9faa-bca0c853827c'
      })
    });

    const result = await response.text();
    console.log('Webhook registration response status:', response.status);
    console.log('Webhook registration response:', result);

    if (!response.ok) {
      console.error('Webhook registration failed');
    } else {
      console.log('Webhook registration successful!');
    }
  } catch (error) {
    console.error('Error testing webhook registration:', error);
  }
};

testWebhookRegistration();
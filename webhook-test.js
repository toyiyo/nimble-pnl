// Comprehensive Square Webhook Test
console.log('🔧 Starting Square Webhook Tests...');

const SUPABASE_URL = 'https://ncdujvdgqtaunuyigflp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZHVqdmRncXRhdW51eWlnZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjgyMTYsImV4cCI6MjA3MzU0NDIxNn0.mlrSpU6RgiQLzLmYgtwcEBpOgoju9fow-_8xv4KRSZw';
const RESTAURANT_ID = 'bfa36fd2-0aa6-45e3-9faa-bca0c853827c';

// Test 1: Test webhook registration
async function testWebhookRegistration() {
  console.log('\n📝 Test 1: Webhook Registration');
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/square-webhook-register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        restaurantId: RESTAURANT_ID
      })
    });

    const result = await response.text();
    console.log('Status:', response.status);
    console.log('Response:', result);

    if (response.ok) {
      console.log('✅ Webhook registration successful');
      try {
        const data = JSON.parse(result);
        console.log('Webhook ID:', data.webhookId);
        console.log('Test result:', data.testResult);
        return data;
      } catch (e) {
        console.log('⚠️ Could not parse response as JSON');
      }
    } else {
      console.log('❌ Webhook registration failed');
    }
  } catch (error) {
    console.error('❌ Webhook registration error:', error);
  }
}

// Test 2: Test webhook endpoint directly
async function testWebhookEndpoint() {
  console.log('\n🎯 Test 2: Webhook Endpoint');
  try {
    const testPayload = {
      merchant_id: 'MLGJF14V2M88Z',
      type: 'order.updated',
      data: {
        id: 'test-order-' + Date.now(),
        type: 'order'
      },
      event_id: 'test-event-' + Date.now()
    };

    console.log('Sending test payload:', testPayload);

    const response = await fetch(`${SUPABASE_URL}/functions/v1/square-webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload)
    });

    const result = await response.text();
    console.log('Status:', response.status);
    console.log('Response:', result);

    if (response.ok) {
      console.log('✅ Webhook endpoint test successful');
    } else {
      console.log('❌ Webhook endpoint test failed');
    }
  } catch (error) {
    console.error('❌ Webhook endpoint error:', error);
  }
}

// Test 3: Check Square connection status
async function checkSquareConnection() {
  console.log('\n🔗 Test 3: Square Connection Status');
  try {
    // We can't directly query the database from here, but we can check through our test function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/test-square-webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        action: 'register_webhook'
      })
    });

    const result = await response.json();
    console.log('Connection test result:', result);

    if (result.success) {
      console.log('✅ Square connection is working');
    } else {
      console.log('❌ Square connection issue:', result.error);
    }
  } catch (error) {
    console.error('❌ Connection check error:', error);
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Running Complete Webhook Test Suite');
  console.log('=====================================');
  
  await checkSquareConnection();
  await testWebhookRegistration();
  await testWebhookEndpoint();
  
  console.log('\n✨ Test suite completed!');
  console.log('Check the logs above for any issues.');
}

// Auto-run tests
runAllTests();
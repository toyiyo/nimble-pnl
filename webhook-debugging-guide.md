# Square Webhooks Debugging Guide

## Overview
This guide helps you set up and troubleshoot Square webhooks for real-time P&L updates.

## Quick Start Testing

### 1. Using the Built-in Tester
- Navigate to `/integrations` in your app
- Select your restaurant
- If connected to Square, you'll see a "Webhook Testing" section
- Click "Run Webhook Tests" to automatically test:
  - Webhook registration with Square
  - Webhook endpoint functionality 
  - Square connection status

### 2. Manual Browser Testing
Run this in your browser console:
```javascript
// Copy and run the webhook-test.js script
// It will test all webhook functionality automatically
```

### 3. Direct Function Testing
Test webhook registration:
```javascript
fetch('https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-webhook-register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_JWT_TOKEN'
  },
  body: JSON.stringify({
    restaurantId: 'bfa36fd2-0aa6-45e3-9faa-bca0c853827c'
  })
});
```

## Webhook Flow
1. **Registration**: `square-webhook-register` creates/updates webhooks with Square
2. **Webhook URL**: `https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/square-webhooks`
3. **Processing**: Incoming webhooks update database and recalculate P&L

## Event Types Handled
- `order.updated` - Order changes (completed, modified, etc.)
- `payment.updated` - Payment status changes
- `refund.updated` - Refund processing
- `inventory.count.updated` - Inventory changes (logged only)

## Troubleshooting

### Common Issues

1. **Webhook Registration Fails**
   - Check Square connection exists
   - Verify encrypted access token is valid
   - Check Square API permissions/scopes

2. **Webhooks Not Received**
   - Verify webhook URL is accessible
   - Check webhook signature validation
   - Look for 401/403 errors in logs

3. **Data Not Updating**
   - Check if order has `service_date` 
   - Verify P&L calculation function is working
   - Look for database constraint errors

### Debug Steps

1. **Check Supabase Logs**:
   - Go to Supabase Dashboard → Functions → Logs
   - Look for `square-webhook-register` and `square-webhooks` logs
   - Check for error messages and status codes

2. **Verify Square Connection**:
   ```sql
   SELECT * FROM square_connections 
   WHERE restaurant_id = 'bfa36fd2-0aa6-45e3-9faa-bca0c853827c';
   ```

3. **Test Webhook Endpoint**:
   - Use the built-in tester or manual scripts
   - Send test payloads to verify processing

4. **Check Webhook Registration in Square**:
   - Login to Square Dashboard → Developer → Webhooks
   - Verify webhooks are registered and active

### Environment Variables Required
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` 
- `SQUARE_APPLICATION_ID`
- `SQUARE_APPLICATION_SECRET`
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `ENCRYPTION_KEY`

## Testing Production Webhooks

### Using Square's Test Feature
Square provides a webhook test button in their dashboard that sends real webhook events.

### Monitoring Real Events
Check these tables for incoming webhook data:
- `square_orders` - Order updates
- `square_payments` - Payment updates  
- `square_refunds` - Refund updates
- `daily_pnl` - Calculated P&L results

## Next Steps
1. Run the webhook tests using the built-in tester
2. Register webhooks if tests pass
3. Monitor webhook logs for incoming events
4. Verify P&L calculations update in real-time
5. Test with actual Square transactions
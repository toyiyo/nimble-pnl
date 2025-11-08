# SpotOn POS Integration - Implementation Summary

## Overview
This document provides a comprehensive guide for the SpotOn POS integration that has been added to the nimble-pnl restaurant management system.

## Architecture

### Integration Pattern
The SpotOn integration follows the **Adapter Pattern** used by existing POS integrations (Square, Clover). This provides:
- Unified interface for all POS systems
- Consistent data flow to `unified_sales` table
- Isolated POS-specific logic
- Easy extensibility for new POS systems

### Components

#### 1. Frontend Hooks

**`useSpotOnIntegration.tsx`**
- Manages SpotOn connection state
- Handles OAuth and API key connection flows
- Provides connect/disconnect functionality
- Checks connection status

**`useSpotOnSalesAdapter.tsx`**
- Implements `POSAdapter` interface
- Fetches sales data from `unified_sales` table
- Syncs SpotOn data to unified format
- Returns integration status

**`usePOSIntegrations.tsx`** (updated)
- Registers SpotOn adapter with other POS adapters
- Provides unified interface for all POS systems
- Handles multi-system sync operations

#### 2. Edge Functions

**`spoton-oauth/index.ts`**
- Handles three authentication methods:
  - `authorize`: Initiates OAuth flow
  - `callback`: Processes OAuth callback
  - `connect_with_key`: Direct API key connection (recommended for SpotOn)
- Encrypts and stores credentials
- Validates API access before storing
- Triggers initial data sync

**`spoton-sync-data/index.ts`**
- Manual data synchronization
- Supports initial sync (30 days) and incremental sync
- Fetches orders from SpotOn API
- Stores raw data in `spoton_orders` and `spoton_order_items`
- Calls RPC to sync to `unified_sales`
- Updates last sync timestamp

**`spoton-webhooks/index.ts`**
- Real-time webhook event handler
- Verifies HMAC signatures
- Handles events:
  - `order.created` / `order.updated`
  - `order.cancelled`
  - `menu.updated`
  - `item.availability_changed`
- Implements idempotency via `spoton_webhook_events`
- Auto-syncs to `unified_sales`

**`spoton-webhook-register/index.ts`**
- Registers webhooks with SpotOn
- Subscribes to relevant events
- Stores subscription details

#### 3. Database Schema

**Tables:**
- `spoton_connections` - OAuth/API key connections (encrypted)
- `spoton_orders` - Raw order data
- `spoton_order_items` - Raw item data
- `spoton_webhook_subscriptions` - Webhook registrations
- `spoton_webhook_events` - Event tracking for idempotency

**RLS Policies:**
- All tables have Row Level Security enabled
- Users can only view/manage their restaurant's data
- Policies check `user_restaurants` table for authorization

**RPC Function:**
- `sync_spoton_to_unified_sales(p_restaurant_id UUID)` - Syncs SpotOn items to unified_sales

## Authentication

### Method 1: API Key (Recommended)
SpotOn primarily uses API key authentication with location-specific access.

**Setup Flow:**
1. User obtains API key from SpotOn
2. User enters API key and location ID in app
3. Edge function validates API key
4. API key is encrypted and stored
5. Initial sync is triggered

**API Request:**
```typescript
const { data, error } = await supabase.functions.invoke('spoton-oauth', {
  body: {
    action: 'connect_with_key',
    restaurantId: 'uuid',
    apiKey: 'key-from-spoton',
    locationId: 'location-id'
  }
});
```

### Method 2: OAuth2 (Optional)
For partner integrations that need self-serve authorization.

**OAuth Flow:**
1. Call `spoton-oauth` with `action: 'authorize'`
2. Redirect to SpotOn authorization page
3. User grants access
4. SpotOn redirects to callback
5. Exchange code for access token
6. Store encrypted tokens
7. Trigger initial sync

## Data Flow

```
SpotOn API
    ↓
Edge Functions (spoton-sync-data / spoton-webhooks)
    ↓
spoton_orders & spoton_order_items (raw storage)
    ↓
RPC: sync_spoton_to_unified_sales()
    ↓
unified_sales (normalized format)
    ↓
Application UI
```

## API Endpoints

### SpotOn Base URL
`https://enterprise.appetize.com`

### Key Endpoints Used
- `/ordering/api/orders` - Fetch orders
- `/oauth/authorize` - OAuth authorization
- `/oauth/token` - Token exchange
- `/api/locations` - Get locations
- `/webhooks/api/register` - Register webhooks

## Environment Variables Required

```env
# SpotOn OAuth Credentials (optional)
SPOTON_CLIENT_ID=your_client_id
SPOTON_CLIENT_SECRET=your_client_secret

# Webhook Security
SPOTON_WEBHOOK_SECRET=your_webhook_secret

# Encryption (shared with other integrations)
ENCRYPTION_KEY=your_32_byte_encryption_key
```

## Usage

### Connect to SpotOn (API Key Method)

```typescript
import { useSpotOnIntegration } from '@/hooks/useSpotOnIntegration';

const { connectSpotOn, isConnected } = useSpotOnIntegration(restaurantId);

// This will call the edge function which handles API key validation and storage
await connectSpotOn();
```

### Sync Sales Data

```typescript
import { useSpotOnSalesAdapter } from '@/hooks/adapters/useSpotOnSalesAdapter';

const adapter = useSpotOnSalesAdapter(restaurantId);

// Manual sync
const syncedCount = await adapter.syncToUnified(restaurantId);

// Fetch sales
const sales = await adapter.fetchSales(restaurantId, startDate, endDate);
```

### Check Connection Status

```typescript
const status = adapter.getIntegrationStatus();
// {
//   system: 'spoton',
//   isConnected: true/false,
//   isConfigured: true/false,
//   connectionId: 'uuid',
//   lastSyncAt: 'timestamp'
// }
```

## Security Considerations

### ✅ Implemented Security Measures
1. **Encryption**: All API keys and OAuth tokens encrypted with AES-GCM
2. **Row Level Security**: All tables have RLS policies
3. **Webhook Signature Verification**: HMAC signature validation
4. **Permission Checks**: Edge functions verify user access to restaurants
5. **Idempotency**: Webhook events tracked to prevent duplicate processing
6. **Audit Logging**: Security events logged via `logSecurityEvent()`

### ⚠️ Security Best Practices
- Never log decrypted API keys or tokens
- Always validate API responses before storing
- Use service role only in Edge Functions (bypasses RLS)
- Validate permissions in Edge Functions explicitly
- Use HTTPS only for all API calls
- Rotate webhook secrets periodically

## Testing Checklist

### Unit Tests (Not Implemented - Manual Testing Required)
- [ ] Test `useSpotOnIntegration` hook connection flow
- [ ] Test `useSpotOnSalesAdapter` fetch and sync operations
- [ ] Test Edge Functions with mock SpotOn API responses
- [ ] Test RPC function `sync_spoton_to_unified_sales`

### Integration Tests
- [ ] Test full OAuth flow (if using OAuth)
- [ ] Test API key connection flow
- [ ] Test data sync from SpotOn to unified_sales
- [ ] Test webhook receiving and processing
- [ ] Test error handling for invalid API keys
- [ ] Test connection disconnection

### Security Tests
- [ ] Verify tokens are encrypted in database
- [ ] Test RLS policies prevent unauthorized access
- [ ] Test webhook signature verification
- [ ] Test permission validation in Edge Functions

## Troubleshooting

### Connection Issues
**Problem**: API key connection fails
- Verify API key has correct permissions in SpotOn
- Check location ID is correct
- Verify SpotOn API is accessible from Edge Functions
- Check logs in Edge Function for detailed error

### Sync Issues
**Problem**: Orders not syncing to unified_sales
- Check `spoton_orders` table - are raw orders being stored?
- Check RPC function logs for errors
- Verify restaurant_id is correct
- Check date ranges for sync

### Webhook Issues
**Problem**: Webhooks not processing
- Verify webhook URL is accessible publicly
- Check webhook signature matches
- Verify webhook is registered in SpotOn
- Check `spoton_webhook_events` for duplicate processing

## Future Enhancements

### Short Term
- [ ] Add UI for API key configuration
- [ ] Add webhook status monitoring
- [ ] Add sync history tracking
- [ ] Add error notifications for failed syncs

### Long Term
- [ ] Menu item sync
- [ ] Inventory sync
- [ ] Multi-location support
- [ ] Reporting API integration
- [ ] Real-time order status updates

## References

- [SpotOn API Documentation](https://developers.spoton.com/restaurant/docs/introduction)
- [SpotOn Centralized APIs](https://developers.spoton.com/central-api/docs/getting-started)
- [SpotOn Order Retrieval APIs](https://developers.spoton.com/enterprise/docs/order-retrieval-apis)
- [Repository Integration Patterns](./INTEGRATIONS.md)

## Migration Notes

### Database Migration
- Migration file: `supabase/migrations/20251107235136_add_spoton_pos_integration.sql`
- Safe to run on existing database (uses `IF NOT EXISTS`)
- No data migration required (new integration)

### Backward Compatibility
- Fully backward compatible
- Does not affect existing Square/Clover integrations
- New type 'spoton' added to `POSSystemType` enum

## Support

For issues or questions:
1. Check Edge Function logs in Supabase dashboard
2. Review database tables for data integrity
3. Verify environment variables are set
4. Check SpotOn API status
5. Review this documentation and INTEGRATIONS.md

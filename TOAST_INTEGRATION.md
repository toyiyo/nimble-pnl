# Toast POS Integration Implementation

## Overview
This document describes the complete Toast POS integration implementation for the Nimble P&L system. The integration enables restaurants to automatically sync sales data, orders, payments, and menu items from Toast POS to the P&L dashboard.

## Implementation Summary

### Status
✅ **COMPLETE** - All UI components and backend infrastructure implemented
⚠️ **Testing Required** - Requires Toast POS credentials for full end-to-end testing

### Architecture
The Toast integration follows the established pattern used by Square, Clover, and Shift4 integrations:

```
┌─────────────────────────────────────────────────────────────┐
│                         UI Layer                             │
│  - IntegrationCard.tsx (connection management)              │
│  - ToastSync.tsx (data synchronization)                     │
│  - Integrations.tsx (integration status display)            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                      React Hooks                             │
│  - useToastIntegration.tsx (connection state)               │
│  - useToastSalesAdapter.tsx (POS adapter pattern)           │
│  - usePOSIntegrations.tsx (multi-POS management)            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Edge Functions                            │
│  - toast-oauth (OAuth 2.0 flow)                             │
│  - toast-sync-data (API data sync)                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Toast POS API                             │
│  - OAuth 2.0 Authorization                                  │
│  - Orders API v2                                            │
│  - Menus API v2                                             │
│  - Payments API                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    Database Layer                            │
│  - toast_connections (OAuth credentials)                    │
│  - toast_orders (order records)                             │
│  - toast_order_items (line items)                           │
│  - toast_payments (payment transactions)                    │
│  - toast_menu_items (menu catalog)                          │
│  - unified_sales (normalized data)                          │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema

### Tables Created (Migration: 20251116_toast_integration.sql)

#### 1. `toast_connections`
Stores OAuth credentials and restaurant information.

**Fields:**
- `id` - UUID primary key
- `restaurant_id` - FK to restaurants table
- `toast_restaurant_guid` - Toast restaurant identifier
- `access_token` - Encrypted OAuth access token
- `refresh_token` - Encrypted OAuth refresh token (optional)
- `token_expires_at` - Token expiration timestamp
- `scopes` - Array of granted OAuth scopes
- `connected_at` - Connection timestamp
- `last_sync_at` - Last successful sync timestamp

**Security:** 
- RLS enabled
- Tokens encrypted using encryption service
- Access restricted to restaurant owners/managers

#### 2. `toast_orders`
Stores order headers from Toast.

**Fields:**
- Order identification (toast_order_guid, order_number)
- Financial data (total_amount, tax_amount, tip_amount, etc.)
- Metadata (payment_status, dining_option, order_date/time)
- `raw_json` - Full order object for audit

#### 3. `toast_order_items`
Stores individual line items from orders.

**Fields:**
- Item identification (toast_item_guid, item_name)
- Pricing (quantity, unit_price, total_price)
- Categorization (menu_category)
- Modifiers (customizations)

#### 4. `toast_payments`
Stores payment transactions.

**Fields:**
- Payment identification (toast_payment_guid)
- Payment details (payment_type, amount, tip_amount)
- Status tracking (payment_status, payment_date)

#### 5. `toast_menu_items`
Stores menu catalog.

**Fields:**
- Item details (item_name, description, price)
- Organization (category)
- Status (is_active)

#### 6. `toast_webhook_events`
Tracks processed webhook events for idempotency.

### Functions

#### `sync_toast_to_unified_sales(p_restaurant_id UUID)`
Transforms Toast order items into the unified sales format.

**Purpose:** Normalizes Toast-specific data structure into the common unified_sales table used across all POS systems.

**Returns:** Count of newly synced items

## Edge Functions

### 1. toast-oauth (Supabase Edge Function)

**Location:** `/supabase/functions/toast-oauth/index.ts`

**Purpose:** Handles OAuth 2.0 authorization flow with Toast POS

**Actions:**
- `authorize` - Generates OAuth authorization URL
- `callback` - Exchanges authorization code for tokens

**OAuth Scopes Requested:**
- `orders:read` - Read order data
- `menus:read` - Read menu catalog
- `payments:read` - Read payment data
- `restaurant:read` - Read restaurant information

**Security Features:**
- Token encryption using getEncryptionService()
- Security event logging
- Restaurant access verification
- Environment-based redirect URIs

**Environment Variables Required:**
- `TOAST_CLIENT_ID` - Toast Partner API client ID
- `TOAST_CLIENT_SECRET` - Toast Partner API client secret

### 2. toast-sync-data (Supabase Edge Function)

**Location:** `/supabase/functions/toast-sync-data/index.ts`

**Purpose:** Syncs data from Toast POS API to database

**Sync Types:**
- `initial_sync` - Last 90 days of data + menu catalog
- `daily_sync` - Yesterday's data
- `hourly_sync` - Last 2 hours of data

**Data Synced:**
1. **Orders** - Order headers with financial totals
2. **Order Items** - Individual line items with quantities and prices
3. **Payments** - Payment transactions with types and amounts
4. **Menu Items** - Menu catalog (initial sync only)

**API Integration:**
- Uses Toast Orders API v2
- Uses Toast Menus API v2
- Implements pagination for large datasets
- Handles API rate limiting

**Data Transformation:**
- Converts Toast amount fields (cents) to decimal dollars
- Extracts nested order item data from checks
- Maps payment types to standardized format
- Links items to unified_sales table

## React Components

### 1. useToastIntegration.tsx (Hook)

**Purpose:** Manages Toast POS connection state

**Features:**
- Connection status checking
- OAuth flow initiation
- Token management
- Connection disconnection

**API:**
```typescript
const {
  isConnected,      // Boolean connection status
  isConnecting,     // Boolean loading state
  connection,       // Connection object or null
  connectToast,     // Function to initiate OAuth
  disconnectToast,  // Function to remove connection
  checkConnectionStatus // Function to refresh status
} = useToastIntegration(restaurantId);
```

### 2. useToastSalesAdapter.tsx (Hook)

**Purpose:** Implements POS adapter pattern for Toast

**Interface:** Implements `POSAdapter` interface for consistency across POS systems

**API:**
```typescript
const adapter = useToastSalesAdapter(restaurantId);
// Returns POSAdapter with:
// - system: 'toast'
// - isConnected: boolean
// - fetchSales(restaurantId, startDate?, endDate?)
// - syncToUnified(restaurantId)
// - getIntegrationStatus()
```

### 3. ToastSync.tsx (Component)

**Purpose:** UI for syncing Toast data

**Features:**
- Real-time sync status indicator
- Historical data import (90 days)
- Incremental sync options (yesterday, last 7 days)
- Sync results display
- Error handling and reporting

**Props:**
```typescript
interface ToastSyncProps {
  restaurantId: string;
  isConnected: boolean;
}
```

### 4. ToastCallback.tsx (Page)

**Purpose:** OAuth callback handler

**Features:**
- Processes OAuth redirect from Toast
- Exchanges authorization code for tokens
- Displays connection status
- Redirects to integrations page

### 5. Updated Components

**IntegrationCard.tsx:**
- Added Toast-specific connection handling
- Toast sync component rendering
- Connection status display

**Integrations.tsx:**
- Toast integration status tracking
- Connection state management

**usePOSIntegrations.tsx:**
- Toast adapter registration
- Multi-POS system management

## User Flow

### Connection Flow

1. **User initiates connection:**
   - Navigates to Integrations page
   - Clicks "Connect" on Toast POS card
   - `useToastIntegration.connectToast()` called

2. **OAuth authorization:**
   - Frontend calls `toast-oauth` edge function with `action: 'authorize'`
   - Edge function generates OAuth URL
   - User redirected to Toast authorization page
   - User approves access and is redirected back

3. **OAuth callback:**
   - User lands on `/toast/callback` route
   - ToastCallback component extracts code and state
   - Calls `toast-oauth` with `action: 'callback'`
   - Edge function exchanges code for tokens
   - Tokens encrypted and stored in database

4. **Initial sync:**
   - User can trigger data sync from ToastSync component
   - Calls `toast-sync-data` edge function
   - Orders, payments, and menu items synced
   - Data transformed to unified_sales format

### Data Sync Flow

1. **Manual sync triggered:**
   - User clicks sync button in UI
   - ToastSync calls `toast-sync-data` edge function
   - Specifies sync type (initial, daily, hourly)

2. **Data retrieval:**
   - Edge function decrypts access token
   - Calls Toast API endpoints
   - Paginates through large datasets
   - Stores raw data in toast_* tables

3. **Data transformation:**
   - `sync_toast_to_unified_sales` function called
   - Toast-specific data normalized
   - Records inserted into unified_sales table
   - Duplicate prevention via unique constraints

4. **Results display:**
   - Sync results returned to UI
   - Statistics shown (orders, items, payments)
   - Errors reported if any

## Configuration

### Environment Variables (Supabase Secrets)

Required for production deployment:

```bash
TOAST_CLIENT_ID=<your_toast_partner_client_id>
TOAST_CLIENT_SECRET=<your_toast_partner_client_secret>
```

### OAuth Redirect URIs

Configure in Toast Partner Portal:

**Production:**
```
https://app.easyshifthq.com/toast/callback
```

**Development:**
```
https://<your-preview-url>.lovableproject.com/toast/callback
```

## Testing

### Prerequisites
1. Toast Partner account with:
   - Client ID and Client Secret
   - OAuth redirect URIs configured
   - API access to test restaurant

2. Supabase configuration:
   - Edge functions deployed
   - Environment variables set
   - Database migration applied

### Test Cases

#### 1. OAuth Connection
- [ ] Click "Connect" on Toast integration card
- [ ] Verify redirect to Toast authorization page
- [ ] Approve access
- [ ] Verify redirect to callback page
- [ ] Check success message
- [ ] Verify redirect to integrations page
- [ ] Confirm "Connected" status displayed

#### 2. Data Sync
- [ ] Navigate to connected Toast integration
- [ ] Click "Import Last 90 Days"
- [ ] Verify sync progress indicator
- [ ] Check sync results (orders, items, payments)
- [ ] Verify data appears in unified_sales table
- [ ] Check P&L dashboard for Toast data

#### 3. Incremental Sync
- [ ] Click "Sync Yesterday"
- [ ] Verify only recent data synced
- [ ] Click "Sync Last 7 Days"
- [ ] Verify date range respected

#### 4. Disconnection
- [ ] Click "Disconnect" button
- [ ] Confirm disconnection
- [ ] Verify connection removed from database
- [ ] Check integration card shows "Connect" again

#### 5. Error Handling
- [ ] Test with invalid credentials
- [ ] Verify error messages displayed
- [ ] Test API failure scenarios
- [ ] Check error logging

## Security Considerations

### Token Security
- ✅ Tokens encrypted at rest using AES-256-GCM
- ✅ Tokens decrypted only in edge functions (server-side)
- ✅ No tokens exposed to client-side code
- ✅ Security events logged for audit trail

### Access Control
- ✅ RLS policies on all tables
- ✅ Restaurant-level data isolation
- ✅ Role-based access (owner/manager only)
- ✅ User authentication required

### API Security
- ✅ HTTPS-only communication
- ✅ OAuth 2.0 standard implementation
- ✅ State parameter for CSRF protection
- ✅ Token expiration handling

## Known Limitations

1. **Webhook Support:** 
   - Current implementation uses manual/scheduled sync
   - Real-time webhooks not yet implemented
   - Consider adding webhook support for real-time updates

2. **Token Refresh:**
   - Refresh token flow not implemented
   - Tokens may expire requiring re-authentication
   - TODO: Implement automatic token refresh

3. **Rate Limiting:**
   - No explicit rate limiting handling
   - Large datasets may hit API limits
   - Consider implementing backoff/retry logic

4. **Error Recovery:**
   - Partial sync failures not fully handled
   - Consider implementing transaction rollback
   - Add retry mechanisms for transient failures

## Future Enhancements

### Short Term
1. Implement webhook support for real-time updates
2. Add automatic token refresh logic
3. Improve error handling and retry mechanisms
4. Add sync scheduling capabilities

### Long Term
1. Support for multiple Toast locations per restaurant
2. Advanced filtering options for sync
3. Bi-directional sync (write data back to Toast)
4. Analytics and reporting on Toast-specific data
5. Menu item mapping to internal product catalog

## Troubleshooting

### Connection Issues

**Problem:** "Failed to connect to Toast"
- Check TOAST_CLIENT_ID and TOAST_CLIENT_SECRET are set
- Verify redirect URI matches configuration in Toast Partner Portal
- Check Supabase edge function logs for detailed errors

**Problem:** "Invalid callback parameters"
- Ensure OAuth flow completed successfully
- Check browser console for redirect errors
- Verify state parameter preserved through redirect

### Sync Issues

**Problem:** "No data synced"
- Verify Toast restaurant has orders in date range
- Check Toast API credentials are valid
- Review edge function logs for API errors

**Problem:** "Partial sync completed"
- Check for specific error messages in sync results
- Verify database has sufficient storage
- Review Toast API rate limit status

### Database Issues

**Problem:** "Permission denied"
- Check RLS policies are correctly configured
- Verify user has access to restaurant
- Ensure user has owner/manager role

## Support

For issues or questions:
1. Check Supabase edge function logs
2. Review database RLS policy logs
3. Check Toast Partner Portal for API status
4. Contact development team with error details

## References

- [Toast Partner API Documentation](https://doc.toasttab.com/openapi/)
- [Toast OAuth 2.0 Guide](https://doc.toasttab.com/openapi/authentication/)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Square Integration Pattern](./SQUARE_INTEGRATION.md) (reference)

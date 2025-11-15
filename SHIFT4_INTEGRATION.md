# Shift4 POS Integration Documentation

## Overview

The Shift4 POS integration enables restaurants to automatically sync payment charges and refunds from Shift4's payment processing platform into the EasyShiftHQ P&L system. Unlike OAuth-based integrations (Square, Clover), Shift4 uses API Key authentication.

## Architecture

### Authentication
- **Method**: API Key (Secret Key) with HTTP Basic Auth
- **Storage**: Secret keys are encrypted using the platform's encryption service before being stored in the database
- **Rotation**: Users can update their API keys at any time through the UI

### Data Flow

```
Shift4 API → Edge Functions → Database Tables → Unified Sales Table → P&L Dashboard
     ↓
Webhooks → Event Verification → Process → Update Database
```

### Components

#### Database Tables

1. **shift4_connections**
   - Stores encrypted API keys and merchant information
   - One connection per restaurant
   - Fields: `id`, `restaurant_id`, `merchant_id`, `secret_key` (encrypted), `environment`, `connected_at`, `last_sync_at`

2. **shift4_charges**
   - Stores payment charge data from Shift4 API
   - Includes tips (when Platform Split is enabled)
   - Fields: `charge_id`, `amount`, `currency`, `status`, `refunded`, `tip_amount`, `service_date`, `service_time`, `raw_json`

3. **shift4_refunds**
   - Stores refund records linked to charges
   - Fields: `refund_id`, `charge_id`, `amount`, `status`, `reason`, `service_date`, `raw_json`

4. **shift4_webhook_events**
   - Tracks processed webhook events for idempotency
   - Prevents duplicate processing on webhook retries
   - Fields: `event_id`, `event_type`, `processed_at`, `raw_json`

#### Edge Functions

1. **shift4-connect**
   - **Purpose**: Validate and store Shift4 API credentials
   - **Input**: `{ restaurantId, secretKey, merchantId?, environment }`
   - **Process**:
     1. Validates user permissions (owner/manager only)
     2. Tests API key by calling Shift4's `/merchants/self` endpoint
     3. Encrypts secret key
     4. Stores connection in database
   - **Output**: `{ success, connectionId, merchantId, merchantName }`

2. **shift4-sync-data**
   - **Purpose**: Sync charges and refunds from Shift4 API
   - **Input**: `{ restaurantId, action: 'initial_sync' | 'daily_sync' | 'hourly_sync', dateRange? }`
   - **Process**:
     1. Fetches charges with pagination (100 per page)
     2. Extracts tip amounts from splits (if available)
     3. Converts UTC timestamps to restaurant's local timezone
     4. Fetches refunds for refunded charges
     5. Stores in database
     6. Calls `sync_shift4_to_unified_sales` RPC function
   - **Output**: `{ chargesSynced, refundsSynced, errors }`

3. **shift4-webhooks**
   - **Purpose**: Handle real-time webhook events from Shift4
   - **Security**: Fetches event from Shift4 API to verify authenticity (never trusts payload)
   - **Process**:
     1. Receives webhook payload with `event_id`
     2. Tries all connections to find which one can verify the event
     3. Fetches full event from Shift4 API using secret key
     4. Checks if event was already processed (idempotency)
     5. Processes event based on type
     6. Marks event as processed
     7. Always returns 200 OK to prevent retries
   - **Events Handled**:
     - `CHARGE_SUCCEEDED`: New charge created
     - `CHARGE_UPDATED`: Charge modified (e.g., tip adjustment)
     - `CHARGE_REFUNDED`: Charge refunded

#### React Hooks

1. **useShift4Integration**
   - Connection management hook
   - Methods:
     - `connectShift4(secretKey, merchantId?, environment)`: Connect to Shift4
     - `disconnectShift4()`: Remove connection
     - `syncNow()`: Trigger manual sync
   - State: `isConnected`, `connection`, `loading`

2. **useShift4SalesAdapter**
   - Implements `POSAdapter` interface
   - Methods:
     - `fetchSales(restaurantId, startDate?, endDate?)`: Fetch unified sales
     - `syncToUnified(restaurantId)`: Trigger sync and RPC
     - `getIntegrationStatus()`: Get connection status

#### UI Components

1. **Shift4ConnectDialog**
   - Modal dialog for API key input
   - Fields:
     - Secret Key (password input, validated to start with `sk_`)
     - Environment (production/sandbox selector)
   - Security notice with encryption information

2. **Shift4Sync**
   - Sync control panel
   - Buttons:
     - Import Last 90 Days (initial sync)
     - Sync Yesterday (daily sync)
     - Sync Last 7 Days
   - Displays sync results and webhook status

## Sync Strategies

### 1. Initial Sync (Backfill)
- **Trigger**: User clicks "Import Last 90 Days"
- **Date Range**: Last 90 days from current date
- **Purpose**: Populate historical data for P&L calculations
- **Process**: Fetches all charges in date range with pagination

### 2. Daily Sync
- **Trigger**: Scheduled or manual
- **Date Range**: Previous business day
- **Purpose**: Comprehensive daily data capture
- **Recommended**: Run nightly at 1 AM local time

### 3. Hourly Sync
- **Trigger**: Scheduled or manual
- **Date Range**: Last 2 days
- **Purpose**: Catch late adjustments (tips, modifications)
- **Note**: Shift4 API doesn't support filtering by `updated_at`, so we re-fetch recent data

### 4. Real-time Webhooks
- **Trigger**: Shift4 sends webhook
- **Events**: CHARGE_SUCCEEDED, CHARGE_UPDATED, CHARGE_REFUNDED
- **Process**: Immediately updates database when events occur
- **Security**: Always verifies by fetching from API

## Data Mapping

### Charge → Unified Sales

| Unified Field | Shift4 Source | Notes |
|--------------|---------------|-------|
| `external_order_id` | `charge.id` | Unique charge ID |
| `external_item_id` | `charge.id + '_sale'` | Synthetic ID (no line items) |
| `item_name` | 'Shift4 Sale' | Generic name (no item details) |
| `total_price` | `charge.amount - tip_amount` | Amount in dollars (converted from cents) |
| `sale_date` | `charge.created` | Converted to restaurant's timezone |
| `sale_time` | `charge.created` | Local time extracted |
| `item_type` | 'sale' | Always 'sale' for base charge |

### Tip Entry (if available)

| Field | Source | Notes |
|-------|--------|-------|
| `external_item_id` | `charge.id + '_tip'` | Separate entry for tips |
| `item_name` | 'Tips' | Standard name |
| `total_price` | Tip amount from splits | Only if Platform Split enabled |
| `item_type` | 'tip' | |
| `adjustment_type` | 'tip' | |

### Refund → Unified Sales

| Field | Source | Notes |
|-------|--------|-------|
| `external_item_id` | `refund.id` | Unique refund ID |
| `item_name` | 'Refund' | |
| `total_price` | `-refund.amount` | Negative amount |
| `item_type` | 'sale' | Still categorized as sale |

## Limitations

### Data Granularity
- ❌ **No line-item details**: Shift4 Charges API doesn't expose individual items
- ❌ **No employee data**: No labor or employee assignment information
- ❌ **No tax breakdown**: Tax is included in total amount but not itemized
- ⚠️ **Limited tip data**: Tips only available if using Platform Split feature

### API Constraints
- No `updated_at` filter: Can't efficiently fetch only modified charges
- Must use pagination for large datasets
- Rate limits apply (though not documented in public API)

## Security Considerations

### Credential Security
1. **Encryption at Rest**: Secret keys are encrypted using the platform's encryption service
2. **No Plain Text Storage**: Keys are never stored or logged in plain text
3. **Secure Transmission**: All API calls use HTTPS
4. **Access Control**: Only owners and managers can connect/disconnect

### Webhook Security
1. **Event Verification**: Always fetches event from Shift4 API (never trusts payload)
2. **Idempotency**: Tracks processed events to prevent duplicate processing
3. **Connection Isolation**: Each connection's secret key is tried to verify ownership
4. **Always 200 OK**: Returns success even on errors to prevent retry storms

### RLS Policies
```sql
-- Users can only access their restaurant's Shift4 data
CREATE POLICY shift4_connections_policy ON shift4_connections
  USING (restaurant_id IN (
    SELECT restaurant_id FROM user_restaurants
    WHERE user_id = auth.uid()
  ));
```

## Setup Instructions

### For Restaurant Users

1. **Get API Credentials**
   - Log in to Shift4 Dashboard
   - Navigate to Developers → API Keys
   - Copy your Secret Key (starts with `sk_live_` or `sk_test_`)

2. **Connect in EasyShiftHQ**
   - Go to Integrations page
   - Click "Connect" on Shift4 card
   - Enter Secret Key
   - Select Environment (Production or Sandbox)
   - Click "Connect"

3. **Initial Data Import**
   - Click "Import Last 90 Days" to backfill historical data
   - Wait for sync to complete
   - Verify data appears in POS Sales

4. **Configure Webhooks** (Manual - Shift4 Dashboard)
   - In Shift4 Dashboard, go to Webhooks
   - Add new webhook endpoint: `https://[your-domain]/functions/v1/shift4-webhooks`
   - Select events: CHARGE_SUCCEEDED, CHARGE_UPDATED, CHARGE_REFUNDED
   - Save configuration

### For Developers

#### Environment Variables
```bash
# Supabase Edge Functions need these
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

#### Testing

**Test Connection**:
```bash
curl -X POST https://your-project.supabase.co/functions/v1/shift4-connect \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "uuid-here",
    "secretKey": "sk_test_...",
    "environment": "sandbox"
  }'
```

**Test Sync**:
```bash
curl -X POST https://your-project.supabase.co/functions/v1/shift4-sync-data \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "uuid-here",
    "action": "hourly_sync"
  }'
```

**Test Webhook** (simulated):
```bash
curl -X POST https://your-project.supabase.co/functions/v1/shift4-webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "id": "evt_test_123",
    "type": "CHARGE_SUCCEEDED",
    "created": 1699999999
  }'
```

## Troubleshooting

### Common Issues

**"Invalid API Key" Error**
- Verify key starts with `sk_live_` (production) or `sk_test_` (sandbox)
- Ensure environment selection matches key type
- Check key hasn't been revoked in Shift4 Dashboard

**No Tips Showing**
- Tips only available with Platform Split feature
- Verify feature is enabled in Shift4 account
- Check `charge.splits` array in raw data

**Missing Recent Data**
- Webhooks may not be configured
- Run manual "Sync Last 7 Days" to catch up
- Check webhook endpoint is accessible (not blocked by firewall)

**Webhook Not Working**
- Verify webhook URL is correct in Shift4 Dashboard
- Check Supabase logs for errors
- Ensure events are being sent (check Shift4 webhook logs)

### Debug Queries

**Check Connection Status**:
```sql
SELECT id, merchant_id, environment, connected_at, last_sync_at
FROM shift4_connections
WHERE restaurant_id = 'your-restaurant-id';
```

**View Recent Charges**:
```sql
SELECT charge_id, amount, status, service_date, tip_amount
FROM shift4_charges
WHERE restaurant_id = 'your-restaurant-id'
ORDER BY created_at_ts DESC
LIMIT 10;
```

**Check Webhook Processing**:
```sql
SELECT event_id, event_type, processed_at
FROM shift4_webhook_events
WHERE restaurant_id = 'your-restaurant-id'
ORDER BY processed_at DESC
LIMIT 20;
```

## Future Enhancements

Potential improvements for future versions:

1. **Background Jobs**: Implement scheduled syncs via Supabase cron
2. **Batch Processing**: Optimize bulk syncs for restaurants with high transaction volume
3. **Custom Date Ranges**: UI for specifying arbitrary sync date ranges
4. **Sync Status Dashboard**: Show sync history and statistics
5. **Split Detection**: Automatically detect and map other split types beyond tips
6. **Multi-Merchant Support**: Support for restaurants with multiple Shift4 merchant accounts
7. **Enhanced Error Handling**: Retry logic with exponential backoff

## References

- [Shift4 API Documentation](https://dev.shift4.com/docs/api/)
- [Shift4 Webhooks Guide](https://dev.shift4.com/docs/api/#webhooks)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- Internal: INTEGRATIONS.md for platform integration patterns

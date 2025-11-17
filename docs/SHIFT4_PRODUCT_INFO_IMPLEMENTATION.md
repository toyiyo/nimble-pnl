# Shift4 Product Information - Implementation Summary

## Problem Solved
Shift4 sales were displaying as generic "Shift4 Sale" entries instead of showing actual product names. This made it difficult to track which products were being sold.

## Solution Implemented
Updated the `sync_shift4_to_unified_sales` database function to intelligently extract product information from Shift4 charge data using metadata or description fields.

## How It Works

### For New Charges
When a Shift4 charge comes in (via webhook or manual sync), the system now:

1. **Checks metadata fields** (in priority order):
   - `metadata.product_name` ⭐ Best practice
   - `metadata.item_name`
   - `metadata.name`
   - `metadata.product`
   - `metadata.lineItems[0].name` (first item if array exists)

2. **Falls back to description**:
   - Uses the charge's `description` field if no metadata found

3. **Uses default**:
   - "Shift4 Sale" if no product info is available

4. **Sanitizes the name**:
   - Trims whitespace
   - Handles null/empty values
   - Limits to 255 characters
   - Preserves special characters

### For Existing Charges
To update existing sales with product names (if the charges already have the data):
- Run a manual sync from the Integrations page
- Or use the SQL script in `docs/RESYNC_SHIFT4_PRODUCTS.sql`

## What Merchants Need to Do

### If Product Info Already Available
If charges already have metadata/description with product info:
1. Go to Integrations page in EasyShiftHQ
2. Click "Sync Now" for Shift4
3. Product names will be extracted from existing charge data

### If No Product Info Currently
Merchants need to update their Shift4 integration to pass product information. See the comprehensive guide in `docs/SHIFT4_PRODUCT_NAMES.md` which includes:

- Code examples in JavaScript, PHP, Python, Node.js, cURL
- Best practices for naming products
- POS system integration patterns
- Troubleshooting guide

**Quick Example:**
```javascript
// When creating a Shift4 charge
const charge = await shift4.charges.create({
  amount: 1299,
  currency: 'USD',
  card: 'tok_...',
  metadata: {
    product_name: 'Pepperoni Pizza - Large'  // Add this!
  }
});
```

## Files Changed

### Database
- `supabase/migrations/20251117143000_shift4_extract_product_info.sql`
  - Updated `sync_shift4_to_unified_sales` function with product extraction logic

### Documentation
- `SHIFT4_INTEGRATION.md` - Updated data mapping documentation
- `docs/SHIFT4_PRODUCT_NAMES.md` - Comprehensive merchant implementation guide
- `docs/RESYNC_SHIFT4_PRODUCTS.sql` - Optional re-sync script for existing data

### Edge Functions
- No changes needed! The existing `shift4-sync-data` function already stores full charge JSON, and the `shift4-webhooks` function automatically triggers syncs.

## Testing

### Automated Tests
Created test scripts:
- `/tmp/test_shift4_extraction.sql` - Unit tests for JSONB extraction logic
- `/tmp/test_shift4_sync_integration.sql` - Integration test with mock charges

### Manual Testing
1. **Create test charge with product info:**
   ```bash
   curl https://api.shift4.com/charges \
     -u sk_test_...: \
     -d amount=1299 \
     -d currency=USD \
     -d card=tok_test_... \
     -d metadata[product_name]="Test Pizza"
   ```

2. **Wait for webhook or trigger sync** in EasyShiftHQ

3. **Verify in POS Sales page:**
   - Sale should show "Test Pizza" instead of "Shift4 Sale"

## Example Scenarios

### Scenario 1: Charge with metadata.product_name
```json
{
  "id": "char_...",
  "amount": 1299,
  "metadata": {
    "product_name": "Pepperoni Pizza - Large"
  }
}
```
**Result:** "Pepperoni Pizza - Large" ✅

### Scenario 2: Charge with description only
```json
{
  "id": "char_...",
  "amount": 999,
  "description": "Caesar Salad - Large"
}
```
**Result:** "Caesar Salad - Large" ✅

### Scenario 3: Charge with no product info (current situation)
```json
{
  "id": "char_...",
  "amount": 799
}
```
**Result:** "Shift4 Sale" (default) ⚠️

### Scenario 4: Charge with lineItems array
```json
{
  "id": "char_...",
  "amount": 2598,
  "metadata": {
    "lineItems": [
      {"name": "Burger", "quantity": 1},
      {"name": "Fries", "quantity": 1}
    ]
  }
}
```
**Result:** "Burger" (first item) ⚠️ *Note: Multiple items not yet split*

## Known Limitations

1. **Multiple Line Items**: Currently uses only the first item from `lineItems` array. Future enhancement needed to split into separate unified_sales entries.

2. **Historical Data**: Existing charges without metadata/description will still show as "Shift4 Sale" unless the merchant:
   - Already had product info in the charges (just needs re-sync)
   - Or implements going forward (new charges only)

3. **Requires Merchant Action**: The merchant must update their Shift4 integration to pass product information. This is not automatic.

## Benefits

✅ **Better Reporting**: See exactly what products were sold
✅ **Recipe Mapping**: Can now map Shift4 sales to recipes for ingredient tracking
✅ **Inventory Tracking**: Clearer visibility into product sales
✅ **P&L Analysis**: More accurate categorization by product
✅ **Customer Experience**: More transparent sales records

## Next Steps

1. ✅ Code implementation complete
2. ✅ Database migration created
3. ✅ Documentation written
4. ⏳ Notify merchants about the new capability
5. ⏳ Provide support for integrating product names
6. 🔮 Future: Consider splitting multiple line items into separate entries

## Support Resources

For merchants needing help:
1. Guide: `docs/SHIFT4_PRODUCT_NAMES.md`
2. API Reference: https://dev.shift4.com/docs/api/
3. Integration docs: `SHIFT4_INTEGRATION.md`
4. Re-sync script: `docs/RESYNC_SHIFT4_PRODUCTS.sql`

## Security Notes

- ✅ Product names are sanitized (trimmed, length-limited)
- ✅ No changes to authentication or credential handling
- ✅ Uses existing RLS policies for data access
- ✅ SECURITY DEFINER function with `SET search_path = public`
- ✅ No SQL injection risk (uses JSONB operators and parameterized values)

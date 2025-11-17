# Shift4 Product Information Guide

## Overview

This guide explains how to pass product information through Shift4 charges so that your sales appear with descriptive names in EasyShiftHQ instead of the generic "Shift4 Sale" label.

## Problem

By default, Shift4 charges don't include line-item product details. When synced to EasyShiftHQ, they appear as:
- ❌ "Shift4 Sale" - Not helpful for reporting and analysis

## Solution

Pass product information through Shift4's `metadata` or `description` fields when creating charges.

## Methods

### Method 1: Using metadata.product_name (Recommended)

When creating a Shift4 charge, include product information in the metadata:

```javascript
// Example: Creating a charge with product name
const charge = await shift4.charges.create({
  amount: 1299, // $12.99 in cents
  currency: 'USD',
  card: 'tok_...',
  metadata: {
    product_name: 'Pepperoni Pizza - Large'
  }
});
```

Result in EasyShiftHQ:
- ✅ "Pepperoni Pizza - Large" - Clear and descriptive

### Method 2: Using metadata.lineItems

For multiple items or more structure:

```javascript
const charge = await shift4.charges.create({
  amount: 2598, // $25.98 total
  currency: 'USD',
  card: 'tok_...',
  metadata: {
    lineItems: [
      {
        name: 'Pepperoni Pizza - Large',
        quantity: 1,
        price: 1299
      },
      {
        name: 'Caesar Salad',
        quantity: 1,
        price: 1299
      }
    ]
  }
});
```

**Note**: Currently, EasyShiftHQ will use the first item's name. Multiple line items are not yet split into separate unified sales entries.

Result in EasyShiftHQ:
- ✅ "Pepperoni Pizza - Large" (first item)

### Method 3: Using description field

If you can't modify metadata, use the description field:

```javascript
const charge = await shift4.charges.create({
  amount: 1299,
  currency: 'USD',
  card: 'tok_...',
  description: 'Margherita Pizza - Medium'
});
```

Result in EasyShiftHQ:
- ✅ "Margherita Pizza - Medium"

## Supported Metadata Fields

EasyShiftHQ checks for product names in this priority order:

1. `metadata.product_name` ⭐ Recommended
2. `metadata.item_name`
3. `metadata.name`
4. `metadata.product`
5. `metadata.lineItems[0].name` (first item in array)
6. `description` field
7. "Shift4 Sale" (default fallback)

## Examples by Platform

### PHP

```php
<?php
require_once('vendor/autoload.php');

\Shift4\Shift4::setApiKey('sk_live_...');

$charge = \Shift4\Charge::create([
    'amount' => 1299,
    'currency' => 'USD',
    'card' => 'tok_...',
    'metadata' => [
        'product_name' => 'Burger Deluxe',
        'order_id' => '12345'
    ]
]);
```

### Python

```python
import shift4

shift4.api_key = 'sk_live_...'

charge = shift4.Charge.create(
    amount=1299,
    currency='USD',
    card='tok_...',
    metadata={
        'product_name': 'Club Sandwich',
        'order_id': '12345'
    }
)
```

### cURL

```bash
curl https://api.shift4.com/charges \
  -u sk_live_...: \
  -d amount=1299 \
  -d currency=USD \
  -d card=tok_... \
  -d metadata[product_name]="Fish and Chips"
```

### Node.js

```javascript
const shift4 = require('shift4')('sk_live_...');

const charge = await shift4.charges.create({
  amount: 1299,
  currency: 'USD',
  card: 'tok_...',
  metadata: {
    product_name: 'Chicken Alfredo Pasta'
  }
});
```

## Integration with POS Systems

### Shift4 Integrated POS

If you're using a POS system that integrates with Shift4, configure it to pass product information:

1. Check if your POS supports custom metadata fields
2. Map product names to the `product_name` metadata field
3. Test with a sample transaction
4. Verify in EasyShiftHQ that the product name appears correctly

### Custom Integration

If you're building a custom integration:

```javascript
// Example: Point of Sale sending charge with product
async function processPayment(cartItems, paymentToken) {
  // Get the primary item or create a summary
  const primaryItem = cartItems[0];
  const itemSummary = cartItems.length > 1 
    ? `${primaryItem.name} + ${cartItems.length - 1} more`
    : primaryItem.name;
  
  // Calculate total
  const totalAmount = cartItems.reduce((sum, item) => 
    sum + (item.price * item.quantity), 0
  );
  
  // Create charge with product information
  const charge = await shift4.charges.create({
    amount: totalAmount,
    currency: 'USD',
    card: paymentToken,
    metadata: {
      product_name: itemSummary,
      lineItems: cartItems,
      order_id: generateOrderId()
    },
    description: `Order: ${itemSummary}`
  });
  
  return charge;
}
```

## Verification

After implementing product names:

1. Create a test charge with product information
2. Wait 5-10 minutes for sync (or trigger manual sync in EasyShiftHQ)
3. Go to POS Sales in EasyShiftHQ
4. Verify your product name appears instead of "Shift4 Sale"

## Troubleshooting

### Product name still shows as "Shift4 Sale"

**Check:**
- Is the metadata field spelled correctly? (e.g., `product_name` not `productName`)
- Is the charge captured and successful?
- Has the sync run? (Check last sync time in Integrations page)
- Is the description or metadata field populated in the raw charge data?

**Debug:**
1. Go to POS Sales in EasyShiftHQ
2. Click on the sale to view details
3. Check the "Raw Data" section to see what Shift4 sent

### Metadata not being saved

Some Shift4 account configurations may limit metadata fields. Contact Shift4 support to ensure metadata is enabled for your account.

### Special characters or long names

Product names are automatically:
- Trimmed of leading/trailing whitespace
- Limited to 255 characters (truncated with "..." if longer)
- Stored as-is (preserves special characters)

## Best Practices

1. ✅ **Be consistent**: Always use the same metadata field (e.g., always `product_name`)
2. ✅ **Be descriptive**: Include size, variant, or modifiers (e.g., "Large Pepperoni Pizza")
3. ✅ **Keep it short**: Aim for 50 characters or less for readability
4. ✅ **Test first**: Use Shift4 test mode to verify before going live
5. ❌ **Don't use order IDs**: Product name should describe the item, not the order

## Support

If you need help implementing product names in your Shift4 integration:

1. Check Shift4's API documentation: https://dev.shift4.com/docs/api/
2. Review EasyShiftHQ integration docs: See SHIFT4_INTEGRATION.md
3. Contact support with sample charge data if issues persist

## Coming Soon

🚀 **Multiple Line Items**: Future updates will split charges with multiple line items into separate unified sales entries, allowing for better inventory tracking and recipe costing.

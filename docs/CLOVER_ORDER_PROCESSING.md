# Clover Order Processing Logic

## Overview

This document explains how Clover POS orders are processed, including how revenue, discounts, taxes, tips, and other adjustments are calculated and stored.

## Data Flow

### 1. Webhook Notification (Real-time)

When an order is created or updated in Clover:

```
Clover POS → Webhook → clover-webhooks Edge Function → Triggers sync
```

**Important**: Webhook payloads contain minimal data - just a notification that something changed. They do **not** include full order details like discounts, taxes, or tips.

**Example webhook payload:**
```json
{
  "id": "XVJ4AXVHGHBWT",
  "total": 877,
  "lineItems": {
    "elements": [{
      "price": 900,
      "isRevenue": true
    }]
  }
}
```

Missing from webhook: `discount`, `taxAmount`, `tipAmount`, `serviceCharge`

### 2. Full Order Sync

The webhook triggers `clover-sync-data` which fetches complete order details:

```typescript
// Expand parameters to get full order data
expand: "lineItems, lineItems.discounts, employee, refunds, credits, voids, 
         customers, serviceCharge, discounts, orderType"
```

This fetches:
- **Line items** with full details
- **Line-item discounts** (applied to individual items)
- **Order-level discounts** (applied to entire order)
- **Tax amounts**
- **Tip amounts**
- **Service charges**

### 3. Data Storage

Data is stored in three places:

#### 3.1 Raw Order Data (`clover_orders` table)
```typescript
{
  order_id: "XVJ4AXVHGHBWT",
  total: 8.77,           // Final total
  tax_amount: 0.67,      // Total tax
  tip_amount: 0.00,      // Tips
  discount_amount: 0.90, // Order-level discount
  service_charge_amount: 0.00,
  raw_json: { ... }      // Complete order JSON
}
```

#### 3.2 Line Items (`clover_order_line_items` table)
```typescript
{
  line_item_id: "G7WE49YKYVF6A",
  name: "tequila shot",
  price: 9.00,           // Unit price BEFORE discount
  unit_quantity: 1,
  is_revenue: true,      // Marks this as revenue
  raw_json: { ... }      // Complete line item JSON including discounts
}
```

#### 3.3 Unified Sales (`unified_sales` table)

**Revenue items** (adjustment_type = NULL):
```typescript
{
  item_name: "tequila shot",
  quantity: 1,
  unit_price: 9.00,
  total_price: 9.00,
  adjustment_type: null,  // NULL = revenue item
  item_type: null
}
```

**Line-item discounts** (adjustment_type = 'discount'):
```typescript
{
  item_name: "tequila shot - 10% Off",
  total_price: -0.90,     // NEGATIVE value
  adjustment_type: "discount",
  item_type: "discount"
}
```

**Order-level adjustments**:
```typescript
// Tax
{
  item_name: "Sales Tax",
  total_price: 0.67,
  adjustment_type: "tax",
  item_type: "tax"
}

// Tips
{
  item_name: "Tips",
  total_price: 0.00,
  adjustment_type: "tip",
  item_type: "tip"
}
```

## Calculation Logic

### Revenue Calculation

**Gross Revenue** (before discounts):
```sql
SELECT SUM(total_price) 
FROM unified_sales 
WHERE adjustment_type IS NULL
  AND restaurant_id = '...'
  AND sale_date = '2025-11-09'
```

**Net Revenue** (after discounts, before tax):
```sql
SELECT 
  SUM(CASE WHEN adjustment_type IS NULL THEN total_price ELSE 0 END) +
  SUM(CASE WHEN adjustment_type = 'discount' THEN total_price ELSE 0 END) as net_revenue
FROM unified_sales 
WHERE restaurant_id = '...'
  AND sale_date = '2025-11-09'
```

**Collected at POS** (total collected including tax, excluding tips):
```sql
SELECT 
  SUM(CASE WHEN adjustment_type IS NULL THEN total_price ELSE 0 END) +
  SUM(CASE WHEN adjustment_type = 'discount' THEN total_price ELSE 0 END) +
  SUM(CASE WHEN adjustment_type = 'tax' THEN total_price ELSE 0 END) as collected_at_pos
FROM unified_sales 
WHERE restaurant_id = '...'
  AND sale_date = '2025-11-09'
```

### Example Order Calculation

**Order Details:**
- Item: tequila shot @ $9.00
- Line-item discount: -$0.90 (10%)
- Subtotal after discount: $8.10
- Tax: $0.67
- Total: $8.77

**Stored in unified_sales:**
```
tequila shot         | $9.00  | adjustment_type: null     (revenue)
tequila shot - 10%   | -$0.90 | adjustment_type: discount (pass-through)
Sales Tax            | $0.67  | adjustment_type: tax      (pass-through)
```

**Calculations:**
```
Gross Revenue:        $9.00   (only NULL adjustment_type)
Net Revenue:          $8.10   (gross + discounts)
Tax:                  $0.67   (adjustment_type = 'tax')
Collected at POS:     $8.77   (net revenue + tax)
```

## Tax Calculation

### Tax Extraction Priority

The Clover sync uses a **two-tier approach** for tax extraction:

#### 1. Primary Source: Clover Payment API (Preferred)

```typescript
// Fetch payments for the order
const paymentsUrl = `${BASE_URL}/orders/${order.id}/payments`;
const payments = await fetch(paymentsUrl).json();

// Extract taxAmount from payments (authoritative source)
taxCents = payments.elements.reduce((sum, payment) => 
  sum + (payment.taxAmount ?? 0), 0
);
```

**Advantages:**
- ✅ Authoritative source - reflects what was actually collected
- ✅ Handles complex tax scenarios (VAT, tax exemptions, partial tax)
- ✅ Accurate even with tax overrides or manual adjustments

**Data Source Indicator:**
```json
{
  "raw_data": {
    "from": "payments",
    "taxCents": 6700
  }
}
```

#### 2. Fallback: Calculated from Order Total

If `payment.taxAmount` is not available (rare cases):

```typescript
// Calculate: Tax = Total - LineItems - ServiceCharge + Discount
const revenueSubtotal = lineItems
  .filter(li => li.isRevenue)
  .reduce((sum, li) => sum + (li.price * li.quantity), 0);

taxCents = Math.max(0, 
  order.total 
  - revenueSubtotal 
  - serviceChargeAmount 
  + discountAmount
);
```

**Formula Explanation:**
- `order.total` = Final amount including tax
- `revenueSubtotal` = Sum of line item prices
- `serviceChargeAmount` = Additional service charges
- `discountAmount` = Total discounts (added back since already subtracted from line items)

**Data Source Indicator:**
```json
{
  "raw_data": {
    "from": "calculated",
    "taxCents": 6700,
    "orderTotal": 32475,
    "revenueSubtotal": 30000,
    "serviceCharge": 0,
    "discount": 2475
  }
}
```

### Tax Scenarios

**Scenario 1: Standard Tax**
- Item: $300.00
- Tax: $24.75 (8.25%)
- Total: $324.75

**Scenario 2: VAT (Tax Included)**
- Item: $300.00 (includes $22.56 VAT)
- Tax Label: "VAT" instead of "Sales Tax"
- Total: $300.00

**Scenario 3: Tax Removed**
- Item: $300.00
- Tax: $0.00 (taxRemoved flag = true)
- Total: $300.00

**Scenario 4: Partial Tax Exemption**
- Item 1: $100.00 (taxable)
- Item 2: $200.00 (tax-exempt food)
- Tax: $8.25 (only on Item 1)
- Total: $308.25

### Tax Validation

The sync function performs reconciliation to ensure accuracy:

```typescript
// Check if payment amounts match order total (±1 cent tolerance)
const orderTotal = order.total;
const paidAmount = payments.reduce((s, p) => s + p.amount, 0);
const delta = Math.abs(orderTotal - paidAmount);

if (delta > 1 && paidAmount > 0) {
  console.warn(`Order ${order.id} mismatch: 
    order.total=${orderTotal}, 
    payment.amount=${paidAmount}, 
    delta=${delta}¢
  `);
}
```

## Discount Types

### 1. Line-Item Discounts
- Applied to specific items
- Extracted from `lineItem.discounts.elements[]`
- Stored as separate records with `adjustment_type = 'discount'`
- Linked to line item via `raw_data.lineItemId`

### 2. Order-Level Discounts
- Applied to entire order
- Extracted from `order.discount.amount`
- Stored as single record with `adjustment_type = 'discount'`

## Pass-Through Items vs Revenue

**Revenue Items** (`adjustment_type = NULL`):
- Regular product sales
- Should be counted in revenue metrics
- Affects COGS calculations

**Pass-Through Items** (`adjustment_type != NULL`):
- Tax (collected for government)
- Tips (passed to employees)
- Service charges (depends on business)
- Discounts (reduce revenue)
- Fees (various purposes)

**Important**: Pass-through items should be **excluded** from revenue metrics but **included** in "Collected at POS" metrics.

## Webhook vs Sync Processing

### Webhook Handler
- **Purpose**: Real-time notification of changes
- **Data**: Minimal (just notification)
- **Action**: Trigger full sync to fetch complete data
- **Processing**: Identifies affected order/payment and triggers sync

### Sync Function
- **Purpose**: Fetch and store complete order data
- **Data**: Full order details with all expand parameters
- **Action**: Extract and store all components (items, adjustments, etc.)
- **Processing**: Comprehensive extraction and normalization

## Common Patterns

### Checking if Sync is Needed
```typescript
// Webhook receives minimal data
const webhookOrder = {
  id: "XVJ4AXVHGHBWT",
  total: 877  // Only basic info
};

// Trigger sync to get full details
await supabase.functions.invoke("clover-sync-data", {
  body: { restaurantId, action: "daily" }
});
```

### Processing Full Order Data
```typescript
// After sync, full order data is available
const fullOrder = {
  id: "XVJ4AXVHGHBWT",
  total: 877,
  taxAmount: 67,
  tipAmount: 0,
  discount: { amount: 90, name: "10% Off" },
  lineItems: {
    elements: [{
      price: 900,
      discounts: {
        elements: [{ amount: 90, name: "10% Off" }]
      }
    }]
  }
};
```

## Troubleshooting

### Issue: Tax amounts incorrect or missing

**Symptoms:**
- Tax amounts don't match Clover reports
- Tax is $0 when it should have a value
- Tax seems calculated incorrectly

**Root Cause (Fixed as of 2025-11-09):**
Prior to the fix, the sync function had an incorrect comment stating "taxAmount is not provided by Clover API" and was **always** calculating tax manually instead of extracting it from the Payment API.

**Resolution:**
The sync function now properly extracts `taxAmount` from the Clover Payment API:

```typescript
// Extract tax from payments (authoritative source)
taxCents = payments.reduce((s, p) => s + (p.taxAmount ?? 0), 0);

// Only calculate if not provided
if (taxCents === 0) {
  taxCents = calculateTaxFromOrderTotal(order);
}
```

**To Verify:**
1. Check `raw_data.from` field in `unified_sales` table:
   - `"payments"` = extracted from Payment API ✅
   - `"calculated"` = manually calculated (fallback)
2. Compare tax amounts between Clover reports and `unified_sales`
3. Look for warning logs: "Order mismatch: order.total vs payment.amount"

**Debug Query:**
```sql
SELECT 
  external_order_id,
  total_price as tax_amount,
  raw_data->>'from' as tax_source,
  raw_data->>'taxCents' as tax_cents
FROM unified_sales
WHERE pos_system = 'clover'
  AND adjustment_type = 'tax'
  AND restaurant_id = 'your-restaurant-id'
ORDER BY sale_date DESC
LIMIT 10;
```

### Issue: Discounts not appearing
**Check:**
1. Is `lineItems.discounts` in expand parameter?
2. Are line-item discounts being extracted in sync function?
3. Are discount adjustments being upserted to unified_sales?

### Issue: Revenue totals don't match
**Check:**
1. Are you filtering by `adjustment_type IS NULL` for revenue?
2. Are discounts being stored as negative values?
3. Are you including/excluding pass-through items correctly?

### Issue: Webhook not processing
**Check:**
1. Is webhook receiving X-Clover-Auth header?
2. Is sync function being triggered?
3. Are full order details being fetched with expand parameters?

## API Permissions Required

For proper order processing, ensure these permissions in Clover:
- **Orders** (Read): Basic order data
- No additional permissions needed for expand parameters used

**Note**: Some expand parameters like `lineItems.modifications` require additional permissions and may cause errors if not granted.

# Shift4 Product Information - Visual Guide

## The Problem

### What You See Now (Without Product Info)
```
┌─────────────────────────────────────────────────────────┐
│ 🔵 shift4-pos                                           │
│                                                         │
│ Shift4 Sale                                            │ ← Generic!
│ Qty: 1                                                  │
│ $7.99                                                   │
│ shift4                                                  │
│ No Recipe                                               │
│ Categorize                                              │
│                                                         │
│ Nov 17, 2025 at 08:28:56                               │
│ Order: char_Je0OgwE4VHiEWramcbQzsJlH                   │
└─────────────────────────────────────────────────────────┘
```

**Issue:** All Shift4 sales look the same - impossible to tell what was actually sold!

---

## The Solution

### What You'll See (With Product Info)
```
┌─────────────────────────────────────────────────────────┐
│ 🔵 shift4-pos                                           │
│                                                         │
│ Cheeseburger with Fries                                │ ← Descriptive!
│ Qty: 1                                                  │
│ $7.99                                                   │
│ shift4                                                  │
│ 📖 Recipe: Burger Combo (75% margin)                   │ ← Can map!
│ ✅ Categorized: Food Sales                             │ ← Can categorize!
│                                                         │
│ Nov 17, 2025 at 08:28:56                               │
│ Order: char_Je0OgwE4VHiEWramcbQzsJlH                   │
└─────────────────────────────────────────────────────────┘
```

**Better!** Now you can see exactly what was sold, map to recipes, and categorize properly.

---

## How to Get Product Names

### Step 1: Understand Your Current Charges

Your current Shift4 charges look like this:
```json
{
  "id": "char_Je0OgwE4VHiEWramcbQzsJlH",
  "amount": 799,
  "status": "successful",
  "currency": "USD",
  "card": {...},
  "created": 1763389736
}
```

❌ **No product information** → Shows as "Shift4 Sale"

---

### Step 2: Add Product Information

Update your Shift4 integration to include product data:

```json
{
  "id": "char_Je0OgwE4VHiEWramcbQzsJlH",
  "amount": 799,
  "status": "successful",
  "currency": "USD",
  "card": {...},
  "created": 1763389736,
  "metadata": {                           ← ADD THIS!
    "product_name": "Cheeseburger with Fries"
  }
}
```

✅ **Has product information** → Shows as "Cheeseburger with Fries"

---

### Step 3: Implementation Options

#### Option A: Using metadata (Recommended)
```javascript
const charge = await shift4.charges.create({
  amount: 799,
  currency: 'USD',
  card: paymentToken,
  metadata: {
    product_name: 'Cheeseburger with Fries'  // ← Add this line
  }
});
```

#### Option B: Using description
```javascript
const charge = await shift4.charges.create({
  amount: 799,
  currency: 'USD',
  card: paymentToken,
  description: 'Cheeseburger with Fries'  // ← Add this line
});
```

#### Option C: Multiple items (uses first)
```javascript
const charge = await shift4.charges.create({
  amount: 1598,
  currency: 'USD',
  card: paymentToken,
  metadata: {
    lineItems: [                           // ← Add this
      { name: 'Cheeseburger', quantity: 1 },
      { name: 'Fries', quantity: 1 }
    ]
  }
});
```
*Note: Currently uses "Cheeseburger" (first item)*

---

## Visual Flow Chart

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SHIFT4 CHARGE CREATED                            │
│                                                                     │
│  Has metadata.product_name?                                         │
│  ├─ YES → Use it! ✅                                                │
│  └─ NO                                                              │
│      │                                                              │
│      Has metadata.item_name?                                        │
│      ├─ YES → Use it! ✅                                            │
│      └─ NO                                                          │
│          │                                                          │
│          Has metadata.lineItems[0].name?                            │
│          ├─ YES → Use it! ✅                                        │
│          └─ NO                                                      │
│              │                                                      │
│              Has description?                                       │
│              ├─ YES → Use it! ✅                                    │
│              └─ NO → Use "Shift4 Sale" ⚠️                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    SYNC TO UNIFIED SALES                            │
│                                                                     │
│  Product name extracted → Saved to unified_sales table              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    DISPLAYED IN POS SALES                           │
│                                                                     │
│  User sees actual product name instead of "Shift4 Sale"             │
│  Can map to recipes, categorize, track inventory                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Real-World Examples

### Example 1: Restaurant POS
```javascript
// When customer orders "Double Bacon Burger + Large Fries"
function processOrder(items) {
  const total = items.reduce((sum, item) => sum + item.price, 0);
  const mainItem = items[0].name;
  const summary = items.length > 1 
    ? `${mainItem} + ${items.length - 1} more`
    : mainItem;
  
  const charge = shift4.charges.create({
    amount: total,
    currency: 'USD',
    card: token,
    metadata: {
      product_name: summary,           // "Double Bacon Burger + 1 more"
      order_items: JSON.stringify(items)
    }
  });
}
```

**Result in EasyShiftHQ:**
```
Double Bacon Burger + 1 more - $15.98
```

---

### Example 2: Coffee Shop
```javascript
// Simple single-item sale
const charge = shift4.charges.create({
  amount: 475,
  currency: 'USD',
  card: token,
  metadata: {
    product_name: 'Large Cappuccino'    // Simple!
  }
});
```

**Result in EasyShiftHQ:**
```
Large Cappuccino - $4.75
```

---

### Example 3: Pizza Delivery
```javascript
// Using description for backward compatibility
const charge = shift4.charges.create({
  amount: 1899,
  currency: 'USD',
  card: token,
  description: 'Large Pepperoni Pizza'  // Works too!
});
```

**Result in EasyShiftHQ:**
```
Large Pepperoni Pizza - $18.99
```

---

## Comparison: Before vs After

| Aspect | Before (No Product Info) | After (With Product Info) |
|--------|-------------------------|---------------------------|
| **Display Name** | "Shift4 Sale" | "Actual Product Name" |
| **Recipe Mapping** | ❌ Not possible | ✅ Can map to recipes |
| **Inventory Tracking** | ❌ Can't track products | ✅ Track by product |
| **Categorization** | ⚠️ Generic categories | ✅ Product-specific |
| **Reporting** | ⚠️ Vague "sales" | ✅ Detailed product sales |
| **P&L Analysis** | ⚠️ Limited insights | ✅ Product-level profitability |
| **Setup Required** | None | Update Shift4 integration |

---

## Quick Start Checklist

- [ ] **Step 1:** Identify where you create Shift4 charges in your code
- [ ] **Step 2:** Add `metadata.product_name` to charge creation
- [ ] **Step 3:** Test with a sample transaction
- [ ] **Step 4:** Verify in EasyShiftHQ POS Sales page
- [ ] **Step 5:** (Optional) Re-sync existing data if charges already have metadata

**Estimated time:** 15-30 minutes

---

## Need Help?

📖 **Full Documentation:**
- Implementation Guide: `docs/SHIFT4_PRODUCT_NAMES.md`
- Technical Details: `docs/SHIFT4_PRODUCT_INFO_IMPLEMENTATION.md`
- Integration Docs: `SHIFT4_INTEGRATION.md`

🔧 **Developer Resources:**
- Shift4 API: https://dev.shift4.com/docs/api/
- Code Examples: See `docs/SHIFT4_PRODUCT_NAMES.md`
- Test Scripts: `/tmp/test_shift4_*.sql`

💬 **Support:**
- Check troubleshooting section in documentation
- Review raw charge data in POS Sales detail view
- Contact support with sample charge JSON if stuck

---

## Benefits at a Glance

```
┌────────────────────────────────────────────────────────┐
│  BEFORE                    AFTER                       │
│  ───────────────────────────────────────────────────   │
│                                                        │
│  😕 Generic "Shift4 Sale"  →  😊 "Margherita Pizza"   │
│  ❌ Can't map recipes       →  ✅ Auto-map to recipes  │
│  ❌ No inventory tracking   →  ✅ Track by product     │
│  ⚠️  Vague reports          →  ✅ Detailed analytics   │
│  ⚠️  Generic categories     →  ✅ Smart categorization │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**The Result:** Better insights, easier management, smarter business decisions! 🚀

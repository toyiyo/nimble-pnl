# Receipt Scanner Price Fix - Implementation Summary

## Problem Statement

The receipt scanning AI prompt was asking for ambiguous `parsedPrice` which could mean either:
- **Unit price** (e.g., "$1.00 per avocado")
- **Line total** (e.g., "$2.00 for 2 avocados")

When the AI extracted the unit price, the code incorrectly divided it by quantity again, resulting in wrong unit costs:

**Example Bug:**
- Receipt shows: "2 Avocados @ $1.00 ea = $2.00"
- AI extracts: `parsedPrice: 1.00` (the unit price from "@ $1.00 ea")
- Code calculates: `unitPrice = 1.00 / 2 = $0.50` ❌ (should be $1.00)

## Solution Implemented

### 1. Updated AI Prompt (process-receipt/index.ts)

The prompt now explicitly requests both prices:

```typescript
"lineItems": [
  {
    "unitPrice": numeric_price_per_unit,    // NEW: Price per single item/unit
    "lineTotal": numeric_total_for_this_line, // NEW: Total for this line
    // ... other fields
  }
]
```

**Price Extraction Rules Added:**
- `unitPrice`: The price PER SINGLE ITEM/UNIT (e.g., "$1.00/ea", "$2.50/lb")
- `lineTotal`: The TOTAL PRICE for that line (quantity × unit price)
- If only ONE price is visible, AI determines context
- Examples given: "2 @ $1.00 = $2.00" → unitPrice=1.00, lineTotal=2.00

### 2. Added Validation & Normalization Logic

Added comprehensive price normalization after AI parsing:

```typescript
// Normalize and validate prices for each line item
parsedData.lineItems = parsedData.lineItems.map((item: any) => {
  let unitPrice = item.unitPrice;
  let lineTotal = item.lineTotal;
  const quantity = item.parsedQuantity || 1;

  // Handle backward compatibility with old parsedPrice field
  if (unitPrice === undefined && lineTotal === undefined && item.parsedPrice !== undefined) {
    lineTotal = item.parsedPrice;
    unitPrice = quantity > 0 ? lineTotal / quantity : lineTotal;
  }

  // If only unitPrice provided, calculate lineTotal
  if (unitPrice !== undefined && lineTotal === undefined) {
    lineTotal = unitPrice * quantity;
  }

  // If only lineTotal provided, calculate unitPrice
  if (lineTotal !== undefined && unitPrice === undefined) {
    unitPrice = quantity > 0 ? lineTotal / quantity : lineTotal;
  }

  // Validation: check if lineTotal ≈ quantity × unitPrice (allow 2% tolerance)
  if (unitPrice !== undefined && lineTotal !== undefined) {
    const expectedTotal = unitPrice * quantity;
    const tolerance = Math.max(0.02, expectedTotal * 0.02);

    if (Math.abs(lineTotal - expectedTotal) > tolerance) {
      console.warn(`⚠️ Price mismatch for "${item.parsedName}"`);
      // Trust lineTotal and recalculate unitPrice
      unitPrice = quantity > 0 ? lineTotal / quantity : lineTotal;
    }
  }

  return {
    ...item,
    unitPrice: unitPrice || 0,
    lineTotal: lineTotal || 0,
    parsedPrice: lineTotal || item.parsedPrice || 0, // Backward compat
  };
});
```

**Key Features:**
- ✅ Backward compatible with existing receipts using `parsedPrice`
- ✅ Calculates missing price field when only one is provided
- ✅ Validates prices with 2% tolerance for rounding errors
- ✅ Trusts `lineTotal` in case of mismatch (more reliable)

### 3. Database Migration

Created migration `20260107000000_add_unit_price_to_receipt_line_items.sql`:

```sql
-- Add unit_price column
ALTER TABLE receipt_line_items 
ADD COLUMN IF NOT EXISTS unit_price numeric;

-- Backfill existing records
UPDATE receipt_line_items
SET unit_price = CASE 
  WHEN parsed_quantity > 0 THEN parsed_price / parsed_quantity 
  ELSE parsed_price 
END
WHERE unit_price IS NULL AND parsed_price IS NOT NULL;

-- Add clarifying comments
COMMENT ON COLUMN receipt_line_items.unit_price IS 'Price per unit. parsed_price contains the line total.';
COMMENT ON COLUMN receipt_line_items.parsed_price IS 'Total price for this line item (quantity × unit_price)';
```

**Impact:**
- ✅ Existing data backfilled with calculated unit prices
- ✅ New receipts will have both `unit_price` and `parsed_price` (line total)
- ✅ No breaking changes for existing code

### 4. Updated TypeScript Interfaces & Hooks

**ReceiptLineItem Interface (useReceiptImport.tsx):**
```typescript
export interface ReceiptLineItem {
  // ... existing fields
  unit_price?: number | null;  // NEW: Price per unit
}
```

**Updated Unit Price Calculation:**
```typescript
// Calculate unit price - prefer stored unit_price, fallback to calculation
const unitPrice = item.unit_price 
  ? item.unit_price 
  : (item.parsed_quantity && item.parsed_quantity > 0) 
    ? (item.parsed_price || 0) / item.parsed_quantity 
    : (item.parsed_price || 0);
```

**Impact:**
- ✅ Uses `unit_price` directly when available (no division)
- ✅ Falls back to old calculation for legacy data
- ✅ Applied to both existing product updates and new product creation

### 5. Updated UI Display

**ReceiptMappingReview.tsx:**
```typescript
{item.parsed_quantity && item.parsed_quantity > 0 && item.parsed_price && (
  <div className="mt-2 space-y-1">
    <Badge variant="secondary">
      Unit: ${(item.unit_price || item.parsed_price / item.parsed_quantity).toFixed(2)}/{item.parsed_unit || 'unit'}
    </Badge>
    {item.parsed_quantity > 1 && (
      <Badge variant="outline" className="ml-2">
        Line Total: ${item.parsed_price.toFixed(2)}
      </Badge>
    )}
  </div>
)}
```

**Impact:**
- ✅ Shows both unit price and line total for clarity
- ✅ Only shows line total badge when quantity > 1
- ✅ Uses `unit_price` directly if available

### 6. Comprehensive Testing

Created two test suites:

**Unit Tests (receiptPriceNormalization.test.ts):**
- 11 test cases covering all scenarios
- Tests the normalization logic in isolation
- Validates bug fix: "CRITICAL: should prevent the bug case from problem statement"
- All tests passing ✅

**Manual Validation Script (validatePriceNormalization.ts):**
- Real-world scenarios from problem statement
- Interactive validation with clear output
- All scenarios passing ✅

## Test Results

### Unit Tests
```
✓ tests/unit/receiptPriceNormalization.test.ts (11 tests) 8ms
  Test Files  1 passed (1)
      Tests  11 passed (11)
```

### Manual Validation
```
✅ Test 1: Bug Case (2 Avocados @ $1.00 ea = $2.00) - PASS
✅ Test 2: Only line total visible (CHICKEN 5LB $15.00) - PASS
✅ Test 3: Only unit price visible (ONIONS $0.50/ea x 10) - PASS
✅ Test 4: Legacy format (parsedPrice only) - PASS
✅ Test 5: Price mismatch - trust lineTotal - PASS
```

## Validation Table

| Receipt Shows | AI Extracts | Result | Status |
|---------------|-------------|--------|--------|
| "2 @ $1.00 = $2.00" | unitPrice=1.00, lineTotal=2.00 | ✅ Uses unitPrice directly (1.00) | Fixed! |
| "CHICKEN 5LB $15.00" | lineTotal=15.00 | ✅ Calculates unitPrice = 15/5 = $3.00 | Works |
| "ONIONS $0.50/ea x 10" | unitPrice=0.50 | ✅ Calculates lineTotal = 0.50 × 10 = $5.00 | Works |
| Old format | parsedPrice=2.00 | ✅ Backward compatible | Works |
| Mismatched prices | unitPrice=1.00, lineTotal=5.00, qty=2 | ⚠️ Logs warning, trusts lineTotal, recalculates | Works |

## Backward Compatibility

✅ **Fully backward compatible:**
- Old receipts with `parsedPrice` only continue to work
- Existing database queries unchanged
- UI handles both old and new data formats
- Migration backfills existing data automatically

## Files Modified

1. `supabase/functions/process-receipt/index.ts` - Updated prompt and added validation
2. `supabase/migrations/20260107000000_add_unit_price_to_receipt_line_items.sql` - Database schema
3. `src/hooks/useReceiptImport.tsx` - Updated interface and logic
4. `src/components/ReceiptMappingReview.tsx` - UI updates
5. `tests/unit/receiptPriceNormalization.test.ts` - Unit tests
6. `tests/manual/validatePriceNormalization.ts` - Manual validation

## Next Steps for Manual Testing

To fully validate the fix with real receipts:

1. **Upload a test receipt** with clear unit prices (e.g., "2 @ $1.00 = $2.00")
2. **Process the receipt** and check the parsed data
3. **Verify in the UI** that both unit price and line total are shown correctly
4. **Import to inventory** and verify the product's `cost_per_unit` is correct
5. **Check database** to ensure `unit_price` column is populated

## Security & Performance

- ✅ No security vulnerabilities introduced
- ✅ No performance impact (simple arithmetic operations)
- ✅ Validation adds minimal overhead
- ✅ All existing RLS policies remain enforced

## Deployment Notes

1. Database migration will run automatically on deployment
2. Existing receipts will have `unit_price` backfilled
3. No code rollback needed - fully backward compatible
4. Monitor AI extraction for the first few receipts to ensure prompt changes work as expected

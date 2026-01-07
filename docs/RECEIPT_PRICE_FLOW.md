# Receipt Price Processing Flow

## Before (Buggy Behavior)

```
Receipt: "2 Avocados @ $1.00 ea = $2.00"
          └─────┬─────┘  └──┬──┘    └──┬──┘
                │           │          │
            Quantity    Unit Price  Line Total

AI Extraction (Ambiguous):
  parsedPrice: 1.00  ← Extracts unit price
  parsedQuantity: 2

Code Processing:
  unitPrice = parsedPrice / parsedQuantity
  unitPrice = 1.00 / 2
  unitPrice = $0.50  ❌ WRONG!

Result: Product cost is $0.50 instead of $1.00
```

## After (Fixed Behavior)

```
Receipt: "2 Avocados @ $1.00 ea = $2.00"
          └─────┬─────┘  └──┬──┘    └──┬──┘
                │           │          │
            Quantity    Unit Price  Line Total

AI Extraction (Clear):
  unitPrice: 1.00     ← Price per unit
  lineTotal: 2.00     ← Total for line
  parsedQuantity: 2

Validation:
  ✓ Check: lineTotal ≈ unitPrice × quantity?
  ✓ 2.00 ≈ 1.00 × 2 = 2.00 ✅

Code Processing:
  unitPrice = item.unit_price
  unitPrice = $1.00  ✅ CORRECT!

Database:
  unit_price: 1.00
  parsed_price: 2.00 (line total)

Result: Product cost is $1.00 ✅
```

## Scenario Matrix

### Scenario 1: Both prices provided
```
Input:  unitPrice=1.00, lineTotal=2.00, qty=2
Logic:  Validate prices match
Output: unitPrice=1.00, lineTotal=2.00 ✅
```

### Scenario 2: Only unit price provided
```
Input:  unitPrice=0.50, qty=10
Logic:  Calculate lineTotal = 0.50 × 10
Output: unitPrice=0.50, lineTotal=5.00 ✅
```

### Scenario 3: Only line total provided
```
Input:  lineTotal=15.00, qty=5
Logic:  Calculate unitPrice = 15.00 / 5
Output: unitPrice=3.00, lineTotal=15.00 ✅
```

### Scenario 4: Legacy format (parsedPrice only)
```
Input:  parsedPrice=6.00, qty=3
Logic:  Treat as lineTotal, calculate unitPrice
Output: unitPrice=2.00, lineTotal=6.00 ✅
```

### Scenario 5: Price mismatch
```
Input:  unitPrice=1.00, lineTotal=5.00, qty=10
Logic:  Expected: 1.00 × 10 = 10.00, got 5.00
        ⚠️  Mismatch! Trust lineTotal
        Recalculate: 5.00 / 10 = 0.50
Output: unitPrice=0.50, lineTotal=5.00 ✅
```

## Data Flow

```
┌─────────────────┐
│  Receipt Image  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  AI Processing  │ ← Updated prompt requests both prices
│  (OpenRouter)   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Edge Function                      │
│  (process-receipt/index.ts)         │
│                                     │
│  1. Parse AI response              │
│  2. Normalize prices                │ ← NEW: Validation logic
│     - Handle missing prices         │
│     - Validate consistency          │
│     - Trust lineTotal on mismatch   │
│  3. Store to database               │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Database                           │
│  (receipt_line_items)               │
│                                     │
│  - unit_price: 1.00  ← NEW field    │
│  - parsed_price: 2.00 (line total)  │
│  - parsed_quantity: 2               │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Hook (useReceiptImport)            │
│                                     │
│  unitPrice = item.unit_price ||     │ ← Uses unit_price directly
│              calculate()            │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  UI (ReceiptMappingReview)          │
│                                     │
│  Display:                           │
│  - Unit: $1.00/unit                 │
│  - Line Total: $2.00                │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Inventory Update                   │
│                                     │
│  Product.cost_per_unit = $1.00 ✅   │
└─────────────────────────────────────┘
```

## Key Improvements

1. **Explicit Price Types**: AI now knows to extract both unitPrice and lineTotal
2. **Validation Logic**: Detects and corrects price inconsistencies
3. **Backward Compatible**: Old receipts still work with parsedPrice
4. **Trust lineTotal**: When in doubt, trust the total (harder to misread than small unit prices)
5. **Database Schema**: New `unit_price` column preserves the correct value
6. **No Re-division**: Code uses `unit_price` directly instead of dividing again

## Testing Coverage

✅ Normal case: Both prices correct
✅ Only unit price: Calculates line total
✅ Only line total: Calculates unit price
✅ Legacy format: Backward compatible
✅ Price mismatch: Corrects and logs warning
✅ Edge cases: Zero quantity, single item, bulk items
✅ Rounding tolerance: Allows 2% variance

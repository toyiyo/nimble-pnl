# Receipt Import Purchase Date Feature

## Overview
This feature allows the system to track and use the actual purchase date from receipts instead of defaulting to the current date when importing inventory items. This provides accurate historical tracking in audit logs.

## Problem Statement
Previously, when users imported inventory items from receipts uploaded days or weeks after the actual purchase, the system would record the inventory transaction with today's date. This created inaccurate audit logs and made it difficult to track historical inventory costs and purchases accurately.

## Solution Architecture

### Database Schema Changes

#### receipt_imports Table
- **New Field**: `purchase_date` (DATE, nullable)
- **Purpose**: Stores the actual date of purchase from the receipt
- **Source Priority**:
  1. AI-extracted date from receipt text (OCR)
  2. Date parsed from filename
  3. User-selected date via UI
  4. NULL if none available

#### inventory_transactions Table
- **New Field**: `transaction_date` (DATE, nullable)
- **Purpose**: Records when the inventory transaction actually occurred
- **Default**: Falls back to `created_at` date if not specified
- **Usage**: Set to `purchase_date` from receipt during import

### Backend Implementation

#### AI Receipt Processing (Edge Function)
Location: `supabase/functions/process-receipt/index.ts`

**New Functionality**:
1. **AI Extraction**: Updated prompt to extract `purchaseDate` from receipt
   - Looks for invoice date, order date, delivery date
   - Returns in YYYY-MM-DD format

2. **Date Validation**: `parsePurchaseDate(dateString)`
   - Validates date is not in future
   - Rejects dates before year 2000
   - Returns null for invalid dates

3. **Filename Extraction**: `extractDateFromFilename(filename)`
   - Pattern 1: YYYY-MM-DD (e.g., `receipt-2024-01-15.pdf`)
   - Pattern 2: MM-DD-YYYY (e.g., `invoice-01-15-2024.pdf`)
   - Handles various separators: `-`, `_`, `.`, `/`

**Processing Flow**:
```typescript
// 1. Try AI extraction first
let purchaseDate = parsePurchaseDate(aiExtractedDate);

// 2. Fall back to filename if AI fails
if (!purchaseDate && fileName) {
  purchaseDate = extractDateFromFilename(fileName);
}

// 3. Store in database
await supabase.from('receipt_imports').update({
  purchase_date: purchaseDate,
  // ... other fields
});
```

### Frontend Implementation

#### ReceiptMappingReview Component
Location: `src/components/ReceiptMappingReview.tsx`

**New UI Elements**:
1. **Date Picker Section**: Added after vendor information
   - Shows extracted/selected purchase date
   - Calendar component from shadcn/ui
   - Disabled after import is complete

2. **Date Selection Handler**: `handlePurchaseDateChange(date)`
   - Updates `receipt_imports.purchase_date` via API
   - Shows toast confirmation
   - Visual feedback with badge when date is set

**UI Code**:
```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">
      <CalendarIcon className="mr-2 h-4 w-4" />
      {purchaseDate 
        ? format(new Date(purchaseDate), 'PPP')
        : <span>Pick a date</span>}
    </Button>
  </PopoverTrigger>
  <PopoverContent>
    <Calendar
      selected={purchaseDate ? new Date(purchaseDate) : undefined}
      onSelect={handlePurchaseDateChange}
      disabled={(date) => date > new Date() || date < new Date("2000-01-01")}
    />
  </PopoverContent>
</Popover>
```

#### Receipt Import Hook
Location: `src/hooks/useReceiptImport.tsx`

**Updated Functionality**:
1. **Fetch Purchase Date**: Added to `bulkImportLineItems()` query
```typescript
const { data: receiptData } = await supabase
  .from('receipt_imports')
  .select('vendor_name, supplier_id, purchase_date')
  .eq('id', receiptId)
  .single();
```

2. **Use in Transactions**: Applied to all inventory transaction inserts
```typescript
await supabase.from('inventory_transactions').insert({
  // ... other fields
  transaction_date: purchaseDate  // Use actual purchase date
});
```

## Testing

### Date Extraction Tests
Location: `tests/verify-date-extraction.js`

**Test Coverage**:
- ✅ Valid ISO date strings (2024-01-15)
- ✅ Date with time (2024-01-15T10:30:00)
- ✅ Text date formats (January 15, 2024)
- ✅ Future date rejection
- ✅ Pre-2000 date rejection
- ✅ Filename formats (YYYY-MM-DD, MM-DD-YYYY)
- ✅ Various separators (-, _, ., /)
- ✅ Real-world patterns (Sysco, US Foods)
- ✅ Invalid inputs (null, empty, malformed)

**Run Tests**:
```bash
node tests/verify-date-extraction.js
```

**Expected Output**:
```
🧪 Testing Date Extraction Functions
📊 Test Results: 19 passed, 0 failed
🎉 All tests passed!
```

## User Flow

### Upload Receipt with Date in Filename
```
1. User uploads: "sysco_invoice_2024-01-15.pdf"
2. System processes receipt
3. AI extracts: "Invoice Date: 01/15/2024"
   OR filename extracts: "2024-01-15"
4. Receipt review shows: "Purchase Date: January 15, 2024 ✓"
5. User can accept or change date
6. On import: Inventory transactions dated 2024-01-15
```

### Upload Receipt without Date
```
1. User uploads: "receipt.pdf"
2. System processes receipt
3. No date found (AI fails, filename has no date)
4. Receipt review shows: "Pick a date" button
5. User selects date from calendar
6. On import: Inventory transactions use selected date
```

### Manual Date Override
```
1. User uploads: "old_receipt_12-01-2024.pdf"
2. System extracts: "2024-12-01"
3. User realizes actual date was "2024-11-30"
4. User clicks date picker, selects Nov 30, 2024
5. System updates: purchase_date = "2024-11-30"
6. On import: Inventory transactions dated 2024-11-30
```

## Data Migration

The migration automatically handles existing data:

```sql
-- Set transaction_date for existing records
UPDATE public.inventory_transactions
SET transaction_date = created_at::date
WHERE transaction_date IS NULL;
```

This ensures all existing inventory transactions have a valid transaction_date based on when they were created.

## Benefits

### For Users
1. **Accurate Historical Tracking**: Inventory transactions show true purchase dates
2. **Better Audit Logs**: Can track when inventory was actually purchased
3. **Flexible Input**: AI extracts dates automatically, with manual override option
4. **Multiple Date Sources**: Filename, OCR, or manual selection

### For Business Operations
1. **Accurate Cost Analysis**: Historical costs tied to actual purchase dates
2. **Better Forecasting**: Can analyze purchase patterns by actual dates
3. **Supplier Analysis**: Track when purchases were made from each supplier
4. **Compliance**: Accurate records for audits and tax purposes

## Supported Date Formats

### AI Extraction
- ISO format: `2024-01-15`
- US format: `01/15/2024`, `1/15/2024`
- Text format: `January 15, 2024`, `Jan 15, 2024`
- European format: `15/01/2024`, `15.01.2024`

### Filename Extraction
- ISO format: `2024-01-15`, `2024_01_15`, `2024.01.15`
- US format: `01-15-2024`, `01_15_2024`, `01.15.2024`
- Mixed separators: `2024/01/15`, `01.15.2024`

### Examples
```
✅ "sysco_invoice_2024-01-15.pdf" → 2024-01-15
✅ "US-Foods-01-15-2024.pdf" → 2024-01-15
✅ "receipt_2024_01_15.jpg" → 2024-01-15
✅ "invoice.2024.01.15.pdf" → 2024-01-15
❌ "receipt.pdf" → null (user must select)
❌ "my-receipt-123.pdf" → null (no date pattern)
```

## API Changes

### ReceiptImport Interface
```typescript
interface ReceiptImport {
  // ... existing fields
  purchase_date: string | null;  // NEW: YYYY-MM-DD format
}
```

### Inventory Transaction Insert
```typescript
await supabase.from('inventory_transactions').insert({
  restaurant_id: string,
  product_id: string,
  quantity: number,
  unit_cost: number,
  total_cost: number,
  transaction_type: 'purchase',
  supplier_id: string | null,
  transaction_date: string | null,  // NEW: Uses purchase_date
  // ... other fields
});
```

## Future Enhancements

### Potential Improvements
1. **Time Zone Support**: Handle receipts from different time zones
2. **Multi-Date Receipts**: Handle receipts with both order and delivery dates
3. **Date Confidence Scores**: Show confidence level for AI-extracted dates
4. **Bulk Date Update**: Allow updating purchase date for multiple receipts
5. **Date Range Validation**: Warn if date is outside typical purchase patterns

### Analytics Opportunities
1. **Purchase Timing Analysis**: Track when purchases typically occur
2. **Seasonal Patterns**: Identify seasonal purchasing trends
3. **Supplier Lead Times**: Calculate time between order and delivery dates
4. **Cost Trends**: Analyze price changes over actual purchase dates

## Troubleshooting

### Date Not Extracted
**Symptom**: Purchase date shows "Pick a date"
**Possible Causes**:
1. Filename has no recognizable date pattern
2. AI couldn't find date in receipt text
3. Receipt is poor quality (blurry, skewed)

**Solution**: Manually select the correct date from calendar picker

### Wrong Date Extracted
**Symptom**: Date is extracted but incorrect
**Possible Causes**:
1. Multiple dates on receipt (order vs delivery)
2. Ambiguous date format (01/02/2024 - US vs European)
3. Filename date differs from receipt date

**Solution**: Click the date picker and select the correct date

### Future Date Warning
**Symptom**: System rejects a date
**Cause**: Date is in the future (validation check)
**Solution**: Verify the date and enter the correct past date

## Security Considerations

### Date Validation
- Prevents future dates (can't backdate to future)
- Rejects dates before 2000 (likely errors)
- Validates date format before database insert

### Permissions
- Only users with receipt import permissions can set dates
- Row Level Security (RLS) enforced on all database operations
- Audit trail maintained via `created_at` and `updated_at` timestamps

## Performance Impact

### Minimal Overhead
- Date extraction adds ~50-100ms to receipt processing
- Filename parsing is synchronous and fast (<1ms)
- No impact on existing functionality
- Database queries use existing indexes

### Optimization
- Date parsing happens only once during receipt processing
- Cached in `receipt_imports` table for reuse during import
- No additional API calls required during import flow

## Backwards Compatibility

### Existing Data
- All existing inventory transactions get `transaction_date = created_at::date`
- No breaking changes to existing queries
- Existing receipts show "Pick a date" button (optional)

### Existing Code
- All changes are additive (new fields, not modifications)
- Existing import flow works with or without purchase_date
- NULL values handled gracefully throughout the system

# Bank Statement Upload Feature - Implementation Summary

## Overview
This feature allows restaurant managers to upload PDF bank statements when they don't have an integrated bank connection yet. The system uses AI to automatically extract transactions from the PDF, allows users to review and edit them, and then imports them into the banking system where they appear alongside integrated bank transactions.

## Architecture

### Database Schema

#### `bank_statement_uploads` Table
Tracks uploaded bank statement files and their processing status.

```sql
CREATE TABLE public.bank_statement_uploads (
  id UUID PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  bank_name TEXT,
  statement_period_start DATE,
  statement_period_end DATE,
  raw_file_url TEXT,  -- Path in Supabase storage
  file_name TEXT,
  file_size INTEGER,
  processed_at TIMESTAMPTZ,
  status TEXT,  -- 'uploaded', 'processed', 'imported', 'error'
  raw_ocr_data JSONB,  -- Full AI response
  transaction_count INTEGER,
  total_debits NUMERIC(15, 2),
  total_credits NUMERIC(15, 2),
  processed_by UUID,
  error_message TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

#### `bank_statement_lines` Table
Staging table for transactions before they're imported to `bank_transactions`.

```sql
CREATE TABLE public.bank_statement_lines (
  id UUID PRIMARY KEY,
  statement_upload_id UUID NOT NULL,
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  transaction_type TEXT,  -- 'debit', 'credit', 'unknown'
  balance NUMERIC(15, 2),
  line_sequence INTEGER NOT NULL,
  confidence_score NUMERIC(3, 2),
  is_imported BOOLEAN DEFAULT FALSE,
  imported_transaction_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

#### Enhanced `bank_transactions` Table
Added columns to support manual uploads:

```sql
ALTER TABLE public.bank_transactions 
  ADD COLUMN source TEXT DEFAULT 'bank_integration',  -- or 'manual_upload'
  ADD COLUMN statement_upload_id UUID;
```

### Edge Function: `process-bank-statement`

Location: `supabase/functions/process-bank-statement/index.ts`

**Purpose:** Extract transaction data from uploaded PDF bank statements using AI.

**AI Processing:**
- Uses OpenRouter API with multi-model fallback strategy
- Primary model: Gemini 2.5 Flash (high token limit, good for long statements)
- Fallback models: Llama 4 Maverick Free, Gemma 3 27B Free
- Streaming enabled to handle large statements (100+ transactions)

**Input:**
```typescript
{
  statementUploadId: string,
  pdfUrl: string  // Signed URL to PDF in storage
}
```

**Output:**
```typescript
{
  success: true,
  bankName: string,
  transactionCount: number,
  totalDebits: number,
  totalCredits: number
}
```

**Extracted Data:**
- Bank name
- Statement period (start/end dates)
- Account number (last 4 digits only)
- Opening/closing balances
- All transactions with:
  - Date
  - Description/payee
  - Amount (negative for debits, positive for credits)
  - Transaction type
  - Running balance (if available)
  - Confidence score (0.0-1.0)

### Frontend Components

#### `BankStatementUpload.tsx`
Upload interface for PDF bank statements.

**Features:**
- File input validation (PDF only)
- Progress indicator during upload and processing
- Status messages for each step
- Error handling with user-friendly messages

**User Flow:**
1. User selects PDF file
2. File uploads to Supabase storage
3. Edge function processes PDF with AI
4. Shows success message when ready for review

#### `BankStatementReview.tsx`
Review and edit interface for extracted transactions.

**Features:**
- Summary card showing bank name, period, totals
- Editable transaction table
- Inline editing for date, description, and amount
- Visual indicators for transaction type (debit/credit)
- Import status tracking
- Bulk import button

**Columns:**
- Date (editable)
- Description (editable)
- Amount (editable with color coding)
- Type (badge: debit/credit)
- Status (pending/imported)
- Actions (edit button)

#### `useBankStatementImport.tsx` Hook
Central hook managing all bank statement operations.

**Methods:**
- `uploadBankStatement(file)` - Upload PDF to storage
- `processBankStatement(id)` - Trigger AI processing
- `getBankStatementUploads()` - List all uploads
- `getBankStatementDetails(id)` - Get upload details
- `getBankStatementLines(id)` - Get extracted transactions
- `updateStatementLine(id, updates)` - Edit a transaction
- `importStatementLines(id)` - Import to bank_transactions

**State Management:**
- `isUploading` - Upload in progress
- `isProcessing` - AI processing in progress

### UI Integration

Added new tab to Banking page (`src/pages/Banking.tsx`):

```tsx
<TabsTrigger value="upload_statement">
  <Upload className="h-4 w-4 sm:mr-2" />
  Upload Statement
</TabsTrigger>

<TabsContent value="upload_statement">
  {!activeStatementId ? (
    <BankStatementUpload onStatementProcessed={setActiveStatementId} />
  ) : (
    <BankStatementReview 
      statementUploadId={activeStatementId}
      onImportComplete={() => {
        setActiveStatementId(null);
        setActiveTab('for_review');
      }}
    />
  )}
</TabsContent>
```

## Data Flow

### Upload & Process Flow
```
1. User uploads PDF
   ↓
2. PDF stored in Supabase storage (receipt-images bucket)
   ↓
3. Record created in bank_statement_uploads (status='uploaded')
   ↓
4. Generate signed URL for PDF
   ↓
5. Call process-bank-statement edge function
   ↓
6. AI extracts transactions
   ↓
7. Update bank_statement_uploads (status='processed')
   ↓
8. Create records in bank_statement_lines
   ↓
9. Show review interface
```

### Import Flow
```
1. User reviews/edits transactions
   ↓
2. User clicks "Import"
   ↓
3. Create/find "Manual Upload" virtual bank connection
   ↓
4. For each unimported line:
   - Create bank_transaction record
   - Set source='manual_upload'
   - Link to statement_upload_id
   - Mark line as imported
   ↓
5. Update bank_statement_uploads (status='imported')
   ↓
6. Navigate to "For Review" tab
   ↓
7. Transactions appear in normal bank transaction list
```

## Virtual Bank Connection

Manual uploads require a `connected_bank_id` to maintain data consistency. The system creates a virtual bank connection:

**Properties:**
- Institution name: "Manual Upload"
- Stripe ID: `manual_{restaurant_id}`
- Status: 'connected'
- Created once per restaurant, reused for all manual uploads

This allows manual transactions to:
- Appear in the same lists as integrated transactions
- Be categorized using the same workflow
- Be reconciled with other transactions
- Maintain referential integrity

## Security Considerations

### Row Level Security (RLS)
All new tables have RLS enabled with policies ensuring:
- Users can only see data for their restaurants
- Only owners/managers can upload and import statements

### API Keys
- OpenRouter API key stored in edge function environment
- Never exposed to client
- Logged in Braintrust for monitoring

### File Storage
- PDFs stored in existing receipt-images bucket
- Path structure: `{restaurant_id}/bank-statements/{filename}`
- Signed URLs generated with 1-hour expiration
- No public access to files

### Data Validation
- File type validation (PDF only)
- File size limits (5MB) - enforced both client-side and server-side
- Transaction data validation before import
- Confidence scores tracked for quality assurance

## Error Handling

### Upload Errors
- Invalid file type → User-friendly error message
- Upload failure → Toast notification with retry option
- File too large (>5MB) → Clear size limit message with suggestion to split file

### Processing Errors
- AI timeout (90s) → Graceful abort with message
- Resource exhaustion (WORKER_LIMIT) → Prevented by file size validation
- AI parsing failure → Fallback error state
- No transactions found → User notification
- Invalid JSON → Error logged, user notified
- Memory overflow → Prevented by streaming buffer limits (100KB)

### Import Errors
- Database constraint violations → Transaction rollback
- Missing required fields → Skip line with warning
- Network errors → Retry mechanism
- Batch insertion failure → Status updated with partial progress

## Testing Recommendations

### Unit Tests
1. Hook methods (upload, process, import)
2. Data transformation functions
3. Validation logic

### Integration Tests
1. Upload PDF → Process → Review → Import flow
2. Error handling for each step
3. RLS policy enforcement
4. Transaction visibility in main list

### E2E Tests
```typescript
test('Upload bank statement and import transactions', async () => {
  // 1. Navigate to Banking > Upload Statement
  await page.goto('/banking');
  await page.click('text=Upload Statement');
  
  // 2. Upload PDF
  await page.setInputFiles('input[type="file"]', 'test-statement.pdf');
  
  // 3. Wait for processing
  await page.waitForText('Statement processed successfully');
  
  // 4. Review transactions
  const transactionCount = await page.locator('table tbody tr').count();
  expect(transactionCount).toBeGreaterThan(0);
  
  // 5. Edit a transaction
  await page.click('button[aria-label="Edit"]');
  await page.fill('input[type="text"]', 'Updated description');
  await page.click('text=Save');
  
  // 6. Import
  await page.click('text=Import');
  
  // 7. Verify in transaction list
  await page.click('text=For Review');
  await page.waitForText('Updated description');
});
```

## Performance Considerations

### Optimizations
- Streaming enabled for AI responses with memory-efficient buffer management (100KB limit)
- Token limits optimized per model (3000 max to prevent resource exhaustion)
- Batch operations for importing multiple transactions (50 per batch)
- File size validation before processing (5MB limit)
- Indexes on frequently queried columns
- Incremental transaction insertion to avoid memory spikes

### Scalability
- Handles statements with up to 150 transactions efficiently
- File size limited to 5MB to prevent Edge function resource exhaustion
- Processes in under 90 seconds for most statements
- Storage costs minimal (PDFs compressed)
- Database queries optimized with proper indexes
- Memory usage carefully managed to prevent WORKER_LIMIT errors

### Resource Management
- Pre-processing file size validation
- Streaming response buffer capped at 100KB
- Batch inserts limited to 50 transactions at a time
- Automatic error recovery and status updates
- Graceful degradation on resource constraints

## Future Enhancements

### Potential Improvements
1. **Statement Templates** - Learn bank-specific formats
2. **Auto-categorization** - Apply rules during import
3. **Duplicate Detection** - Warn if transactions already exist
4. **Multi-page Support** - Better handling of long statements
5. **CSV Support** - Alternative to PDF for some banks
6. **Batch Upload** - Upload multiple statements at once
7. **Historical Data** - View past uploads
8. **Export** - Download processed data as CSV

### AI Model Improvements
1. **Fine-tuning** - Train on restaurant-specific statements
2. **Confidence Thresholds** - Auto-flag low-confidence items
3. **Pattern Learning** - Remember corrections for future uploads
4. **Multi-language** - Support international statements

## Usage Guide

### For End Users

**Step 1: Upload Statement**
1. Navigate to Banking → Upload Statement tab
2. Click "Select Bank Statement PDF"
3. Choose your PDF file (max 10MB)
4. Wait for processing (usually 10-30 seconds)

**Step 2: Review Transactions**
1. Check bank name and statement period
2. Review extracted transactions
3. Click Edit icon to fix any errors
4. Verify amounts match your statement

**Step 3: Import**
1. Click "Import X Transactions" button
2. Wait for import to complete
3. Transactions appear in "For Review" tab
4. Categorize them like normal transactions

**Tips:**
- Upload recent statements first
- Check for duplicate transactions before importing
- Review AI extractions carefully
- Save original PDFs for reference

### For Developers

**Adding New Features:**
1. Follow existing patterns in `useBankStatementImport.tsx`
2. Add TypeScript types for new data structures
3. Update RLS policies if needed
4. Add tests for new functionality

**Debugging:**
1. Check edge function logs in Supabase dashboard
2. Review Braintrust for AI call metrics
3. Inspect raw_ocr_data JSONB for full AI response
4. Check confidence_score for quality issues

## Monitoring & Analytics

### Metrics to Track
- Upload success rate
- AI processing time
- Extraction accuracy
- Import completion rate
- User corrections frequency

### Logging
- All AI calls logged to Braintrust
- Edge function errors logged to Supabase
- User actions tracked (upload, review, import)

## Support & Troubleshooting

### Common Issues

**"File too large" error**
- Maximum file size is 5MB
- Split large statements into multiple PDFs (by month/quarter)
- Consider uploading statements in smaller time periods
- Contact support if you need help with large historical imports

**"Processing timed out"**
- Timeout is 90 seconds for processing
- Files over 5MB are automatically rejected
- Very complex layouts may take longer
- Try a cleaner/simpler statement format if available

**"Resource limit exceeded" (WORKER_LIMIT)**
- This error should now be prevented by file size limits
- If you still see it, the file may have extremely dense content
- Contact support with the file details

**"No transactions found"**
- PDF may be image-based (scanned)
- Try a digital PDF from your bank
- Check if text is selectable in PDF

**"Duplicate transactions"**
- Check if statement period overlaps with existing data
- Review transaction dates before importing
- Use filters to find duplicates

**"Wrong amounts extracted"**
- Review and edit before importing
- Check decimal places match statement
- Report persistent issues for AI improvement

## Conclusion

This bank statement upload feature provides a complete solution for restaurants without automated bank integrations. It maintains consistency with existing bank transaction workflows while offering flexibility through manual uploads and AI-assisted extraction. The architecture is scalable, secure, and follows best practices established in the receipt import feature.

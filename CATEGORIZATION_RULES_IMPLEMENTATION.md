# Enhanced Categorization Rules Implementation Summary

## Overview
This implementation adds a comprehensive categorization rules system that automatically categorizes both bank transactions and POS sales based on pattern matching rules. The system replaces the basic supplier-only rules with a flexible, multi-criteria pattern matching engine with AI-powered rule suggestions.

## Key Features

### 1. Multi-Factor Pattern Matching
Rules can match on combinations of:
- **For Bank Transactions:**
  - Description pattern (exact, contains, starts_with, ends_with, regex)
  - Amount range (min/max)
  - Supplier
  - Transaction type (debit/credit)

- **For POS Sales:**
  - Item name pattern (exact, contains, starts_with, ends_with, regex)
  - POS category
  - Amount range (min/max)

### 2. Rule Management
- **Create** rules with multiple conditions
- **Edit** existing rules
- **Enable/Disable** rules (active/inactive)
- **Auto-apply** toggle - when enabled, rules apply automatically to new transactions
- **Priority** system - higher priority rules match first
- **Statistics** - track how many times each rule has been applied
- **AI Suggestions** - analyze existing categorizations to suggest new rules

### 3. Rule Application
- **Automatic**: Rules with auto_apply=true run automatically when new transactions/sales are synced
- **Bulk Apply**: Apply all active rules to existing uncategorized records
- **Targeted**: Apply rules to either bank transactions, POS sales, or both

### 4. AI-Powered Rule Suggestions (NEW)
- **Analyze** up to 100 recent categorized transactions or POS sales
- **Identify** patterns in descriptions, amounts, suppliers, POS categories
- **Suggest** rules with confidence levels (high/medium/low)
- **Historical** match counts show how many existing records match the suggested pattern
- **One-click** application - pre-fills rule form for review before saving
- **Multi-model fallback** - uses OpenRouter with same pattern as recipe suggestions

## Database Schema

### New Table: `categorization_rules`
```sql
CREATE TABLE categorization_rules (
  id UUID PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  rule_name TEXT NOT NULL,
  applies_to TEXT NOT NULL, -- 'bank_transactions', 'pos_sales', 'both'
  
  -- Pattern matching fields
  description_pattern TEXT,
  description_match_type TEXT,
  amount_min NUMERIC,
  amount_max NUMERIC,
  supplier_id UUID,
  transaction_type TEXT, -- 'debit', 'credit', 'any'
  pos_category TEXT,
  item_name_pattern TEXT,
  item_name_match_type TEXT,
  
  -- Target category
  category_id UUID NOT NULL,
  
  -- Settings
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  auto_apply BOOLEAN DEFAULT false,
  
  -- Statistics
  apply_count INTEGER DEFAULT 0,
  last_applied_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Key Functions

1. **Pattern Matching**
   - `matches_bank_transaction_rule(rule_id, transaction_json)` - Check if transaction matches a rule
   - `matches_pos_sale_rule(rule_id, sale_json)` - Check if POS sale matches a rule

2. **Rule Finding**
   - `find_matching_rules_for_bank_transaction(restaurant_id, transaction_json)` - Find highest priority matching rule
   - `find_matching_rules_for_pos_sale(restaurant_id, sale_json)` - Find highest priority matching rule

3. **Bulk Application**
   - `apply_rules_to_bank_transactions(restaurant_id)` - Apply all rules to uncategorized bank transactions
   - `apply_rules_to_pos_sales(restaurant_id)` - Apply all rules to uncategorized POS sales

4. **Auto-Apply Triggers**
   - `auto_apply_bank_categorization_rules()` - Trigger function for bank_transactions
   - `auto_apply_pos_categorization_rules()` - Trigger function for unified_sales

## Frontend Components

### 1. Enhanced Hook: `useCategorizationRulesV2`
Located: `src/hooks/useCategorizationRulesV2.tsx`

Provides:
- `useCategorizationRulesV2(appliesTo?)` - Fetch rules
- `useCreateRuleV2()` - Create a new rule
- `useUpdateRuleV2()` - Update existing rule
- `useDeleteRuleV2()` - Delete a rule
- `useApplyRulesV2()` - Bulk apply rules

### 2. Enhanced Dialog: `EnhancedCategoryRulesDialog`
Located: `src/components/banking/EnhancedCategoryRulesDialog.tsx`

Features:
- Tabbed interface for Bank Transactions and POS Sales
- Rule builder with dynamic fields based on tab
- Display existing rules with conditions
- Toggle active/auto-apply switches
- Edit and delete rules
- Bulk apply to existing records button

### 3. Integration Points
- **Banking Page** (`src/pages/Banking.tsx`) - Added "Categorization Rules" button
- **POS Sales Page** (`src/pages/POSSales.tsx`) - Added "Categorization Rules" button

## Edge Functions

### `apply-categorization-rules`
Located: `supabase/functions/apply-categorization-rules/index.ts`

Purpose: Apply categorization rules to existing uncategorized records

Parameters:
- `restaurantId` (required)
- `applyTo` (optional: 'bank_transactions', 'pos_sales', 'both') - default: 'both'

Returns:
```json
{
  "success": true,
  "message": "Applied rules to X of Y transactions",
  "count": X,
  "details": {
    "bank": { "applied_count": N, "total_count": M },
    "pos": { "applied_count": P, "total_count": Q }
  }
}
```

### `ai-suggest-categorization-rules` (NEW)
Located: `supabase/functions/ai-suggest-categorization-rules/index.ts`

Purpose: Analyze categorized transactions/sales and suggest new categorization rules using AI

Parameters:
- `restaurantId` (required)
- `source` (optional: 'bank' | 'pos') - default: 'bank'
- `limit` (optional: number) - default: 100 (max categorized records to analyze)

Returns:
```json
{
  "rules": [
    {
      "rule_name": "Amazon Supplies",
      "pattern_type": "description",
      "description_pattern": "Amazon",
      "description_match_type": "contains",
      "account_code": "6100",
      "category_id": "uuid",
      "category_name": "Office Supplies",
      "confidence": "high",
      "historical_matches": 15,
      "reasoning": "Consistent categorization of Amazon purchases",
      "priority": 8,
      "applies_to": "bank_transactions"
    }
  ],
  "total_analyzed": 100,
  "source": "bank"
}
```

**AI Model Fallback:**
- Uses OpenRouter API with multi-model fallback
- Primary: Gemini 2.5 Flash Lite
- Free models: Llama 4 Maverick Free, Gemma 3 27B Free
- Paid fallback: Claude Sonnet 4.5, Llama 4 Maverick

**Pattern Analysis:**
- Identifies recurring description/item name patterns
- Detects amount ranges that consistently map to categories
- Recognizes supplier associations
- Analyzes transaction types and POS categories
- Calculates confidence based on pattern consistency
- Counts historical matches in the analyzed dataset

## Auto-Apply Integration

### Bank Transactions
1. **Trigger on Insert**: `auto_categorize_bank_transaction` trigger runs BEFORE INSERT
2. **Sync Function Update**: `stripe-sync-transactions` now calls `apply_rules_to_bank_transactions()` after importing new transactions
3. **Fallback**: Uncategorized transactions still get default "Uncategorized Income/Expense" categories

### POS Sales
1. **Trigger on Insert**: `auto_categorize_pos_sale` trigger runs BEFORE INSERT on `unified_sales`
2. **Automatic**: Works automatically when Square/Clover sync functions insert new sales

## Migration Path

### Old System → New System
The migration automatically converts existing `supplier_categorization_rules` to the new format:
```sql
INSERT INTO categorization_rules (...)
SELECT 
  restaurant_id,
  'Supplier: ' || s.name AS rule_name,
  'bank_transactions' AS applies_to,
  supplier_id,
  default_category_id,
  auto_apply,
  ...
FROM supplier_categorization_rules
```

Users' existing supplier-based rules are preserved and continue to work.

## Usage Examples

### Example 1: Simple Supplier Rule
```javascript
createRule({
  restaurantId: 'xxx',
  ruleName: 'Sysco Food Purchases',
  appliesTo: 'bank_transactions',
  supplierId: 'sysco-id',
  categoryId: 'food-cogs-id',
  autoApply: true
});
```

### Example 2: Description Pattern Rule
```javascript
createRule({
  restaurantId: 'xxx',
  ruleName: 'Amazon Purchases',
  appliesTo: 'bank_transactions',
  descriptionPattern: 'Amazon',
  descriptionMatchType: 'contains',
  categoryId: 'supplies-expense-id',
  autoApply: true
});
```

### Example 3: Amount Range Rule
```javascript
createRule({
  restaurantId: 'xxx',
  ruleName: 'Large Equipment Purchases',
  appliesTo: 'bank_transactions',
  amountMin: 1000,
  transactionType: 'debit',
  categoryId: 'equipment-id',
  autoApply: false  // Manual review for large purchases
});
```

### Example 4: POS Item Pattern Rule
```javascript
createRule({
  restaurantId: 'xxx',
  ruleName: 'Coffee Sales',
  appliesTo: 'pos_sales',
  itemNamePattern: 'Coffee',
  itemNameMatchType: 'contains',
  categoryId: 'beverage-revenue-id',
  priority: 10,
  autoApply: true
});
```

### Example 5: Combined Criteria Rule
```javascript
createRule({
  restaurantId: 'xxx',
  ruleName: 'Small Sysco Orders',
  appliesTo: 'bank_transactions',
  supplierId: 'sysco-id',
  amountMax: 500,
  categoryId: 'small-supplies-id',
  priority: 5,
  autoApply: true
});
```

### Example 6: Using AI Suggestions
```javascript
// Request AI analysis
const { mutate: aiSuggestRules } = useAISuggestRules();

aiSuggestRules({ 
  restaurantId: 'xxx',
  source: 'bank',  // or 'pos'
  limit: 100
}, {
  onSuccess: (data) => {
    // data.rules contains AI-suggested rules
    // Each suggestion includes:
    // - rule_name, pattern_type, pattern values
    // - category_id, category_name
    // - confidence (high/medium/low)
    // - historical_matches count
    // - reasoning explanation
    
    // User can review and accept suggestions in UI
    // Clicking "Use This Rule" pre-fills the form
  }
});
```

## Testing Checklist

- [ ] Create a bank transaction rule with description pattern
- [ ] Create a bank transaction rule with supplier
- [ ] Create a POS sales rule with item name pattern
- [ ] Create a rule with amount range
- [ ] Test auto-apply toggle
- [ ] Test active/inactive toggle
- [ ] Test bulk apply to existing transactions
- [ ] Test rule priority (create overlapping rules)
- [ ] Verify auto-categorization on new bank transaction sync
- [ ] Verify auto-categorization on new POS sales sync
- [ ] Test edit rule functionality
- [ ] Test delete rule functionality
- [ ] Verify rule statistics (apply_count, last_applied_at)
- [ ] **NEW: Test AI rule suggestions for bank transactions**
- [ ] **NEW: Test AI rule suggestions for POS sales**
- [ ] **NEW: Verify AI suggestions have confidence levels**
- [ ] **NEW: Test one-click "Use This Rule" functionality**
- [ ] **NEW: Verify all chart of account categories display in dropdown**

## Performance Considerations

1. **Indexes**: Created on key columns for fast rule matching
   - `idx_categorization_rules_active` - For filtering active rules
   - `idx_categorization_rules_priority` - For priority sorting
   - `idx_categorization_rules_supplier` - For supplier lookups

2. **Pattern Matching**: Uses PostgreSQL's native string operations and regex
   - LOWER() for case-insensitive matching
   - POSITION() for contains
   - LIKE for starts_with/ends_with
   - ~ for regex

3. **Triggers**: Only run on uncategorized records to minimize overhead

4. **Bulk Operations**: Edge function with proper error handling and transaction batching

## Security

- All operations respect Row Level Security (RLS)
- Only owners and managers can create/edit/delete rules
- All users with restaurant access can view rules
- Service role used for auto-apply triggers to bypass RLS safely
- Edge function validates user permissions before applying rules

## Future Enhancements

Potential additions (not implemented):
- Machine learning to suggest rules based on manual categorizations
- Rule templates for common scenarios
- Rule testing/preview mode
- Confidence scores for pattern matches
- Rule conflict detection
- Audit log of rule applications
- Export/import rules between restaurants
- Schedule-based rules (e.g., monthly recurring charges)
- Vendor name normalization (fuzzy matching)

## Files Changed

### Database
- `supabase/migrations/20251111000000_enhanced_categorization_rules.sql` - Main migration

### Backend
- `supabase/functions/apply-categorization-rules/index.ts` - New edge function
- `supabase/functions/ai-suggest-categorization-rules/index.ts` - **NEW: AI rule suggestions**
- `supabase/functions/stripe-sync-transactions/index.ts` - Updated to apply rules

### Frontend
- `src/hooks/useCategorizationRulesV2.tsx` - New hook
- `src/hooks/useAISuggestRules.tsx` - **NEW: AI suggestions hook**
- `src/components/banking/EnhancedCategoryRulesDialog.tsx` - New dialog component with AI suggestions
- `src/pages/Banking.tsx` - Integrated dialog
- `src/pages/POSSales.tsx` - Integrated dialog

## Notes

- The old `CategoryRulesDialog` component is kept for backward compatibility
- The `useCategorizationRules` hook is kept for backward compatibility
- Both old and new systems can coexist during migration
- Rule matching is deterministic (priority-based, then creation date)
- At least one matching pattern is required when creating a rule

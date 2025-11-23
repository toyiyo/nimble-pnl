# Split Categorization Rules - Implementation Summary

## Overview

This implementation adds support for **split categorization rules** to the Nimble PnL system. Split rules allow automatic categorization of bank transactions and POS sales across multiple categories, enabling more granular expense tracking and P&L reporting.

## Key Features

### 1. **Automatic Split Categorization**
- Rules can now split a single transaction/sale into multiple categories
- Supports both **percentage-based** and **amount-based** splits
- Reuses existing `split_bank_transaction()` and `split_pos_sale()` functions

### 2. **User Interface**
- Toggle to mark a rule as a "split rule" in the categorization rules dialog
- Visual split category input component with:
  - Multiple category selection
  - Percentage or amount input
  - Optional descriptions for each split
  - Real-time validation
- Split rules display with "Split Rule" badge
- Shows "Split into X categories" instead of single category

### 3. **Validation**
- Split rules must have at least 2 categories
- Percentage-based splits must sum to exactly 100%
- All split categories must have a valid category selected

## Database Schema Changes

### New Columns in `categorization_rules` table:

```sql
-- Boolean flag to identify split rules
is_split_rule BOOLEAN NOT NULL DEFAULT false

-- JSONB array storing split configuration
split_categories JSONB
```

### Split Categories Structure:

```json
[
  {
    "category_id": "uuid1",
    "percentage": 60,
    "description": "Labor portion"
  },
  {
    "category_id": "uuid2", 
    "percentage": 40,
    "description": "Materials portion"
  }
]
```

Or for amount-based:

```json
[
  {
    "category_id": "uuid1",
    "amount": 100.00,
    "description": "Ingredient cost"
  },
  {
    "category_id": "uuid2",
    "amount": 50.00,
    "description": "Packaging"
  }
]
```

### Constraints:

```sql
-- Ensures split rules have split_categories and regular rules have category_id
CHECK (
  (is_split_rule = false AND category_id IS NOT NULL AND split_categories IS NULL) OR
  (is_split_rule = true AND split_categories IS NOT NULL AND jsonb_array_length(split_categories) >= 2)
)
```

## Application Logic

### Rule Application Flow:

1. **Matching**: When a transaction/sale matches a rule's conditions
2. **Type Check**: System checks if `is_split_rule = true`
3. **Split Execution**:
   - For bank transactions: Calls `split_bank_transaction(transaction_id, split_categories)`
   - For POS sales: Calls `split_pos_sale(sale_id, split_categories)`
4. **Recording**: Original record is marked as `is_split = true`
5. **Child Records**: Split entries are created as child records

### Updated Functions:

- `apply_rules_to_bank_transactions()` - Now handles split rules
- `apply_rules_to_pos_sales()` - Now handles split rules
- `find_matching_rules_for_bank_transaction()` - Returns split rule info
- `find_matching_rules_for_pos_sale()` - Returns split rule info

## Usage Examples

### Example 1: Restaurant Meal Split

**Scenario**: Split a $100 restaurant meal purchase between Food (70%) and Beverages (30%)

**Rule Configuration**:
- Rule Name: "Restaurant Supply - Split"
- Applies To: Bank Transactions
- Description Pattern: "Restaurant Supply Co"
- Split Type: Percentage
- Splits:
  - Food Cost (70%) - $70
  - Beverage Cost (30%) - $30

### Example 2: POS Item with Multiple Revenue Streams

**Scenario**: Split a combo meal sale between Food and Beverage revenue

**Rule Configuration**:
- Rule Name: "Combo Meal Split"
- Applies To: POS Sales
- Item Name Pattern: "Combo Meal"
- Split Type: Percentage
- Splits:
  - Food Revenue (60%)
  - Beverage Revenue (40%)

### Example 3: Fixed Amount Split

**Scenario**: Split a $500 invoice into fixed amounts for different categories

**Rule Configuration**:
- Rule Name: "Marketing Invoice Split"
- Applies To: Bank Transactions
- Description Pattern: "Marketing Agency"
- Split Type: Amount
- Splits:
  - Advertising ($300)
  - Design Services ($200)

## How to Create a Split Rule

1. Navigate to **Banking** or **POS Sales** page
2. Click **Categorization Rules** button
3. Select the appropriate tab (Bank Transactions or POS Sales)
4. Click **Add New Rule**
5. Fill in the rule conditions (description pattern, amount range, etc.)
6. Toggle **"Split rule (categorize into multiple categories)"**
7. Choose split type: **Percentage** or **Amount**
8. Add at least 2 split categories:
   - Select category
   - Enter percentage or amount
   - Add optional description
9. Ensure percentages sum to 100% (if using percentage-based)
10. Set priority and auto-apply preferences
11. Click **Create Rule**

## Applying Rules

### Manual Application:
1. Open **Categorization Rules** dialog
2. Click **Apply Rules to Existing Records**
3. System processes uncategorized transactions/sales in batches
4. Split rules automatically create split entries

### Automatic Application:
- Enable **Auto-apply** toggle for the rule
- New matching transactions/sales are automatically split

## Technical Details

### TypeScript Interfaces:

```typescript
export interface SplitCategory {
  category_id: string;
  amount?: number;
  percentage?: number;
  description?: string;
}

export interface CategorizationRule {
  // ... existing fields
  is_split_rule: boolean;
  split_categories?: SplitCategory[];
}
```

### React Components:

- `SplitCategoryInput` - UI for managing split categories
- `EnhancedCategoryRulesDialog` - Updated with split rule support

### Hooks:

- `useCategorizationRulesV2` - Updated to handle split fields
- `useCreateRuleV2` - Supports creating split rules
- `useUpdateRuleV2` - Supports updating split rules

## Design Principles

### DRY (Don't Repeat Yourself)
- Reuses existing split functions (`split_bank_transaction`, `split_pos_sale`)
- No new database tables for split functionality
- Leverages existing split infrastructure

### Simplicity
- Minimal code changes
- Clear UI with toggle switch
- Intuitive percentage/amount selection

### Type Safety
- Proper TypeScript typing throughout
- Validation at both UI and database levels
- Consistent data handling

## Testing Checklist

- [ ] Create a percentage-based split rule for bank transactions
- [ ] Create an amount-based split rule for bank transactions
- [ ] Create a split rule for POS sales
- [ ] Apply split rules to existing records
- [ ] Verify split entries are created correctly
- [ ] Test auto-apply functionality for new records
- [ ] Edit an existing split rule
- [ ] Delete a split rule
- [ ] Ensure non-split rules continue to work
- [ ] Validate percentage sums to 100%
- [ ] Test with closed fiscal periods

## Security Considerations

- Split rules respect Row Level Security (RLS) policies
- Only users with owner/manager roles can create split rules
- Validation prevents splitting in closed fiscal periods
- Split amounts are validated before execution

## Performance Considerations

- Rules are processed in batches (default 100 records)
- Split operations are atomic (all-or-nothing)
- Indexed for fast lookup of split rules
- Optimistic updates in UI for better UX

## Future Enhancements

Potential improvements for future iterations:

1. **Template Splits**: Common split patterns (e.g., 70/30, 50/50)
2. **Dynamic Splits**: Calculate amounts based on formulas
3. **Conditional Splits**: Different splits based on amount ranges
4. **Split History**: Track changes to split configurations
5. **Bulk Operations**: Apply splits to specific date ranges
6. **AI Suggestions**: Recommend split patterns based on history

## Support

For questions or issues related to split categorization rules:
- Check the database migration files for schema details
- Review the hook implementations for business logic
- Examine the UI components for user interaction patterns
- Refer to existing split functions for split execution logic

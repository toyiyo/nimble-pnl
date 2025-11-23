# Create Rule from Bank Transaction Feature

## Overview

Added "Create Rule" action button to bank transaction views, matching the existing functionality in POS sales. This allows users to quickly create categorization rules based on any bank transaction, significantly speeding up the process of categorizing thousands of transactions.

## Changes Made

### 1. BankTransactionRow.tsx (Desktop Table View)

**Imports Added**:
- `Settings2` icon from lucide-react
- `EnhancedCategoryRulesDialog` component

**State Added**:
```typescript
const [showRulesDialog, setShowRulesDialog] = useState(false);
```

**Functions Added**:

#### `handleCreateRule()`
Opens the categorization rules dialog with prefilled data from the transaction.

#### `getPrefilledRuleData()`
Prepares rule data based on the transaction:
- **Rule Name**: Auto-generated from merchant name/payee/description
- **Applies To**: `bank_transactions`
- **Description Pattern**: Merchant name for matching
- **Match Type**: `contains`
- **Supplier**: Pre-filled if transaction has supplier
- **Transaction Type**: `debit` (expense) or `credit` (income)
- **Category**: Uses current category or AI-suggested category
- **Priority**: Defaults to 5
- **Auto Apply**: Enabled by default

**UI Changes**:
- Added "Create Rule" menu item in the actions dropdown
- Icon: Settings2 (gear icon)
- Position: Between "Split Transaction" and "Exclude"
- Accessible via the "..." menu on each transaction row

**Dialog Added**:
```tsx
<EnhancedCategoryRulesDialog
  open={showRulesDialog}
  onOpenChange={setShowRulesDialog}
  defaultTab="bank"
  prefilledRule={getPrefilledRuleData()}
/>
```

### 2. BankTransactionCard.tsx (Mobile Card View)

**Same changes as BankTransactionRow**, adapted for mobile layout:
- Added "Rule" button alongside "Edit", "Split", "Exclude"
- Compact button with icon + text
- Tooltip: "Create a rule based on this transaction"
- Same prefill logic and dialog integration

## User Flow

### Creating a Rule from a Transaction

1. **Find a transaction** you want to create a rule for
2. **Click "..." menu** (desktop) or see buttons (mobile)
3. **Click "Create Rule"**
4. **Rules dialog opens** with prefilled data:
   - Rule name based on merchant
   - Pattern set to transaction description
   - Category pre-selected (if already categorized)
   - Transaction type (debit/credit) set correctly
5. **Adjust rule as needed** (optional):
   - Modify pattern or match type
   - Add amount constraints
   - Change priority
   - Create split rule instead
6. **Save rule**
7. **Apply to existing transactions** (optional)

### Example Use Case

**Transaction**:
- Description: "AMAZON.COM*AB123DEF456"
- Amount: -$47.23 (debit)
- Category: Office Supplies

**Click "Create Rule" → Pre-filled**:
```json
{
  "ruleName": "Auto-categorize AMAZON.COM*AB123DEF456",
  "appliesTo": "bank_transactions",
  "descriptionPattern": "AMAZON.COM*AB123DEF456",
  "descriptionMatchType": "contains",
  "transactionType": "debit",
  "categoryId": "<office-supplies-id>",
  "priority": "5",
  "autoApply": true
}
```

**User adjusts**:
- Change pattern to "AMAZON.COM" (to match all Amazon transactions)
- Change match type to "starts_with"
- Save

**Result**: All future Amazon debits automatically categorized as Office Supplies.

## Benefits

### 1. **Speed**
- No manual data entry for rule creation
- One click to start creating a rule
- Pre-filled with transaction details

### 2. **Accuracy**
- Pattern extracted from actual transaction
- Category already selected if categorized
- Transaction type (debit/credit) set correctly
- Supplier linked if available

### 3. **Discoverability**
- Visible in transaction actions menu
- Consistent with POS sales workflow
- Clear icon (gear) and label

### 4. **Flexibility**
- User can still modify all rule fields
- Can create split rules from transaction
- Can set custom priority and constraints

## Pattern Matching Tips

The description pattern is extracted from:
1. `merchant_name` (if available from Stripe)
2. `normalized_payee` (if set)
3. `description` (raw bank description)

**Common patterns**:
- **Exact merchants**: "Sysco Foods" → contains
- **Card transactions**: "SQ *COFFEE SHOP" → starts_with "SQ *"
- **Regular vendors**: "Check #1234 ABC Corp" → contains "ABC Corp"
- **ACH payments**: "ACH Transfer XYZ Company" → contains "XYZ Company"

**Tips for users**:
- Use `contains` for partial matching (most common)
- Use `starts_with` for transaction types (ACH, SQ *, etc.)
- Use `exact` for very specific transactions
- Use `regex` for complex patterns (advanced)

## Integration with Existing Features

### 1. Works with Splits
- If transaction is split, can still create rule
- Rule will be for regular categorization (not split)
- User can convert to split rule in dialog

### 2. Works with AI Suggestions
- If transaction has `suggested_category_id`, it's pre-filled
- If user accepts AI suggestion then creates rule, rule uses that category
- Speeds up AI-assisted categorization workflow

### 3. Works with Suppliers
- If transaction is linked to supplier, supplier_id pre-filled in rule
- Rule will only match transactions from same supplier
- Useful for recurring vendor expenses

### 4. Transaction Type Filtering
- Automatically detects if transaction is debit or credit
- Rule will only match same transaction type
- Prevents rules from matching both expenses and income

## Related Files

**Modified**:
- `/src/components/banking/BankTransactionRow.tsx` - Desktop table view
- `/src/components/banking/BankTransactionCard.tsx` - Mobile card view

**Existing (used)**:
- `/src/components/banking/EnhancedCategoryRulesDialog.tsx` - Rules dialog
- `/src/components/banking/TransactionDetailSheet.tsx` - Already had this feature in detail sheet

**Migrations (for split rules)**:
- `20251121170000_fix_apply_split_rules_conversion.sql` - POS split rules
- `20251121180000_fix_split_pos_sale_authorization.sql` - POS auth fix
- `20251121190000_fix_exclude_bank_transaction.sql` - Bank exclusion fix
- `20251121200000_fix_bank_split_rules_conversion.sql` - Bank split rules

## Testing Checklist

- [ ] Desktop view: Click "..." menu → "Create Rule" → Dialog opens
- [ ] Mobile view: Click "Rule" button → Dialog opens
- [ ] Dialog pre-fills with transaction data
- [ ] Can modify rule fields
- [ ] Can save rule successfully
- [ ] Can create split rule from transaction
- [ ] Works with categorized transactions
- [ ] Works with uncategorized transactions
- [ ] Works with transactions that have AI suggestions
- [ ] Works with supplier-linked transactions
- [ ] Rule correctly matches transaction type (debit/credit)

## Future Enhancements

1. **Smart Pattern Extraction**: Use AI to suggest best pattern from description
2. **Rule Templates**: "Create rule like this one" based on similar transactions
3. **Bulk Rule Creation**: Select multiple transactions → Create rules for all
4. **Rule Suggestions**: "You have 10 similar transactions, create a rule?"
5. **Pattern Preview**: Show how many existing transactions the pattern would match

## Documentation

Users can find this feature:
- **Desktop**: In the "..." menu on any transaction row
- **Mobile**: As a "Rule" button in the transaction card actions
- **Detail Sheet**: As "Suggest Rule from This Transaction" button

**Tooltip**: "Create a rule based on this transaction"

**Help text** (for user guide):
> Create categorization rules directly from any transaction. Click "Create Rule" to automatically generate a rule using the transaction's merchant, category, and transaction type. This is the fastest way to categorize similar transactions automatically.

# Smart Rule Creation Enhancement

## Problem Statement

When creating a categorization rule from a bank transaction with minimal details, the suggested rule is too broad and dangerous.

### Example Issue

**Transaction**:
- Amount: -$7,500.00
- Description: "Withdrawal"
- Type: Payment (Debit)
- Category: 6001 Salaries & Wages

**Current Suggested Rule** (DANGEROUS):
```
Description Pattern: (empty)
Transaction Type: Expense (Debit)
Min Amount: 0.00
Max Amount: 0.00
```

**Problem**: This rule would match **ALL debit transactions**, auto-categorizing everything as Salaries & Wages!

## Root Cause

The prefill logic in `getPrefilledRuleData()` uses:
1. `transaction.merchant_name` (often null)
2. `transaction.normalized_payee` (often null)
3. `transaction.description` (often generic like "Withdrawal")

For manual transactions or generic bank entries, all three are either empty or too generic.

## Proposed Solutions

### Solution 1: Require Specificity (Quick Fix)

**Validation**: Don't allow rule creation if pattern is too generic.

```typescript
// In EnhancedCategoryRulesDialog validation
const isGenericPattern = (pattern: string) => {
  const genericTerms = [
    'withdrawal',
    'deposit',
    'payment',
    'transfer',
    'debit',
    'credit',
    'transaction',
    'ach',
    'wire'
  ];
  
  const normalized = pattern.toLowerCase().trim();
  return genericTerms.includes(normalized) || normalized.length < 3;
};

// Validation logic
if (!formData.descriptionPattern || isGenericPattern(formData.descriptionPattern)) {
  if (!formData.supplierId && !formData.minAmount && !formData.maxAmount) {
    setError('Rule is too generic. Add a specific description pattern, supplier, or amount range.');
    return;
  }
}
```

**Benefits**:
- ✅ Prevents dangerous "match-all" rules
- ✅ Forces users to add specificity
- ✅ Quick to implement

**Drawbacks**:
- ❌ Doesn't help user create a good rule, just blocks bad ones

---

### Solution 2: Smart Prefill with Context (Recommended)

**Enhancement**: Use transaction context to suggest better criteria.

```typescript
const getSmartPrefilledRuleData = (transaction: BankTransaction) => {
  const merchantName = transaction.merchant_name || transaction.normalized_payee;
  const isExpense = transaction.amount < 0;
  const amount = Math.abs(transaction.amount);
  
  // Check if we have a specific merchant/payee
  const hasSpecificMerchant = merchantName && merchantName.length >= 3 && 
    !isGenericTerm(merchantName);
  
  // Check if this is a recurring amount (query recent transactions)
  const isLikelyRecurring = amount > 0 && Number.isInteger(amount / 100);
  
  // Build smart suggestions
  let descriptionPattern = '';
  let minAmount = undefined;
  let maxAmount = undefined;
  let suggestionNote = '';
  
  if (hasSpecificMerchant) {
    // Good merchant name - use it
    descriptionPattern = merchantName;
    suggestionNote = 'Rule will match transactions from this merchant';
  } else if (transaction.supplier?.id) {
    // Has supplier - suggest using supplier instead
    descriptionPattern = '';
    suggestionNote = 'Rule will match transactions from this supplier';
  } else if (isLikelyRecurring && amount >= 100) {
    // Likely recurring payment - suggest amount range
    const tolerance = amount * 0.05; // 5% tolerance
    minAmount = amount - tolerance;
    maxAmount = amount + tolerance;
    suggestionNote = `Rule will match ${isExpense ? 'expenses' : 'deposits'} around ${formatCurrency(amount)}`;
  } else {
    // Generic transaction - leave fields empty and show warning
    suggestionNote = '⚠️ Add specific criteria to avoid matching too many transactions';
  }
  
  return {
    ruleName: hasSpecificMerchant 
      ? `Auto-categorize ${merchantName.substring(0, 30)}`
      : 'Transaction categorization rule',
    appliesTo: 'bank_transactions' as const,
    descriptionPattern,
    descriptionMatchType: 'contains' as const,
    supplierId: transaction.supplier?.id || '',
    transactionType: (isExpense ? 'debit' : 'credit') as const,
    categoryId: transaction.category_id || transaction.suggested_category_id || '',
    priority: '5',
    autoApply: true,
    minAmount: minAmount?.toFixed(2),
    maxAmount: maxAmount?.toFixed(2),
    suggestionNote, // New field to explain the rule
  };
};

// Helper
const isGenericTerm = (text: string) => {
  const genericTerms = [
    'withdrawal', 'deposit', 'payment', 'transfer', 'debit', 
    'credit', 'transaction', 'ach', 'wire', 'check', 'atm'
  ];
  const normalized = text.toLowerCase().trim();
  return genericTerms.some(term => normalized === term || normalized.includes(`${term} `));
};
```

**Benefits**:
- ✅ Smart suggestions based on transaction type
- ✅ Suggests amount ranges for recurring payments
- ✅ Shows explanatory notes to guide user
- ✅ Still allows user to customize

**Drawbacks**:
- ❌ More complex implementation
- ❌ Requires querying recent transactions (performance)

---

### Solution 3: Interactive Rule Builder (Advanced)

**Enhancement**: Show real-time preview of matching transactions.

```typescript
interface RulePreview {
  matchingCount: number;
  matchingSample: BankTransaction[];
  warning?: string;
}

// In EnhancedCategoryRulesDialog
const [rulePreview, setRulePreview] = useState<RulePreview | null>(null);

// Debounced preview query
useEffect(() => {
  const timer = setTimeout(() => {
    if (formData.appliesTo === 'bank_transactions') {
      previewRuleMatches(formData).then(setRulePreview);
    }
  }, 500);
  
  return () => clearTimeout(timer);
}, [formData]);

// Preview function
const previewRuleMatches = async (rule: RuleFormData): Promise<RulePreview> => {
  const { data, error } = await supabase.rpc('preview_rule_matches', {
    p_restaurant_id: restaurantId,
    p_description_pattern: rule.descriptionPattern,
    p_supplier_id: rule.supplierId || null,
    p_transaction_type: rule.transactionType,
    p_min_amount: rule.minAmount ? parseFloat(rule.minAmount) : null,
    p_max_amount: rule.maxAmount ? parseFloat(rule.maxAmount) : null,
  });
  
  if (error) throw error;
  
  const warning = data.matching_count > 100 
    ? `⚠️ This rule would match ${data.matching_count} transactions. Consider making it more specific.`
    : data.matching_count === 0
    ? '⚠️ This rule wouldn\'t match any transactions. Try broader criteria.'
    : undefined;
  
  return {
    matchingCount: data.matching_count,
    matchingSample: data.sample_transactions,
    warning,
  };
};
```

**UI Component**:
```tsx
{rulePreview && (
  <Alert variant={rulePreview.warning ? 'warning' : 'default'}>
    <AlertDescription>
      {rulePreview.warning || `This rule would match ${rulePreview.matchingCount} transaction(s)`}
      
      {rulePreview.matchingSample.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-sm font-medium">Sample matches:</p>
          {rulePreview.matchingSample.slice(0, 3).map(tx => (
            <div key={tx.id} className="text-xs p-2 bg-muted rounded">
              {tx.description} • {formatCurrency(tx.amount)} • {formatDate(tx.transaction_date)}
            </div>
          ))}
        </div>
      )}
    </AlertDescription>
  </Alert>
)}
```

**Benefits**:
- ✅ Real-time feedback
- ✅ Shows exactly what the rule will match
- ✅ Prevents both over-matching and under-matching
- ✅ User can adjust until satisfied

**Drawbacks**:
- ❌ Requires new database function
- ❌ Additional queries on every field change
- ❌ More complex UI

---

## Recommended Implementation

### Phase 1: Quick Wins (Immediate)

1. **Add validation** for generic patterns (Solution 1)
2. **Enhance prefill logic** with smart suggestions (Solution 2 - simplified)
3. **Show warning message** when no specific criteria provided

```typescript
// Simple enhancement to getPrefilledRuleData
const getPrefilledRuleData = () => {
  const merchantName = transaction.merchant_name || transaction.normalized_payee;
  const description = transaction.description?.trim() || '';
  const isExpense = transaction.amount < 0;
  const amount = Math.abs(transaction.amount);
  
  // Check if description is too generic
  const genericTerms = ['withdrawal', 'deposit', 'payment', 'transfer'];
  const isGeneric = genericTerms.some(term => 
    description.toLowerCase() === term.toLowerCase()
  );
  
  // Use merchant if available and not generic
  const hasGoodPattern = merchantName && merchantName.length >= 3;
  
  // For recurring amounts, suggest amount range
  const isRecurring = amount > 0 && amount >= 100 && Number.isInteger(amount * 100);
  
  return {
    ruleName: hasGoodPattern 
      ? `Auto-categorize ${merchantName.substring(0, 30)}`
      : 'Transaction categorization rule',
    appliesTo: 'bank_transactions' as const,
    descriptionPattern: hasGoodPattern ? merchantName : '',
    descriptionMatchType: 'contains' as const,
    supplierId: transaction.supplier?.id || '',
    transactionType: (isExpense ? 'debit' : 'credit') as const,
    categoryId: transaction.category_id || transaction.suggested_category_id || '',
    priority: '5',
    autoApply: true,
    // Add amount range for likely recurring payments
    minAmount: isRecurring && !hasGoodPattern ? (amount * 0.95).toFixed(2) : '',
    maxAmount: isRecurring && !hasGoodPattern ? (amount * 1.05).toFixed(2) : '',
  };
};
```

**Add validation in dialog**:
```typescript
const validateRule = () => {
  const errors = [];
  
  // Check for overly generic rules
  const hasDescription = formData.descriptionPattern?.length >= 3;
  const hasSupplier = formData.supplierId;
  const hasAmountRange = formData.minAmount || formData.maxAmount;
  
  if (!hasDescription && !hasSupplier && !hasAmountRange) {
    errors.push('Add at least one specific criterion: description pattern, supplier, or amount range');
  }
  
  // Warn about generic descriptions
  const genericTerms = ['withdrawal', 'deposit', 'payment', 'transfer', 'debit', 'credit'];
  if (hasDescription && genericTerms.includes(formData.descriptionPattern.toLowerCase())) {
    errors.push(`"${formData.descriptionPattern}" is too generic - add supplier or amount range`);
  }
  
  return errors;
};
```

### Phase 2: Enhanced Preview (Future)

- Add database function `preview_rule_matches`
- Show real-time count and sample transactions
- Add warning thresholds (>100 matches = warning)

---

## Database Function (Phase 2)

```sql
CREATE OR REPLACE FUNCTION preview_rule_matches(
  p_restaurant_id UUID,
  p_description_pattern TEXT DEFAULT NULL,
  p_supplier_id UUID DEFAULT NULL,
  p_transaction_type TEXT DEFAULT NULL,
  p_min_amount NUMERIC DEFAULT NULL,
  p_max_amount NUMERIC DEFAULT NULL
)
RETURNS TABLE(
  matching_count BIGINT,
  sample_transactions JSONB
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sample JSONB;
BEGIN
  -- Get sample of matching transactions (max 5)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', bt.id,
      'description', bt.description,
      'amount', bt.amount,
      'transaction_date', bt.transaction_date,
      'merchant_name', bt.merchant_name
    )
  )
  INTO v_sample
  FROM (
    SELECT bt.*
    FROM bank_transactions bt
    WHERE bt.restaurant_id = p_restaurant_id
      AND bt.excluded_reason IS NULL
      AND (p_description_pattern IS NULL OR bt.description ILIKE '%' || p_description_pattern || '%')
      AND (p_supplier_id IS NULL OR bt.supplier_id = p_supplier_id)
      AND (p_transaction_type IS NULL OR 
           (p_transaction_type = 'debit' AND bt.amount < 0) OR
           (p_transaction_type = 'credit' AND bt.amount > 0))
      AND (p_min_amount IS NULL OR ABS(bt.amount) >= p_min_amount)
      AND (p_max_amount IS NULL OR ABS(bt.amount) <= p_max_amount)
    ORDER BY bt.transaction_date DESC
    LIMIT 5
  ) bt;
  
  -- Get total count
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as matching_count,
    COALESCE(v_sample, '[]'::JSONB) as sample_transactions
  FROM bank_transactions bt
  WHERE bt.restaurant_id = p_restaurant_id
    AND bt.excluded_reason IS NULL
    AND (p_description_pattern IS NULL OR bt.description ILIKE '%' || p_description_pattern || '%')
    AND (p_supplier_id IS NULL OR bt.supplier_id = p_supplier_id)
    AND (p_transaction_type IS NULL OR 
         (p_transaction_type = 'debit' AND bt.amount < 0) OR
         (p_transaction_type = 'credit' AND bt.amount > 0))
    AND (p_min_amount IS NULL OR ABS(bt.amount) >= p_min_amount)
    AND (p_max_amount IS NULL OR ABS(bt.amount) <= p_max_amount);
END;
$$;
```

---

## User Experience Improvements

### Current Flow (Problematic)
1. User clicks "Create Rule" on generic transaction
2. Dialog opens with empty/generic fields
3. User clicks "Create Rule"
4. Rule applies to ALL debits → Disaster!

### Improved Flow (Phase 1)
1. User clicks "Create Rule" on generic transaction
2. Dialog opens with:
   - Empty description (or amount range if recurring)
   - **Warning**: "⚠️ Add specific criteria to avoid matching too many transactions"
3. User tries to save without adding criteria
4. Validation error: "Add at least one specific criterion"
5. User adds supplier or amount range
6. Rule created safely

### Optimal Flow (Phase 2)
1. User clicks "Create Rule"
2. Dialog opens with smart prefill
3. Preview shows: "This rule would match 247 transactions"
4. **Warning**: "⚠️ This rule would match 247 transactions. Consider making it more specific."
5. User adds supplier
6. Preview updates: "This rule would match 12 transactions"
7. Preview shows sample of 3 transactions
8. User confirms rule is correct
9. Rule created with confidence

---

## Testing Checklist

### Phase 1 Tests
- [ ] Generic transaction ("Withdrawal") shows empty description pattern
- [ ] Generic transaction shows warning about adding criteria
- [ ] Cannot save rule without description, supplier, or amount range
- [ ] Cannot save rule with generic term ("withdrawal") without other criteria
- [ ] Recurring amount transaction suggests amount range
- [ ] Transaction with merchant name prefills description
- [ ] Transaction with supplier prefills supplier

### Phase 2 Tests
- [ ] Preview shows accurate count
- [ ] Preview updates on field change (debounced)
- [ ] Warning shows when count > 100
- [ ] Warning shows when count = 0
- [ ] Sample transactions displayed correctly
- [ ] Preview query doesn't cause performance issues

---

## Files to Modify

### Phase 1 (Immediate)
1. `/src/components/banking/BankTransactionRow.tsx` - Update `getPrefilledRuleData()`
2. `/src/components/banking/BankTransactionCard.tsx` - Update `getPrefilledRuleData()`
3. `/src/components/banking/TransactionDetailSheet.tsx` - Update `getPrefilledRuleData()`
4. `/src/components/banking/EnhancedCategoryRulesDialog.tsx` - Add validation logic

### Phase 2 (Future)
5. Create migration: `add_preview_rule_matches_function.sql`
6. `/src/hooks/useCategorizationRulesV2.tsx` - Add `previewRuleMatches` function
7. `/src/components/banking/EnhancedCategoryRulesDialog.tsx` - Add preview UI

---

## Summary

**Problem**: Generic transactions create dangerous "match-all" rules  
**Quick Fix**: Validation + smarter prefill logic (Phase 1)  
**Ultimate Solution**: Real-time preview with feedback (Phase 2)  

**Recommendation**: Implement Phase 1 now (15-30 minutes), consider Phase 2 later based on user feedback.

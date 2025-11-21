# Tax Rates and Categories Feature - Implementation Summary

## Overview
This feature allows restaurants to configure tax rates (e.g., sales tax, alcohol tax) and optionally associate them with revenue categories from their chart of accounts. The system then automatically calculates taxes on matching POS transactions and provides compliance-ready reports.

## What Was Implemented

### 1. Database Schema (Migration: `20251121000000_create_tax_rates_tables.sql`)

#### Tables Created:
- **`tax_rates`**: Stores tax rate configurations
  - Fields: name, rate (percentage), description, is_active, restaurant_id
  - Constraints: Rate between 0-100%, unique name per restaurant
  
- **`tax_rate_categories`**: Junction table linking tax rates to revenue categories
  - Links tax_rates to chart_of_accounts entries
  - Allows optional category association (if none, applies to all sales)

#### Security:
- Row Level Security (RLS) policies enforce multi-tenant isolation
- Only owners and managers can create/edit tax rates
- All users in a restaurant can view tax rates

#### Database Functions:
- **`calculate_taxes_for_period()`**: Calculates taxes for a date range
  - Matches unified_sales to tax rates based on categories
  - Handles split sales correctly (excludes parent sales)
  - Returns totals grouped by tax rate
  
- **`get_tax_rate_with_categories()`**: Fetches a tax rate with its associated categories

### 2. React Hooks (`src/hooks/useTaxRates.tsx`)

Provides a clean interface for tax rate management:
- `taxRates`: List of all tax rates for the restaurant
- `createTaxRate()`: Create a new tax rate with optional categories
- `updateTaxRate()`: Update tax rate and categories
- `deleteTaxRate()`: Delete a tax rate (cascades to categories)
- `calculateTaxes()`: Calculate taxes for a date range
- `getTaxRateWithCategories()`: Fetch detailed tax rate info

Uses React Query for:
- Automatic caching (30-second stale time)
- Optimistic updates
- Background refetching

### 3. User Interface

#### Tax Rates Page (`src/pages/TaxRates.tsx`)
- Dashboard showing active/inactive tax rates
- Stats cards: Active tax rates, total tax rates, revenue categories
- List of configured tax rates with status badges
- Edit and delete actions per tax rate
- Two main action buttons: "Add Tax Rate" and "Generate Tax Report"

#### Tax Rate Dialog (`src/components/tax-rates/TaxRateDialog.tsx`)
Create/edit form with:
- Tax rate name (e.g., "Sales Tax")
- Rate percentage (0-100%)
- Optional description
- Active/inactive toggle
- Multi-select for revenue categories (optional)
- If no categories selected, tax applies to ALL sales

#### Tax Report Dialog (`src/components/tax-rates/TaxReportDialog.tsx`)
Report generation interface:
- Date range picker (start/end dates)
- Calculate button to run tax calculations
- Results table showing:
  - Tax type name
  - Rate percentage
  - Total taxable amount
  - Calculated tax amount
  - Number of transactions
- Summary cards for totals
- Export to PDF button
- Print button (print-friendly layout)

### 4. Navigation
- Added "Tax Rates" link to sidebar under "Accounting" section
- Route: `/tax-rates`
- Icon: Percent symbol
- Accessible to owners and managers only (via existing RLS)

### 5. Testing
E2E tests (`tests/e2e/tax-rates/tax-rates-page.spec.ts`):
- Verify page loads with correct elements
- Test dialog opening (Add Tax Rate)
- Test report dialog opening
- Uses helper function to avoid code duplication

## Usage Examples

### Example 1: Simple Sales Tax
1. Navigate to Tax Rates page
2. Click "Add Tax Rate"
3. Enter:
   - Name: "Sales Tax"
   - Rate: 8.25
   - Leave categories empty (applies to all sales)
4. Save

Result: All sales transactions will be included when calculating this tax.

### Example 2: Alcohol Tax
1. Click "Add Tax Rate"
2. Enter:
   - Name: "Alcohol Tax"
   - Rate: 6.00
   - Select categories: "Sales - Beer", "Sales - Wine", "Sales - Spirits"
3. Save

Result: Only sales in the selected categories will be included when calculating this tax.

### Example 3: Generate Tax Report
1. Click "Generate Tax Report"
2. Select date range (e.g., October 1 - October 31)
3. Click "Calculate Taxes"
4. Review results:
   - Sales Tax: $15,234.56 taxable amount → $1,257.35 tax
   - Alcohol Tax: $3,421.00 taxable amount → $205.26 tax
5. Click "Export PDF" to download report
6. Click "Print" to print directly

## Technical Details

### Tax Calculation Logic
```sql
-- Pseudo-code for calculation:
FOR each active tax_rate:
  IF tax_rate has categories:
    Match sales where category_id IN (tax_rate_categories)
  ELSE:
    Match ALL sales
  
  SUM(total_price) = taxable_amount
  taxable_amount * (rate / 100) = calculated_tax
```

### Key Features
- **Multi-restaurant support**: All data is scoped by restaurant_id
- **Category flexibility**: Tax rates can apply to all sales OR specific categories
- **Split sale handling**: Correctly excludes parent sales that have been split
- **Date range filtering**: Calculate taxes for any period
- **Real-time updates**: Uses React Query for automatic data refreshing
- **Security**: RLS policies prevent cross-restaurant access
- **Export options**: PDF export and print-friendly layout

## Database Migration Notes

When this migration is applied to production:
1. Two new tables will be created
2. RLS policies will be automatically applied
3. Indexes will be created for performance
4. Functions will be available for tax calculations

No existing data is modified. This is a purely additive feature.

## Files Changed/Added

### New Files:
- `supabase/migrations/20251121000000_create_tax_rates_tables.sql`
- `src/types/taxRates.ts`
- `src/hooks/useTaxRates.tsx`
- `src/pages/TaxRates.tsx`
- `src/components/tax-rates/TaxRateDialog.tsx`
- `src/components/tax-rates/TaxReportDialog.tsx`
- `tests/e2e/tax-rates/tax-rates-page.spec.ts`

### Modified Files:
- `src/App.tsx` (added route)
- `src/components/AppSidebar.tsx` (added navigation link)

## Future Enhancements (Not Implemented)

Possible additions:
1. **Tax filing reminders**: Notifications when reports are due
2. **Historical comparison**: Compare tax collections period-over-period
3. **Tax jurisdiction management**: Multiple tax authorities
4. **Automatic tax rate updates**: Integration with tax rate databases
5. **Tax exemption handling**: Mark certain transactions as exempt
6. **Multi-level taxes**: Compound tax rates

## Security Summary

**Security Measures Implemented:**
- ✅ Row Level Security (RLS) enforced on all tables
- ✅ Multi-tenant isolation by restaurant_id
- ✅ Role-based access control (owners/managers only)
- ✅ Input validation (rate constraints 0-100%)
- ✅ Proper TypeScript types throughout
- ✅ No SQL injection vulnerabilities (using Supabase client)
- ✅ SECURITY DEFINER functions with proper permission checks

**No Security Vulnerabilities Introduced:**
- No user input is used in raw SQL
- All database access goes through Supabase client with RLS
- No sensitive data exposed in frontend
- Proper error handling with toast notifications

## Testing Checklist

To fully validate in a live environment:
- [ ] Create a tax rate without categories
- [ ] Create a tax rate with specific categories
- [ ] Edit an existing tax rate
- [ ] Deactivate a tax rate
- [ ] Delete a tax rate
- [ ] Generate a report with no data
- [ ] Generate a report with sample data
- [ ] Export PDF report
- [ ] Print report
- [ ] Verify multi-restaurant isolation
- [ ] Test with split sales
- [ ] Verify RLS policies work correctly

## Support

For questions or issues, the implementation follows the existing patterns in the codebase:
- Similar to Banking page structure
- Uses standard shadcn/ui components
- Follows React Query patterns from other hooks
- Database functions follow existing SQL function conventions

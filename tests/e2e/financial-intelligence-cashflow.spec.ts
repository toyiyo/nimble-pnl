import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

const getRestaurantId = (page: Page) =>
  page.evaluate<string | null>(async () => {
    const helperWindow = window as Window & {
      __getRestaurantId?: () => Promise<string | null> | string | null;
    };
    const fn = helperWindow.__getRestaurantId;
    return fn ? await fn() : null;
  });

/** 'yyyy-MM-dd' for N days before today, in the browser's local time. */
function dateDaysAgo(page: Page, daysAgo: number): Promise<string> {
  return page.evaluate((n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }, daysAgo);
}

/**
 * Read a headline value ("$2,400") next to its label ("Net cashflow").
 * CashFlowHeadline gives each stat a `role="group"` with the label as its
 * accessible name, so this scopes by role instead of matching the value
 * text page-wide (breakdown cards repeat "Money in" / "Money out" as card
 * titles).
 */
async function expectHeadlineValue(page: Page, label: string, value: string) {
  const group = page.getByRole('group', { name: label });
  await expect(group.getByText(value, { exact: true })).toBeVisible({ timeout: 10000 });
}

test.describe('Financial Intelligence — Cash Flow view', () => {
  test('shows totals, narrative, chart modes, breakdown tabs, account filter, and empty state', async ({ page }) => {
    const user = generateTestUser();

    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await getRestaurantId(page);
    expect(restaurantId).toBeTruthy();

    // Compute the 'yyyy-MM-dd' dates the seed rows need before entering the
    // page.evaluate sandbox (dates there must stay JSON-serializable).
    const day2 = await dateDaysAgo(page, 2);
    const day3 = await dateDaysAgo(page, 3);
    const day32 = await dateDaysAgo(page, 32);
    const day33 = await dateDaysAgo(page, 33);
    const day62 = await dateDaysAgo(page, 62);
    const day87 = await dateDaysAgo(page, 87);

    // Seed two connected banks (one per account, mirroring production's
    // one-row-per-Stripe-account shape) and transactions spread across the
    // last ~3 months, all inside the 90-day window the test switches to.
    await page.evaluate(
      async ({ rid, day2, day3, day32, day33, day62, day87 }) => {
        const { supabase } = await import('/src/integrations/supabase/client');

        const timestamp = Date.now();
        const random = crypto.randomUUID().slice(0, 8);

        const { data: bank1, error: bank1Error } = await supabase
          .from('connected_banks')
          .insert({
            restaurant_id: rid,
            institution_name: 'Chase Test Bank',
            stripe_financial_account_id: `fca_cf1_${timestamp}_${random}`,
            account_mask: '1111',
            status: 'connected',
          })
          .select()
          .single();
        if (bank1Error) throw new Error(`Failed to create bank1: ${bank1Error.message}`);

        const { data: bank2, error: bank2Error } = await supabase
          .from('connected_banks')
          .insert({
            restaurant_id: rid,
            institution_name: 'Wells Test Bank',
            stripe_financial_account_id: `fca_cf2_${timestamp}_${random}`,
            account_mask: '2222',
            status: 'connected',
          })
          .select()
          .single();
        if (bank2Error) throw new Error(`Failed to create bank2: ${bank2Error.message}`);

        const { error: balancesError } = await supabase.from('bank_account_balances').insert([
          {
            connected_bank_id: bank1.id,
            stripe_financial_account_id: `fa_cf1_${timestamp}_${random}`,
            account_name: 'Checking Account',
            account_type: 'checking',
            account_mask: '1111',
            current_balance: 10000,
            as_of_date: new Date().toISOString(),
          },
          {
            connected_bank_id: bank2.id,
            stripe_financial_account_id: `fa_cf2_${timestamp}_${random}`,
            account_name: 'Savings Account',
            account_type: 'savings',
            account_mask: '2222',
            current_balance: 20000,
            as_of_date: new Date().toISOString(),
          },
        ]);
        if (balancesError) throw new Error(`Failed to create balances: ${balancesError.message}`);

        const { error: txError } = await supabase.from('bank_transactions').insert([
          {
            restaurant_id: rid,
            connected_bank_id: bank1.id,
            stripe_transaction_id: `txn_cf_1_${timestamp}_${random}`,
            transaction_date: day2,
            description: 'Client Payment Alpha',
            amount: 2000,
            status: 'posted',
          },
          {
            restaurant_id: rid,
            connected_bank_id: bank1.id,
            stripe_transaction_id: `txn_cf_2_${timestamp}_${random}`,
            transaction_date: day32,
            description: 'Vendor Payment Beta',
            amount: -800,
            status: 'posted',
          },
          {
            restaurant_id: rid,
            connected_bank_id: bank1.id,
            stripe_transaction_id: `txn_cf_3_${timestamp}_${random}`,
            transaction_date: day62,
            description: 'Client Payment Alpha',
            amount: 1500,
            status: 'posted',
          },
          {
            restaurant_id: rid,
            connected_bank_id: bank1.id,
            stripe_transaction_id: `txn_cf_4_${timestamp}_${random}`,
            transaction_date: day87,
            description: 'Vendor Payment Gamma',
            amount: -600,
            status: 'posted',
          },
          {
            restaurant_id: rid,
            connected_bank_id: bank2.id,
            stripe_transaction_id: `txn_cf_5_${timestamp}_${random}`,
            transaction_date: day3,
            description: 'Second Bank Income',
            amount: 500,
            status: 'posted',
          },
          {
            restaurant_id: rid,
            connected_bank_id: bank2.id,
            stripe_transaction_id: `txn_cf_6_${timestamp}_${random}`,
            transaction_date: day33,
            description: 'Second Bank Expense',
            amount: -200,
            status: 'posted',
          },
        ]);
        if (txError) throw new Error(`Failed to create transactions: ${txError.message}`);
      },
      { rid: restaurantId, day2, day3, day32, day33, day62, day87 },
    );

    await page.goto('/financial-intelligence', { timeout: 10000 });

    // Switch to a period wide enough to hold every seeded row (the page
    // opens on "This Month", which would miss the older rows).
    await page.getByRole('button', { name: 'Last 90 Days' }).click();

    // --- URL state: the period preset lands in the search params --------
    await expect(page).toHaveURL(/period=last90/);

    // --- Headline totals: all accounts combined -----------------------
    await expectHeadlineValue(page, 'Net cashflow', '$2,400');
    await expectHeadlineValue(page, 'Money in', '$4,000');
    await expectHeadlineValue(page, 'Money out', '$1,600');

    // --- Narrative: region present, no static disclaimer ----------------
    // The insight list itself is calendar-dependent (it compares full
    // calendar months against "today"), so this only pins the region and
    // the absence of the old boilerplate disclaimer.
    const narrative = page.getByRole('region', { name: 'Cash flow narrative' });
    await expect(narrative).toBeVisible();
    await expect(narrative.getByText(/Trends are generated/)).toHaveCount(0);

    // --- Chart mode switch: category bars and in/out bars ---------------
    await expect(page.getByRole('img', { name: /Flow view of cash flow/i })).toBeVisible();

    await page.getByRole('radio', { name: 'By category', exact: true }).click();
    await expect(page.getByRole('img', { name: /By category view of cash flow, net \$2,400/i })).toBeVisible();

    await page.getByRole('radio', { name: 'In vs out', exact: true }).click();
    await expect(page.getByRole('img', { name: /In vs out view of cash flow, net \$2,400/i })).toBeVisible();

    // --- URL state: view and period survive a reload ---------------------
    await expect(page).toHaveURL(/view=inout/);
    await page.reload();
    await expect(
      page.getByRole('img', { name: /In vs out view of cash flow, net \$2,400/i }),
    ).toBeVisible({ timeout: 10000 });

    // --- Breakdown tab switch: Source rows vs. folded Category rows ----
    // Each breakdown row carries `role="listitem"` with its label as the
    // accessible name (MoneyBreakdownTable.tsx), so a row can be found
    // without a data-testid.
    await expect(page.getByRole('listitem', { name: 'Client Payment Alpha' })).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Second Bank Income' })).toBeVisible();

    const sourceTab = page.getByRole('tab', { name: 'Source' });
    const categoryTabInMoneyIn = sourceTab.locator('..').getByRole('tab', { name: 'Category' });
    await categoryTabInMoneyIn.click();

    await expect(page.getByRole('listitem', { name: 'Client Payment Alpha' })).not.toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Uncategorized' })).toBeVisible();

    // --- Bank-account filter changes the totals -------------------------
    await page.getByRole('combobox').filter({ hasText: 'All Accounts' }).click();
    await page.getByRole('option', { name: /Wells Test Bank/i }).click();

    await expectHeadlineValue(page, 'Net cashflow', '$300');
    await expectHeadlineValue(page, 'Money in', '$500');
    await expectHeadlineValue(page, 'Money out', '$200');

    // --- Empty state: a period with no transactions ---------------------
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.getByText('No transactions for this period')).toBeVisible({ timeout: 10000 });
  });

  test('hero net value matches the Cash Flow section net value', async ({ page }) => {
    const user = generateTestUser();

    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await getRestaurantId(page);
    expect(restaurantId).toBeTruthy();

    // Read today's local calendar day straight from the browser clock.
    // dateDaysAgo() converts through toISOString(), which reads UTC — in
    // zones behind UTC after midnight UTC it names tomorrow, so the seeded
    // row would miss the "Today" UI filter (local calendar day).
    const today = await page.evaluate(() => {
      const date = new Date();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${date.getFullYear()}-${month}-${day}`;
    });

    // Seed one ordinary row, one row at the last minute of today (the
    // final-day bound), and one transfer row. The transfer must not count
    // in either view; the final-day row must count in both.
    await page.evaluate(
      async ({ rid, today }) => {
        const { supabase } = await import('/src/integrations/supabase/client');

        const timestamp = Date.now();
        const random = crypto.randomUUID().slice(0, 8);

        const { data: bank, error: bankError } = await supabase
          .from('connected_banks')
          .insert({
            restaurant_id: rid,
            institution_name: 'Hero Parity Test Bank',
            stripe_financial_account_id: `fca_hp_${timestamp}_${random}`,
            account_mask: '3333',
            status: 'connected',
          })
          .select()
          .single();
        if (bankError) throw new Error(`Failed to create bank: ${bankError.message}`);

        const { error: txError } = await supabase.from('bank_transactions').insert([
          {
            restaurant_id: rid,
            connected_bank_id: bank.id,
            stripe_transaction_id: `txn_hp_1_${timestamp}_${random}`,
            transaction_date: `${today}T09:00:00.000Z`,
            description: 'Morning Deposit',
            amount: 1000,
            status: 'posted',
            is_transfer: false,
          },
          {
            // Final-day row, 23:45 UTC on the period's last day. The old
            // exclusive end bound (`< end_date` at midnight) dropped this
            // row; the fixed bound (`< end_date + 1`) counts it.
            restaurant_id: rid,
            connected_bank_id: bank.id,
            stripe_transaction_id: `txn_hp_2_${timestamp}_${random}`,
            transaction_date: `${today}T23:45:00.000Z`,
            description: 'Late Deposit',
            amount: 250,
            status: 'posted',
            is_transfer: false,
          },
          {
            // Transfer row: never counts as cash flow, in the hero or the
            // section. A large amount makes a regression obvious.
            restaurant_id: rid,
            connected_bank_id: bank.id,
            stripe_transaction_id: `txn_hp_3_${timestamp}_${random}`,
            transaction_date: `${today}T12:00:00.000Z`,
            description: 'Internal Transfer',
            amount: 9999,
            status: 'posted',
            is_transfer: true,
          },
        ]);
        if (txError) throw new Error(`Failed to create transactions: ${txError.message}`);
      },
      { rid: restaurantId, today },
    );

    await page.goto('/financial-intelligence', { timeout: 10000 });
    await page.getByRole('button', { name: 'Today' }).click();

    // Expected net: $1,000 + $250, with the $9,999 transfer excluded.
    await expectHeadlineValue(page, 'Net cashflow', '$1,250');

    // `FinancialPulseHero` gives its value no accessible group role (unlike
    // `CashFlowHeadline`), so read its unique "text-3xl font-bold
    // text-white" node and poll past the `CountingNumber` count-up
    // animation until it settles.
    await expect
      .poll(
        async () => {
          const text = await page.locator('.text-3xl.font-bold.text-white').first().textContent();
          return Number((text ?? '').replace(/[^0-9.-]/g, ''));
        },
        { timeout: 10000, message: 'hero net cash flow value' },
      )
      .toBe(1250);
  });
});

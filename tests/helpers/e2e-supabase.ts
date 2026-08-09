/**
 * E2E test helpers for Supabase operations
 * These functions run in Node.js context and can be exposed to browser via page.exposeFunction()
 */

import { expect, type Page } from '@playwright/test';

// Node-side reuse of the app's own DST-safe wall-clock <-> instant conversion,
// so seed data is constructed with the exact same reasoning the feature code
// (and the SQL RPC's `AT TIME ZONE` reconstruction) uses — never the runner's
// or the DB session's local timezone. Playwright's TS transform resolves the
// `@/` alias here the same way it does inside spec files.
import { wallClockToInstant, formatLocalDateInTz } from '@/lib/shiftInterval';

/**
 * Shape of `tip_pool_settings.role_percentages`, keyed by role name.
 * Exported so specs and the `__getTipPoolSettings` helper cannot drift apart.
 */
export type RolePercentagesMap = Record<string, { mode: string; percentage: number }>;

/**
 * One approved payout, joined back to the employee it belongs to.
 * `appliedRule` is the audit trail: which guarantee, if any, produced the amount.
 */
export type ApprovedSplitRow = {
  name: string;
  amountCents: number;
  appliedRule: { mode: string; percentage: number } | null;
};

/**
 * Expose Supabase helper functions to browser context
 * This avoids dynamic imports from /src/ which Vite doesn't serve
 */
export async function exposeSupabaseHelpers(page: Page) {
  // Inject helpers into the browser so they share the same Supabase client/session as the app
  const injectHelpers = async () => {
    if ((window as any).__supabaseHelpersReady) return;

    const { supabase } = await import('/src/integrations/supabase/client');
    (window as any).__supabase = supabase;

    const waitForUser = async (): Promise<{ id: string } | null> => {
      for (let i = 0; i < 50; i++) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) return user;
        await new Promise(res => setTimeout(res, 300));
      }
      return null;
    };

    (window as any).__getAuthUser = waitForUser;

    (window as any).__getRestaurantId = async (userId?: string): Promise<string | null> => {
      const user = userId ? { id: userId } : await waitForUser();
      if (!user?.id) return null;

      for (let i = 0; i < 50; i++) {
        const { data, error } = await supabase
          .from('user_restaurants')
          .select('restaurant_id')
          .eq('user_id', user.id)
          .limit(1)
          .single();

        if (data?.restaurant_id) {
          return data.restaurant_id;
        }

        if (error && !error.message?.includes('No rows')) {
          console.error('Failed to load restaurant for user', error);
          return null;
        }

        await new Promise(res => setTimeout(res, 300));
      }

      return null;
    };

    (window as any).__insertEmployees = async (employees: any[], restaurantId: string) => {
      // Two steps, on purpose. A bare .select() after the insert sends
      // Prefer: return=representation, so PostgREST runs INSERT ... RETURNING *
      // and reads the eight masked columns that `authenticated` no longer holds.
      // Ask the insert for `id` alone, then read the full row back through
      // `employees_secure`. The seeding user is the owner, who holds both
      // sensitive flags, so the view returns every column unmasked. Callers
      // read `position`, `area`, and `hourly_rate` off these rows.
      const { data: inserted, error } = await supabase
        .from('employees')
        .insert(employees.map(emp => ({
          ...emp,
          restaurant_id: restaurantId,
        })))
        .select('id');

      if (error) {
        throw new Error(error.message);
      }

      // any: PostgREST's row shape here is untyped in this helper file, same
      // as every other row map above.
      const ids = (inserted ?? []).map((row: any) => row.id); // eslint-disable-line @typescript-eslint/no-explicit-any
      const { data, error: readError } = await supabase
        .from('employees_secure')
        .select('*')
        .in('id', ids)
        .eq('restaurant_id', restaurantId);

      if (readError) {
        throw new Error(readError.message);
      }

      // Keep the caller's insert order. `.in()` does not promise it, and specs
      // pair the returned rows with their own seed array by index.
      // any: same untyped row shape as the map above.
      const byId = new Map((data ?? []).map((row: any) => [row.id, row])); // eslint-disable-line @typescript-eslint/no-explicit-any
      return ids.map((id: string) => byId.get(id));
    };

    (window as any).__insertTimePunches = async (punches: any[], restaurantId: string) => {
      const payload = punches.map(punch => ({
        id: crypto.randomUUID(),
        created_at: punch.created_at || punch.punch_time || new Date().toISOString(),
        updated_at: punch.updated_at || punch.punch_time || new Date().toISOString(),
        ...punch,
        restaurant_id: restaurantId,
      }));

      const { data, error } = await supabase
        .from('time_punches')
        .insert(payload)
        .select();

      if (error) {
        throw new Error(error.message);
      }

      return data;
    };

    (window as any).__checkApprovedSplits = async (restaurantId: string): Promise<boolean> => {
      const { count, error } = await supabase
        .from('tip_splits')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('status', 'approved');

      if (error) {
        console.error('Error checking approved splits', error);
        return false;
      }

      return (count || 0) > 0;
    };

    (window as any).__getTipPoolSettings = async (
      restaurantId: string
    ): Promise<RolePercentagesMap | null> => {
      const { data, error } = await supabase
        .from('tip_pool_settings')
        .select('role_percentages')
        .eq('restaurant_id', restaurantId)
        .eq('active', true)
        .maybeSingle();

      if (error) {
        console.error('Error fetching tip_pool_settings', error);
        return null;
      }

      return (data?.role_percentages as RolePercentagesMap) ?? null;
    };

    (window as any).__getApprovedSplitBreakdown = async (
      restaurantId: string
    ): Promise<ApprovedSplitRow[]> => {
      const { data, error } = await supabase
        .from('tip_split_items')
        .select('amount, applied_rule, employees!inner(name), tip_splits!inner(restaurant_id, status)')
        .eq('tip_splits.restaurant_id', restaurantId)
        .eq('tip_splits.status', 'approved');

      if (error) {
        console.error('Error fetching approved split breakdown', error);
        return [];
      }

      // The `!inner` joins defeat the generated row types, so name the shape we
      // actually asked for rather than letting it decay to `any`.
      type JoinedRow = {
        amount: number;
        applied_rule: ApprovedSplitRow['appliedRule'];
        employees: { name: string } | null;
      };

      return ((data ?? []) as unknown as JoinedRow[]).map(row => ({
        name: row.employees?.name ?? '',
        amountCents: row.amount,
        appliedRule: row.applied_rule ?? null,
      }));
    };

    (window as any).__insertAvailability = async (rows: any[], restaurantId: string) => {
      const { data, error } = await supabase
        .from('employee_availability')
        .insert(rows.map(r => ({ ...r, restaurant_id: restaurantId })))
        .select();
      if (error) throw new Error(error.message);
      return data;
    };

    (window as any).__insertAvailabilityExceptions = async (rows: any[], restaurantId: string) => {
      const { data, error } = await supabase
        .from('availability_exceptions')
        .insert(rows.map(r => ({ ...r, restaurant_id: restaurantId })))
        .select();
      if (error) throw new Error(error.message);
      return data;
    };

    (window as any).__insertShifts = async (rows: any[], restaurantId: string) => {
      const { data, error } = await supabase
        .from('shifts')
        .insert(rows.map(r => ({ ...r, restaurant_id: restaurantId })))
        .select();
      if (error) throw new Error(error.message);
      return data;
    };

    (window as any).__insertDispute = async (dispute: any) => {
      const { error } = await supabase.from('tip_disputes').insert(dispute);
      if (error) {
        throw new Error(error.message);
      }
    };

    (window as any).__checkResolvedDisputes = async (restaurantId: string): Promise<boolean> => {
      const { count, error } = await supabase
        .from('tip_disputes')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('status', 'resolved');

      if (error) {
        console.error('Error checking disputes', error);
        return false;
      }

      return (count || 0) > 0;
    };

    (window as any).__getApprovedTipAmounts = async (restaurantId?: string): Promise<number[]> => {
      const user = await waitForUser();
      if (!user?.id) return [];

      let restaurantIdToUse = restaurantId;
      if (!restaurantIdToUse) {
        const { data: ur } = await supabase
          .from('user_restaurants')
          .select('restaurant_id')
          .eq('user_id', user.id)
          .limit(1)
          .single();
        restaurantIdToUse = ur?.restaurant_id || undefined;
      }

      if (!restaurantIdToUse) return [];

      const { data: items, error } = await supabase
        .from('tip_split_items')
        .select('amount, tip_splits!inner(restaurant_id, status)')
        .eq('tip_splits.restaurant_id', restaurantIdToUse)
        .eq('tip_splits.status', 'approved')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching tip_split_items', error);
      }

      if (items?.length) {
        return items.map(i => i.amount);
      }

      // Fallback to legacy employee_tips table
      const { data: legacy } = await supabase
        .from('employee_tips')
        .select('amount')
        .eq('restaurant_id', restaurantIdToUse)
        .order('created_at', { ascending: false })
        .limit(10);

      return (legacy || []).map(l => l.amount);
    };

    (window as any).__seedIncomeStatement = async (opts: {
      restaurantId: string;
      saleDate?: string;
    }) => {
      const saleDate =
        opts.saleDate ||
        new Date().toISOString().slice(0, 10);

      const { restaurantId } = opts;

      // Upsert needed accounts
      const accounts = [
        {
          account_code: '1000',
          account_name: 'Cash',
          account_type: 'asset',
          account_subtype: 'cash',
          normal_balance: 'debit',
        },
        {
          account_code: '4000',
          account_name: 'Food Sales',
          account_type: 'revenue',
          account_subtype: 'food_sales',
          normal_balance: 'credit',
        },
        {
          account_code: '5000',
          account_name: 'Food COGS',
          account_type: 'cogs',
          account_subtype: 'cost_of_goods_sold',
          normal_balance: 'debit',
        },
        {
          account_code: '6000',
          account_name: 'Operating Expenses',
          account_type: 'expense',
          account_subtype: 'operating_expenses',
          normal_balance: 'debit',
        },
      ].map(acc => ({
        id: crypto.randomUUID(),
        restaurant_id: restaurantId,
        is_system_account: false,
        is_active: true,
        ...acc,
      }));

      // Use upsert to avoid duplicates on re-run
      const { data: insertedAccounts, error: accountError } = await supabase
        .from('chart_of_accounts')
        .upsert(accounts, { onConflict: 'restaurant_id,account_code' })
        .select();

      if (accountError) {
        throw new Error(`Account upsert failed: ${accountError.message}`);
      }

      const getId = (code: string) =>
        (insertedAccounts || []).find((a: any) => a.account_code === code)?.id;

      const cashId = getId('1000');
      const revenueId = getId('4000');
      const cogsId = getId('5000');
      const expenseId = getId('6000');

      // Validate that all required account IDs were found
      if (!cashId) {
        throw new Error('Cash account (1000) not found after upsert. Check chart_of_accounts setup.');
      }
      if (!revenueId) {
        throw new Error('Revenue account (4000) not found after upsert. Check chart_of_accounts setup.');
      }
      if (!cogsId) {
        throw new Error('COGS account (5000) not found after upsert. Check chart_of_accounts setup.');
      }
      if (!expenseId) {
        throw new Error('Expense account (6000) not found after upsert. Check chart_of_accounts setup.');
      }

      // Seed POS revenue + pass-through
      const { error: salesError } = await supabase.from('unified_sales').insert([
        {
          restaurant_id: restaurantId,
          pos_system: 'test',
          external_order_id: 'order-1',
          item_name: 'POS Food Sale',
          quantity: 1,
          total_price: 1200,
          sale_date: saleDate,
          item_type: 'sale',
          is_categorized: true,
          category_id: revenueId,
        },
        {
          restaurant_id: restaurantId,
          pos_system: 'test',
          external_order_id: 'order-2',
          item_name: 'Uncategorized Sale',
          quantity: 1,
          total_price: 300,
          sale_date: saleDate,
          item_type: 'sale',
          is_categorized: false,
        },
        {
          restaurant_id: restaurantId,
          pos_system: 'test',
          external_order_id: 'order-3',
          item_name: 'Sales Tax',
          quantity: 1,
          total_price: 50,
          sale_date: saleDate,
          adjustment_type: 'tax',
          is_categorized: true,
          category_id: null,
        },
        {
          restaurant_id: restaurantId,
          pos_system: 'test',
          external_order_id: 'order-4',
          item_name: 'Tips',
          quantity: 1,
          total_price: 20,
          sale_date: saleDate,
          adjustment_type: 'tip',
          is_categorized: true,
          category_id: null,
        },
        {
          restaurant_id: restaurantId,
          pos_system: 'test',
          external_order_id: 'order-5',
          item_name: 'Discounts',
          quantity: 1,
          total_price: -100,
          sale_date: saleDate,
          adjustment_type: 'discount',
          is_categorized: true,
          category_id: null,
        },
      ]);

      if (salesError) {
        throw new Error(`Sales seed failed: ${salesError.message}`);
      }

      // Helper to insert a balanced journal entry with lines
      const insertJE = async ({
        entryNumber,
        description,
        debitAccountId,
        debitAmount,
        creditAccountId,
        creditAmount,
      }: {
        entryNumber: string;
        description: string;
        debitAccountId: string;
        debitAmount: number;
        creditAccountId: string;
        creditAmount: number;
      }) => {
        const { data: je, error: jeError } = await supabase
          .from('journal_entries')
          .insert({
            restaurant_id: restaurantId,
            entry_number: entryNumber,
            entry_date: saleDate,
            description,
            total_debit: debitAmount,
            total_credit: creditAmount,
            created_by: null,
          })
          .select()
          .single();

        if (jeError) throw new Error(`JE insert failed: ${jeError.message}`);

        const { error: lineError } = await supabase.from('journal_entry_lines').insert([
          {
            journal_entry_id: je.id,
            account_id: debitAccountId,
            debit_amount: debitAmount,
            credit_amount: 0,
          },
          {
            journal_entry_id: je.id,
            account_id: creditAccountId,
            debit_amount: 0,
            credit_amount: creditAmount,
          },
        ]);

        if (lineError) throw new Error(`JE lines failed: ${lineError.message}`);
      };

      await insertJE({
        entryNumber: 'JE-REV',
        description: 'Seed revenue',
        debitAccountId: cashId,
        debitAmount: 1500,
        creditAccountId: revenueId,
        creditAmount: 1500,
      });

      await insertJE({
        entryNumber: 'JE-COGS',
        description: 'Seed COGS',
        debitAccountId: cogsId,
        debitAmount: 500,
        creditAccountId: cashId,
        creditAmount: 500,
      });

      await insertJE({
        entryNumber: 'JE-EXP',
        description: 'Seed expenses',
        debitAccountId: expenseId,
        debitAmount: 400,
        creditAccountId: cashId,
        creditAmount: 400,
      });
    };

    (window as any).__seedBalanceSheet = async (opts: { restaurantId: string; asOfDate?: string }) => {
      const asOfDate =
        opts.asOfDate ||
        new Date().toISOString().slice(0, 10);
      const { restaurantId } = opts;

      const accounts = [
        { account_code: '1000', account_name: 'Cash', account_type: 'asset', account_subtype: 'cash', normal_balance: 'debit' },
        { account_code: '1200', account_name: 'Inventory', account_type: 'asset', account_subtype: 'inventory', normal_balance: 'debit' },
        // Use existing enum values for liability subtypes
        { account_code: '2000', account_name: 'Sales Tax Payable', account_type: 'liability', account_subtype: 'other_current_liabilities', normal_balance: 'credit' },
        { account_code: '2100', account_name: 'Tips Payable', account_type: 'liability', account_subtype: 'other_current_liabilities', normal_balance: 'credit' },
        { account_code: '2200', account_name: 'Payroll Liabilities', account_type: 'liability', account_subtype: 'other_current_liabilities', normal_balance: 'credit' },
        { account_code: '3000', account_name: 'Opening Equity', account_type: 'equity', account_subtype: 'owners_equity', normal_balance: 'credit' },
        { account_code: '4000', account_name: 'Food Sales', account_type: 'revenue', account_subtype: 'food_sales', normal_balance: 'credit' },
        { account_code: '5000', account_name: 'COGS', account_type: 'cogs', account_subtype: 'cost_of_goods_sold', normal_balance: 'debit' },
        { account_code: '6000', account_name: 'Operating Expenses', account_type: 'expense', account_subtype: 'operating_expenses', normal_balance: 'debit' },
        { account_code: '6100', account_name: 'Payroll Expense', account_type: 'expense', account_subtype: 'operating_expenses', normal_balance: 'debit' },
      ].map(acc => ({
        id: crypto.randomUUID(),
        restaurant_id: restaurantId,
        is_system_account: false,
        is_active: true,
        ...acc,
      }));

      const { data: insertedAccounts, error: accountError } = await supabase
        .from('chart_of_accounts')
        .upsert(accounts, { onConflict: 'restaurant_id,account_code' })
        .select();

      if (accountError) {
        throw new Error(`Account upsert failed: ${accountError.message}`);
      }

      const getId = (code: string) =>
        (insertedAccounts || []).find((a: any) => a.account_code === code)?.id;

      const cashId = getId('1000');
      const inventoryId = getId('1200');
      const taxId = getId('2000');
      const tipsId = getId('2100');
      const payrollLiabId = getId('2200');
      const equityId = getId('3000');
      const revenueId = getId('4000');
      const cogsId = getId('5000');
      const opExpId = getId('6000');
      const payrollExpId = getId('6100');

      const insertJE = async (entryNumber: string, description: string, lines: any[]) => {
        const { data: je, error: jeError } = await supabase
          .from('journal_entries')
          .insert({
            restaurant_id: restaurantId,
            entry_number: entryNumber,
            entry_date: asOfDate,
            description,
            total_debit: lines.reduce((s, l) => s + (l.debit_amount || 0), 0),
            total_credit: lines.reduce((s, l) => s + (l.credit_amount || 0), 0),
            created_by: null,
          })
          .select()
          .single();

        if (jeError) throw new Error(`JE insert failed: ${jeError.message}`);

        const { error: lineError } = await supabase.from('journal_entry_lines').insert(
          lines.map(l => ({
            journal_entry_id: je.id,
            ...l,
          }))
        );

        if (lineError) throw new Error(`JE lines failed: ${lineError.message}`);
      };

      // Opening equity and assets
      await insertJE('JE-OPEN', 'Opening balances', [
        { account_id: cashId, debit_amount: 5000, credit_amount: 0 },
        { account_id: inventoryId, debit_amount: 2000, credit_amount: 0 },
        { account_id: equityId, debit_amount: 0, credit_amount: 7000 },
      ]);

      // Sales
      await insertJE('JE-SALES', 'Record sales', [
        { account_id: cashId, debit_amount: 3000, credit_amount: 0 },
        { account_id: revenueId, debit_amount: 0, credit_amount: 3000 },
      ]);

      // COGS / inventory usage
      await insertJE('JE-COGS', 'COGS and inventory reduction', [
        { account_id: cogsId, debit_amount: 1200, credit_amount: 0 },
        { account_id: inventoryId, debit_amount: 0, credit_amount: 1200 },
      ]);

      // Operating expense
      await insertJE('JE-OPEX', 'Operating expenses', [
        { account_id: opExpId, debit_amount: 700, credit_amount: 0 },
        { account_id: cashId, debit_amount: 0, credit_amount: 700 },
      ]);

      // Tips collected (liability)
      await insertJE('JE-TIPS', 'Tips collected', [
        { account_id: cashId, debit_amount: 300, credit_amount: 0 },
        { account_id: tipsId, debit_amount: 0, credit_amount: 300 },
      ]);

      // Sales tax collected (liability)
      await insertJE('JE-TAX', 'Sales tax collected', [
        { account_id: cashId, debit_amount: 200, credit_amount: 0 },
        { account_id: taxId, debit_amount: 0, credit_amount: 200 },
      ]);

      // Payroll accrual
      await insertJE('JE-PAYROLL', 'Accrue payroll', [
        { account_id: payrollExpId, debit_amount: 400, credit_amount: 0 },
        { account_id: payrollLiabId, debit_amount: 0, credit_amount: 400 },
      ]);
    };

    // Helper to simulate a different role for the current user (for testing routing)
    (window as any).__simulateCollaboratorRole = async (role: string) => {
      const user = await waitForUser();
      if (!user?.id) throw new Error('No user session');

      // Get current restaurant
      const restaurantId = await (window as any).__getRestaurantId(user.id);
      if (!restaurantId) throw new Error('No restaurant');

      // Update the user's role in user_restaurants
      const { error } = await supabase
        .from('user_restaurants')
        .update({ role })
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId);

      if (error) {
        throw new Error(`Failed to simulate role: ${error.message}`);
      }

      // Update localStorage to reflect the new role
      const key = `selectedRestaurant_${user.id}`;
      const currentData = localStorage.getItem(key);
      if (currentData) {
        const restaurantData = JSON.parse(currentData);
        restaurantData.role = role;
        localStorage.setItem(key, JSON.stringify(restaurantData));
      }

      return { role, restaurantId };
    };

    // Helper to set subscription tier on a restaurant (for E2E testing)
    (window as any).__setSubscriptionTier = async (
      restaurantId: string,
      tier: 'starter' | 'growth' | 'pro' = 'pro',
      status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'grandfathered' = 'active'
    ) => {
      const { error } = await supabase
        .from('restaurants')
        .update({
          subscription_tier: tier,
          subscription_status: status,
        })
        .eq('id', restaurantId);

      if (error) {
        throw new Error(`Failed to set subscription tier: ${error.message}`);
      }
    };

    (window as any).__supabaseHelpersReady = true;
  };

  // Ensure helpers exist now and on future navigations
  await page.addInitScript(injectHelpers);
  await page.evaluate(injectHelpers);
}

export interface SeedTemplateWithShiftsOptions {
  /** Template's current hours, 24h `HH:MM`. */
  start_time: string;
  /** Template's current hours, 24h `HH:MM`. */
  end_time: string;
  /** Number of "moving" shifts to seed at exactly the template's hours. */
  shiftCount: number;
  /**
   * One further linked shift whose hours have already drifted from the
   * template. Kept singular for backward compatibility with existing specs —
   * equivalent to `driftedShifts: [driftedShift]`. If both are supplied,
   * `driftedShift` is treated as the first entry of `driftedShifts`.
   */
  driftedShift?: {
    start_time: string;
    end_time: string;
    employeeName: string;
  };
  /** Any number of further linked shifts whose hours have already drifted from the template, each under its own employee/date. */
  driftedShifts?: {
    start_time: string;
    end_time: string;
    employeeName: string;
  }[];
  /**
   * One further linked shift dated yesterday (restaurant-local calendar day),
   * at the TEMPLATE'S OWN hours — so the only reason it is excluded from the
   * cascade is that it is in the past, not that its hours differ.
   */
  pastShift?: { employeeName: string };
  /**
   * One further linked shift, future and `locked = true`, at the TEMPLATE'S
   * OWN hours — so the only reason it is excluded from the cascade is the
   * lock, not that its hours differ.
   */
  lockedShift?: { employeeName: string };
  /** IANA timezone the seeded dates/times are anchored in. Defaults to `America/Chicago`. */
  timezone?: string;
  templateName?: string;
  position?: string;
}

export interface SeededTemplate {
  id: string;
  name: string;
  /** Echoes the input, 24h `HH:MM`. */
  start_time: string;
  end_time: string;
}

export interface SeededDriftedShift {
  shiftId: string;
  employeeName: string;
  /** Restaurant-local `YYYY-MM-DD` the drifted shift falls on — matches the
   *  disclosure row's accessible label exactly, so a spec can build the same
   *  regex the UI renders. */
  localDate: string;
  /** Exact `start_time`/`end_time` as stored, straight off the insert's
   *  `.select()` — for asserting a shift was left byte-identical later. */
  startTime: string;
  endTime: string;
}

export interface SeededLinkedShift {
  shiftId: string;
  employeeName: string;
  /** Exact `start_time`/`end_time` as stored, straight off the insert's
   *  `.select()` — for asserting a shift was left byte-identical later. */
  startTime: string;
  endTime: string;
}

export interface SeedTemplateWithShiftsResult {
  template: SeededTemplate;
  /** First entry of `driftedShifts`, or null — kept for backward compatibility. */
  drifted: SeededDriftedShift | null;
  /** Every drifted shift seeded, in the order requested. */
  driftedShifts: SeededDriftedShift[];
  /** The "moving" shifts seeded via `shiftCount`, in insertion order. */
  moving: SeededLinkedShift[];
  past: SeededLinkedShift | null;
  locked: SeededLinkedShift | null;
}

/**
 * Seeds one `shift_templates` row plus `shiftCount` linked shifts at exactly
 * the template's hours (so `bucketTemplateShifts` classifies them as
 * `moving`, never `drifted` or `past`), anchored to the next Monday in
 * `timezone`. Anchoring to a future weekday — computed on a pure Y/M/D
 * calendar via `Date.UTC`, never the runner's local `Date` — keeps every
 * seeded shift unambiguously in the future relative to "now" regardless of
 * which machine or timezone runs the suite.
 *
 * Optional buckets, each under its own named employee so every seeded shift
 * can be matched back unambiguously after insert:
 *  - `driftedShift`/`driftedShifts` seed shifts at different hours, landing
 *    in the `drifted` bucket.
 *  - `pastShift` seeds a shift dated yesterday (restaurant-local calendar
 *    day) at the TEMPLATE'S OWN hours, so it is excluded from the cascade
 *    only because it is in the past.
 *  - `lockedShift` seeds a future shift at the TEMPLATE'S OWN hours with
 *    `locked = true`, so it is excluded from the cascade only because of the
 *    lock.
 *
 * The actual inserts run through the browser's authenticated Supabase client
 * (`window.__supabase`, wired up by `exposeSupabaseHelpers`) rather than a
 * Node-side service-role client: RLS on `employees`/`shifts` is scoped to the
 * signed-in manager, and a service-role bypass would seed data no real user
 * could actually create — mirrors the shape of the existing `__insertShifts`
 * / `__insertEmployees` helpers above.
 */
export async function seedTemplateWithShifts(
  page: Page,
  restaurantId: string,
  opts: SeedTemplateWithShiftsOptions
): Promise<SeedTemplateWithShiftsResult> {
  const tz = opts.timezone ?? 'America/Chicago';
  const position = opts.position ?? 'Server';
  const templateName = opts.templateName ?? `Cascade Test ${crypto.randomUUID().slice(0, 8)}`;
  const movingEmployeeName = 'Jordan Baker';

  // "Next Monday" on a pure calendar (Date.UTC arithmetic) computed from the
  // restaurant's own timezone's "today" — not the runner's local Date. A
  // runner on the other side of midnight from `tz` would otherwise anchor to
  // the wrong calendar day.
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => Number(todayParts.find((p) => p.type === type)?.value);
  const todayUtcMs = Date.UTC(part('year'), part('month') - 1, part('day'));
  const todayDow = new Date(todayUtcMs).getUTCDay(); // 0=Sun..6=Sat
  let daysUntilMonday = (1 - todayDow + 7) % 7;
  if (daysUntilMonday === 0) daysUntilMonday = 7; // today IS Monday — use next week's for a safety margin
  const mondayUtcMs = todayUtcMs + daysUntilMonday * 86_400_000;

  // Future dates anchor off next-Monday (see above); the past shift anchors
  // off TODAY directly so it lands yesterday regardless of how many days
  // away "next Monday" happens to be.
  const dateStrAtOffset = (dayOffset: number): string => {
    const d = new Date(mondayUtcMs + dayOffset * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };
  const dateStrFromToday = (dayOffset: number): string => {
    const d = new Date(todayUtcMs + dayOffset * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };

  const movingShifts = Array.from({ length: opts.shiftCount }, (_, i) => ({
    startIso: wallClockToInstant(dateStrAtOffset(i), opts.start_time, tz).toISOString(),
    endIso: wallClockToInstant(dateStrAtOffset(i), opts.end_time, tz).toISOString(),
  }));

  // Every drifted shift gets its own date, right after the last moving
  // shift's date, so none of them ever collides with a moving shift's date
  // or each other's.
  const driftedInputs = opts.driftedShifts ?? (opts.driftedShift ? [opts.driftedShift] : []);
  const driftedList = driftedInputs.map((d, i) => {
    const dateStr = dateStrAtOffset(opts.shiftCount + i);
    return {
      startIso: wallClockToInstant(dateStr, d.start_time, tz).toISOString(),
      endIso: wallClockToInstant(dateStr, d.end_time, tz).toISOString(),
      employeeName: d.employeeName,
    };
  });

  // Yesterday, restaurant-local calendar day — the whole day is before "now"
  // no matter what time within today "now" actually is.
  const pastDate = dateStrFromToday(-1);
  const past = opts.pastShift
    ? {
        startIso: wallClockToInstant(pastDate, opts.start_time, tz).toISOString(),
        endIso: wallClockToInstant(pastDate, opts.end_time, tz).toISOString(),
        employeeName: opts.pastShift.employeeName,
      }
    : null;

  // Own date, after every moving/drifted date, so it never collides.
  const lockedDate = dateStrAtOffset(opts.shiftCount + driftedList.length);
  const locked = opts.lockedShift
    ? {
        startIso: wallClockToInstant(lockedDate, opts.start_time, tz).toISOString(),
        endIso: wallClockToInstant(lockedDate, opts.end_time, tz).toISOString(),
        employeeName: opts.lockedShift.employeeName,
      }
    : null;

  // Fail loudly on an ambiguous name rather than let the Set in the
  // page.evaluate below dedup it silently: `employeeIdByName`/`rows.find`
  // resolve by name, so a drifted/past/locked employee sharing a name with
  // the moving employee (or with each other) would produce a fixture other
  // than the one the test intended, with no error to explain why.
  const allSeedNames = [
    movingEmployeeName,
    ...driftedList.map((d) => d.employeeName),
    ...(past ? [past.employeeName] : []),
    ...(locked ? [locked.employeeName] : []),
  ];
  const seenNames = new Set<string>();
  for (const name of allSeedNames) {
    if (seenNames.has(name)) {
      throw new Error(
        `seedTemplateWithShifts: employee name "${name}" is used by more than one seeded shift — ` +
        'each moving/drifted/past/locked employee must have a distinct name.'
      );
    }
    seenNames.add(name);
  }

  const seeded = await page.evaluate(
    async (args: {
      restId: string;
      templateName: string;
      position: string;
      startTime: string;
      endTime: string;
      movingEmployeeName: string;
      movingShifts: { startIso: string; endIso: string }[];
      driftedList: { startIso: string; endIso: string; employeeName: string }[];
      past: { startIso: string; endIso: string; employeeName: string } | null;
      locked: { startIso: string; endIso: string; employeeName: string } | null;
    }) => {
      const supabase = (window as any).__supabase;

      const { data: template, error: templateError } = await supabase
        .from('shift_templates')
        .insert({
          restaurant_id: args.restId,
          name: args.templateName,
          start_time: `${args.startTime}:00`,
          end_time: `${args.endTime}:00`,
          position: args.position,
          days: [0, 1, 2, 3, 4, 5, 6], // every day — deterministic regardless of today's weekday
          is_active: true,
        })
        .select()
        .single();
      if (templateError) throw new Error(`shift_templates insert failed: ${templateError.message}`);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No authenticated user found');

      const employeeNames = Array.from(
        new Set([
          args.movingEmployeeName,
          ...args.driftedList.map((d) => d.employeeName),
          ...(args.past ? [args.past.employeeName] : []),
          ...(args.locked ? [args.locked.employeeName] : []),
        ])
      );
      const { data: employees, error: empError } = await supabase
        .from('employees')
        .insert(
          employeeNames.map((name: string) => ({
            restaurant_id: args.restId,
            user_id: user.id,
            name,
            position: args.position,
            status: 'active',
            is_active: true,
            compensation_type: 'hourly',
            hourly_rate: 1500,
          }))
        )
        .select('id, name');
      if (empError) throw new Error(`employees insert failed: ${empError.message}`);

      const employeeIdByName = new Map<string, string>((employees ?? []).map((e: any) => [e.name, e.id]));
      const movingEmployeeId = employeeIdByName.get(args.movingEmployeeName);
      if (!movingEmployeeId) throw new Error('moving employee not found after insert');

      const rowsToInsert = args.movingShifts.map((s) => ({
        restaurant_id: args.restId,
        shift_template_id: template.id,
        employee_id: movingEmployeeId,
        start_time: s.startIso,
        end_time: s.endIso,
        position: args.position,
        status: 'scheduled',
        is_published: false,
        locked: false,
      }));

      for (const d of args.driftedList) {
        const driftedEmployeeId = employeeIdByName.get(d.employeeName);
        if (!driftedEmployeeId) throw new Error(`drifted employee "${d.employeeName}" not found after insert`);
        rowsToInsert.push({
          restaurant_id: args.restId,
          shift_template_id: template.id,
          employee_id: driftedEmployeeId,
          start_time: d.startIso,
          end_time: d.endIso,
          position: args.position,
          status: 'scheduled',
          is_published: false,
          locked: false,
        });
      }

      if (args.past) {
        const pastEmployeeId = employeeIdByName.get(args.past.employeeName);
        if (!pastEmployeeId) throw new Error('past employee not found after insert');
        rowsToInsert.push({
          restaurant_id: args.restId,
          shift_template_id: template.id,
          employee_id: pastEmployeeId,
          start_time: args.past.startIso,
          end_time: args.past.endIso,
          position: args.position,
          status: 'scheduled',
          is_published: false,
          locked: false,
        });
      }

      if (args.locked) {
        const lockedEmployeeId = employeeIdByName.get(args.locked.employeeName);
        if (!lockedEmployeeId) throw new Error('locked employee not found after insert');
        rowsToInsert.push({
          restaurant_id: args.restId,
          shift_template_id: template.id,
          employee_id: lockedEmployeeId,
          start_time: args.locked.startIso,
          end_time: args.locked.endIso,
          position: args.position,
          status: 'scheduled',
          is_published: false,
          locked: true,
        });
      }

      const { data: insertedShifts, error: shiftsError } = await supabase
        .from('shifts')
        .insert(rowsToInsert)
        .select();
      if (shiftsError) throw new Error(`shifts insert failed: ${shiftsError.message}`);

      const rows = (insertedShifts ?? []) as any[];

      const movingRows = rows
        .filter((r) => r.employee_id === movingEmployeeId)
        .map((r) => ({ shiftId: r.id as string, startTime: r.start_time as string, endTime: r.end_time as string }));

      // Match on employee_id alone: every non-moving bucket here gets its own
      // uniquely-named employee, so this is a stable key across the batch.
      // (Matching on start_time is unreliable — Postgres normalizes the
      // returned timestamptz string and it need not equal the JS-side
      // `toISOString()` we sent byte-for-byte.)
      const driftedResults = args.driftedList.map((d) => {
        const employeeId = employeeIdByName.get(d.employeeName);
        const match = rows.find((r) => r.employee_id === employeeId);
        if (!match) throw new Error(`drifted shift for "${d.employeeName}" not found among inserted rows`);
        return {
          shiftId: match.id as string,
          employeeName: d.employeeName,
          startTime: match.start_time as string,
          endTime: match.end_time as string,
        };
      });

      let pastResult: { shiftId: string; startTime: string; endTime: string } | null = null;
      if (args.past) {
        const employeeId = employeeIdByName.get(args.past.employeeName);
        const match = rows.find((r) => r.employee_id === employeeId);
        if (!match) throw new Error('past shift not found among inserted rows');
        pastResult = { shiftId: match.id as string, startTime: match.start_time as string, endTime: match.end_time as string };
      }

      let lockedResult: { shiftId: string; startTime: string; endTime: string } | null = null;
      if (args.locked) {
        const employeeId = employeeIdByName.get(args.locked.employeeName);
        const match = rows.find((r) => r.employee_id === employeeId);
        if (!match) throw new Error('locked shift not found among inserted rows');
        lockedResult = { shiftId: match.id as string, startTime: match.start_time as string, endTime: match.end_time as string };
      }

      return {
        templateId: template.id as string,
        templateName: template.name as string,
        moving: movingRows,
        drifted: driftedResults,
        past: pastResult,
        locked: lockedResult,
      };
    },
    {
      restId: restaurantId,
      templateName,
      position,
      startTime: opts.start_time,
      endTime: opts.end_time,
      movingEmployeeName,
      movingShifts,
      driftedList,
      past,
      locked,
    }
  );

  const driftedShifts: SeededDriftedShift[] = seeded.drifted.map((d, i) => ({
    shiftId: d.shiftId,
    employeeName: d.employeeName,
    localDate: formatLocalDateInTz(new Date(driftedList[i].startIso), tz),
    startTime: d.startTime,
    endTime: d.endTime,
  }));

  return {
    template: {
      id: seeded.templateId,
      name: seeded.templateName,
      start_time: opts.start_time,
      end_time: opts.end_time,
    },
    drifted: driftedShifts[0] ?? null,
    driftedShifts,
    moving: seeded.moving,
    past: seeded.past && opts.pastShift
      ? { shiftId: seeded.past.shiftId, employeeName: opts.pastShift.employeeName, startTime: seeded.past.startTime, endTime: seeded.past.endTime }
      : null,
    locked: seeded.locked && opts.lockedShift
      ? { shiftId: seeded.locked.shiftId, employeeName: opts.lockedShift.employeeName, startTime: seeded.locked.startTime, endTime: seeded.locked.endTime }
      : null,
  };
}

/**
 * Fill an employee's hours spinbutton on the Tips daily-entry screen and assert
 * the value committed. Verifying the commit catches the (now-fixed) case where a
 * background re-render could drop a just-typed value, and fails at the point of
 * entry rather than three assertions later.
 */
export async function fillHours(page: Page, employeeName: string, hours: string) {
  const escapedName = employeeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const input = page.getByRole('spinbutton', { name: new RegExp(escapedName, 'i') });
  await input.fill(hours);
  await expect(input).toHaveValue(hours);
}

/**
 * Generate unique test user credentials to avoid conflicts
 */
export const generateTestUser = (prefix: string = 'test') => {
  const ts = Date.now();
  // crypto.randomUUID() rather than Math.random(): the returned object also
  // carries a `password`, so CodeQL (js/insecure-randomness) taints any
  // Math.random()-derived field here as randomness in a security context.
  // The suffix only needs to make emails unique, but a CSPRNG costs nothing.
  const random = crypto.randomUUID().slice(0, 8);
  return {
    email: `${prefix}-${ts}-${random}@test.com`,
    password: 'TestPassword123!',
    fullName: `${prefix} Test User ${ts}`,
    restaurantName: `${prefix} Test Restaurant ${ts}`,
  };
};

/**
 * Standard signup and restaurant creation flow for E2E tests
 * Handles OnboardingDrawer that appears after restaurant creation
 */
export async function signUpAndCreateRestaurant(
  page: Page,
  user: { email: string; password: string; fullName: string; restaurantName: string }
) {
  const { expect } = await import('@playwright/test');

  await page.goto('/auth');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForURL(/\/auth/);

  // Expose Supabase helpers now that we're on the app (Vite serving)
  await exposeSupabaseHelpers(page);

  const signupTab = page.getByRole('tab', { name: /sign up/i });
  await expect(signupTab).toBeVisible({ timeout: 10000 });
  await signupTab.click();

  await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10000 });
  await page.getByLabel(/email/i).first().fill(user.email);
  await page.getByLabel(/full name/i).fill(user.fullName);
  await page.getByLabel(/password/i).first().fill(user.password);
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await page.waitForURL('/', { timeout: 15000 });

  // Handle Welcome Modal (shows pricing plans for new users)
  await page.getByRole('button', { name: 'Get Started', exact: true }).click({ timeout: 5000 });

  const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
  await expect(addRestaurantButton).toBeVisible({ timeout: 10000 });
  await addRestaurantButton.click();

  // Filter specifically for RestaurantSelector dialog to avoid confusion with OnboardingDrawer
  const dialog = page.getByRole('dialog').filter({ hasText: /add new restaurant/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/restaurant name/i).fill(user.restaurantName);
  await dialog.getByLabel(/address/i).fill('123 Main St');
  await dialog.getByLabel(/phone/i).fill('555-123-4567');
  await dialog.getByRole('button', { name: /create|add|save/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });

  // Close onboarding drawer if it appears (it defaults to open for new restaurants)
  try {
    const onboardingDrawer = page.locator('[role="dialog"]').filter({ hasText: /getting started/i });
    if (await onboardingDrawer.isVisible({ timeout: 4000 })) {
      const closeButton = onboardingDrawer.getByRole('button', { name: /close/i });
      if (await closeButton.isVisible()) {
        await closeButton.click();
        await expect(onboardingDrawer).not.toBeVisible();
      } else {
        await page.keyboard.press('Escape');
      }
    }
  } catch (e) {
    console.log('Onboarding drawer handling skipped or failed', e);
  }

  // Set subscription tier to Pro so E2E tests can access all features
  try {
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    if (restaurantId) {
      await page.evaluate(
        (restId) => (window as any).__setSubscriptionTier(restId, 'pro', 'active'),
        restaurantId
      );
    }
  } catch (e) {
    console.log('Failed to set subscription tier to Pro:', e);
  }
}

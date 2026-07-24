import { test, expect, type Page } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * E2E: Coverage chart explainer (Timeline view).
 *
 * Exercises the redesigned coverage panel end-to-end against a real staffing
 * pipeline: the single SVG coverage chart (people y-axis, demand/floor split,
 * roving-tabindex columns), the on-chart SPLH slider with its live
 * implied-labor readout + on/over-target pill, and the pinned arithmetic
 * receipt. The pure branch logic (`classifyHour`, `impliedLabor`, `buildReceipt`)
 * is unit-tested separately; this spec proves the wiring — seeded sales →
 * demand → a rendered, interactive explainer.
 *
 * Determinism:
 *  - Restaurant timezone pinned to 'UTC' so the Timeline's default-day selection
 *    and the demand pipeline's weekday bucketing don't drift with host TZ.
 *  - Exactly ONE employee at hourly_rate 1500 (¢) so `avgWage` is exactly
 *    $15.00/hr — the implied-labor percentages below are then fixed:
 *      splh 60 (default) → 15/60 = 25.0%  (> 22% target → "Over target")
 *      splh 120 (End)    → 15/120 = 12.5% (< 22% target → "On target")
 *      splh 25  (Home)   → 15/25 = 60.0%  (> 22% target → "Over target")
 *  - Sales seeded for every day across the last two weeks (daily-spread
 *    fallback, ~$2400/day) so whatever weekday "today" resolves to has demand
 *    of ~4/hr against a lone scheduled server → guaranteed `crit` columns.
 */

/** Host-local YYYY-MM-DD for today — matches the Timeline's default day selection. */
function todayLocalDateStr(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function pinRestaurantTimezone(page: Page, restaurantId: string, timezone = 'UTC') {
  const error = await page.evaluate(
    async ({ restId, tz }) => {
      const supabase = (window as any).__supabase;
      const { error } = await supabase.from('restaurants').update({ timezone: tz }).eq('id', restId);
      return error?.message ?? null;
    },
    { restId: restaurantId, tz: timezone },
  );
  expect(error).toBeNull();
}

/** Seed one $15/hr server plus a mid-day shift today (UTC instants) so a lane and coverage window exist. */
async function seedEmployeeAndShift(page: Page, restaurantId: string): Promise<void> {
  const inserted = await page.evaluate(
    ({ restId }) =>
      (window as any).__insertEmployees(
        [
          {
            name: 'Dana Okafor',
            position: 'Server',
            status: 'active',
            is_active: true,
            compensation_type: 'hourly',
            hourly_rate: 1500, // ¢ → avgWage $15.00/hr exactly
          },
        ],
        restId,
      ),
    { restId: restaurantId },
  );
  const emp = (inserted as Array<{ id: string; name: string }>).find((e) => e.name === 'Dana Okafor')!;
  const day = todayLocalDateStr();

  await page.evaluate(
    ({ restId, empId, dayStr }) =>
      (window as any).__insertShifts(
        [
          {
            employee_id: empId,
            start_time: `${dayStr}T10:00:00Z`,
            end_time: `${dayStr}T16:00:00Z`,
            position: 'Server',
            status: 'scheduled',
            break_duration: 0,
            is_published: false,
            locked: false,
          },
        ],
        restId,
      ),
    { restId: restaurantId, empId: emp.id, dayStr: day },
  );
}

/** Seed ~$2400/day of history for the last 14 days (daily-spread fallback → per-hour demand ≈ 4). */
async function seedSalesHistory(page: Page, restaurantId: string): Promise<void> {
  await page.evaluate(
    async ({ restId }: { restId: string }) => {
      const supabase = (window as any).__supabase;
      const today = new Date();
      const rows: Record<string, unknown>[] = [];
      for (let daysAgo = 1; daysAgo <= 14; daysAgo++) {
        const d = new Date(today);
        d.setDate(d.getDate() - daysAgo);
        const saleDate = d.toISOString().slice(0, 10);
        rows.push({
          restaurant_id: restId,
          pos_system: 'manual',
          external_order_id: `coverage-e2e-${daysAgo}-${Date.now()}`,
          item_name: 'Food Sale',
          item_type: 'sale',
          quantity: 1,
          unit_price: 2400,
          total_price: 2400,
          sale_date: saleDate,
          // sale_time omitted → daily-spread fallback (9am–10pm)
        });
      }
      const { error } = await supabase.from('unified_sales').insert(rows);
      if (error) throw new Error(`Seed failed: ${error.message}`);
    },
    { restId: restaurantId },
  );
}

/** Navigate to the planner and switch to the Timeline view (defaults to today). */
async function openTimeline(page: Page): Promise<void> {
  await page.goto('/scheduling');
  await page.waitForURL(/\/scheduling/, { timeout: 10000 });

  const plannerTab = page.getByRole('tab', { name: /planner/i });
  await expect(plannerTab).toBeVisible({ timeout: 10000 });
  await plannerTab.click();

  // ToggleGroupItem renders with role="radio" in single-select mode.
  const timelineToggle = page.getByRole('radio', { name: /^timeline$/i });
  await expect(timelineToggle).toBeVisible({ timeout: 10000 });
  await timelineToggle.click();
}

test.describe('Coverage chart explainer', () => {
  test('renders the chart, SPLH slider, and arithmetic receipt with demand-short columns', async ({ page }) => {
    const user = generateTestUser('coverage-explainer');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await pinRestaurantTimezone(page, restaurantId);
    await seedEmployeeAndShift(page, restaurantId);
    await seedSalesHistory(page, restaurantId);

    await openTimeline(page);

    // The single coverage chart (role="toolbar", not role="img").
    const chart = page.getByRole('toolbar', { name: /hourly coverage chart/i });
    await expect(chart).toBeVisible({ timeout: 15000 });

    // Demand > scheduled produces at least one solid-red "short on demand" column.
    const critColumns = page.locator('[data-hour-col][data-kind="crit"]');
    await expect(critColumns.first()).toBeVisible({ timeout: 10000 });
    expect(await critColumns.count()).toBeGreaterThan(0);

    // Legend distinguishes demand-short from floor-short (the whole point of the redesign).
    // Scope to the legend — the same phrases also appear in the sr-only summary and the receipt.
    const legend = page.getByTestId('coverage-chart-legend');
    await expect(legend.getByText('Short on demand')).toBeVisible();
    await expect(legend.getByText('At the floor only')).toBeVisible();

    // On-chart SPLH slider + its live implied-labor readout at the default target ($60 → 25.0%).
    const slider = page.getByRole('slider', { name: /sales per labor hour target/i });
    await expect(slider).toBeVisible();
    await expect(page.getByText(/25\.0% labor at \$15\.00\/hr/)).toBeVisible();
    await expect(page.getByTestId('splh-slider-pill')).toHaveText('Over target');

    // Owner may persist the target — the Save button is present (Stage 5.3 authz gate).
    await expect(
      page.getByRole('button', { name: /save sales per labor hour target/i }),
    ).toBeVisible();

    // Pinned arithmetic receipt, defaulting to the worst (crit) hour, offering quick-add.
    const receipt = page.getByTestId('coverage-receipt');
    await expect(receipt).toBeVisible();
    await expect(receipt.getByRole('button', { name: /add shift for this hour/i })).toBeVisible();
  });

  test('SPLH slider live-updates the implied labor % and flips the on/over-target pill', async ({ page }) => {
    const user = generateTestUser('coverage-slider');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await pinRestaurantTimezone(page, restaurantId);
    await seedEmployeeAndShift(page, restaurantId);
    await seedSalesHistory(page, restaurantId);

    await openTimeline(page);

    const slider = page.getByRole('slider', { name: /sales per labor hour target/i });
    await expect(slider).toBeVisible({ timeout: 15000 });
    const pill = page.getByTestId('splh-slider-pill');

    // Baseline: default target $60 → 25.0% labor, over the 22% target.
    await expect(pill).toHaveText('Over target');

    // Drag to the max ($120) → 15/120 = 12.5% labor, now under target → pill flips to "On target".
    await slider.focus();
    await page.keyboard.press('End');
    await expect(page.getByText(/12\.5% labor at \$15\.00\/hr/)).toBeVisible();
    await expect(pill).toHaveText('On target');

    // Drag to the min ($25) → 15/25 = 60.0% labor, well over target → pill returns to "Over target".
    await page.keyboard.press('Home');
    await expect(page.getByText(/60\.0% labor at \$15\.00\/hr/)).toBeVisible();
    await expect(pill).toHaveText('Over target');
  });
});

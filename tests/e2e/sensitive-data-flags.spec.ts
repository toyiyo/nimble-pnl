import { expect, test, type Page } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

type TestUser = ReturnType<typeof generateTestUser>;

// Sign the member up first, purely to mint a real auth.users row — the
// membership row's user_id is a foreign key, so it cannot be faked. Return
// the new user id and sign back out, so the caller can seed as the owner.
async function signUpMemberReturnId(page: Page, member: TestUser): Promise<string> {
  await page.goto('/auth');
  // Clear any stale session left by another test before signing up — a
  // leftover session here would sign the member in as the wrong user.
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await exposeSupabaseHelpers(page);
  await page.getByRole('tab', { name: /sign up/i }).click();
  await page.getByLabel(/email/i).first().fill(member.email);
  await page.getByLabel(/full name/i).fill(member.fullName);
  await page.getByLabel(/password/i).first().fill(member.password);
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await page.waitForURL('/', { timeout: 10000 });

  const memberUserId = await page.evaluate(async () => {
    // `any`: test-only global attached by exposeSupabaseHelpers, no typed surface.
    const user = await (window as any).__getAuthUser();
    return user?.id as string;
  });

  await page.evaluate(async () => {
    // `any`: test-only global attached by exposeSupabaseHelpers, no typed surface.
    await (window as any).__supabase.auth.signOut();
  });

  return memberUserId;
}

// Sign in with a real credentialed session, not the owner's.
async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/auth');
  await page.getByLabel(/email/i).first().fill(user.email);
  await page.getByLabel(/password/i).first().fill(user.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 10000 });
}

// A role without view:pay_rates opens the roster and sees no pay.
//
// The gate is in Postgres, so the check that matters is the response body, not
// the rendered text. A client-only gate would still ship the rate over the
// wire, and this role is collaborator-flavored — an external person who can
// call PostgREST with their own token.
test('a role without view:pay_rates receives no rate from PostgREST', async ({ page }) => {
  const member = generateTestUser('no-pay-member');
  const owner = generateTestUser('no-pay-owner');

  // 1. Mint the member's auth.users row, then sign back out.
  const memberUserId = await signUpMemberReturnId(page, member);
  expect(memberUserId).toBeTruthy();

  // 2. Owner signs up and creates the restaurant.
  await signUpAndCreateRestaurant(page, owner);
  await exposeSupabaseHelpers(page);

  // 3. Owner seeds: a custom role holding only the scheduling area (no
  //    view:pay_rates, no view:employee_pii role_flags row at all), the
  //    member's membership on that role, and one employee row with a real
  //    rate and a real email — proof of what a leak would look like.
  const roleName = `Scheduler ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.evaluate(
    async ({ memberUserId, roleName }) => {
      // `any`: both are test-only globals attached by exposeSupabaseHelpers, no typed surface.
      const supabase = (window as any).__supabase;
      const restaurantId = await (window as any).__getRestaurantId();

      const { data: role, error: roleError } = await supabase
        .from('roles')
        .insert({ restaurant_id: restaurantId, name: roleName, flavor: 'collaborator', builtin: false })
        .select('id')
        .single();
      if (roleError) throw new Error(`role insert failed: ${roleError.message}`);

      const { error: areaError } = await supabase
        .from('role_areas')
        .insert({ role_id: role.id, area_key: 'scheduling', level: 'view' });
      if (areaError) throw new Error(`area insert failed: ${areaError.message}`);

      const { error: memberError } = await supabase.from('user_restaurants').insert({
        user_id: memberUserId,
        restaurant_id: restaurantId,
        role: 'collaborator_custom',
        role_id: role.id,
      });
      if (memberError) throw new Error(`membership insert failed: ${memberError.message}`);

      const { error: employeeError } = await supabase.from('employees').insert({
        restaurant_id: restaurantId,
        name: 'Rate Carrier',
        email: 'rate-carrier@example.com',
        position: 'Cook',
        status: 'active',
        is_active: true,
        compensation_type: 'hourly',
        hourly_rate: 1800,
      });
      if (employeeError) throw new Error(`employee insert failed: ${employeeError.message}`);
    },
    { memberUserId, roleName }
  );

  await page.evaluate(async () => {
    // `any`: test-only global attached by exposeSupabaseHelpers, no typed surface.
    await (window as any).__supabase.auth.signOut();
  });

  // 4. Sign in as the member — a real credentialed session, not the owner's.
  await signIn(page, member);

  // Some other query on the page (the caller's own self-scope employee
  // lookup) also hits employees_secure, via `.single()`, and 406s here
  // because this member has no linked employee record. That is a
  // different request from the roster fetch this test cares about, so
  // only keep responses whose body is a row array — the roster shape.
  const bodies: unknown[] = [];
  page.on('response', async (response) => {
    if (response.url().includes('/rest/v1/employees_secure')) {
      const json = await response.json().catch(() => null);
      if (Array.isArray(json)) bodies.push(json);
    }
  });

  // Wait for the roster fetch specifically — the row-array shape, not the
  // caller's own `.single()` self-scope lookup on the same table.
  const rosterResponse = page.waitForResponse(async (response) => {
    if (!response.url().includes('/rest/v1/employees_secure')) return false;
    const json = await response.json().catch(() => null);
    return Array.isArray(json);
  }, { timeout: 10000 });
  await page.goto('/scheduling');
  await expect(page.getByRole('heading', { name: /schedule/i })).toBeVisible({ timeout: 10000 });
  await rosterResponse;

  const rows = bodies.flat().filter(Boolean) as Array<Record<string, unknown>>;
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.hourly_rate).toBeNull();
    expect(row.email).toBeNull();
  }
});

// A staff member sees their OWN pay and PII, but every coworker stays masked.
//
// The masked view carries a self-row exception: `e.user_id = auth.uid()`
// unmasks a member's own row, even without view:pay_rates. This proves a
// staff user reads their own rate on /employee/pay, and that the exception
// does not leak a coworker's rate or a row linked to nobody.
test('a staff member sees own pay and PII, coworkers stay masked', async ({ page }) => {
  const member = generateTestUser('self-pay-member');
  const owner = generateTestUser('self-pay-owner');

  // 1. Mint the member's auth.users row, then sign back out.
  const memberUserId = await signUpMemberReturnId(page, member);
  expect(memberUserId).toBeTruthy();

  // 2. Owner signs up and creates the restaurant.
  await signUpAndCreateRestaurant(page, owner);
  await exposeSupabaseHelpers(page);

  // 3. Owner seeds: a plain staff membership (no view:pay_rates, no
  //    view:employee_pii), the member's OWN employee row linked by user_id,
  //    and a coworker row linked to nobody.
  await page.evaluate(
    async ({ memberUserId }) => {
      // `any`: both are test-only globals attached by exposeSupabaseHelpers, no typed surface.
      const supabase = (window as any).__supabase;
      const restaurantId = await (window as any).__getRestaurantId();

      const { error: memberError } = await supabase.from('user_restaurants').insert({
        user_id: memberUserId,
        restaurant_id: restaurantId,
        role: 'staff',
      });
      if (memberError) throw new Error(`membership insert failed: ${memberError.message}`);

      // The member's own row — the self-row exception must unmask it.
      const { error: selfError } = await supabase.from('employees').insert({
        restaurant_id: restaurantId,
        user_id: memberUserId,
        name: 'Self Carrier',
        email: 'self-carrier@example.com',
        position: 'Server',
        status: 'active',
        is_active: true,
        compensation_type: 'hourly',
        hourly_rate: 2500,
      });
      if (selfError) throw new Error(`self employee insert failed: ${selfError.message}`);

      // A coworker row, linked to nobody — must stay masked for the member.
      const { error: coworkerError } = await supabase.from('employees').insert({
        restaurant_id: restaurantId,
        name: 'Coworker Carrier',
        email: 'coworker-carrier@example.com',
        position: 'Cook',
        status: 'active',
        is_active: true,
        compensation_type: 'hourly',
        hourly_rate: 1800,
      });
      if (coworkerError) throw new Error(`coworker employee insert failed: ${coworkerError.message}`);
    },
    { memberUserId }
  );

  await page.evaluate(async () => {
    // `any`: test-only global attached by exposeSupabaseHelpers, no typed surface.
    await (window as any).__supabase.auth.signOut();
  });

  // 4. Sign in as the member.
  await signIn(page, member);

  // 5. /employee/pay shows the member's own rate — a real number, not $0.00/hr.
  //    The rate renders twice (the header subtitle and the wages breakdown),
  //    so match the first node — the assertion is presence, not count.
  await page.goto('/employee/pay');
  await expect(page.getByText(/\$25\.00\/hr/).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/\$0\.00\/hr/)).toHaveCount(0);

  // 6. employees_secure returns the member's own row unmasked and every other
  //    row masked. The self-row exception must not leak a coworker's data.
  await exposeSupabaseHelpers(page);
  const rows = await page.evaluate(async () => {
    // `any`: test-only global attached by exposeSupabaseHelpers, no typed surface.
    const supabase = (window as any).__supabase;
    const restaurantId = await (window as any).__getRestaurantId();
    const { data, error } = await supabase
      .from('employees_secure')
      .select('user_id, hourly_rate, email')
      .eq('restaurant_id', restaurantId);
    if (error) throw new Error(error.message);
    return data as Array<{ user_id: string | null; hourly_rate: number | null; email: string | null }>;
  });

  const ownRows = rows.filter((row) => row.user_id === memberUserId);
  const otherRows = rows.filter((row) => row.user_id !== memberUserId);

  // The member's own row is unmasked.
  expect(ownRows).toHaveLength(1);
  expect(ownRows[0].hourly_rate).toBe(2500);
  expect(ownRows[0].email).toBe('self-carrier@example.com');

  // Every other row stays masked — the coworker linked to nobody included.
  expect(otherRows.length).toBeGreaterThan(0);
  for (const row of otherRows) {
    expect(row.hourly_rate).toBeNull();
    expect(row.email).toBeNull();
  }
});

// A role without view:pay_rates reads the dashboard labor cost as "Unavailable".
//
// A masked rate arrives as null, and a null rate would compute as a $0 labor
// cost — a wrong number that understates labor and inflates margin. The
// dashboard must mark the Labor and Net Profit cells "Unavailable" instead.
// The `chef` legacy role reaches the dashboard (view:dashboard) but holds no
// view:pay_rates, so employees_secure masks every rate for it.
test('a role without view:pay_rates sees dashboard labor cost as Unavailable', async ({ page }) => {
  const member = generateTestUser('no-pay-chef');
  const owner = generateTestUser('dash-owner');

  // 1. Mint the member's auth.users row, then sign back out.
  const memberUserId = await signUpMemberReturnId(page, member);
  expect(memberUserId).toBeTruthy();

  // 2. Owner signs up and creates the restaurant.
  await signUpAndCreateRestaurant(page, owner);
  await exposeSupabaseHelpers(page);

  // 3. Owner seeds: a chef membership (reaches the dashboard, no view:pay_rates)
  //    and one active hourly employee with a real rate. The chef reads null
  //    for that rate, which would compute as a $0 labor cost without the fix.
  await page.evaluate(
    async ({ memberUserId }) => {
      // `any`: both are test-only globals attached by exposeSupabaseHelpers, no typed surface.
      const supabase = (window as any).__supabase;
      const restaurantId = await (window as any).__getRestaurantId();

      const { error: memberError } = await supabase.from('user_restaurants').insert({
        user_id: memberUserId,
        restaurant_id: restaurantId,
        role: 'chef',
      });
      if (memberError) throw new Error(`membership insert failed: ${memberError.message}`);

      const { error: employeeError } = await supabase.from('employees').insert({
        restaurant_id: restaurantId,
        name: 'Rate Carrier',
        position: 'Cook',
        status: 'active',
        is_active: true,
        compensation_type: 'hourly',
        hourly_rate: 1800,
        hire_date: '2020-01-01',
      });
      if (employeeError) throw new Error(`employee insert failed: ${employeeError.message}`);
    },
    { memberUserId }
  );

  await page.evaluate(async () => {
    // `any`: test-only global attached by exposeSupabaseHelpers, no typed surface.
    await (window as any).__supabase.auth.signOut();
  });

  // 4. Sign in as the member and open the dashboard.
  await signIn(page, member);
  await page.goto('/');
  // The heading renders twice (the page section and the table card), so match
  // the first node — the assertion is presence, not count.
  await expect(page.getByRole('heading', { name: /monthly performance/i }).first()).toBeVisible({ timeout: 15000 });

  // The Labor and Net Profit cells for a month with a masked rate read
  // "Unavailable", never a $0 labor cost.
  await expect(page.getByText('Pay rates hidden').first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Labor cost hidden').first()).toBeVisible();
});

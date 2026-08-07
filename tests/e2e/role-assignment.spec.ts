import { test, expect } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

test('an owner moves a member into a custom role and it survives a reload', async ({ page }) => {
  const member = generateTestUser('member');
  const owner = generateTestUser('owner');

  // 1. Sign the member up first, purely to mint a real auth.users row — the
  //    membership row's user_id is a foreign key, so it cannot be faked.
  await page.goto('/auth');
  await exposeSupabaseHelpers(page);
  await page.getByRole('tab', { name: /sign up/i }).click();
  await page.getByLabel(/email/i).first().fill(member.email);
  await page.getByLabel(/full name/i).fill(member.fullName);
  await page.getByLabel(/password/i).first().fill(member.password);
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await page.waitForURL('/', { timeout: 15000 });

  const memberUserId = await page.evaluate(async () => {
    // `any`: test-only global attached by exposeSupabaseHelpers, no typed surface.
    const user = await (window as any).__getAuthUser();
    return user?.id as string;
  });
  expect(memberUserId).toBeTruthy();

  await page.evaluate(async () => {
    // `any`: test-only global attached by exposeSupabaseHelpers, no typed surface.
    await (window as any).__supabase.auth.signOut();
  });

  // 2. Owner signs up and creates the restaurant.
  await signUpAndCreateRestaurant(page, owner);
  await exposeSupabaseHelpers(page);

  // 3. Seed a custom role and the member's staff membership, from the owner's
  //    session. Both writes are ones the owner can legitimately make.
  const roleName = `Ops Lead ${Date.now()}`;
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

      const { error: grantError } = await supabase
        .from('role_areas')
        .insert({ role_id: role.id, area_key: 'recipes', level: 'manage' });
      if (grantError) throw new Error(`grant insert failed: ${grantError.message}`);

      const { error: memberError } = await supabase
        .from('user_restaurants')
        .insert({ user_id: memberUserId, restaurant_id: restaurantId, role: 'staff' });
      if (memberError) throw new Error(`membership insert failed: ${memberError.message}`);
    },
    { memberUserId, roleName }
  );

  // 4. The actual behaviour under test.
  await page.goto('/team');

  const chip = page.getByRole('combobox', { name: new RegExp(`${member.fullName}.*Change role`) });
  await expect(chip).toBeVisible({ timeout: 10000 });
  await chip.click();

  await page.getByRole('option', { name: new RegExp(roleName) }).click();
  await page.getByRole('button', { name: `Change role to ${roleName}` }).click();

  await expect(
    page.getByRole('combobox', { name: new RegExp(`role is ${roleName}`) })
  ).toBeVisible({ timeout: 10000 });

  // The reload is the whole point. The code this replaces showed a success
  // toast over a write that never landed; only a reload told the truth.
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: new RegExp(`role is ${roleName}`) })
  ).toBeVisible({ timeout: 10000 });
});

/**
 * The claim the whole design rests on: the role lives on the ACCOUNT, not on
 * the employee row. So the employee dialog and Team members are two windows
 * onto one value — changing it through either has to move the other.
 *
 * If this ever fails, the likely cause is a third assignment path having grown
 * somewhere that writes a role the other surface doesn't read.
 */
test('a role changed on the employee dialog is the same role Team members shows', async ({ page }) => {
  const member = generateTestUser('two-surface-member');
  const owner = generateTestUser('two-surface-owner');

  // Mint a real auth.users row for the member — user_restaurants.user_id and
  // employees.user_id are both foreign keys, so neither can be faked.
  await page.goto('/auth');
  await exposeSupabaseHelpers(page);
  await page.getByRole('tab', { name: /sign up/i }).click();
  await page.getByLabel(/email/i).first().fill(member.email);
  await page.getByLabel(/full name/i).fill(member.fullName);
  await page.getByLabel(/password/i).first().fill(member.password);
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await page.waitForURL('/', { timeout: 15000 });

  const memberUserId = await page.evaluate(async () => {
    // `any`: test-only global attached by exposeSupabaseHelpers, no typed surface.
    const user = await (window as any).__getAuthUser();
    return user?.id as string;
  });
  expect(memberUserId).toBeTruthy();

  await page.evaluate(async () => {
    // `any`: test-only global attached by exposeSupabaseHelpers, no typed surface.
    await (window as any).__supabase.auth.signOut();
  });

  await signUpAndCreateRestaurant(page, owner);
  await exposeSupabaseHelpers(page);

  // Seed the custom role, the membership, and — the piece this test needs that
  // the one above doesn't — an employee record LINKED to the same account.
  const roleName = `Line Captain ${Date.now()}`;
  await page.evaluate(
    async ({ memberUserId, memberName, memberEmail, roleName }) => {
      // `any`: both are test-only globals attached by exposeSupabaseHelpers, no typed surface.
      const supabase = (window as any).__supabase;
      const restaurantId = await (window as any).__getRestaurantId();

      const { data: role, error: roleError } = await supabase
        .from('roles')
        .insert({ restaurant_id: restaurantId, name: roleName, flavor: 'collaborator', builtin: false })
        .select('id')
        .single();
      if (roleError) throw new Error(`role insert failed: ${roleError.message}`);

      const { error: grantError } = await supabase
        .from('role_areas')
        .insert({ role_id: role.id, area_key: 'recipes', level: 'manage' });
      if (grantError) throw new Error(`grant insert failed: ${grantError.message}`);

      const { error: memberError } = await supabase
        .from('user_restaurants')
        .insert({ user_id: memberUserId, restaurant_id: restaurantId, role: 'staff' });
      if (memberError) throw new Error(`membership insert failed: ${memberError.message}`);

      const { error: employeeError } = await supabase.from('employees').insert({
        restaurant_id: restaurantId,
        user_id: memberUserId,
        name: memberName,
        email: memberEmail,
        position: 'Cook',
        status: 'active',
      });
      if (employeeError) throw new Error(`employee insert failed: ${employeeError.message}`);
    },
    { memberUserId, memberName: member.fullName, memberEmail: member.email, roleName }
  );

  // --- Surface 1: the employee dialog ---
  await page.goto('/employees');
  await page.getByRole('button', { name: `Edit ${member.fullName}` }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // The row reports the linked ACCOUNT, not a role stored on the employee row.
  await expect(dialog.getByText(member.email)).toBeVisible({ timeout: 10000 });

  const dialogChip = dialog.getByRole('combobox', {
    name: new RegExp(`${member.fullName}.*Change role`),
  });
  await expect(dialogChip).toBeVisible({ timeout: 10000 });
  await dialogChip.click();

  await page.getByRole('option', { name: new RegExp(roleName) }).click();
  await page.getByRole('button', { name: `Change role to ${roleName}` }).click();

  await expect(
    dialog.getByRole('combobox', { name: new RegExp(`role is ${roleName}`) })
  ).toBeVisible({ timeout: 10000 });

  // --- Surface 2: Team members, reading the same row ---
  await page.goto('/team');
  await expect(
    page.getByRole('combobox', { name: new RegExp(`${member.fullName}.*role is ${roleName}`) })
  ).toBeVisible({ timeout: 10000 });
});

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
    const user = await (window as any).__getAuthUser();
    return user?.id as string;
  });
  expect(memberUserId).toBeTruthy();

  await page.evaluate(async () => { await (window as any).__supabase.auth.signOut(); });

  // 2. Owner signs up and creates the restaurant.
  await signUpAndCreateRestaurant(page, owner);
  await exposeSupabaseHelpers(page);

  // 3. Seed a custom role and the member's staff membership, from the owner's
  //    session. Both writes are ones the owner can legitimately make.
  const roleName = `Ops Lead ${Date.now()}`;
  await page.evaluate(
    async ({ memberUserId, roleName }) => {
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

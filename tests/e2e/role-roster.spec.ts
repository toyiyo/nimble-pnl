import { test, expect } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

/**
 * Move 2 of the role-assignment design: a role card's member count is a door.
 *
 * The bug this closes is the one the user reported — you make a custom role,
 * and the card says "0 members" with nothing to click. So this walks the path
 * from the dead end to the fix: empty card → "Assign people" → the People tab
 * → the dialog → the count on the card, all without touching the Team members
 * tab that Move 1 already covers (role-assignment.spec.ts).
 *
 * The reload at the end is the same guard Move 1's spec keeps: the code this
 * feature replaced showed success over a write that never landed.
 */
test('an owner fills an empty custom role from the role card, and the count follows', async ({ page }) => {
  const member = generateTestUser('member');
  const owner = generateTestUser('owner');

  // Sign the member up first, purely to mint a real auth.users row — the
  // membership row's user_id is a foreign key, so it cannot be faked.
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

  // Seed the empty custom role and the member's staff membership. Both writes
  // are ones the owner can legitimately make through the UI; doing them here
  // keeps the spec on the behaviour under test rather than re-walking the role
  // builder, which roles-and-areas.spec.ts already covers end to end.
  const roleName = `Weekend Lead ${Date.now()}`;
  await page.evaluate(
    async ({ memberUserId, roleName }) => {
      // `any`: both are test-only globals attached by exposeSupabaseHelpers.
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

  await page.goto('/team');
  await page.getByRole('tab', { name: /roles & areas/i }).click();

  // ---- The dead end, now a door ----
  const assignFromCard = page.getByRole('button', {
    name: new RegExp(`Nobody is in ${roleName} yet\\. Assign people`),
  });
  await expect(assignFromCard).toBeVisible({ timeout: 10000 });
  await assignFromCard.click();

  // It opens the editor on the People tab, not the Areas tab — the two doors
  // on a card go to different places.
  await expect(page.getByRole('tab', { name: 'People', selected: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /who's in this role/i })).toBeVisible();

  // ---- Assign, from the role's side rather than the person's ----
  await page.getByRole('button', { name: /^assign people$/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const dialog = page.getByRole('dialog');
  await dialog.getByText(member.fullName).click();
  await dialog.getByRole('button', { name: /^assign 1$/i }).click();

  // ---- The roster now holds them ----
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
  await expect(
    page.getByRole('combobox', { name: new RegExp(`${member.fullName}.*role is ${roleName}`) })
  ).toBeVisible({ timeout: 10000 });

  // ---- And the card's count followed ----
  await page.getByRole('button', { name: /all roles/i }).click();
  const countDoor = page.getByRole('button', {
    name: new RegExp(`1 person in ${roleName}`),
  });
  await expect(countDoor).toBeVisible({ timeout: 10000 });

  await page.reload();
  await page.getByRole('tab', { name: /roles & areas/i }).click();
  await expect(countDoor).toBeVisible({ timeout: 10000 });
});

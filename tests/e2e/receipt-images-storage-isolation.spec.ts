import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generateTestUser } from '../helpers/e2e-supabase';
import { getServiceRoleClient } from '../helpers/e2e-service-role';

/**
 * Tenant isolation of the private `receipt-images` bucket, through the real
 * storage API. See docs/superpowers/specs/2026-10-26-receipt-images-storage-rls-design.md.
 *
 * pgTAP (supabase/tests/receipt_images_storage_rls.test.sql) checks the
 * policies on storage.objects. This spec checks the seam that the app uses:
 * supabase-js -> storage API -> RLS, as two signed-in owners.
 *
 * The service-role client stays in this Node process. It seeds the users,
 * the restaurants and the file of restaurant B, and it reads back the result.
 */

const BUCKET = 'receipt-images';
const PDF = Buffer.from('%PDF-1.4\n%receipt\n');

function userClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required for this spec.');
  }
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function seedOwner(prefix: string) {
  const admin = getServiceRoleClient();
  const user = generateTestUser(prefix);

  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { full_name: user.fullName },
  });
  if (userError) throw userError;

  const { data: restaurant, error: restaurantError } = await admin
    .from('restaurants')
    .insert({ name: user.restaurantName })
    .select('id')
    .single();
  if (restaurantError) throw restaurantError;

  const { error: memberError } = await admin
    .from('user_restaurants')
    .insert({ user_id: created.user.id, restaurant_id: restaurant.id, role: 'owner' });
  if (memberError) throw memberError;

  const client = userClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signInError) throw signInError;

  return { userId: created.user.id, restaurantId: restaurant.id, client };
}

test.describe('receipt-images storage isolation', () => {
  test('an owner cannot read, replace, delete or plant receipts of another restaurant', async () => {
    const admin = getServiceRoleClient();
    const a = await seedOwner('rcpt-iso-a');
    const b = await seedOwner('rcpt-iso-b');

    const fileB = `${b.restaurantId}/${Date.now()}-receipt-b.pdf`;
    const fileA = `${a.restaurantId}/${Date.now()}-receipt-a.pdf`;
    const planted = `${b.restaurantId}/${Date.now()}-planted.pdf`;

    try {
      const { error: seedError } = await admin.storage
        .from(BUCKET)
        .upload(fileB, PDF, { contentType: 'application/pdf' });
      expect(seedError).toBeNull();

      // Owner A keeps upload, signed URL and download in its own folder.
      const ownUpload = await a.client.storage.from(BUCKET).upload(fileA, PDF, { contentType: 'application/pdf' });
      expect(ownUpload.error).toBeNull();

      const ownSigned = await a.client.storage.from(BUCKET).createSignedUrl(fileA, 60);
      expect(ownSigned.error).toBeNull();
      expect(ownSigned.data?.signedUrl).toBeTruthy();

      const ownDownload = await a.client.storage.from(BUCKET).download(fileA);
      expect(ownDownload.error).toBeNull();

      // Owner A cannot reach the file of restaurant B.
      const foreignDownload = await a.client.storage.from(BUCKET).download(fileB);
      expect(foreignDownload.error).not.toBeNull();

      const foreignSigned = await a.client.storage.from(BUCKET).createSignedUrl(fileB, 60);
      expect(foreignSigned.error).not.toBeNull();

      const foreignList = await a.client.storage.from(BUCKET).list(b.restaurantId);
      expect(foreignList.data ?? []).toHaveLength(0);

      const foreignReplace = await a.client.storage
        .from(BUCKET)
        .update(fileB, Buffer.from('%PDF-1.4\n%tampered\n'), { contentType: 'application/pdf' });
      expect(foreignReplace.error).not.toBeNull();

      const foreignPlant = await a.client.storage
        .from(BUCKET)
        .upload(planted, PDF, { contentType: 'application/pdf' });
      expect(foreignPlant.error).not.toBeNull();

      // storage.remove() returns the objects it deleted. RLS hides the file
      // of restaurant B, so the result must be empty.
      const foreignRemove = await a.client.storage.from(BUCKET).remove([fileB]);
      expect(foreignRemove.data ?? []).toHaveLength(0);

      // The file of restaurant B still exists and has no change.
      const after = await admin.storage.from(BUCKET).download(fileB);
      expect(after.error).toBeNull();
      expect(await after.data!.text()).toContain('%receipt');

      const plantedCheck = await admin.storage.from(BUCKET).list(b.restaurantId);
      expect((plantedCheck.data ?? []).map((o) => `${b.restaurantId}/${o.name}`)).not.toContain(planted);
    } finally {
      await admin.storage.from(BUCKET).remove([fileA, fileB, planted]);
      await admin.from('restaurants').delete().in('id', [a.restaurantId, b.restaurantId]);
      await admin.auth.admin.deleteUser(a.userId);
      await admin.auth.admin.deleteUser(b.userId);
    }
  });
});

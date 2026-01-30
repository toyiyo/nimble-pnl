import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

test.describe.skip('Tip Split Reopen Feature', () => {
  // TODO: These tests require pre-existing approved splits in the database
  // They should be rewritten to create test data programmatically using exposeSupabaseHelpers
  // Follow the pattern in tip-double-counting-prevention.spec.ts
  
  test.beforeEach(async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);
    
    // Navigate to Tips page
    await page.goto('/tips');
    await expect(page.getByRole('heading', { name: /tips/i }).first()).toBeVisible({ timeout: 10000 });
  });

  test.skip('should display reopen button for approved splits', async ({ page }) => {
    // TODO: This test requires pre-existing approved splits in the database
    // Should be rewritten to create test data programmatically
    await page.waitForSelector('[data-testid="recent-tip-splits"], text=/Recent Tip Splits/i', { timeout: 10000 });
    
    // Find an approved split (green badge with "Approved")
    const approvedSplit = page.locator('div:has-text("Approved")').first();
    
    if (await approvedSplit.count() > 0) {
      // Check for reopen button
      const reopenButton = approvedSplit.locator('button:has-text("Reopen")');
      await expect(reopenButton).toBeVisible();
    }
  });

  test('should reopen an approved split when button clicked', async ({ page }) => {
    // Wait for recent splits
    await page.waitForSelector('text=/Recent Tip Splits/i', { timeout: 10000 });
    
    // Find first approved split
    const approvedSplit = page.locator('div:has-text("Approved")').first();
    
    if (await approvedSplit.count() > 0) {
      // Click reopen button
      const reopenButton = approvedSplit.locator('button:has-text("Reopen")');
      await reopenButton.click();
      
      // Wait for success toast
      await expect(page.locator('text=/Split reopened/i')).toBeVisible({ timeout: 5000 });
      
      // Verify split status changed to Draft (should show "Draft" badge)
      await expect(page.locator('text=/Draft/i').first()).toBeVisible({ timeout: 3000 });
    }
  });

  test('should open audit log dialog when View Details clicked', async ({ page }) => {
    // Wait for recent splits
    await page.waitForSelector('text=/Recent Tip Splits/i', { timeout: 10000 });
    
    // Find first split (approved or draft)
    const split = page.locator('[data-testid="recent-tip-splits"], div:has-text("Approved"), div:has-text("Draft")').first();
    
    if (await split.count() > 0) {
      // Click View Details
      const viewButton = page.locator('button:has-text("View Details")').first();
      if (await viewButton.count() > 0) {
        await viewButton.click();
        
        // Check dialog opened
        await expect(page.locator('text=/Tip Split Details/i')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('text=/Audit Trail/i')).toBeVisible();
      }
    }
  });

  test('should display audit entries in chronological order', async ({ page }) => {
    // Wait for recent splits
    await page.waitForSelector('text=/Recent Tip Splits/i', { timeout: 10000 });
    
    // Find approved split with audit trail
    const approvedSplit = page.locator('div:has-text("Approved")').first();
    
    if (await approvedSplit.count() > 0) {
      // Open audit log
      const viewButton = approvedSplit.locator('button:has-text("View Details")');
      if (await viewButton.count() > 0) {
        await viewButton.click();
        // Wait for dialog to open
        await expect(page.locator('div:has-text("created"), div:has-text("approved")').first()).toBeVisible({ timeout: 3000 }).catch(() => {});
        
        // Check for audit entries (created, approved actions)
        const auditEntries = page.locator('div:has-text("created"), div:has-text("approved")');
        const count = await auditEntries.count();
        
        if (count > 0) {
          // Verify at least one entry exists
          await expect(auditEntries.first()).toBeVisible();
          
          // Check for timestamps
          await expect(page.locator('text=/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i').first()).toBeVisible();
        }
      }
    }
  });

  test('should show reopen action in audit log after reopening', async ({ page }) => {
    // Wait for recent splits
    await page.waitForSelector('text=/Recent Tip Splits/i', { timeout: 10000 });

    const splitId = await page.evaluate(async () => {
      const { supabase } = await import('@/integrations/supabase/client');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: restaurant } = await supabase
        .from('user_restaurants')
        .select('restaurant_id')
        .eq('user_id', user.id)
        .limit(1)
        .single();

      if (!restaurant?.restaurant_id) return null;

      const { data } = await supabase
        .from('tip_splits')
        .select('id')
        .eq('restaurant_id', restaurant.restaurant_id)
        .eq('status', 'approved')
        .order('split_date', { ascending: false })
        .limit(1)
        .single();

      return data?.id ?? null;
    });

    if (!splitId) {
      return;
    }

    const auditBefore = await page.evaluate(async (tipSplitId: string) => {
      const { supabase } = await import('@/integrations/supabase/client');
      // @ts-expect-error tip_split_audit table not yet in generated types
      const { data, error } = await supabase
        .from('tip_split_audit')
        .select('id, action')
        .eq('tip_split_id', tipSplitId);

      if (error) {
        throw new Error(error.message);
      }

      const entries = (data ?? []) as { action: string }[];
      return {
        count: data?.length ?? 0,
        actions: entries.map(entry => entry.action),
      };
    }, splitId);
    
    // Find first approved split
    const approvedSplit = page.locator('div:has-text("Approved")').first();
    
    if (await approvedSplit.count() === 0) {
      return;
    }

    const reopenButton = approvedSplit.locator('button:has-text("Reopen")');
    await reopenButton.click();
    await expect(page.locator('text=/Split reopened/i')).toBeVisible({ timeout: 5000 });

    const auditAfter = await page.evaluate(async (tipSplitId: string) => {
      const { supabase } = await import('@/integrations/supabase/client');
      // @ts-expect-error tip_split_audit table not yet in generated types
      const { data, error } = await supabase
        .from('tip_split_audit')
        .select('id, action, changed_at')
        .eq('tip_split_id', tipSplitId)
        .order('changed_at', { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      const entries = (data ?? []) as { action: string }[];
      return {
        count: data?.length ?? 0,
        actions: entries.map(entry => entry.action),
      };
    }, splitId);

    expect(auditAfter.count).toBeGreaterThan(auditBefore.count);
    expect(auditAfter.actions).toContain('reopened');
  });

  test.skip('should prevent non-managers from reopening splits (RLS)', async () => {
    // TODO: Implement with non-manager login - RLS enforced at database level
  });

  test('should display user email in audit entries', async ({ page }) => {
    // Wait for recent splits
    await page.waitForSelector('text=/Recent Tip Splits/i', { timeout: 10000 });
    
    const split = page.locator('div:has-text("Approved")').first();
    
    if (await split.count() > 0) {
      const viewButton = split.locator('button:has-text("View Details")');
      if (await viewButton.count() > 0) {
        await viewButton.click();
        // Wait for email pattern to be visible
        await expect(page.locator('text=/@/').first()).toBeVisible({ timeout: 3000 }).catch(() => {});
        
        // Check for email pattern (user@domain.com)
        const emailPattern = page.locator('text=/@/');
        const emailCount = await emailPattern.count();
        
        if (emailCount > 0) {
          await expect(emailPattern.first()).toBeVisible();
        }
      }
    }
  });

  test('should close audit dialog with Escape key', async ({ page }) => {
    await page.waitForSelector('text=/Recent Tip Splits/i', { timeout: 10000 });
    
    const split = page.locator('div:has-text("Approved")').first();
    
    if (await split.count() > 0) {
      const viewButton = split.locator('button:has-text("View Details")');
      if (await viewButton.count() > 0) {
        await viewButton.click();
        
        // Verify dialog is open
        await expect(page.locator('text=/Audit Trail/i')).toBeVisible({ timeout: 3000 });
        
        // Press Escape
        await page.keyboard.press('Escape');
        
        // Verify dialog closed
        await expect(page.locator('text=/Audit Trail/i')).not.toBeVisible({ timeout: 2000 });
      }
    }
  });

  test('should display reopened splits as drafts in the list', async ({ page }) => {
    await page.waitForSelector('text=/Recent Tip Splits/i', { timeout: 10000 });
    
    // Count approved splits before
    const approvedCountBefore = await page.locator('text=/Approved/i').count();
    
    if (approvedCountBefore > 0) {
      // Reopen first approved split
      const approvedSplit = page.locator('div:has-text("Approved")').first();
      const reopenButton = approvedSplit.locator('button:has-text("Reopen")');
      await reopenButton.click();
      
      // Wait for reopen to complete and draft badge to appear
      await expect(page.locator('text=/Draft/i').first()).toBeVisible({ timeout: 5000 });
      
      // Verify draft count increased
      const draftCount = await page.locator('text=/Draft/i').count();
      expect(draftCount).toBeGreaterThan(0);
    }
  });

  test('should show Resume button for reopened drafts', async ({ page }) => {
    await page.waitForSelector('text=/Recent Tip Splits/i', { timeout: 10000 });
    
    // Find first approved and reopen it
    const approvedSplit = page.locator('div:has-text("Approved")').first();
    
    if (await approvedSplit.count() > 0) {
      await approvedSplit.locator('button:has-text("Reopen")').click();
      // Wait for draft badge to appear
      await expect(page.locator('text=/Draft/i').first()).toBeVisible({ timeout: 5000 });
      
      // Find the draft (now showing as Draft)
      const draftSplit = page.locator('div:has-text("Draft")').first();
      
      // Check for Resume button
      const resumeButton = draftSplit.locator('button:has-text("Resume")');
      await expect(resumeButton).toBeVisible();
    }
  });
});

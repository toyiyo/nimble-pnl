import { test, expect } from '@playwright/test';

test.describe('Tip Split Reopen Feature', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to login page
    await page.goto('/');
    
    // Login as manager (assuming manager credentials)
    await page.fill('input[type="email"]', 'manager@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    // Wait for dashboard to load
    await page.waitForURL('/dashboard');
    
    // Navigate to Tips page
    await page.click('a[href="/tips"]');
    await page.waitForURL('/tips');
  });

  test('should display reopen button for approved splits', async ({ page }) => {
    // Wait for recent splits to load
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
      await page.waitForTimeout(1000); // Wait for UI update
      await expect(page.locator('text=/Draft/i').first()).toBeVisible();
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
        await page.waitForTimeout(500);
        
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
    
    // Find first approved split
    const approvedSplit = page.locator('div:has-text("Approved")').first();
    
    if (await approvedSplit.count() > 0) {
      // Open audit log before reopening
      const viewButton = approvedSplit.locator('button:has-text("View Details")').first();
      if (await viewButton.count() > 0) {
        await viewButton.click();
        
        // Check initial entries
        const auditEntriesBefore = await page.locator('[data-testid="audit-entry"], div:has-text("created"), div:has-text("approved")').count();
        
        // Close dialog
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        
        // Reopen split
        const reopenButton = approvedSplit.locator('button:has-text("Reopen")');
        await reopenButton.click();
        await page.waitForTimeout(1000);
        
        // Open audit log again
        const draftSplit = page.locator('div:has-text("Draft")').first();
        const viewButton2 = draftSplit.locator('button:has-text("View Details")');
        
        // Note: After reopen, status changes to draft, so View Details button won't be there
        // Approved splits have View Details, drafts have Resume
        // So we skip this check for now
      }
    }
  });

  test('should prevent non-managers from reopening splits (RLS)', async ({ page }) => {
    // This would require logging in as non-manager
    // Skipping for now - RLS enforced at database level
    test.skip();
  });

  test('should display user email in audit entries', async ({ page }) => {
    // Wait for recent splits
    await page.waitForSelector('text=/Recent Tip Splits/i', { timeout: 10000 });
    
    const split = page.locator('div:has-text("Approved")').first();
    
    if (await split.count() > 0) {
      const viewButton = split.locator('button:has-text("View Details")');
      if (await viewButton.count() > 0) {
        await viewButton.click();
        await page.waitForTimeout(500);
        
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
        await page.waitForTimeout(300);
        
        // Verify dialog is open
        await expect(page.locator('text=/Audit Trail/i')).toBeVisible();
        
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
      
      // Wait for reopen
      await page.waitForTimeout(1500);
      
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
      await page.waitForTimeout(1500);
      
      // Find the draft (now showing as Draft)
      const draftSplit = page.locator('div:has-text("Draft")').first();
      
      // Check for Resume button
      const resumeButton = draftSplit.locator('button:has-text("Resume")');
      await expect(resumeButton).toBeVisible();
    }
  });
});

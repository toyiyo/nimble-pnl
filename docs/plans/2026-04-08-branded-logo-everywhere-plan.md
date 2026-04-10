# Branded Logo Everywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all generic Lucide CalendarCheck/ShieldCheck icons and inline SVG logos with the actual branded EasyShiftHQ logo (`/icon-192.png`) across the web app and email templates.

**Architecture:** Create a reusable `AppLogo` React component for frontend usage. Update the shared `emailTemplates.ts` header to use a hosted `<img>` tag, then migrate all 4 email templates with duplicated inline SVG headers to use the shared helper. The weekly brief email gets the logo added to its header.

**Tech Stack:** React, TypeScript, Deno (edge functions), HTML email

**Logo URLs:**
- Frontend: `/icon-192.png` (served from `public/`)
- Email: `https://app.easyshifthq.com/icon-192.png` (publicly accessible)

---

## File Structure

### New files
- `src/components/AppLogo.tsx` — Reusable logo component with configurable size

### Modified files (Frontend)
- `src/pages/Auth.tsx` — Replace CalendarCheck with AppLogo
- `src/pages/ForgotPassword.tsx` — Replace CalendarCheck with AppLogo
- `src/pages/ResetPassword.tsx` — Replace CalendarCheck with AppLogo
- `src/components/AppSidebar.tsx` — Replace CalendarCheck + gradient wrapper with AppLogo
- `src/components/BiometricLockScreen.tsx` — Replace ShieldCheck with AppLogo

### Modified files (Email templates)
- `supabase/functions/_shared/emailTemplates.ts` — Replace inline SVG in `generateHeader()` with `<img>` tag
- `supabase/functions/notify-schedule-published/index.ts` — Remove duplicated header HTML
- `supabase/functions/send-time-off-notification/index.ts` — Remove duplicated header HTML
- `supabase/functions/send-team-invitation/index.ts` — Remove duplicated header HTML
- `supabase/functions/send-shift-trade-notification/index.ts` — Remove duplicated header HTML
- `supabase/functions/send-weekly-brief-email/index.ts` — Add logo to header

---

### Task 1: Create AppLogo component

**Files:**
- Create: `src/components/AppLogo.tsx`
- Test: `tests/unit/AppLogo.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/AppLogo.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppLogo } from '@/components/AppLogo';

describe('AppLogo', () => {
  it('renders an img with the logo src', () => {
    render(<AppLogo />);
    const img = screen.getByAltText('EasyShiftHQ');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('/icon-192.png');
  });

  it('applies default size of 32px', () => {
    render(<AppLogo />);
    const img = screen.getByAltText('EasyShiftHQ');
    expect(img.getAttribute('width')).toBe('32');
    expect(img.getAttribute('height')).toBe('32');
  });

  it('accepts custom size', () => {
    render(<AppLogo size={64} />);
    const img = screen.getByAltText('EasyShiftHQ');
    expect(img.getAttribute('width')).toBe('64');
    expect(img.getAttribute('height')).toBe('64');
  });

  it('accepts custom className', () => {
    render(<AppLogo className="my-custom-class" />);
    const img = screen.getByAltText('EasyShiftHQ');
    expect(img.className).toContain('my-custom-class');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/AppLogo.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/AppLogo.tsx
interface AppLogoProps {
  size?: number;
  className?: string;
}

export function AppLogo({ size = 32, className = '' }: AppLogoProps) {
  return (
    <img
      src="/icon-192.png"
      alt="EasyShiftHQ"
      width={size}
      height={size}
      className={`rounded-lg ${className}`.trim()}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/AppLogo.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/AppLogo.tsx tests/unit/AppLogo.test.tsx
git commit -m "feat: add AppLogo component for branded logo rendering"
```

---

### Task 2: Replace logo in Auth page

**Files:**
- Modify: `src/pages/Auth.tsx:14,163-165`

- [ ] **Step 1: Replace CalendarCheck import with AppLogo import**

In `src/pages/Auth.tsx`, change the import line:

```tsx
// Before
import { Building, ArrowRight, Shield, CalendarCheck } from 'lucide-react';

// After
import { Building, ArrowRight, Shield } from 'lucide-react';
import { AppLogo } from '@/components/AppLogo';
```

- [ ] **Step 2: Replace the logo rendering in CardHeader**

In `src/pages/Auth.tsx`, find this block (~line 163):

```tsx
// Before
<div className="flex justify-center items-center gap-2 mb-2">
  <CalendarCheck className="h-8 w-8 text-emerald-600" />
  <CardTitle className="text-2xl">EasyShiftHQ</CardTitle>
</div>

// After
<div className="flex justify-center items-center gap-2 mb-2">
  <AppLogo size={32} />
  <CardTitle className="text-2xl">EasyShiftHQ</CardTitle>
</div>
```

- [ ] **Step 3: Run build to verify no errors**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/pages/Auth.tsx
git commit -m "feat: use branded logo on Auth page"
```

---

### Task 3: Replace logo in ForgotPassword page

**Files:**
- Modify: `src/pages/ForgotPassword.tsx:9,98-100`

- [ ] **Step 1: Replace CalendarCheck import with AppLogo**

```tsx
// Before
import { CalendarCheck, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';

// After
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { AppLogo } from '@/components/AppLogo';
```

- [ ] **Step 2: Replace the logo rendering**

Find this block (~line 98):

```tsx
// Before
<div className="flex justify-center items-center gap-2 mb-2">
  <CalendarCheck className="h-8 w-8 text-emerald-600" />
  <CardTitle className="text-2xl">EasyShiftHQ</CardTitle>
</div>

// After
<div className="flex justify-center items-center gap-2 mb-2">
  <AppLogo size={32} />
  <CardTitle className="text-2xl">EasyShiftHQ</CardTitle>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/ForgotPassword.tsx
git commit -m "feat: use branded logo on ForgotPassword page"
```

---

### Task 4: Replace logo in ResetPassword page

**Files:**
- Modify: `src/pages/ResetPassword.tsx:9,143-145`

- [ ] **Step 1: Replace CalendarCheck import with AppLogo**

```tsx
// Before
import { CalendarCheck, Lock, CheckCircle2 } from 'lucide-react';

// After
import { Lock, CheckCircle2 } from 'lucide-react';
import { AppLogo } from '@/components/AppLogo';
```

- [ ] **Step 2: Replace the logo rendering**

Find this block (~line 143):

```tsx
// Before
<div className="flex justify-center items-center gap-2 mb-2">
  <CalendarCheck className="h-8 w-8 text-emerald-600" />
  <CardTitle className="text-2xl">EasyShiftHQ</CardTitle>
</div>

// After
<div className="flex justify-center items-center gap-2 mb-2">
  <AppLogo size={32} />
  <CardTitle className="text-2xl">EasyShiftHQ</CardTitle>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/ResetPassword.tsx
git commit -m "feat: use branded logo on ResetPassword page"
```

---

### Task 5: Replace logo in Sidebar header

**Files:**
- Modify: `src/components/AppSidebar.tsx:293-295`

The sidebar currently wraps a CalendarCheck icon in an emerald gradient div. Replace the entire gradient wrapper with the AppLogo (which already has its own background).

- [ ] **Step 1: Add AppLogo import**

Add to the imports in `src/components/AppSidebar.tsx`:

```tsx
import { AppLogo } from '@/components/AppLogo';
```

Remove `CalendarCheck` from the lucide-react import if it's no longer used elsewhere in the file. Check first with a search.

- [ ] **Step 2: Replace the sidebar logo rendering**

Find this block (~line 293):

```tsx
// Before
<div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg shadow-lg p-1.5 group-hover:shadow-emerald-500/50 transition-all duration-200 flex-shrink-0">
  <CalendarCheck className="h-4 w-4 text-white" />
</div>

// After
<AppLogo size={28} className="shadow-lg group-hover:shadow-emerald-500/50 transition-all duration-200 flex-shrink-0" />
```

- [ ] **Step 3: Run build to verify**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/AppSidebar.tsx
git commit -m "feat: use branded logo in sidebar header"
```

---

### Task 6: Replace logo in BiometricLockScreen

**Files:**
- Modify: `src/components/BiometricLockScreen.tsx:1-2,20-22`

- [ ] **Step 1: Replace ShieldCheck import with AppLogo**

```tsx
// Before
import { useEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

// After
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { AppLogo } from '@/components/AppLogo';
```

- [ ] **Step 2: Replace the icon rendering**

Find this block (~line 20):

```tsx
// Before
<div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center">
  <ShieldCheck className="h-8 w-8 text-foreground" />
</div>

// After
<AppLogo size={64} />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/BiometricLockScreen.tsx
git commit -m "feat: use branded logo on biometric lock screen"
```

---

### Task 7: Update shared email header with branded logo image

**Files:**
- Modify: `supabase/functions/_shared/emailTemplates.ts:46-61`

The logo is publicly hosted at `https://app.easyshifthq.com/icon-192.png`. Replace the inline SVG with an `<img>` tag. Email clients have inconsistent SVG support but universal PNG `<img>` support.

- [ ] **Step 1: Replace the `generateHeader()` function body**

In `supabase/functions/_shared/emailTemplates.ts`, replace lines 46-62:

```typescript
const generateHeader = (): string => {
  return `
    <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0;">
      <div style="display: inline-flex; align-items: center; justify-content: center; background-color: rgba(255, 255, 255, 0.95); border-radius: 12px; padding: 12px 20px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);">
        <img src="https://app.easyshifthq.com/icon-192.png" alt="EasyShiftHQ" width="40" height="40" style="display: block; border-radius: 8px; margin-right: 12px;" />
        <span style="font-size: 20px; font-weight: 700; color: #1f2937; letter-spacing: -0.5px;">EasyShiftHQ</span>
      </div>
    </div>
  `;
};
```

- [ ] **Step 2: Export `generateHeader` so edge functions can use it**

Change the function declaration from `const` to `export const`:

```typescript
export const generateHeader = (): string => {
```

Also export `generateFooter` for the same reason:

```typescript
export const generateFooter = (): string => {
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/emailTemplates.ts
git commit -m "feat: replace inline SVG with branded logo image in email header"
```

---

### Task 8: Migrate notify-schedule-published to shared header

**Files:**
- Modify: `supabase/functions/notify-schedule-published/index.ts:128-142`

- [ ] **Step 1: Add import for shared header**

At the top of `supabase/functions/notify-schedule-published/index.ts`, add:

```typescript
import { generateHeader, generateFooter } from '../_shared/emailTemplates.ts';
```

- [ ] **Step 2: Replace the inline header HTML**

Find the `<!-- Header with Logo -->` block (lines ~129-142) and replace it with:

```typescript
${generateHeader()}
```

This is the entire block from `<div style="background: linear-gradient...">` through the closing `</div>` right before `<!-- Content -->`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/notify-schedule-published/index.ts
git commit -m "refactor: use shared email header in schedule notification"
```

---

### Task 9: Migrate send-time-off-notification to shared header

**Files:**
- Modify: `supabase/functions/send-time-off-notification/index.ts:214-227`

- [ ] **Step 1: Add import for shared header**

```typescript
import { generateHeader } from '../_shared/emailTemplates.ts';
```

- [ ] **Step 2: Replace the inline header HTML**

Find the `<!-- Header with Logo -->` block (lines ~214-227) and replace with `${generateHeader()}`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-time-off-notification/index.ts
git commit -m "refactor: use shared email header in time-off notification"
```

---

### Task 10: Migrate send-team-invitation to shared header

**Files:**
- Modify: `supabase/functions/send-team-invitation/index.ts:178-189`

- [ ] **Step 1: Add import for shared header**

```typescript
import { generateHeader } from '../_shared/emailTemplates.ts';
```

- [ ] **Step 2: Replace the inline header HTML**

Find the `<!-- Header with Logo -->` block (lines ~178-189) and replace with `${generateHeader()}`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-team-invitation/index.ts
git commit -m "refactor: use shared email header in team invitation"
```

---

### Task 11: Migrate send-shift-trade-notification to shared header

**Files:**
- Modify: `supabase/functions/send-shift-trade-notification/index.ts:167-181`

- [ ] **Step 1: Add import for shared header**

```typescript
import { generateHeader } from '../_shared/emailTemplates.ts';
```

- [ ] **Step 2: Replace the inline header HTML**

Find the `<!-- Header with Logo -->` block (lines ~167-181) and replace with `${generateHeader()}`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-shift-trade-notification/index.ts
git commit -m "refactor: use shared email header in shift trade notification"
```

---

### Task 12: Add branded logo to weekly brief email header

**Files:**
- Modify: `supabase/functions/send-weekly-brief-email/index.ts:290-298`

The weekly brief has a different layout — a compact header without the emerald gradient. Add the logo image inline before the text.

- [ ] **Step 1: Add the logo to the header section**

Find the header block (~line 293-298):

```html
<!-- Before -->
<tr><td style="padding:24px 24px 16px;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">Weekly Brief</div>
  <div style="font-size:17px;font-weight:600;color:#111827;margin-top:4px;">${restaurantName}</div>
  <div style="font-size:13px;color:#6b7280;margin-top:2px;">${formatWeekRange(brief.brief_week_end)}</div>
</td></tr>

<!-- After -->
<tr><td style="padding:24px 24px 16px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
    <img src="https://app.easyshifthq.com/icon-192.png" alt="EasyShiftHQ" width="32" height="32" style="display:block;border-radius:8px;" />
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">Weekly Brief</div>
  </div>
  <div style="font-size:17px;font-weight:600;color:#111827;margin-top:4px;">${restaurantName}</div>
  <div style="font-size:13px;color:#6b7280;margin-top:2px;">${formatWeekRange(brief.brief_week_end)}</div>
</td></tr>
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/send-weekly-brief-email/index.ts
git commit -m "feat: add branded logo to weekly brief email header"
```

---

### Task 13: Final verification

- [ ] **Step 1: Run full typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: PASS with zero errors

- [ ] **Step 2: Run unit tests**

```bash
npm run test
```

Expected: All tests pass including new AppLogo tests

- [ ] **Step 3: Verify no remaining CalendarCheck usage for branding**

Search for any remaining branding-related CalendarCheck icons:

```bash
grep -rn "CalendarCheck" src/pages/Auth.tsx src/pages/ForgotPassword.tsx src/pages/ResetPassword.tsx src/components/AppSidebar.tsx src/components/BiometricLockScreen.tsx
```

Expected: No matches

- [ ] **Step 4: Verify no remaining inline SVG headers in email templates**

```bash
grep -rn "<!-- Header with Logo -->" supabase/functions/*/index.ts
```

Expected: No matches (all migrated to shared `generateHeader()`)

# Notification System - Complete Audit & Implementation Plan

## Executive Summary

This document provides a comprehensive audit of the EasyShiftHQ notification system, identifies all missing notifications, and outlines an implementation plan using DRY (Don't Repeat Yourself) principles.

**Current State**: 10 notification types implemented  
**Missing**: 23 notification types identified  
**Total System**: 33 notification types when complete

## Table of Contents
1. [Current Implementation](#current-implementation)
2. [Missing Notifications](#missing-notifications)
3. [DRY Template Infrastructure](#dry-template-infrastructure)
4. [Implementation Plan](#implementation-plan)
5. [Database Schema](#database-schema)
6. [Testing Strategy](#testing-strategy)

---

## Current Implementation

### ✅ Implemented Notifications (10 types)

| # | Notification | Edge Function | Recipients | Status |
|---|--------------|---------------|------------|--------|
| 1 | Schedule Published | `notify-schedule-published` | Scheduled employees | ✅ Live |
| 2 | Time-Off Created | `send-time-off-notification` | Managers | ✅ Live |
| 3 | Time-Off Approved | `send-time-off-notification` | Employee | ✅ Live |
| 4 | Time-Off Rejected | `send-time-off-notification` | Employee | ✅ Live |
| 5 | Shift Trade Created | `send-shift-trade-notification` | All employees | ✅ Live |
| 6 | Shift Trade Accepted | `send-shift-trade-notification` | Managers + original employee | ✅ Live |
| 7 | Shift Trade Approved | `send-shift-trade-notification` | Both employees | ✅ Live |
| 8 | Shift Trade Rejected | `send-shift-trade-notification` | Both employees | ✅ Live |
| 9 | Shift Trade Cancelled | `send-shift-trade-notification` | Accepting employee | ✅ Live |
| 10 | Team Invitation | `send-team-invitation` | Invited email | ✅ Live |

---

## Missing Notifications

### Priority Classification

**High Priority** (11): Critical for operations, directly impacts employees' ability to work  
**Medium Priority** (10): Important but not time-critical  
**Low Priority** (2): Nice-to-have, non-urgent

### 🔴 High Priority (11 notifications)

| # | Notification | Trigger | Recipients | Business Impact |
|---|--------------|---------|------------|----------------|
| 11 | Shift Created | Manager creates shift | Assigned employee | Employee needs to know about new shifts |
| 12 | Shift Modified | Manager changes shift | Assigned employee | Critical for schedule coordination |
| 13 | Shift Deleted | Manager removes shift | Previously assigned employee | Employee must know schedule changed |
| 15 | Payroll Finalized | Manager finalizes period | All employees in period | Transparency about pay processing |
| 17 | Compensation Changed | Rate/salary update | Affected employee | Legal/transparency requirement |
| 19 | Tip Split Approved | Manager approves split | All employees in split | Need to know final tip amounts |
| 20 | Tip Dispute Submitted | Employee submits dispute | Managers | Requires prompt manager attention |
| 21 | Tip Dispute Resolved | Manager resolves dispute | Disputing employee | Employee needs resolution |
| 28 | Employee Activated | Account activation | Employee | Welcome email with login credentials |
| 32 | Timecard Edited | Manager edits punches | Affected employee | Transparency about time records |
| 33 | PIN Reset | Manager resets PIN | Employee | Secure PIN delivery |

### 🟡 Medium Priority (10 notifications)

| # | Notification | Trigger | Recipients | Business Impact |
|---|--------------|---------|------------|----------------|
| 14 | Shift Reminder | X hours before shift | Scheduled employee | Reduces no-shows |
| 16 | Manual Payment Added | Manager adds payment | Affected employee | Transparency about additional pay |
| 18 | Tip Split Created | Manager creates split | Employees in split | Awareness of pending tips |
| 23 | Production Variance | Variance > threshold | Managers | Inventory control |
| 24 | Invoice Created | Invoice generated | Customer | Professional invoicing |
| 25 | Invoice Sent | Invoice finalized | Customer + Manager | Payment tracking |
| 26 | Invoice Paid | Payment received | Managers | Cash flow awareness |
| 27 | Invoice Overdue | X days past due | Customer + Managers | Accounts receivable |
| 29 | Employee Deactivated | Termination | Employee | Offboarding notification |
| 31 | Missed Punch-Out | No punch-out recorded | Employee + Manager | Time tracking accuracy |

### 🟢 Low Priority (2 notifications)

| # | Notification | Trigger | Recipients | Business Impact |
|---|--------------|---------|------------|----------------|
| 22 | Production Run Completed | Run marked complete | Managers | FYI notification |
| 30 | Employee Reactivated | Rehire | Employee | Welcome back |

---

## DRY Template Infrastructure

### Architecture Overview

```
supabase/functions/
  ├── _shared/
  │   ├── emailTemplates.ts       # 🆕 Shared email HTML generator
  │   ├── notificationHelpers.ts  # 🆕 Common notification utilities
  │   ├── cors.ts                 # ✅ Existing CORS headers
  │   └── encryption.ts           # ✅ Existing encryption
  │
  ├── send-shift-notification/    # 🆕 Example implementation
  │   └── index.ts
  │
  ├── send-shift-trade-notification/
  │   ├── index.ts                # ✅ Existing
  │   └── index.refactored.ts     # 🆕 DRY version example
  │
  └── [other notification functions]
```

### Key Components

#### 1. **emailTemplates.ts** - Shared Email Template Generator

**Purpose**: Eliminate HTML duplication across notification functions

**Features**:
- Consistent EasyShiftHQ branding (logo, colors, footer)
- XSS protection via HTML escaping
- Reusable components: status badges, detail cards, CTAs, manager notes
- Accessibility compliant
- Responsive design

**Usage Example**:
```typescript
import { generateEmailTemplate } from '../_shared/emailTemplates.ts';

const html = generateEmailTemplate({
  heading: 'Your Shift Has Been Updated',
  statusBadge: { text: 'Modified', color: '#f59e0b' },
  greeting: 'Hi John,',
  message: 'Your shift details have been changed.',
  detailsCard: {
    items: [
      { label: 'Restaurant', value: 'Main Street Bistro' },
      { label: 'Position', value: 'Server' },
      { label: 'Start', value: 'Mon, Jan 8, 2026, 5:00 PM' },
      { label: 'End', value: 'Mon, Jan 8, 2026, 11:00 PM' },
    ]
  },
  ctaButton: {
    text: 'View My Schedule',
    url: 'https://app.easyshifthq.com/employee/schedule'
  },
  footerNote: 'Contact your manager if you have questions.'
});
```

#### 2. **notificationHelpers.ts** - Common Utilities

**Purpose**: Reduce code duplication for common notification operations

**Utilities**:
- `getManagerEmails()` - Get all manager emails for a restaurant
- `getEmployeeEmail()` - Get employee email by ID
- `getEmployeeEmails()` - Get multiple employee emails
- `getAllActiveEmployeeEmails()` - Get all active employees
- `getRestaurantName()` - Get restaurant name
- `shouldSendNotification()` - Check notification settings
- `sendEmail()` - Resend API wrapper
- `verifyRestaurantPermission()` - Authorization check
- `authenticateRequest()` - Standard auth flow
- `errorResponse()` / `successResponse()` - Standard responses
- `handleCorsPreflightRequest()` - CORS handling

**Benefits**:
- Consistent error handling
- Centralized email sending logic
- Reusable permission checks
- Standard response formats

### Template Benefits

| Aspect | Before (Duplicated) | After (DRY Template) |
|--------|---------------------|---------------------|
| **HTML Code** | ~260 lines per function | ~30 lines per function |
| **Maintenance** | Update 10+ files | Update 1 shared file |
| **Consistency** | Manual sync required | Automatic consistency |
| **Security** | XSS risk in each file | Centralized escaping |
| **Branding** | Easy to diverge | Always consistent |
| **Testing** | Test each function | Test template once |

---

## Implementation Plan

### Phase 1: DRY Infrastructure ✅ COMPLETE

- [x] Create `emailTemplates.ts` - Shared email template system
- [x] Create `notificationHelpers.ts` - Shared utilities
- [x] Create `send-shift-notification/` - Example implementation
- [x] Create refactored example of existing function
- [x] Create migration for expanded notification settings
- [x] Document DRY approach

**Files Created**:
- `supabase/functions/_shared/emailTemplates.ts` (450 lines)
- `supabase/functions/_shared/notificationHelpers.ts` (350 lines)
- `supabase/functions/send-shift-notification/index.ts` (220 lines)
- `supabase/migrations/20260108000000_expand_notification_settings.sql`

### Phase 2: High Priority Notifications (11 items)

**Week 1-2**: Scheduling Notifications
- [ ] Shift Created (use template - ~150 lines)
- [ ] Shift Modified (use template - ~170 lines)
- [ ] Shift Deleted (use template - ~140 lines)
- [ ] Add database triggers for shift changes
- [ ] Add notification settings UI
- [ ] Test scheduling notifications E2E

**Week 3**: Payroll Notifications
- [ ] Payroll Period Finalized (use template - ~180 lines)
- [ ] Compensation Changed (use template - ~160 lines)
- [ ] Update payroll hooks to trigger notifications
- [ ] Test payroll notifications

**Week 4**: Tip Notifications
- [ ] Tip Split Approved (use template - ~170 lines)
- [ ] Tip Dispute Submitted (use template - ~160 lines)
- [ ] Tip Dispute Resolved (use template - ~160 lines)
- [ ] Update tip hooks to trigger notifications
- [ ] Test tip notifications

**Week 5**: Employee & Timecard
- [ ] Employee Activated (use template - ~180 lines)
- [ ] Timecard Edited (use template - ~170 lines)
- [ ] PIN Reset (use template - ~150 lines)
- [ ] Test employee lifecycle notifications

**Estimate**: 5 weeks, ~2,000 lines of new code (vs ~8,000+ without template)

### Phase 3: Medium Priority Notifications (10 items)

**Week 6-7**: Scheduling & Payroll
- [ ] Shift Reminder (with scheduled job)
- [ ] Manual Payment Added
- [ ] Missed Punch-Out (with scheduled job)

**Week 8**: Tips & Production
- [ ] Tip Split Created
- [ ] Production Run Variance Alert

**Week 9-10**: Invoicing
- [ ] Invoice Created
- [ ] Invoice Sent
- [ ] Invoice Paid
- [ ] Invoice Overdue (with scheduled job)

**Week 11**: Employee Lifecycle
- [ ] Employee Deactivated

**Estimate**: 6 weeks, ~1,800 lines of new code

### Phase 4: Low Priority Notifications (2 items)

**Week 12**:
- [ ] Production Run Completed
- [ ] Employee Reactivated

**Estimate**: 1 week, ~300 lines of new code

### Phase 5: Refactor Existing Notifications

- [ ] Refactor `send-time-off-notification` to use template
- [ ] Refactor `send-shift-trade-notification` to use template
- [ ] Refactor `notify-schedule-published` to use template
- [ ] Refactor `send-team-invitation` to use template
- [ ] Remove duplicated email HTML code

**Estimate**: 1 week

### Phase 6: Testing & Documentation

- [ ] E2E tests for all new notifications
- [ ] Unit tests for email templates
- [ ] Update notification settings UI
- [ ] User documentation
- [ ] Admin guide

**Estimate**: 2 weeks

---

## Database Schema

### notification_settings Table

```sql
CREATE TABLE notification_settings (
  id UUID PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  
  -- Existing columns (Time-off, Schedule, Shift Trading)
  notify_time_off_request BOOLEAN DEFAULT true,
  notify_time_off_approved BOOLEAN DEFAULT true,
  notify_time_off_rejected BOOLEAN DEFAULT true,
  time_off_notify_managers BOOLEAN DEFAULT true,
  time_off_notify_employee BOOLEAN DEFAULT true,
  
  -- 🆕 Shift notifications
  notify_shift_created BOOLEAN DEFAULT true,
  notify_shift_modified BOOLEAN DEFAULT true,
  notify_shift_deleted BOOLEAN DEFAULT true,
  notify_shift_reminder BOOLEAN DEFAULT false,
  shift_reminder_hours INTEGER DEFAULT 2,
  
  -- 🆕 Payroll notifications
  notify_payroll_finalized BOOLEAN DEFAULT true,
  notify_manual_payment BOOLEAN DEFAULT true,
  notify_compensation_changed BOOLEAN DEFAULT true,
  
  -- 🆕 Tip notifications
  notify_tip_split_created BOOLEAN DEFAULT false,
  notify_tip_split_approved BOOLEAN DEFAULT true,
  notify_tip_dispute_submitted BOOLEAN DEFAULT true,
  notify_tip_dispute_resolved BOOLEAN DEFAULT true,
  
  -- 🆕 Production/Inventory notifications
  notify_production_run_completed BOOLEAN DEFAULT false,
  notify_production_variance BOOLEAN DEFAULT true,
  production_variance_threshold DECIMAL(5,2) DEFAULT 10.0,
  
  -- 🆕 Invoice notifications
  notify_invoice_created BOOLEAN DEFAULT false,
  notify_invoice_sent BOOLEAN DEFAULT true,
  notify_invoice_paid BOOLEAN DEFAULT true,
  notify_invoice_overdue BOOLEAN DEFAULT true,
  invoice_overdue_days INTEGER DEFAULT 7,
  
  -- 🆕 Employee lifecycle notifications
  notify_employee_activated BOOLEAN DEFAULT true,
  notify_employee_deactivated BOOLEAN DEFAULT false,
  notify_employee_reactivated BOOLEAN DEFAULT true,
  
  -- 🆕 Time tracking notifications
  notify_missed_punch_out BOOLEAN DEFAULT true,
  notify_timecard_edited BOOLEAN DEFAULT true,
  
  -- 🆕 Access control notifications
  notify_pin_reset BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Migration File**: `20260108000000_expand_notification_settings.sql` ✅

---

## Testing Strategy

### Unit Tests (TypeScript)

```typescript
// tests/unit/emailTemplates.test.ts
describe('generateEmailTemplate', () => {
  it('escapes HTML to prevent XSS', () => {
    const html = generateEmailTemplate({
      heading: '<script>alert("xss")</script>',
      message: 'Safe message'
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  
  it('generates consistent branding', () => {
    const html = generateEmailTemplate({
      heading: 'Test',
      message: 'Test message'
    });
    expect(html).toContain('EasyShiftHQ');
    expect(html).toContain('linear-gradient');
  });
});
```

### E2E Tests (Playwright)

```typescript
// tests/e2e/shift-notifications.spec.ts
test('sends notification when shift is created', async ({ page }) => {
  // Setup: Create manager and employee
  await signUpAndCreateRestaurant(page, manager);
  const employee = await createEmployee(page, {
    name: 'Test Employee',
    email: 'employee@test.com',
  });
  
  // Action: Create shift
  await createShift(page, {
    employeeId: employee.id,
    startTime: tomorrow9AM,
    endTime: tomorrow5PM,
  });
  
  // Assert: Email sent (mock Resend API)
  expect(mockResend.emails.send).toHaveBeenCalledWith({
    to: ['employee@test.com'],
    subject: expect.stringContaining('New Shift Assigned'),
  });
});
```

### Integration Tests (Edge Functions)

```typescript
// Manual test with Supabase CLI
supabase functions serve send-shift-notification

// Test request
curl -X POST http://localhost:54321/functions/v1/send-shift-notification \
  -H "Content-Type: application/json" \
  -d '{"shiftId": "uuid-here", "action": "created"}'
```

---

## Success Metrics

### Code Quality
- **Reduced Duplication**: 70% less HTML/email code
- **Consistency**: 100% of notifications use same template
- **Maintainability**: Single point of update for branding
- **Security**: Centralized XSS protection

### Business Impact
- **Employee Satisfaction**: Timely notifications about schedule/pay
- **Manager Efficiency**: Automated notifications reduce manual communication
- **Compliance**: Documented trail of employee communications
- **Transparency**: Employees always informed of changes

### Technical Metrics
- **Test Coverage**: 90%+ on notification code
- **Email Deliverability**: 98%+ (via Resend)
- **Performance**: <500ms edge function execution
- **Reliability**: 99.9% uptime

---

## Rollout Plan

### Stage 1: Soft Launch (Week 1-2)
- Deploy DRY infrastructure
- Enable shift notifications for 1 test restaurant
- Monitor for issues
- Collect feedback

### Stage 2: Phased Rollout (Week 3-6)
- Enable high-priority notifications for 25% of restaurants
- Monitor email deliverability and engagement
- Enable for 50% of restaurants
- Enable for 100% of restaurants

### Stage 3: Full Feature Set (Week 7-12)
- Roll out medium and low priority notifications
- Refactor existing notifications
- Complete testing and documentation

### Stage 4: Optimization (Week 13+)
- Analyze email open rates
- A/B test subject lines
- Implement digest mode (daily summary)
- Add SMS notifications (future enhancement)

---

## Conclusion

This comprehensive plan transforms the notification system from 10 ad-hoc implementations to a robust, DRY, maintainable system covering 33 notification types. The shared template infrastructure reduces code by 70% while ensuring consistency, security, and maintainability.

**Total Estimated Effort**: 12-14 weeks for complete implementation  
**Code Reduction**: ~6,000 lines saved via DRY approach  
**Maintenance Benefit**: 90% faster updates to branding/styling

---

## References

- [Existing Time-Off Notifications](./TIME_OFF_NOTIFICATIONS.md)
- [Shift Trading Implementation](./SHIFT_TRADING_IMPLEMENTATION.md)
- [Schedule Publishing](./SCHEDULE_PUBLISHING_IMPLEMENTATION.md)
- [Integrations Guide](./INTEGRATIONS.md)

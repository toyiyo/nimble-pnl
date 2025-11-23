# Time-Off Request Notifications

This document describes the email notification system for time-off requests.

## Overview

The system sends email notifications to managers and employees when time-off requests are created, approved, or rejected. Notifications are configurable through the admin settings panel.

## Features

### Notification Types

1. **Request Created**: Sent when an employee submits a new time-off request
2. **Request Approved**: Sent when a manager approves a time-off request
3. **Request Rejected**: Sent when a manager rejects a time-off request

### Configurable Settings

Owners and managers can configure:
- Which events trigger notifications (created, approved, rejected)
- Who receives notifications (managers, employees, or both)

Settings are stored per restaurant in the `notification_settings` table.

## Architecture

### Database

**Table: `notification_settings`**
```sql
CREATE TABLE notification_settings (
  id UUID PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  
  -- Event toggles
  notify_time_off_request BOOLEAN DEFAULT true,
  notify_time_off_approved BOOLEAN DEFAULT true,
  notify_time_off_rejected BOOLEAN DEFAULT true,
  
  -- Recipient toggles
  time_off_notify_managers BOOLEAN DEFAULT true,
  time_off_notify_employee BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
);
```

### Edge Function

**Location**: `supabase/functions/send-time-off-notification/index.ts`

The edge function:
1. Receives a `timeOffRequestId` and `action` (created/approved/rejected)
2. Fetches the time-off request and related data
3. Checks notification settings to determine if notification should be sent
4. Collects email addresses based on settings (managers and/or employee)
5. Sends formatted email notifications using Resend

**Environment Variables Required**:
- `RESEND_API_KEY`: API key for Resend email service

### Frontend Components

**NotificationSettings Component**
- Location: `src/components/NotificationSettings.tsx`
- Displays toggle switches for each notification setting
- Allows owners/managers to save settings
- Shows reset button when changes are made
- Integrated into the Restaurant Settings page

**Hooks**
- `useNotificationSettings`: Fetches notification settings for a restaurant
- `useUpdateNotificationSettings`: Saves notification settings

**Updated Hooks**
- `useCreateTimeOffRequest`: Triggers notification on successful creation
- `useReviewTimeOffRequest`: Triggers notification on approval/rejection

## Usage

### For Administrators

1. Navigate to **Settings** page
2. Scroll to **Notification Settings** section
3. Configure which events should trigger notifications
4. Configure who should receive notifications
5. Click **Save Settings**

### For Developers

#### Sending a Notification Manually

```typescript
await supabase.functions.invoke('send-time-off-notification', {
  body: {
    timeOffRequestId: 'uuid-here',
    action: 'created' // or 'approved' or 'rejected'
  }
});
```

#### Checking Notification Settings

```typescript
import { useNotificationSettings } from '@/hooks/useNotificationSettings';

function MyComponent({ restaurantId }) {
  const { settings, loading } = useNotificationSettings(restaurantId);
  
  if (settings?.notify_time_off_request) {
    // Notifications are enabled
  }
}
```

## Email Template

Emails use the EasyShiftHQ branded template with:
- Logo and branding header
- Status badge (Pending/Approved/Rejected)
- Restaurant and employee details
- Time-off dates and reason
- Call-to-action button linking to the app
- Professional footer

## Testing

### E2E Tests

Location: `tests/e2e/scheduling/notification-settings.spec.ts`

Tests cover:
- Display of notification settings
- Saving notification settings
- Reset functionality
- Permission restrictions (owners/managers only)

### Manual Testing

1. **Create a time-off request**:
   - Log in as an owner/manager
   - Navigate to Scheduling → Time-Off
   - Create a new request
   - Check email for notification

2. **Approve/Reject a request**:
   - Find a pending request
   - Click Approve or Reject
   - Check email for notification

3. **Configure settings**:
   - Go to Settings → Notification Settings
   - Toggle any setting
   - Save changes
   - Create/approve a request to test

## Security

### Row Level Security (RLS)

- Only owners and managers can view and modify notification settings
- Settings are isolated per restaurant
- Edge function uses service role key to bypass RLS when fetching data for notifications

### Email Privacy

- Only registered email addresses receive notifications
- Employees without email addresses in their profile won't receive notifications
- Manager emails are fetched from the `auth.users` table linked through `user_restaurants`

## Troubleshooting

### Notifications Not Being Sent

1. **Check notification settings**: Verify the event type is enabled
2. **Check recipient settings**: Verify managers/employees are enabled
3. **Check email addresses**: Ensure employees and managers have valid emails
4. **Check edge function logs**: Review Supabase edge function logs for errors
5. **Check Resend API key**: Ensure `RESEND_API_KEY` environment variable is set

### Missing Email Addresses

- Employees need an email in the `employees` table
- Managers need an email in their `auth.users` record
- Update profiles to add missing emails

### Permission Issues

- Only owners and managers can access notification settings
- Staff users won't see the notification settings section
- Check user role in `user_restaurants` table

## Future Enhancements

Potential improvements:
- Add notification preferences per user (allow users to opt out)
- Add digest emails (daily/weekly summaries)
- Add in-app notifications alongside emails
- Add notification for shift changes
- Add notification for schedule published
- Add SMS notifications option
- Add webhook support for external integrations

## Related Documentation

- [Scheduling System](./SCHEDULING.md)
- [Time-Off Requests](./TIME_OFF_AVAILABILITY_GUIDE.md)
- [Email Integration](./INTEGRATIONS.md#email)

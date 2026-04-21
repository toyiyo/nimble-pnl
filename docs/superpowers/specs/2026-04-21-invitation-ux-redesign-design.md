# Design: Invitation UX Redesign

**Date:** 2026-04-21
**Status:** Approved

## Problem

The invitations section has three UX gaps that make it unclear what to do when an invitation expires:

1. **No resend action** — expired invitation rows have no button; the only way to resend is to re-open the "Send Invitation" dialog, which is non-obvious.
2. **Generic expired-link page** — when a new employee clicks an expired invite link, they see "invalid/expired/already used" with no guidance on what to do next.
3. **Cluttered list** — accepted and cancelled rows mix with actionable rows, making the list noisy and hiding what needs attention.
4. **Silent re-invite** — resending to an email that already has a pending invite silently cancels the old link with no warning to the manager.

## What Already Works (No Backend Changes Needed)

- `send-team-invitation` edge function correctly cancels any existing `pending` invite and creates a fresh one when re-inviting the same email. Re-inviting is already safe.
- The unique constraint `UNIQUE(restaurant_id, email, status)` allows one `pending` and one `expired` row to coexist — no conflicts.
- `validate-invitation` already returns distinct error messages: `'Invitation has expired'` vs. a generic invalid-token error. The frontend just isn't using this distinction yet.

## Design

### 1. Resend Button on Expired Rows

In `TeamInvitations.tsx` and `CollaboratorInvitations.tsx`, add a "Resend" button alongside expired invitation rows. Clicking it calls `send-team-invitation` with the same email, role, and (if present) `employeeId` from the existing invitation row. On success, show a toast: "Invitation resent to sam@example.com."

No dialog is required — the parameters are already known from the expired row.

### 2. History Collapse

Accepted and cancelled rows are collapsed by default behind a "Show history (N)" toggle at the bottom of the list. Expired rows remain visible (they are actionable). The toggle is local UI state — no new queries needed.

### 3. Pending Invite Confirmation

When the "Send Invitation" dialog is submitted for an email that already has a `pending` invitation, show an inline warning before submitting: "A pending invite for this email already exists. Sending a new one will cancel the old link. Continue?" with Confirm / Cancel buttons.

Detection: check the current `invitations` list (already loaded in React Query) for a `pending` row matching the entered email before calling the edge function.

### 4. Improved Expired-Link Page

In `AcceptInvitation.tsx`, the `validate-invitation` edge function call can return two distinct error cases:
- HTTP 400 with message `'Invitation has expired'` → show: "This invitation has expired. Ask your manager to resend it from the Team page."
- Any other error → keep the current generic "invalid/expired/already used" message.

No changes to `validate-invitation` are required — the error message distinction already exists.

### 5. "Expires in N days" on Pending Rows

Replace "Sent X ago" with "Expires in N days" on pending invitation rows to give managers a clearer signal of urgency.

## Components Affected

| File | Change |
|---|---|
| `src/components/TeamInvitations.tsx` | Resend button, history collapse, pending confirmation, expires-in label |
| `src/components/CollaboratorInvitations.tsx` | Resend button, history collapse |
| `src/pages/AcceptInvitation.tsx` | Distinguish expired vs. invalid error state |

## Out of Scope

- Auto-scheduling `cleanup_expired_invitations()` (separate ops concern)
- Notification emails to invitees when an invite expires
- Bulk resend

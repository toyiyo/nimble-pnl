---
title: "Manage Your Team: Invite, Change Roles, Remove, and Add Collaborators"
category: "getting-started"
summary: "Invite staff, view pending invitations, change member roles, remove someone from the team, and invite external collaborators such as accountants or inventory helpers."
audience: ["owner", "manager"]
order: 50
keywords: ["team", "invite", "collaborator", "role", "remove member", "invitation", "accountant", "inventory helper"]
related: ["roles-and-permissions", "accept-team-invitation", "restaurant-settings"]
---

# Manage Your Team: Invite, Change Roles, Remove, and Add Collaborators

This guide walks owners and managers through every team-management task in EasyShiftHQ: viewing current members, changing their roles, sending and cancelling invitations, and granting limited access to outside helpers like accountants or inventory assistants.

## Before you begin

You must be signed in with an **Owner** or **Manager** role to invite people, change roles, or remove members. Staff and Chef accounts can view the Team page but cannot make changes.

## View current team members

1. Navigate to the **Team Management** page.
2. The page opens on the **Team Members** tab.
3. Each row shows the member's name, email address, and a role badge (Owner, Manager, Chef, Staff, or Kiosk).

> Owner and Kiosk accounts do not show a three-dot action menu — those roles cannot be changed or removed from this screen.

## Change a member's role

1. On the **Team Members** tab, find the person whose role you want to change.
2. Click the three-dot icon on the right side of their row.
3. A menu opens with a **Change Role** section at the top.
4. Use the dropdown inside that section to select a new role: **Staff**, **Chef**, or **Manager**. If you are an Owner, you will also see **Owner** as an option.
5. The role updates immediately — no separate Save button is needed.

## Remove a member from the team

1. On the **Team Members** tab, click the three-dot icon next to the person.
2. Click **Remove Member** (shown with a trash icon).
3. A confirmation dialog appears asking you to confirm. Click **Remove** to proceed, or **Cancel** to go back.
4. The action cannot be undone. If you need to re-add them later, send a new invitation.

## Send an invitation to a new team member

1. Click the **Invitations** tab at the top of the Team page.
2. Click the **Send Invitation** button in the upper right.
3. In the dialog that appears, fill in:
   - **Email Address** — the person's email
   - **Role** — Staff, Chef, or Manager (Owner is available if you are an Owner)
4. Click **Send Invitation**. The person will receive an email with a link to accept and join your team.

### If a pending invitation already exists for that email

When you click **Send Invitation** and the email already has a pending invite, a warning appears:

> "A pending invite for [email] already exists. Sending a new one will cancel the old link."

Click **Yes, resend anyway** to cancel the old link and send a fresh invitation, or click **Cancel** to stop without making any changes.

## Cancel or resend an invitation

On the **Invitations** tab, each invitation row shows a status badge:

- **Pending** — the invitation has been sent and is waiting for the recipient to accept.
- **Expired** — the invitation link has passed its expiry date.

To **cancel a pending invitation**, click the trash icon on the right side of that row. The link is cancelled immediately.

To **resend an expired invitation**, click the refresh icon on the right side of that row. A new invitation email is sent to the same address with a fresh link.

### View accepted and cancelled invitations

By default, only active (pending and expired) invitations are shown. To see the full history, click **Show history** (the button also shows a count of historical entries) at the bottom of the list. Click **Hide history** to collapse it again.

## Invite an external collaborator

Collaborators are people outside your core team — such as an accountant or an outside inventory assistant — who need limited, focused access to your restaurant. They do not appear on the Team Members tab.

1. Click the **Collaborators** tab at the top of the Team page.
2. In the **Invite Collaborator** section, choose the type of access the person needs by clicking one of the three role cards:
   - **Accountant** — view and edit financial data, bank transactions, chart of accounts, invoices, and payroll figures for bookkeeping.
   - **Inventory Helper** — view and edit inventory, conduct audits, create purchase orders, and import vendor receipts.
   - **Chef** — create and edit recipes and prep recipes, manage production batches, and view inventory for ingredient context.
3. After clicking a card, a detail panel appears showing exactly what that role can access, along with an **Email address** field.
4. Enter the collaborator's email address and click **Send Invite**.

The collaborator receives an email invitation. Once they accept, they appear under **Active Collaborators**.

## Remove an active collaborator

1. On the **Collaborators** tab, scroll to the **Active Collaborators** section.
2. Find the person you want to remove and click the trash icon on the right side of their row.
3. They are removed immediately.

## View cancelled collaborator invitations

On the **Collaborators** tab, if there are any cancelled invitations, a **Show cancelled** button (which also shows a count) appears at the bottom of the Invitations section. Click it to expand the list, or **Hide cancelled** to collapse it.

---

## Tips

- You can have multiple Owners on the same restaurant account. Only Owners can assign the Owner role to someone else.
- Kiosk accounts are service accounts for the shared time-clock tablet. Their role cannot be changed from this screen.
- Collaborators have isolated access — they only see the sections relevant to their role and cannot manage team members or settings.
- If a collaborator's invitation expires before they accept it, it will appear with an **Expired** status. Use the refresh icon to send them a new link.
- Sending a fresh invitation to an email that already has a pending invite automatically cancels the old link, so there is never more than one active link per address.

---

## Troubleshooting

**The three-dot menu does not appear next to a team member.**
This happens for Owner and Kiosk accounts — those roles cannot be edited from the Team Members tab. If you need to change an Owner's access, contact that person directly or update your subscription settings.

**I do not see the "Send Invitation" or "Invite Collaborator" buttons.**
These buttons are only visible to Owners and Managers. If you are logged in as a Chef or Staff member, you can view the Team page but cannot send invitations.

**The invitation was accepted but the new member does not appear in Team Members.**
Refresh the page. If the person still does not appear, ask them to sign out and sign back in to complete the setup.

**I sent an invitation but the recipient says they did not get an email.**
Ask them to check their spam or junk folder. If the email is not there, go to the Invitations tab and check whether the status is still Pending. If it is, cancel it and send a fresh invitation.

**The collaborator I removed still has access.**
Have them sign out and sign back in. Access changes take effect on the next login.

---

## Frequently asked questions

**What is the difference between a team member and a collaborator?**
Team members (Owner, Manager, Chef, Staff) are full members of your restaurant account with access that matches their role. Collaborators are external helpers — such as an outside accountant — who receive narrowly scoped access to a specific area like finances or inventory, and they do not appear on the main Team Members tab.

**Can a collaborator send invitations or manage the team?**
No. Collaborators cannot manage team members, change roles, or send invitations.

**Can I change a collaborator's role after inviting them?**
No. To give a collaborator a different type of access, remove them using the trash icon and send a new invitation with the correct role selected.

**What happens if I remove a team member by mistake?**
Removing a member is permanent, but you can invite them back. Go to the Invitations tab, click Send Invitation, and enter their email and role again.

**Can more than one person be an Owner?**
Yes. A current Owner can assign the Owner role to another team member using the Change Role dropdown on the Team Members tab.

---

## Related articles

- [Roles and What Each One Can Access](/help/roles-and-permissions)
- [Accept a Team Invitation](/help/accept-team-invitation)
- [Sign In or Create Your EasyShiftHQ Account](/help/sign-in-create-account)

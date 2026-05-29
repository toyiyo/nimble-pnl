---
title: "Connect Sling for Schedule and Timesheet Sync"
category: "pos-and-sales"
summary: "Link your Sling scheduling account to EasyShiftHQ, map Sling employees to payroll records, and sync shifts and timesheets."
audience: ["owner", "manager"]
order: 20
keywords: ["Sling", "scheduling", "sync", "integration", "shifts", "timesheets", "connect"]
related: ["connect-pos-system", "build-publish-weekly-schedule", "time-punches-manager"]
---

# Connect Sling for Schedule and Timesheet Sync

This article walks owners and managers through connecting a Sling scheduling account to EasyShiftHQ so that shifts and timesheets flow automatically into payroll calculations.

## Before you begin

- You must have an **owner** or **manager** role in EasyShiftHQ. Staff-level accounts cannot access the Integrations page.
- You need a Sling **admin or manager** account. EasyShiftHQ authenticates with Sling on your behalf, so the credentials you provide must have admin or manager access in Sling.

## Step 1: Find the Sling card on the Integrations page

1. In the left navigation, go to **Integrations** (or navigate to `/integrations`).
2. Scroll to the **Scheduling** section.
3. Locate the **Sling** card.
4. Click **Connect**.

A setup wizard opens. It guides you through four steps: **Credentials**, **Organization**, **Employees**, and **Complete**.

## Step 2: Enter your Sling credentials

On the **Credentials** step, choose how you want to authenticate:

### Option A: Email & Password

1. Click the **Email & Password** tab (selected by default).
2. Enter the **Email** address of your Sling admin or manager account.
3. Enter the **Password** for that account.
4. Click **Continue**.

Your credentials are encrypted and stored securely — EasyShiftHQ never displays them again.

### Option B: Auth Token

Use this option if you prefer not to store your Sling password, or if your organization requires token-based access.

1. Click the **Auth Token** tab.
2. Follow the on-screen instructions to retrieve the token from Sling:
   - Log in to [app.getsling.com](https://app.getsling.com) with an admin account.
   - Open your browser's developer tools and go to the **Network** tab.
   - Refresh the page, then click any request to `api.getsling.com`.
   - Copy the value of the **Authorization** header.
3. Paste the copied value into the **Authorization Token** field.
4. Click **Continue**.

## Step 3: Select your Sling organization (if prompted)

If your Sling account belongs to more than one organization, the **Organization** step appears automatically.

1. Open the **Organization** dropdown (labeled "Choose an organization") and select the organization you want to connect to EasyShiftHQ.
2. Click **Continue**.

If your account has only one organization, this step is skipped and the wizard moves directly to the Employees step.

## Step 4: Map Sling employees to your payroll records

The **Employees** step shows every Sling user found in the connected organization alongside their best match in EasyShiftHQ. Each row displays a match badge:

| Badge | Meaning |
|---|---|
| **Matched** | EasyShiftHQ found an exact match — no action needed. |
| **Partial** | A possible match was found — review and confirm. |
| **Unmatched** | No match found — you must link or create the employee. |

### Linking an unmatched or partially matched user

1. In the row for the Sling user, open the **Link to existing** dropdown.
2. Select the correct employee from the list.

### Creating a new employee record for one user

1. In the row for the unmatched Sling user, click **Create**.
2. A confirmation toast appears confirming the employee was added.

### Creating new employee records for all unmatched users at once

1. Click **Create All Unmatched** (top-right of the employee list).
2. All users currently shown as **Unmatched** are added as new employees in one step.

### Finishing the employee step

Once you are satisfied with all mappings, click **Confirm & Finish**. EasyShiftHQ saves the links between Sling users and your payroll records, then advances to the **Complete** screen.

## Step 5: Finish setup

The **Complete** screen confirms your Sling account is connected and ready to sync. Click **Done** to return to the Integrations page.

The Sling card on the Integrations page now shows a green **Connected** badge and the date the connection was made. Your first 90-day history import will run on the next scheduled sync (every 6 hours), or you can kick it off right away by clicking **Sync Now** in the Sling Data Sync section.

## Sync shifts and timesheets manually

Once Sling is connected, the **Sling Data Sync** section appears on the Sling card. Shifts and timesheets sync automatically every 6 hours, but you can also trigger a sync at any time.

### Sync recent shifts (last 25 hours)

1. On the Integrations page, find the Sling card.
2. In the **Sling Data Sync** section, select the **Sync recent shifts** option (radio button).
3. Click **Sync Now**.

### Sync a custom date range

1. Select **Custom date range** (radio button).
2. Use the date picker to choose a start and end date (up to 90 days).
3. Click **Sync Now**.

After the sync finishes, a results summary shows how many shifts and timesheets were synced. Any errors encountered are listed below the summary.

## Disconnect Sling

To remove the Sling integration:

1. Go to **Integrations**.
2. Find the Sling card.
3. Click **Disconnect** (the red button below "Configure").

Disconnecting stops all future syncs and removes the stored credentials. Shift and timesheet data already synced to EasyShiftHQ is not deleted.

## Tips

- **Use an admin Sling account.** EasyShiftHQ needs admin or manager-level access to read shift and timesheet data from Sling. A staff-level Sling account will fail to connect.
- **Review all Partial matches.** Employees shown with a **Partial** badge may be assigned to the wrong person. Click **Link to existing** and confirm the correct match before finishing.
- **Avoid duplicate links.** Each EasyShiftHQ employee can only be linked to one Sling user. If the same payroll record appears in two rows, one row will show a **Duplicate** warning — open the dropdown on the incorrect row and choose a different match or leave it unlinked.
- **Automatic sync runs every 6 hours.** You only need to use **Sync Now** when you want data imported immediately — for example, right before running payroll.
- **Custom date range is useful for backfills.** If you made changes in Sling for past weeks, select those dates with **Custom date range** and click **Sync Now** to pull the corrected data.

## Troubleshooting

**"Connection failed" error on the Credentials step**
- Double-check that the email and password belong to a Sling admin or manager account, not a staff account.
- If using an auth token, make sure you copied the full value of the Authorization header and did not include any extra spaces.

**No employees appear on the Employees step**
- The connected Sling organization may have no users. Confirm you selected the correct organization on the Organization step (click **Back** to return and choose a different one).

**A Sling user shows as Unmatched even though the employee exists in EasyShiftHQ**
- The names may be spelled differently between the two systems. Use the **Link to existing** dropdown to manually select the correct employee.

**Sync Now completes but shows zero shifts synced**
- If this is the initial sync, it may still be running in the background. Wait a few minutes and check again.
- For a custom date range sync, verify that Sling has shifts scheduled for the dates you selected.

**"Last sync error" banner appears on the Sling card**
- The banner shows the error message and when it occurred. Try clicking **Sync Now** again. If the error repeats, disconnect and reconnect Sling to refresh the credentials.

**The Sling card does not appear under Scheduling on the Integrations page**
- Make sure you are logged in with an owner or manager role. Staff accounts do not see integration settings. See [Roles and What Each One Can Access](/help/roles-and-permissions).

## Frequently asked questions

**Can I connect more than one Sling organization to the same restaurant?**
No. Each restaurant location in EasyShiftHQ supports one Sling connection at a time. To connect a different organization, disconnect the current one first, then run the setup wizard again.

**Will disconnecting Sling delete my synced shifts or timesheet data?**
No. Disconnecting only removes the connection and stops future syncs. Shift and timesheet records already in EasyShiftHQ are preserved.

**How far back does the first sync go?**
The initial sync imports your last 90 days of shift and timesheet history from Sling. After that, each automatic or manual sync pulls the most recent 25 hours (or the custom date range you specify).

**What happens if an employee is added to Sling after the initial setup?**
Their shifts will sync, but without a payroll link. Go to the Integrations page, click **Configure** on the Sling card — this is not yet available for re-mapping without disconnecting — or use **Sync Now** after the employee is added and then review time punches manually. See [Track and Manage Employee Time Punches](/help/time-punches-manager).

**Does Sling sync work alongside a POS integration like Square or Toast?**
Yes. Sling handles scheduling and timesheet data; POS integrations handle sales data. Both can be active at the same time without conflict.

## Related articles

- [Connect and Sync a POS System](/help/connect-pos-system)
- [Build, Edit, and Publish the Weekly Schedule](/help/build-publish-weekly-schedule)
- [Track and Manage Employee Time Punches](/help/time-punches-manager)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
- [Run Payroll: View Wages, Hours, and Tips](/help/run-payroll)

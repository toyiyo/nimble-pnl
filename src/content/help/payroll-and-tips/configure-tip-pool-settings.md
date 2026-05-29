---
title: "Configure Tip Pool Settings"
category: "payroll-and-tips"
summary: "Choose the pooling model, share method, split cadence, role weights, and which employees participate — settings are auto-saved."
audience: ["owner", "manager"]
order: 50
keywords: ["tip pool", "settings", "pooling model", "share method", "cadence", "role weights", "contribution", "participating employees"]
related: ["tips-daily-entry", "lock-tips-for-payroll", "payroll-rules-and-types"]
---

# Configure Tip Pool Settings

This article walks owners and managers through every option in the **Tip Pool Settings** dialog — from choosing a pooling model to selecting which employees participate. You only need to configure these settings once; the app saves changes automatically as you make them.

## Before you begin

You must be signed in as an **Owner** or **Manager** to access Tip Pool Settings. Staff and other roles do not see the settings option.

## Open Tip Pool Settings

1. Go to **Tips** in the left navigation (route: `/tips`).
2. In the top-right corner of the Tips header, click the gear icon button.
3. The **Tip Pool Settings** dialog opens. All your current settings are shown immediately.

## Choose a Pooling Model

The **Pooling Model** section is always the first thing shown in the dialog. It controls the fundamental approach to tip distribution.

1. In the **Pooling Model** section, click one of the two cards:
   - **Full Pool** — All tips are combined and distributed to every participating employee. This is the simpler, more common setup.
   - **Percentage Contribution** — Servers keep the majority of their own tips and contribute a defined percentage to shared pools (for example, a kitchen pool or busser pool).
2. The rest of the dialog updates immediately to show only the options relevant to your chosen model.

## Configure Full Pool settings

When **Full Pool** is active, the dialog shows the following additional sections.

### Set the Tip Source

Under **Tip Source**, choose how tip amounts enter the system each day:

- **Manual Entry** — A manager types in the total tip amount each day on the Daily Entry tab.
- **POS Import** — Tips are pulled automatically from your connected point-of-sale system.

### Choose a Share Method

Under **Share Method**, select how the pooled tips are divided:

- **By Hours Worked** *(Recommended)* — Each employee's share is proportional to how many hours they worked. Employees with more hours receive a larger cut.
- **By Role** — Shares are calculated using a numeric weight assigned to each role. For example, a Server set to 1.0 and a Busser set to 0.5 means servers receive twice as much per person.
- **Even Split** — Tips are divided equally among all participating employees regardless of hours or role.

### Adjust Role Weights (By Role only)

If you selected **By Role**, a **Role Weights** section appears below Share Method.

1. You will see a row for each role that exists among your eligible employees.
2. Click into the number field next to any role and type a new weight. Weights can be decimals (for example, 0.5 or 1.5). A higher number means a larger share.
3. An example note reminds you: "If Server = 1.0 and Busser = 0.5, servers get twice as much per person."

Changes save automatically as you type.

### Select Participating Employees

Under **Participating Employees**, control exactly who is included in the tip pool.

1. The list shows all hourly (non-salaried) active employees. Salaried employees are automatically excluded and do not appear here.
2. Check or uncheck individual employees to include or remove them.
3. Use the **Select All** button at the top of the section to include everyone at once, or **Select None** to clear all selections.
4. A count below the list shows how many employees are currently selected (for example, "4 of 6 employees selected").

## Configure Percentage Contribution pools

When **Percentage Contribution** is active, the **Contribution Pools** section replaces the Tip Source, Share Method, and Participating Employees sections.

### Add a pool

1. Click **Add Pool**. A new pool card appears with the default name "Pool 1" and a 5% contribution.

### Edit a pool

Each pool card has the following fields:

- **Pool Name** — Type a descriptive name such as "Kitchen Pool" or "Busser Pool."
- **Contribution %** — Enter the percentage of each server's tips that goes into this pool (0–100). The combined total across all pools is shown in the section header. If the total exceeds 50%, a warning appears noting that servers may find the share too high.
- **Distribution Method** — Choose how the collected pool funds are split among eligible recipients:
  - **Hours** — distributed proportionally by hours worked
  - **Role** — distributed by role weights (a **Role Weights** grid appears when this is selected)
  - **Even** — distributed equally
- **Eligible Employees** — Click the **Eligible Employees** row to expand the employee list for this pool. Use **Select All** or **Select None**, or check individual employees. The count badge next to the label shows how many are included.

### Delete a pool

Click the trash icon on the right side of a pool card. The pool is removed immediately.

## Set the Split Cadence

The **Split Cadence** section appears for both pooling models.

Under **Split Cadence**, click one of the three options to choose how often tips are calculated and distributed:

- **Daily** — Tips are calculated every day.
- **Weekly** — Tips are calculated once a week.
- **Per Shift** — Tips are calculated after each shift.

## Close the dialog

Click **Done** in the bottom-right corner of the dialog. Because all settings are auto-saved as you change them, no separate "Save" step is required — **Done** simply closes the dialog.

---

## Tips

- Settings are **auto-saved** about one second after you make a change. You do not need to click any save button; just close with **Done** when you are finished.
- If you switch from **Full Pool** to **Percentage Contribution** (or vice versa), the system keeps the settings for both models. You can switch back at any time without losing your configuration.
- Under **Percentage Contribution**, the section header shows a running **Total** percentage across all pools. Watch for the amber warning triangle if the total climbs above 50%.
- **By Hours Worked** is the recommended share method for most restaurants because hours are automatically pulled from time punches — managers rarely need to enter anything manually.

---

## Troubleshooting

**The gear icon button is not visible.**
Only Owners and Managers can see and click the gear icon button. If you are logged in as a Staff member or another role, the option is not available. Ask your owner or manager to adjust your role if needed. See [Roles and What Each One Can Access](/help/roles-and-permissions).

**An employee I expect to see is missing from Participating Employees.**
Salaried employees are automatically excluded from the list. If a hourly employee is missing, they may be inactive. An owner or manager can check and reactivate team members in [Manage Your Team](/help/manage-team-members).

**The total Contribution % shows a warning even though my pools look correct.**
The warning appears whenever the combined percentage across all pools exceeds 50%. Review each pool's **Contribution %** field and lower one or more until the total is at or below 50%.

**I changed a setting but it does not seem to have saved.**
Settings save automatically about one second after a change. Wait a moment, close the dialog with **Done**, then reopen it to confirm the value is correct. If the problem persists, check your internet connection and try again.

**No POS tips appear on the Daily Entry tab even though I selected POS Import.**
The Tips page shows a notice when no POS tips are found for the selected day. Confirm your POS system is connected and synced. See [Connect and Sync a POS System](/help/connect-pos-system).

---

## Frequently asked questions

**Can I change the pooling model after I have already approved some tips?**
Yes. Switching the pooling model only affects future tip entries. Past approved splits are not changed.

**Do I have to reconfigure settings every week?**
No. Tip Pool Settings persist until you change them. You configure them once and they apply to every future tip split.

**What happens if I click "Select None" under Participating Employees?**
The tip pool will have zero participants. When you enter tips on the Daily Entry tab, no employees will receive a share until you add participants back. Use **Select All** or check individuals to re-include employees.

**Can each Contribution Pool have a different set of eligible employees?**
Yes. Each pool has its own **Eligible Employees** list. For example, your "Kitchen Pool" might include only kitchen staff, while a "Busser Pool" includes only bussers.

**Where do the hours come from when "By Hours Worked" is selected?**
Hours are automatically calculated from employee time punches recorded in EasyShiftHQ. Managers can still manually override the hours for any employee during the daily tip review step.

---

## Related articles

- [Enter and Approve Daily Tip Splits](/help/tips-daily-entry)
- [Lock Tips for Payroll, Record Cash Payouts, and Review Tip History](/help/lock-tips-for-payroll)
- [Run Payroll: View Wages, Hours, and Tips](/help/run-payroll)
- [Connect and Sync a POS System](/help/connect-pos-system)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
- [Manage Your Team: Invite, Change Roles, Remove, and Add Collaborators](/help/manage-team-members)

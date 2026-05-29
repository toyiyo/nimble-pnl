---
title: "Triage Operational Alerts in Ops Inbox"
category: "financials-and-accounting"
summary: "Use the Ops Inbox to review, snooze, dismiss, or escalate operational alerts such as uncategorized transactions, reconciliation gaps, and AI-detected anomalies."
audience: ["owner", "manager", "accountant"]
order: 100
keywords: ["ops inbox", "alerts", "anomaly", "uncategorized", "snooze", "reconciliation", "triage"]
related: ["dashboard-overview", "banking-connect-and-transactions", "categorize-pos-sales", "ai-chef-assistant"]
---

# Triage Operational Alerts in Ops Inbox

The Ops Inbox collects operational alerts that need your attention—things like uncategorized bank transactions, POS sales that could not be matched, AI-detected anomalies, and reconciliation gaps—all in one place so nothing slips through the cracks.

## Before you begin

Ops Inbox is available on plans that include the feature. If you do not see it in the navigation, contact your restaurant owner to confirm your subscription includes Ops Inbox.

## Open Ops Inbox and check how many alerts are waiting

1. In the main navigation, click **Ops Inbox**.
2. Next to the "Ops Inbox" heading you will see a small count badge showing the total number of open alerts. If there are no open alerts, the badge does not appear.

## Switch between tabs to filter alerts

Ops Inbox organizes alerts into four tabs:

| Tab | What it shows |
|-----|--------------|
| **All Open** | Every alert that has not yet been snoozed or resolved |
| **Critical** | Open alerts flagged at the highest priority level |
| **Snoozed** | Alerts you have temporarily hidden until a later time |
| **Resolved** | Alerts that have been marked as done |

1. Click the tab name to switch views. The active tab is underlined.
2. The **Critical** tab displays a red count badge next to its label when one or more critical-priority alerts are open. Check this tab first at the start of each day to catch anything that needs immediate attention.

## Read an alert card

Each alert appears as a card with the following information:

- **Priority badge** (left side) — indicates urgency:
  - **Critical** — shown in red; requires immediate action
  - **High** — shown in orange
  - **Medium** — shown in amber/yellow
  - **Low** or **Info** — shown in a neutral color
- **Title** — a short description of what was detected
- **Type badge** — categorizes the alert as one of: **Uncategorized Txn**, **Uncategorized POS**, **Anomaly**, **Reconciliation**, or **Recommendation**
- **Description** — up to two lines of additional detail below the title
- **Timestamp** (right side) — shows how long ago the alert was created (for example, "5m ago", "Yesterday", or "3d ago")

Alerts are sorted with the highest priority at the top, and within the same priority level the newest alerts appear first.

## Snooze an alert to handle it later

Use snooze when you have seen an alert but cannot act on it right now.

1. Hover over any alert card. Three action icons appear on the right side.
2. Click the **clock icon** (Snooze).
3. A menu opens with three options:
   - **1 hour** — hides the alert for one hour
   - **Tomorrow** — hides the alert until 9:00 AM the next day
   - **Next week** — hides the alert until 9:00 AM seven days from now
4. Click your preferred option. The alert moves to the **Snoozed** tab and reappears in **All Open** when the snooze period ends.

## Dismiss an alert

Dismiss an alert when it is not relevant or has already been handled outside the inbox.

1. Hover over the alert card.
2. Click the **X icon** (Dismiss).
3. The alert is immediately removed from the open list.

Dismissed alerts are removed from all tabs and are no longer visible in the inbox.

## Ask the AI about an alert

If you are unsure what an alert means or what to do next, you can open the AI assistant directly from the alert.

1. Hover over the alert card.
2. Click the **sparkle icon** (Ask AI about this item).
3. The AI chat panel opens so you can ask follow-up questions about the alert.

## Tips

- Work through the **Critical** tab before **All Open** so the highest-risk items get resolved first.
- Use **Snoozed** for alerts tied to a vendor callback or bank statement that arrives on a schedule—snooze to "Tomorrow" or "Next week" so the alert resurfaces at the right time.
- The inbox refreshes automatically whenever you switch back to the browser tab, so counts stay current without a manual page reload.
- If an alert card shows a description that's cut off after two lines, the AI chat (sparkle icon) can often provide the full context and suggested next steps.

## Troubleshooting

**The Ops Inbox page shows "Failed to load inbox"**
This usually means a temporary connection issue. Refresh the page. If the error persists, check your internet connection and try again in a few minutes.

**I dismissed an alert by mistake.**
Dismissed alerts are removed from the inbox entirely—they do not appear in the **Resolved** tab. At this time there is no undo; you would need to locate the underlying transaction or item through the relevant section of the app (for example, Banking or POS Sales) and address it there.

**The Critical count badge disappeared but I still see alerts on the Critical tab.**
The badge only appears when there is at least one open critical alert. If you snoozed or dismissed all critical items, the badge is hidden even if other open alerts remain on the **All Open** tab.

**A snoozed alert did not come back when expected.**
Snoozed alerts return to the **All Open** tab automatically. If you do not see it, switch to the **Snoozed** tab to confirm the snooze is still active, then refresh the page.

## Frequently asked questions

**What is the difference between "Dismiss" and resolving an alert?**
The **Resolved** tab shows alerts that were marked as done through a workflow action. **Dismiss** (the X icon) removes the alert from the inbox entirely—dismissed alerts do not appear in any tab afterward. Use dismiss when the underlying issue is not applicable to your operation or has been handled elsewhere.

**Will a snoozed alert come back on its own?**
Yes. Once the snooze period ends (1 hour, the next morning, or the following week), the alert automatically reappears in the **All Open** tab with its original priority.

**Who can see alerts in Ops Inbox?**
Any team member whose account has access to the Ops Inbox feature can view and act on alerts. Actions taken by one user (snooze, dismiss) affect the alert for all users at that location.

**How are alerts created?**
Alerts are generated automatically by the system—for example, when a bank transaction cannot be categorized, when AI detects a spending pattern that looks unusual, or when imported POS data does not match expected categories. You do not need to create them manually.

**Can I filter alerts by type (for example, see only Anomaly alerts)?**
The tabs filter by status and priority (All Open, Critical, Snoozed, Resolved). There is currently no tab that filters by alert type. Use the **All Open** tab and read the type badge on each card to identify the alerts you want to focus on.

## Related articles

- [Connect Bank Accounts and Manage Transactions](/help/banking-connect-and-transactions)
- [Categorize POS Sales](/help/categorize-pos-sales)
- [AI Chef Assistant](/help/ai-chef-assistant)

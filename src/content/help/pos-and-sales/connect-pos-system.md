---
title: "Connect and Sync a POS System"
category: "pos-and-sales"
summary: "Walk through connecting Toast, Square, Clover, or Shift4, trigger data syncs, and disconnect a POS system from the Integrations page."
audience: ["owner", "manager"]
order: 10
keywords: ["POS", "Toast", "Square", "Clover", "Shift4", "connect", "sync", "integration", "disconnect"]
related: ["connect-sling-scheduling", "view-filter-pos-sales", "categorize-pos-sales", "import-sales-csv"]
---

# Connect and Sync a POS System

This article walks owners and managers through connecting a point-of-sale system to EasyShiftHQ, pulling in historical and recent sales data, and disconnecting a POS when needed. All of these actions happen on the **Integrations** page.

## Before you begin

- You must be signed in as an **Owner** or **Manager** to manage integrations.
- You must have a restaurant selected. If you land on the Integrations page without a restaurant chosen, you will see a prompt to select one before any integration cards appear.
- For Toast, you will need API credentials from your Toast account before starting the wizard.
- For Shift4, you will need your Lighthouse account email and password.

## Go to the Integrations page

1. In the left navigation, click **Integrations**.
2. Confirm the correct restaurant is selected at the top of the page.
3. Scroll down to the **Point of Sale** section. You will see cards for **Toast POS**, **Square**, **Clover**, and **Shift4**.

## Connect Toast POS

Toast uses a three-step setup wizard.

**Step 1 — API Credentials**

Before opening EasyShiftHQ, get your credentials from Toast:

1. Log in to your Toast account and go to the **Toast API Access** page.
2. Click **Create credential**, give it a name (for example, "EasyShiftHQ"), and select the required API scopes.
3. Copy the **Client ID** and **Client Secret** that Toast generates.

Back in EasyShiftHQ:

1. On the **Toast POS** card, click **Connect**. The **Toast POS Setup** wizard opens.
2. Enter your **Client ID** and **Client Secret**.
3. Click **Continue**.

**Step 2 — Select Location**

1. Enter your **Restaurant External ID (GUID)** — a 36-character code that looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.
   - The easiest way to find it: search your inbox for an email from Toast about your API credentials — the GUID is included there.
   - Alternatively, go back to the Toast API Access page, click your credential name, and look in the **Edit Location IDs** section.
2. Click **Connect**. EasyShiftHQ tests the connection automatically.

**Step 3 — Complete**

When the connection test passes, a confirmation screen appears. Click **Go to Dashboard** to close the wizard. The Toast POS card now shows a green **Connected** badge and the date you connected.

After connection, orders sync automatically every **6 hours**. The first sync imports the last 90 days of order history.

## Connect Square

Square uses an OAuth flow — no credentials to copy and paste.

1. On the **Square** card, click **Connect**.
2. You are redirected to Square's login page. Sign in and authorize EasyShiftHQ.
3. After authorizing, you are returned to the Integrations page. The Square card shows a green **Connected** badge and the connection date.

Square also updates your data automatically in real time as new orders, payments, and shifts are processed — no manual sync required for day-to-day use.

## Connect Clover

Clover also uses an OAuth flow.

1. On the **Clover** card, click **Connect**.
2. You are redirected to Clover's login page. Sign in and authorize EasyShiftHQ.
3. After authorizing, you are returned to the Integrations page. The Clover card shows a green **Connected** badge and the connection date.

## Connect Shift4

Shift4 uses your **Lighthouse** account credentials.

1. On the **Shift4** card, click **Connect**. The **Connect to Shift4** dialog opens.
2. Enter your **Lighthouse Username/Email**.
3. Enter your **Lighthouse Password**.
4. Optionally, enter a **Merchant ID** to help identify this location in your dashboard.
5. Choose an **Environment**: **Production** for your live account, or **Sandbox (Testing)** if you are testing.
6. Click **Connect**.

Your credentials are encrypted before being stored and are never kept in plain text. The Shift4 card shows a green **Connected** badge and the connection date when the setup succeeds.

After connection, Shift4 tickets sync automatically every **2 hours**.

## Sync data manually

### Toast: manual sync

Once Toast is connected, a **Toast Data Sync** panel appears below the connection date on the card.

1. Choose a sync mode:
   - **Sync recent orders** — fetches orders from the last 25 hours.
   - **Custom date range** — lets you pick a specific start and end date (up to 90 days) to backfill or re-sync.
2. If you chose **Custom date range**, select your dates using the date picker that appears.
3. Click **Sync Now**.

A progress bar and a running count of orders synced appear while the sync is in progress. When complete, a **Sync Complete** results panel shows the total number of orders synced and any errors.

### Square: manual sync

Once Square is connected, a **Square Data Sync** panel appears on the card.

- Click **Import Last 90 Days** to pull in historical data and populate your full P&L history.
- Click **Sync Yesterday** to pull in the previous day's data.
- Click **Sync Last 7 Days** to pull in the past week.

A progress indicator appears while the import is running. When complete, a results panel breaks down the count of orders, payments, refunds, labor shifts, and team members synced, as well as any errors.

Because Square sends real-time updates automatically, manual syncs are mainly useful for importing historical data or filling in a specific date range you may have missed.

### Shift4: manual sync

Once Shift4 is connected, a **Shift4/Lighthouse Data Sync** panel appears on the card.

1. Choose a sync mode:
   - **Sync recent tickets** — fetches tickets from the last 25 hours.
   - **Custom date range** — lets you pick a specific start and end date (up to 90 days).
2. If you chose **Custom date range**, select your dates using the date picker.
3. Click **Sync Now**.

A progress bar and ticket count appear while the sync runs. When complete, a **Sync Complete** results panel shows the total tickets synced and any errors.

## Disconnect a POS system

1. Go to **Integrations** and find the connected POS card.
2. Click the red **Disconnect** button.
3. The card returns to its unconnected state and the **Connected** badge is removed.

Disconnecting stops future syncs. Your previously imported data is not deleted.

## Tips

- The first sync after connecting any POS imports up to 90 days of history. Depending on your data volume, this may take several minutes.
- For Toast and Shift4, the **Recent** sync mode (last 25 hours) is the fastest option for catching up after a missed scheduled sync.
- Square's real-time webhook updates mean you rarely need to trigger a manual sync — use **Import Last 90 Days** when you first connect to back-fill history.
- If you manage multiple locations, select each restaurant separately from the restaurant selector at the top of the Integrations page and connect the appropriate POS for each one.

## Troubleshooting

**The Connect button shows "Connecting..." but nothing happens (Toast or Shift4)**
Check that you entered your credentials correctly. For Toast, make sure there are no extra spaces in the Client ID, Client Secret, or Restaurant External ID. For Shift4, confirm you are using your Lighthouse email and password, not a different account.

**Toast shows a "Connection test failed" error after entering credentials**
The Client ID and Client Secret may not have the required API scopes (orders:read, menus:read, restaurants:read). Return to your Toast API Access page, verify the scopes, and try again.

**The Restaurant External ID field is not accepting my input (Toast)**
Make sure the GUID is exactly 36 characters including the dashes, formatted as `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. Check your Toast API credential email or the Edit Location IDs section in the Toast portal.

**A sync finishes but the results panel shows errors**
A partial sync still saves the records that did succeed. Review the error messages listed in the results panel. Common causes include individual orders with missing data. You can re-run the sync — EasyShiftHQ skips records it already has and only retries failed ones.

**The Shift4 card shows "Last sync error" in red**
Click **Sync Now** to attempt a fresh sync. If the error repeats, confirm your Lighthouse credentials are still valid and that you selected the correct environment (Production vs. Sandbox).

**I clicked Connect on 7shifts, When I Work, QuickBooks, or Sysco and nothing happened**
Those integrations are not yet available. When you click Connect on those cards, you will see an **Integration Coming Soon** message. They will be enabled in a future update.

## Frequently asked questions

**Do I need to keep triggering manual syncs after the first setup?**
No. Toast syncs automatically every 6 hours, Shift4 every 2 hours, and Square updates in real time. Manual syncs are for importing historical data or filling specific date gaps.

**Can I connect more than one POS at the same time?**
Yes. Each POS card is independent. You can connect Toast, Square, Clover, and Shift4 all at once for the same restaurant if you use multiple systems.

**Where does the synced sales data appear?**
After a successful sync, your data flows into the unified sales dashboard. You can view and filter it under the Sales section of EasyShiftHQ.

**What happens to my data if I disconnect a POS?**
Disconnecting stops future syncs. Data that was already imported remains in your account and is not deleted.

**How do I find my Toast Restaurant External ID if I cannot find the email?**
Log in to the Toast admin portal, go to your API Access page, click your credential name, and look in the **Edit Location IDs** section. The GUID appears there in the format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

## Related articles

- [Connect Sling for Schedule and Timesheet Sync](/help/connect-sling-scheduling)
- [View, Search, and Filter Your POS Sales](/help/view-filter-pos-sales)
- [Categorize Sales and Create Automation Rules](/help/categorize-pos-sales)
- [Import Sales from a CSV File](/help/import-sales-csv)
- [Roles and What Each One Can Access](/help/roles-and-permissions)

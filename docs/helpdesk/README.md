# EasyShiftHQ Help Center

This is the knowledge base index for the EasyShiftHQ Help Center. All articles are written from the user's perspective and reflect the actual shipped app; they render in-app at `/help` (individual articles at `/help/<slug>`).

## How this is organized

Articles live as Markdown files under `src/content/help/`, grouped by category folder. They are surfaced via the in-app Help Center — users reach the index at `/help` and individual articles at `/help/<slug>`.

---

## Getting Started

- [Sign In or Create Your EasyShiftHQ Account](/help/sign-in-create-account) — Create a new EasyShiftHQ account or sign back in using email/password or Google, and start your 14-day Pro trial.  ·  `src/content/help/getting-started/sign-in-create-account.md`
- [Reset or Change Your Password](/help/reset-change-password) — Recover account access via a forgot-password email link, or update your password inside Settings while logged in.  ·  `src/content/help/getting-started/reset-change-password.md`
- [Accept a Team Invitation](/help/accept-team-invitation) — Open your invitation link, create or sign into your account, and join a restaurant as a new team member or collaborator.  ·  `src/content/help/getting-started/accept-team-invitation.md`
- [Roles and What Each One Can Access](/help/roles-and-permissions) — A plain-language guide to all eight roles in EasyShiftHQ — what each can see, what is hidden, and how collaborator roles differ from internal team roles.  ·  `src/content/help/getting-started/roles-and-permissions.md`
- [Manage Your Team: Invite, Change Roles, Remove, and Add Collaborators](/help/manage-team-members) — Invite staff, view pending invitations, change member roles, remove someone from the team, and invite external collaborators such as accountants or inventory helpers.  ·  `src/content/help/getting-started/manage-team-members.md`
- [Choose or Change Your Subscription Plan](/help/subscription-plans) — View your current trial or plan status, compare the three plan tiers, toggle annual billing, and upgrade through the Subscription tab in Settings.  ·  `src/content/help/getting-started/subscription-plans.md`
- [Read and Use Your Dashboard](/help/dashboard-overview) — A guide to every section on the main Dashboard — what the numbers mean, how to change the date range, and what to do when an alert appears.  ·  `src/content/help/getting-started/dashboard-overview.md`

---

## POS & Sales

- [Connect and Sync a POS System](/help/connect-pos-system) — Walk through connecting Toast, Square, Clover, or Shift4, trigger data syncs, and disconnect a POS system from the Integrations page.  ·  `src/content/help/pos-and-sales/connect-pos-system.md`
- [Connect Sling for Schedule and Timesheet Sync](/help/connect-sling-scheduling) — Link your Sling scheduling account to EasyShiftHQ, map Sling employees to payroll records, and sync shifts and timesheets.  ·  `src/content/help/pos-and-sales/connect-sling-scheduling.md`
- [View, Search, and Filter Your POS Sales](/help/view-filter-pos-sales) — Browse all sales from connected POS systems and manual entries on the Sales page, using date ranges, search, and status or recipe filters.  ·  `src/content/help/pos-and-sales/view-filter-pos-sales.md`
- [Record and Edit Sales Manually](/help/record-edit-manual-sales) — Add individual sales entries by hand — including adjustments for tax, tip, and discounts — and edit or delete them later.  ·  `src/content/help/pos-and-sales/record-edit-manual-sales.md`
- [Import Sales from a CSV File](/help/import-sales-csv) — Upload a CSV export from any POS system, map columns, review and correct records, and confirm before importing.  ·  `src/content/help/pos-and-sales/import-sales-csv.md`
- [Categorize Sales and Create Automation Rules](/help/categorize-pos-sales) — Assign sales to chart-of-accounts categories manually, accept AI suggestions, bulk-categorize, split a sale across categories, and save rules to auto-categorize future sales.  ·  `src/content/help/pos-and-sales/categorize-pos-sales.md`

---

## Inventory & Recipes

- [Manage Your Inventory: Add, Edit, and Track Products](/help/manage-inventory-products) — Add products, update stock levels, set par levels and reorder points, record waste, transfer items between locations, and export your product list.  ·  `src/content/help/inventory-and-recipes/manage-inventory-products.md`
- [Scan Barcodes to Add and Update Inventory](/help/barcode-scanning-inventory) — Use the Scanner tab to add new products or update existing stock counts by scanning barcodes with a device camera, USB laser scanner, or AI-powered photo scan.  ·  `src/content/help/inventory-and-recipes/barcode-scanning-inventory.md`
- [Run an Inventory Count (Reconciliation)](/help/inventory-reconciliation) — Start, conduct, and complete a physical inventory count session that compares expected stock to actual counted quantities and applies corrections.  ·  `src/content/help/inventory-and-recipes/inventory-reconciliation.md`
- [Build and Manage Menu Item Recipes](/help/menu-item-recipes) — Create, edit, and link menu recipes to POS items so the system can automatically deduct ingredients from inventory when sales occur.  ·  `src/content/help/inventory-and-recipes/menu-item-recipes.md`
- [Create and Manage Prep Recipes](/help/prep-recipes) — Build a library of standardized kitchen prep recipes with ingredients, procedure steps, yield, storage instructions, and batch cost tracking — then log a prep batch to update inventory.  ·  `src/content/help/inventory-and-recipes/prep-recipes.md`
- [Create and Manage Purchase Orders](/help/purchase-orders) — Create, edit, and manage purchase orders — including smart quantity suggestions based on par levels and usage — and export orders as PDF, CSV, or text.  ·  `src/content/help/inventory-and-recipes/purchase-orders.md`
- [Import Supplier Receipts to Update Inventory](/help/receipt-import) — Upload a supplier receipt image or PDF so AI extracts line items which you review and confirm to add purchases to your inventory.  ·  `src/content/help/inventory-and-recipes/receipt-import.md`

---

## Financials & Accounting

- [Connect Your Bank and Manage Transactions](/help/banking-connect-and-transactions) — Connect a bank account or upload a statement, then review, categorize, reconcile, and export your transactions.  ·  `src/content/help/financials-and-accounting/banking-connect-and-transactions.md`
- [View and Export Financial Statements](/help/financial-statements) — Read your Income Statement, Balance Sheet, Cash Flow Statement, and Trial Balance, adjust the date range, and export reports as PDF or CSV.  ·  `src/content/help/financials-and-accounting/financial-statements.md`
- [Understand Your Break-Even and Set Operating Costs](/help/budget-break-even) — Set up fixed and variable operating costs, see your daily break-even target, track monthly progress, and view a sales-vs-cost chart.  ·  `src/content/help/financials-and-accounting/budget-break-even.md`
- [Track Expenses, Upload Invoices, and Print Checks](/help/expenses-and-print-checks) — Record pending vendor bills before they clear your bank, upload invoices for AI extraction, and generate printable check PDFs for vendor payments.  ·  `src/content/help/financials-and-accounting/expenses-and-print-checks.md`
- [Create and Send Invoices to Customers](/help/invoices-and-customers) — Build a customer directory, create invoices with line items, set up Stripe payment processing for card or ACH payments, and track invoice status.  ·  `src/content/help/financials-and-accounting/invoices-and-customers.md`
- [Track Fixed Assets and Depreciation](/help/assets-and-depreciation) — Add, edit, and dispose of restaurant equipment and other fixed assets, record depreciation entries, and bulk-import assets from an invoice or CSV.  ·  `src/content/help/financials-and-accounting/assets-and-depreciation.md`
- [Set Up the Chart of Accounts and View Financial Intelligence](/help/chart-of-accounts-and-intelligence) — Generate restaurant-specific accounts, add custom accounts or sub-accounts, and use the Financial Intelligence dashboard for cash flow, spending, and AI-powered predictions.  ·  `src/content/help/financials-and-accounting/chart-of-accounts-and-intelligence.md`
- [Triage Operational Alerts in Ops Inbox](/help/ops-inbox-triage-alerts) — Use the Ops Inbox to review, snooze, dismiss, or escalate operational alerts such as uncategorized transactions, reconciliation gaps, and AI-detected anomalies.  ·  `src/content/help/financials-and-accounting/ops-inbox-triage-alerts.md`
- [Read Your Weekly Performance Brief](/help/weekly-brief-performance-digest) — The Weekly Brief delivers an auto-generated Monday morning digest showing revenue, food cost %, labor cost %, prime cost %, week-over-week variances, an AI narrative summary, and prioritized action recommendations.  ·  `src/content/help/financials-and-accounting/weekly-brief-performance-digest.md`
- [Use the Reports Page: P&L, Recipes, Variance, and Pricing](/help/reports-pnl-recipe-variance-pricing) — The Reports page gives you seven analytical tabs — P&L Trends, P&L Detail, Recipes, Trends, Alerts, Variance, and Pricing — all scoped to a date range you choose, with CSV and PDF export available on key reports.  ·  `src/content/help/financials-and-accounting/reports-pnl-recipe-variance-pricing.md`

---

## Payroll & Tips

- [Run Payroll: View Wages, Hours, and Tips](/help/run-payroll) — Calculate gross wages, overtime, and tips owed for any pay period, spot incomplete punches, and export payroll data for your payroll processor.  ·  `src/content/help/payroll-and-tips/run-payroll.md`
- [How Payroll Is Calculated by Compensation Type](/help/payroll-rules-and-types) — Learn the exact rules EasyShiftHQ uses to calculate pay for hourly, salaried, regular contractor, per-job contractor, and per-day-worked employees, including overtime and proration.  ·  `src/content/help/payroll-and-tips/payroll-rules-and-types.md`
- [Adjust Overtime or Add a Manual Contractor Payment](/help/adjust-overtime-add-manual-payment) — From the Payroll table, reclassify hours between regular and overtime for hourly employees, or record a one-off cash payment for a per-job contractor.  ·  `src/content/help/payroll-and-tips/adjust-overtime-add-manual-payment.md`
- [Enter and Approve Daily Tip Splits](/help/tips-daily-entry) — Enter total tips collected for a day, review the calculated split across eligible employees, then approve or save as a draft to include amounts in payroll.  ·  `src/content/help/payroll-and-tips/tips-daily-entry.md`
- [Configure Tip Pool Settings](/help/configure-tip-pool-settings) — Choose the pooling model, share method, split cadence, role weights, and which employees participate — settings are auto-saved.  ·  `src/content/help/payroll-and-tips/configure-tip-pool-settings.md`
- [Lock Tips for Payroll, Record Cash Payouts, and Review Tip History](/help/lock-tips-for-payroll) — Lock an approved tip period so amounts appear in payroll, record which employees received cash, and review employee tip disputes.  ·  `src/content/help/payroll-and-tips/lock-tips-for-payroll.md`
- [Add and Edit Employees on the Roster](/help/add-edit-employees) — How to add a new employee record, fill in their position, contact details, and hire date, and how to edit any of those details later.  ·  `src/content/help/payroll-and-tips/add-edit-employees.md`
- [Set Compensation Type and Pay Rate for an Employee](/help/employee-compensation-setup) — How to choose between hourly, salary, per-day, and contractor pay types and enter the matching rate or amount when adding or editing an employee.  ·  `src/content/help/payroll-and-tips/employee-compensation-setup.md`
- [Deactivate or Reactivate an Employee](/help/deactivate-reactivate-employee) — How to deactivate an employee when they leave or go on leave — stopping payroll and scheduling access while keeping historical records — and how to bring them back when they return.  ·  `src/content/help/payroll-and-tips/deactivate-reactivate-employee.md`

---

## Scheduling & Time

- [Build, Edit, and Publish the Weekly Schedule](/help/build-publish-weekly-schedule) — Create shifts on the weekly grid, use filters and grouping, copy or import shifts, publish the schedule for staff to see, and undo a publish when corrections are needed.  ·  `src/content/help/scheduling-and-time/build-publish-weekly-schedule.md`
- [Set Up Recurring Shifts and Edit a Shift Series](/help/recurring-shifts) — Create a shift that repeats on a schedule, then edit or delete one occurrence, all future occurrences, or the entire series when plans change.  ·  `src/content/help/scheduling-and-time/recurring-shifts.md`
- [Use the Shift Planner: Templates and AI Schedule Generation](/help/shift-planner-templates-auto-generate) — Define reusable shift templates in the Planner tab, assign employees to templates, and use AI to auto-generate a full week's schedule.  ·  `src/content/help/scheduling-and-time/shift-planner-templates-auto-generate.md`
- [Manage Time-Off Requests and Employee Availability](/help/time-off-availability) — Create and approve time-off requests, set each employee's regular weekly availability, add one-time date exceptions, and handle open-shift claims and shift trades.  ·  `src/content/help/scheduling-and-time/time-off-availability.md`
- [Track and Manage Employee Time Punches](/help/time-punches-manager) — View, manually enter, edit, delete, and export time punch data; manage kiosk mode for PIN-based clock-in; and handle open sessions that need a forced clock-out.  ·  `src/content/help/scheduling-and-time/time-punches-manager.md`

---

## Employee Self-Service

- [Clock In, Start a Break, and Clock Out](/help/employee-time-clock) — Use the Time Clock screen to record when you start and stop working, including the selfie verification step, geofence warnings, and viewing today's punch history.  ·  `src/content/help/employee-self-service/employee-time-clock.md`
- [Using the Shared Kiosk Tablet to Clock In and Out](/help/kiosk-mode-clock-in-out) — Enter your PIN on the shared kiosk device, optionally take a selfie, record clock-ins and clock-outs, and enter end-of-shift tips.  ·  `src/content/help/employee-self-service/kiosk-mode-clock-in-out.md`
- [Setting and Changing Your Kiosk PIN](/help/employee-kiosk-pin) — Generate a new PIN automatically or choose your own numeric PIN for logging in on the shared kiosk tablet.  ·  `src/content/help/employee-self-service/employee-kiosk-pin.md`
- [View Your Timecard and Hours](/help/employee-view-timecard) — Employees can see their own punch history, net hours, break time, regular hours, and overtime for any past or current week directly in the app.  ·  `src/content/help/employee-self-service/employee-view-timecard.md`
- [View Your Pay Estimate for a Pay Period](/help/employee-view-pay) — Employees can review a pay estimate broken down by wages, overtime, and tips for any pay period, and see a warning if any shifts are incomplete before payroll runs.  ·  `src/content/help/employee-self-service/employee-view-pay.md`
- [View Your Tips and Dispute an Allocation](/help/employee-view-tips-and-dispute) — Employees can see how their tips were calculated each day, understand the share method used, view cash payouts, and flag a problem directly to their manager using the built-in dispute tool.  ·  `src/content/help/employee-self-service/employee-view-tips-and-dispute.md`
- [Pick Up or Accept a Shift Trade in the Shift Marketplace](/help/employee-shift-marketplace) — Employees can browse shifts that teammates have offered for trade, see the date, time, position, and reason, then accept a shift in one tap — the manager is notified for final approval.  ·  `src/content/help/employee-self-service/employee-shift-marketplace.md`
- [Set Your Availability and Request Time Off](/help/employee-availability-and-time-off) — Employees can set their regular weekly availability, add one-off date exceptions, and submit or cancel time-off requests — all from the Employee Portal.  ·  `src/content/help/employee-self-service/employee-availability-and-time-off.md`

---

## Settings & Integrations

- [Update Your Restaurant Profile](/help/restaurant-profile-general-settings) — Edit your restaurant's name, address, phone number, cuisine type, and timezone from the General tab in Settings, and configure geofenced clock-in enforcement.  ·  `src/content/help/settings-and-integrations/restaurant-profile-general-settings.md`
- [Add Your Business and Tax Information](/help/business-information-settings) — Enter your legal name, EIN, entity type, and business address in the Business tab so that invoices, checks, and payment setup use the correct details.  ·  `src/content/help/settings-and-integrations/business-information-settings.md`
- [Manage Email Notifications and the Weekly Brief](/help/notification-and-email-preferences) — Control which time-off events send emails, who receives them, and whether you get a Monday morning performance summary.  ·  `src/content/help/settings-and-integrations/notification-and-email-preferences.md`
- [Switch Between Restaurants or Add a New Location](/help/switch-restaurants-add-location) — Use the restaurant picker in the top bar to jump between your locations, or create a new restaurant directly from there.  ·  `src/content/help/settings-and-integrations/switch-restaurants-add-location.md`
- [Set Up Stripe for Payments and Payouts](/help/stripe-financial-account-setup) — Connect your restaurant to Stripe so you can accept customer payments, receive payouts to your bank account, and manage tax registrations — all without leaving EasyShiftHQ.  ·  `src/content/help/settings-and-integrations/stripe-financial-account-setup.md`
- [Use the AI Chef Assistant to Ask Questions About Your Restaurant](/help/ai-chef-assistant) — How to open the Chef Assistant, what kinds of questions it can answer using your actual restaurant data, and how to manage conversation history.  ·  `src/content/help/settings-and-integrations/ai-chef-assistant.md`

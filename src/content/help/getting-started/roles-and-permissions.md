---
title: "Roles and What Each One Can Access"
category: "getting-started"
summary: "A plain-language guide to all eight roles in EasyShiftHQ — what each can see, what is hidden, and how collaborator roles differ from internal team roles."
audience: ["owner", "manager"]
order: 40
keywords: ["roles", "permissions", "owner", "manager", "chef", "staff", "kiosk", "collaborator", "access"]
related: ["manage-team-members", "accept-team-invitation", "restaurant-settings"]
---

# Roles and What Each One Can Access

EasyShiftHQ uses eight distinct roles to control what each person can see and do in your restaurant. This article explains every role — its purpose, what appears in the sidebar, and what stays hidden — so you can assign the right access to the right people.

## Before you begin

Only **Owners** and **Managers** can manage who has which role (invite, change, or remove team members). To open Team Management, click **Team** in the left sidebar under the **Admin** section.

---

## The two types of roles

EasyShiftHQ separates roles into two categories:

- **Internal team roles** — for your full-time and part-time employees (Owner, Manager, Chef, Staff, Kiosk).
- **Collaborator roles** — for outside specialists you invite for a specific purpose, such as your bookkeeper or a recipe consultant. Collaborators only see the narrow set of screens relevant to their work.

---

## Internal team roles

### Owner — Full access to everything

The Owner role has unrestricted access to every screen in EasyShiftHQ, including subscription and billing management, chart-of-accounts editing, all financial data, payroll, banking, and team settings.

**What the Owner sees in the sidebar:**

| Section | Items |
|---|---|
| Main | Dashboard, Integrations, POS Sales, Ops Inbox, Weekly Brief |
| Operations | Scheduling, Time Clock, Tip Pooling, Payroll |
| Inventory | Recipes, Prep Recipes, Inventory, Audit, Purchase Orders, Reports |
| Accounting | Budget & Run Rate, Customers, Invoices, Financial Account, Banks, Expenses, Print Checks, Assets & Equipment, Financial Intelligence, Transactions, Chart of Accounts, Statements |
| Admin | Employees, Team, Settings |

Among internal team roles, the Owner is the only one with Chart of Accounts editing rights — Managers can view it but not change it. Accountant collaborators also have Chart of Accounts edit access. The Owner is the only role with full Settings editing rights, which includes subscription and plan changes.

---

### Manager — Almost identical to Owner, with two key exceptions

Managers can do nearly everything an Owner can: they can run payroll, manage the team, connect integrations, edit scheduling, and access all financial screens. There are two things Managers cannot do:

1. **Edit the Chart of Accounts** — Managers can view it but not change it.
2. **Edit subscription or billing settings** — Managers have view-only access to Settings; plan management is reserved for Owners.

Managers also cannot edit the **Integrations** section — they can view it, but only Owners can change integration settings.

The Manager sidebar is identical to the Owner sidebar listed above.

---

### Chef — Recipes, inventory, and scheduling view (no financial editing)

The Chef role is designed for kitchen leads who need to manage food operations without access to sensitive financial or payroll data.

The Chef sidebar is identical to the Owner and Manager sidebar — all the same sections and links appear. Chef permissions, however, restrict what they can actually do:

**What Chef has permission to do:**

| Section | Items |
|---|---|
| Main | Dashboard, POS Sales |
| Operations | Scheduling (view only — cannot edit shifts) |
| Inventory | Recipes, Prep Recipes, Inventory, Audit, Purchase Orders (view and create only), Reports |

Chefs can create Purchase Orders but cannot approve or pay them. They can view the Scheduling page but cannot make changes to shifts or schedules.

**What Chef does not have permission for:** Running or editing Payroll, managing Tip Pooling, managing Time Clock records, editing Integrations, accessing financial data (Banking, Expenses, Transactions, Statements, Invoices, Customers, Budget, Financial Intelligence, Chart of Accounts), managing the Team roster, or managing Employees.

---

### Staff — Self-service screens only

Staff members are regular employees. When they sign in, they land directly on **Time Clock** and only ever see their own information.

**What Staff can access:**

| Section | Items |
|---|---|
| Employee | Time Clock, My Timecard, My Schedule, My Pay, My Requests |
| Settings | Settings |

Staff cannot see any management screens, financial data, inventory, recipes, or anyone else's information. Their sidebar only shows the **Employee** section.

---

### Kiosk — Clock-in screen only, no sidebar

The Kiosk role is a service account intended for a shared tablet mounted in your restaurant. When a Kiosk account signs in, it goes directly to the kiosk clock-in screen. There is no sidebar and no other navigation — the account exists solely to let employees tap in and out on a shared device.

Kiosk accounts should never be assigned to a personal employee login. See [Using the Shared Kiosk Tablet to Clock In and Out](/help/kiosk-mode-clock-in-out) for setup instructions.

---

## Collaborator roles

Collaborators are invited specialists — people who are not on your internal staff but need limited access to help you run the business. Each collaborator role is scoped tightly to a specific job.

### Accountant collaborator — Financial data only

When you invite an **Accountant** collaborator, they land on **Transactions** and see only the financial sidebar.

**What Accountant collaborators can access:**

| Section | Items |
|---|---|
| Financial | Budget & Run Rate, Transactions, Banks, Expenses, Print Checks, Assets, Invoices, Customers, Chart of Accounts, Statements, Intelligence |
| Payroll | Payroll (view only), Employees (view only) |
| Settings | Settings |

Accountant collaborators can view and edit the Chart of Accounts, which internal Managers cannot. Payroll access is read-only — enough to reconcile books but not to run or change payroll.

**What they cannot see:** Inventory, Recipes, Prep Recipes, Purchase Orders, POS Sales, Scheduling, Time Clock, Tip Pooling, Team management.

---

### Inventory Helper collaborator — Inventory and purchasing only

When you invite an **Inventory Helper** collaborator, they land on **Inventory** and see only inventory-related screens.

**What Inventory Helper collaborators can access:**

| Section | Items |
|---|---|
| Inventory | Inventory, Audit, Purchase Orders, Receipt Import |
| Settings | Settings |

**What they cannot see:** Any financial data, payroll, recipes, scheduling, team management, or POS sales.

---

### Recipe Consultant collaborator (Chef collaborator) — Recipes and read-only inventory

When you invite a **Chef** collaborator, they are shown in your team as **Recipe Consultant**. They land on **Recipes** and can create and edit recipes and prep recipes. They also have read-only access to Inventory so they can reference ingredients.

**What Recipe Consultant collaborators can access:**

| Section | Items |
|---|---|
| Recipes | Recipes, Prep Recipes |
| Inventory | Inventory (view only) |
| Settings | Settings |

**What they cannot see:** Financial data, payroll, team management, POS sales, purchase orders, scheduling, or any cost/margin information. Inventory is view-only — they can see what ingredients exist but cannot make changes.

---

## How the sidebar adapts to your role

EasyShiftHQ adjusts the sidebar to match your role the moment you sign in. Collaborator and Staff roles see a tightly scoped sidebar with only their relevant sections. Owner, Manager, and Chef roles share the same full sidebar layout, with permissions controlling what each role can actually do on each page. There is nothing to configure — the app handles this automatically.

---

## Tips

- **Assign the least access needed.** If someone only manages food, use Chef. If someone only handles the books, invite an Accountant collaborator rather than making them a Manager.
- **Use Kiosk for shared tablets.** Create a dedicated Kiosk account for any clock-in tablet. Do not use a personal staff login on a shared device.
- **Collaborators are isolated.** Accountant, Inventory Helper, and Recipe Consultant collaborators cannot see each other's areas or your team roster (except Accountants, who see employee names for payroll context).
- **Only Owners can change the subscription plan.** If a Manager needs to upgrade the plan, they must ask the Owner.

---

## Troubleshooting

**I don't see "Team" in my sidebar.**
The Team link appears under **Admin** in the sidebar for Owner, Manager, and Chef roles. If you don't see it, your account has a Staff or Collaborator role — those roles use a different, narrower sidebar that does not include Admin links. Contact your Owner to confirm your role.

**A team member says they can't see a screen they need.**
Go to **Team** and check the role shown next to their name. If it is incorrect, change it to a role with the right access. Keep in mind that Managers still cannot edit the Chart of Accounts — only Owners can.

**A collaborator says they see a screen they shouldn't.**
Collaborator access is fixed by role — an Accountant collaborator will always see the Financial and Payroll sections, and nothing else. If the wrong person received an invitation, remove them from the **Collaborators** tab on the **Team** page and re-invite with the correct role.

**Staff member is landing on the wrong screen.**
Staff always land on **Time Clock** when they sign in. If they need schedule or pay information, they can navigate to **My Schedule** or **My Pay** from their sidebar. If they need anything beyond the Employee section, their role needs to be changed by an Owner or Manager.

**Kiosk account shows a sidebar.**
Kiosk accounts should show no sidebar. If a sidebar appears, the account may have been assigned the wrong role. Verify the account's role under **Team > Team Members** and set it to **Kiosk**.

---

## Frequently asked questions

**Can I have more than one Owner?**
Yes. You can assign the Owner role to multiple people. All of them will have full access, including subscription management.

**What is the difference between a Manager and an Accountant collaborator?**
A Manager is an internal employee with broad operational access — they can run payroll, manage the team, and handle scheduling. An Accountant collaborator is an outside specialist who can only see financial screens and has read-only payroll access. Accountant collaborators also gain the ability to edit the Chart of Accounts, which Managers cannot do.

**Can a Chef collaborator (Recipe Consultant) see ingredient costs?**
No. Recipe Consultant collaborators can view the Inventory list to know which ingredients exist, but they cannot see costs, margins, or any financial data.

**Can a Staff member see other employees' timecards or pay?**
No. Staff members only see their own timecard, schedule, and pay. There is no way for them to view another employee's information through the app.

**Where do I go to change someone's role?**
Go to **Team** in the left sidebar. The Team page has three tabs: **Team Members** (internal staff and their roles), **Collaborators** (outside specialists you have invited), and **Invitations** (pending invites that have not yet been accepted). Under **Team Members** you can see every internal team member and change their role. Under **Collaborators** you can remove and re-invite collaborators with a different role.

---

## Related articles

- [Manage Your Team: Invite, Change Roles, Remove, and Add Collaborators](/help/manage-team-members)
- [Accept a Team Invitation](/help/accept-team-invitation)
- [Using the Shared Kiosk Tablet to Clock In and Out](/help/kiosk-mode-clock-in-out)
- [Choose or Change Your Subscription Plan](/help/subscription-plans)
- [Chart of Accounts and Financial Intelligence](/help/chart-of-accounts-and-intelligence)

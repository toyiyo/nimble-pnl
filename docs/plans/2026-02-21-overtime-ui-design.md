# Overtime Management UI Design

**Goal:** Add UI for configuring overtime rules, marking employees exempt, and adjusting overtime classifications — completing the overtime management system.

**Architecture:** Three additions to existing pages (no new routes). Follows established patterns: tab in settings, toggle in employee dialog, button+dialog on payroll table.

---

## 1. Payroll Tab in Restaurant Settings

**File:** `src/pages/RestaurantSettings.tsx`

Add a "Payroll" tab alongside General, Business, Notifications, Security. Contains an "Overtime Rules" card with:

- **Weekly Threshold** — number input, default 40 hours
- **Weekly OT Multiplier** — number input, default 1.5x
- **Daily Threshold** — optional, enabled via toggle. Null = disabled.
- **Daily OT Multiplier** — number input, default 1.5x (visible when daily enabled)
- **Double-Time Threshold** — optional (visible when daily enabled)
- **Double-Time Multiplier** — number input, default 2.0x (visible when double-time enabled)
- **Exclude Tips from OT Rate** — Switch, default on

**Data flow:** Upserts to `overtime_rules` table (one row per restaurant). Only visible to owners/managers.

**Validation:**
- All multipliers > 0
- All thresholds >= 0
- Double-time threshold > daily threshold (when both set)

---

## 2. Exempt Toggle in Employee Dialog

**File:** `src/components/EmployeeDialog.tsx`

Add a Switch labeled "FLSA Exempt (No Overtime)" in the compensation section.

**FLSA salary warning:** When exempt is toggled on, compute annualized pay. If below $35,568/year, show a non-blocking amber banner: "This employee's pay may be below the FLSA exempt threshold ($35,568/year). Consult labor law before classifying as exempt."

**Annualization logic:**
- Hourly: hourly_rate * 2080 (40hr/week * 52 weeks)
- Weekly salary: salary_amount * 52
- Bi-weekly: salary_amount * 26
- Semi-monthly: salary_amount * 24
- Monthly: salary_amount * 12

**Saves:** `is_exempt`, `exempt_changed_at`, `exempt_changed_by` on the employees table.

---

## 3. Adjust OT Dialog on Payroll Page

**Files:** `src/pages/Payroll.tsx`, new `src/components/payroll/AdjustOvertimeDialog.tsx`

Add an "Adjust OT" button in the Actions column for hourly employees with hours. Follows the same pattern as "Add Payment" button.

**Dialog fields:**
- **Direction** — Select: "Regular to Overtime" or "Overtime to Regular"
- **Hours** — number input, validated against available hours in source bucket
- **Date** — date picker, constrained to the current pay period
- **Reason** — text input (optional)

**Data flow:** Inserts into `overtime_adjustments` table. After save, invalidates the payroll query so it recalculates with the new adjustment.

**Validation:**
- Hours > 0
- Hours <= available hours in the source bucket (regular or overtime)
- Date within pay period range

---

## Testing

- Unit tests for OT settings form validation
- Calculation logic already fully tested (37 tests in overtimeCalculations.test.ts)

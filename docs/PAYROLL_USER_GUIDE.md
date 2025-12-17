# Payroll User Guide: Understanding Salary Calculations

> How salaries are calculated and displayed across the system

---

## 🎯 Quick Reference

| Question | Answer | Where You See It |
|----------|--------|------------------|
| When does salary expense hit P&L? | **Daily** (if allocate_daily=true) or **Payday** (if false) | Dashboard > Labor Costs |
| How is daily salary calculated? | `Salary Amount ÷ Days in Pay Period` | Scheduling > Labor Cost Preview |
| Do salaried employees get overtime? | **Only if non-exempt** (currently all treated as exempt) | Payroll Report |
| How are partial weeks handled? | **Prorated by days worked** (hire/termination dates) | Payroll > Period Details |

---

## 💰 Compensation Types

### 1. Hourly Employees
```
Pay = (Regular Hours × Hourly Rate) + (Overtime Hours × Hourly Rate × 1.5)
Overtime = Hours over 40 per week
```

**Dashboard Display:**
- Shows actual hours worked × rate
- Updates in real-time as employees clock in/out
- Overtime automatically calculated weekly

**Scheduling Display:**
- Shows scheduled hours × rate
- Helps predict labor cost before shifts happen

---

### 2. Salaried Employees (Exempt)

**What "Exempt" Means:**
- Employee is **exempt from overtime pay** under FLSA
- Paid the same salary regardless of hours worked
- Typically: managers, professionals earning >$35,568/year

**How Daily Allocation Works:**

```
Weekly Pay Period:
  Salary: $1,000/week
  Daily Rate: $1,000 ÷ 7 days = $142.86/day
  
  Dashboard shows: $142.86 every day
  Payroll shows: $1,000 on payday
```

**Why This Matters:**
- **Accrual Accounting** (allocate_daily=true): Smooth daily P&L
- **Cash Accounting** (allocate_daily=false): Lumpy P&L on paydays

**Example Schedule:**
```
Monday-Sunday: Manager works 50 hours
  ❌ NO overtime pay (exempt)
  ✅ Receives full $1,000 salary
  📊 Dashboard shows $142.86/day all week
```

---

### 3. Salaried Employees (Non-Exempt) ⚠️ NOT YET IMPLEMENTED

**What "Non-Exempt" Means:**
- Employee gets overtime despite being salaried
- Must track hours worked
- Typically: assistant managers, supervisors earning <$35,568/year

**How It Should Work (Future):**
```
Weekly Salary: $700 (40 hours expected)
Hourly Equivalent: $700 ÷ 40 = $17.50/hour

Week with 45 hours:
  Base Salary: $700.00
  Overtime: 5 hours × ($17.50 × 1.5) = $131.25
  Total Pay: $831.25
```

**Current Limitation:**
- System doesn't have `exempt` flag
- All salaried employees treated as exempt
- Non-exempt must be entered as hourly for now

---

### 4. Contractors

**Weekly/Bi-Weekly/Monthly Contractors:**
```
Payment: $700/week
Daily Allocation: $700 ÷ 7 = $100/day

Dashboard shows: $100/day every day
Payroll shows: $700 on payment date
```

**Per-Job Contractors:**
```
Payment: $5,000 per project
Daily Allocation: $0 (doesn't appear daily)

Dashboard shows: $0 daily
Manual Payment: Record $5,000 when job complete
```

---

## 📅 Pay Periods & Proration

### Weekly (7 days)
```
Employee hired Wednesday (5 days in first week):
  Salary: $1,000/week
  Prorated: $1,000 × (5 days / 7 days) = $714.29
```

### Bi-Weekly (14 days)
```
Employee terminated Thursday (11 days worked):
  Salary: $2,000/bi-weekly
  Prorated: $2,000 × (11 days / 14 days) = $1,571.43
```

### Semi-Monthly ⚠️ USES AVERAGE

**Current Behavior:**
```
Period 1 (1st-15th): Always 15 days
Period 2 (16th-end): Varies 13-16 days

System uses: 15.22 average days for BOTH periods

Example $2,500 semi-monthly:
  Daily Rate: $2,500 ÷ 15.22 = $164.26/day
  
  Feb 16-29 (14 days): 14 × $164.26 = $2,299.64 ❌ Should be $2,500
  Jan 16-31 (16 days): 16 × $164.26 = $2,628.16 ❌ Should be $2,500
```

**Why This Happens:**
- Using average simplifies calculations
- Total over a year is correct
- Individual periods can be off by ~8%

**Future Fix:**
- Calculate based on actual period days
- More accurate per period, same annual total

### Monthly (varies 28-31 days)
```
Uses 30.44 average days (365.25 ÷ 12)

Similar issue as semi-monthly:
  February (29 days): Slightly underpaid
  March (31 days): Slightly overpaid
  Annual total: Correct
```

---

## 📊 How It Appears in Each View

### Dashboard - Labor Costs

**Daily P&L:**
```
Date: Jan 15, 2024

Hourly Staff:    $1,450.00  (actual hours worked today)
Salaried (daily): $  428.57  (3 managers × $142.86/day)
Contractors:     $  200.00  (2 contractors × $100/day)
─────────────────────────────
Total Labor:     $2,078.57
```

**Notes:**
- Updates real-time for hourly (as time punches happen)
- Constant for salaried/contractors (spread evenly)
- If allocate_daily=false, salaried shows $0 daily, full amount on payday

---

### Scheduling - Labor Cost Preview

**Scheduled vs Actual:**
```
Week of Jan 15-21, 2024

SCHEDULED (before shifts happen):
  Hourly:   $3,200  (160 hours scheduled)
  Salaried: $3,000  (3 managers)
  Total:    $6,200

ACTUAL (as shifts are worked):
  Hourly:   $3,450  (overtime happened)
  Salaried: $3,000  (same - no overtime)
  Total:    $6,450  ⚠️ $250 over budget
```

**Color Coding (Recommended UI):**
- 🟢 Green: Under budget
- 🟡 Yellow: Within 5% of budget
- 🔴 Red: Over budget

---

### Payroll Report

**Pay Period: Jan 1-14 (Bi-Weekly)**

| Employee | Type | Base | OT | Tips | Total |
|----------|------|------|----|----- |-------|
| John (Manager) | Salary | $2,000 | - | - | $2,000 |
| Jane (Server) | Hourly | $840 | $63 | $450 | $1,353 |
| Bob (Cook) | Hourly | $960 | - | - | $960 |
| Alice (Contractor) | Contract | $1,400 | - | - | $1,400 |

**Footnotes:**
- Salaried: Exempt - no overtime
- Hourly OT: Hours over 40/week × 1.5
- Contractor: Paid per agreement, no OT

---

## 🎓 Understanding Accrual vs Cash Basis

### Accrual Accounting (allocate_daily=true) - RECOMMENDED

**Philosophy:** Expense recognized when earned, not when paid

**Daily P&L:**
```
Every day shows: $142.86 (manager salary / 7 days)
Payday shows: $0 (already recorded daily)
```

**Pros:**
- Smooth, predictable P&L
- Matches revenue to labor cost
- Better for decision-making

**Cons:**
- Doesn't match bank account
- More complex

---

### Cash Accounting (allocate_daily=false)

**Philosophy:** Expense recognized when paid

**Daily P&L:**
```
Mon-Fri shows: $0
Friday (payday): $1,000 (full week salary)
```

**Pros:**
- Matches bank account exactly
- Simpler to understand

**Cons:**
- Spiky P&L (huge expense on paydays)
- Harder to compare daily performance
- Can hide profitability issues

**When to Use:**
- Very small businesses
- Cash flow critical
- Owner wants to match bank statement

---

## 🚨 Common Misunderstandings

### 1. "Why does my salaried manager cost the same on busy days?"

**Answer:** Salaried employees are paid for **availability**, not hours worked. The daily allocation spreads their salary evenly across the pay period for smooth P&L.

**If you need to track salaried hours:**
- Enable `requires_time_punch=true`
- Hours tracked but don't affect pay
- Use for client billing or performance review

---

### 2. "My assistant manager worked 50 hours - where's the OT?"

**Answer:** Check if they're properly classified:
- **Exempt** (>$35,568/year, management duties): No OT
- **Non-Exempt** (<$35,568/year): Should get OT

**Current System:** All salaried = exempt (no OT)

**Workaround:** Enter non-exempt salaried as hourly with 40 hrs/week base

---

### 3. "Semi-monthly payroll doesn't match exactly"

**Answer:** System uses 15.22 average days for both periods, but actual periods vary:
- 1st-15th: Always 15 days
- 16th-end: 13-16 days (depends on month)

**Impact:** Individual periods off by ~8%, annual total correct

**Future:** Will use actual period days for precision

---

### 4. "Dashboard shows different labor cost than payroll"

**Possible Reasons:**
1. **Time Tracking:** Payroll uses actual punches, dashboard may show scheduled
2. **Allocation Method:** If allocate_daily=false, daily dashboard shows $0
3. **Pay Period Boundaries:** Dashboard is daily, payroll is per period
4. **Tips:** Dashboard may not include tips

**How to Match:**
- Compare same date ranges
- Check allocate_daily setting
- Verify tips are included in both

---

## 🔧 Recommended Settings by Business Type

### Small Restaurant (1-2 locations)
```
Compensation Types:
  - Hourly: Servers, cooks, dishwashers
  - Salary (exempt): General manager only
  - Contractor: Cleaning service, maintenance

Settings:
  - allocate_daily: false (cash basis - match bank)
  - Pay Period: bi-weekly (easier for small payroll)
```

### Multi-Location Chain
```
Compensation Types:
  - Hourly: Staff
  - Salary (exempt): GMs, AGMs, corporate staff
  - Salary (non-exempt): Shift leads (use hourly for now)
  - Contractor: Consultants, per-project work

Settings:
  - allocate_daily: true (accrual - better analytics)
  - Pay Period: bi-weekly (standard)
```

---

## 📈 Future Improvements

### High Priority
1. **Add Exempt/Non-Exempt Flag**
   - Legal requirement for proper OT calculation
   - Auto-check against $35,568/year threshold
   - Warning if classification seems wrong

2. **Actual Semi-Monthly Period Days**
   - Calculate 1st-15th separately from 16th-end
   - More accurate per-period allocation
   - Same annual total

3. **Better Dashboard Labels**
   - Show "Allocated" vs "Actual" clearly
   - Explain accrual vs cash in UI
   - Tooltips for each calculation

### Medium Priority
4. **Part-Time Salary Work Schedules**
   - Define expected work days
   - Allocate only on scheduled days
   - Better accuracy for part-time salaried

5. **Per-Job Contractor Tracking**
   - Projects table
   - Link payments to project completion
   - Track WIP (Work in Progress)

### Low Priority
6. **Timezone Support**
   - Store restaurant timezone
   - Handle DST transitions
   - Correct pay period boundaries

---

## 💡 Quick Troubleshooting

### Labor cost seems too high on dashboard
- ✅ Check if overtime is happening (hourly staff)
- ✅ Verify scheduled vs actual hours
- ✅ Make sure allocate_daily=true (if using accrual)

### Payroll total doesn't match expected
- ✅ Check hire/termination dates (proration)
- ✅ Verify pay period boundaries
- ✅ Include tips if applicable
- ✅ Semi-monthly periods vary in length

### Salaried employee shows $0 on dashboard
- ✅ Check allocate_daily setting (should be true)
- ✅ Verify hire_date is before the date you're viewing
- ✅ Check employment status (active vs terminated)

---

## 📞 Support

For questions about:
- **Accounting method:** Talk to your accountant about accrual vs cash
- **FLSA compliance:** Consult employment lawyer for exempt/non-exempt
- **System behavior:** Check this guide or contact support

**Remember:** The system calculates correctly based on settings, but choosing the right settings requires understanding your business needs and legal requirements.

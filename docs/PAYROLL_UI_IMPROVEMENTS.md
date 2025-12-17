# Payroll UI Improvements: Making Calculations Transparent

> How to make salary calculations obvious and understandable across all views

---

## 🎯 Core Principle

**Users should never wonder "where did this number come from?"**

Every labor cost display should:
1. Show the calculation method
2. Link to detailed breakdown
3. Warn about edge cases (proration, overtime, etc.)
4. Use consistent terminology everywhere

---

## 📱 Component-by-Component Improvements

### 1. Employee List/Card - Add Classification Badge

**Current:**
```
John Smith
Manager
$2,000/bi-weekly
```

**Improved:**
```
John Smith
Manager • Exempt Salary
$2,000/bi-weekly → $142.86/day

[?] Exempt: No overtime, paid for availability
```

**Implementation:**
```tsx
<Badge variant="outline" className="gap-1">
  <CheckCircle className="h-3 w-3" />
  Exempt Salary
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className="h-3 w-3 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent>
        <p>Exempt employees are not eligible for overtime pay.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Daily allocation: ${dailyRate}/day for smooth P&L
        </p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</Badge>
```

**Badge Colors:**
- Hourly: Blue
- Exempt Salary: Green
- Non-Exempt Salary: Yellow (when implemented)
- Contractor: Purple

---

### 2. Dashboard - Labor Cost Breakdown

**Current:**
```
Labor Costs Today: $2,078.57
```

**Improved:**
```
Labor Costs - January 15, 2024

Total: $2,078.57  [View Breakdown ▼]

─────────────────────────────────
Hourly Staff (Actual)        $1,450.00
├─ Jane (Server): 8.0 hrs × $15  $120.00
├─ Bob (Cook): 8.5 hrs × $18     $153.00
└─ ... (5 more)                  $1,177.00

Salaried (Allocated)          $428.57  ℹ️
├─ John (GM): $1,000/wk ÷ 7     $142.86
├─ Mary (AGM): $2,000/2wk ÷ 14  $142.86
└─ Tom (Chef): $1,000/wk ÷ 7    $142.86

Contractors (Allocated)       $200.00  ℹ️
├─ Alice: $700/wk ÷ 7           $100.00
└─ Charlie: $700/wk ÷ 7         $100.00

[ℹ️] Allocated = spread evenly across pay period
     Actual on payday may differ (see Payroll)
```

**Tooltip on ℹ️:**
```
Salaried & Contractor Costs

These amounts are "allocated" daily for smooth P&L.

• Accrual Accounting: Expense recognized when earned
• The actual payment happens on payday
• Total for the pay period is exact
• Daily amounts are estimates (salary ÷ days)

Why? Helps you see true daily profitability without 
spikes on paydays.

[Learn more about accrual vs cash accounting]
```

---

### 3. Scheduling - Labor Cost Preview

**Current:**
```
Week Labor Cost: $6,200
```

**Improved:**
```
Week of Jan 15-21 • Labor Cost Forecast

Scheduled: $6,200  (based on planned shifts)
Budget:    $5,800  
Variance:  +$400   🔴 6.9% over

────────────────────────────────────────
Breakdown by Day:

Mon  $850  ├──────────┤ ✓ Under budget
Tue  $920  ├──────────────┤ ⚠️ 5% over  
Wed  $880  ├───────────┤ ✓ On target
Thu  $890  ├───────────┤ ✓ On target
Fri  $950  ├──────────────┤ ⚠️ 8% over
Sat  $960  ├──────────────┤ 🔴 10% over
Sun  $750  ├────────┤ ✓ Under budget

────────────────────────────────────────
Cost by Type:

Hourly (Actual Hours)      $3,200  51.6%
├─ Regular: 160 hrs @ avg $20
└─ Overtime: 10 hrs @ avg $30  ⚠️

Salaried (Always Same)     $3,000  48.4%
├─ 3 managers × $142.86/day × 7 days
└─ No overtime (exempt)  ℹ️

[ℹ️] Salaried costs don't change with hours worked
     All managers are classified as exempt
```

**Interactive Features:**
- Click day to see hourly breakdown
- Hover "overtime" to see which employees
- Click "exempt" to learn about classification

---

### 4. Payroll Report - Detailed Calculation

**Current:**
```
John Smith: $2,000
```

**Improved:**
```
Pay Period: Jan 1-14, 2024 (Bi-Weekly)

────────────────────────────────────────
JOHN SMITH - General Manager
Classification: Exempt Salary  [?]
Pay Period: Bi-Weekly
Base Salary: $2,000.00

Calculation:
  $2,000/period ÷ 14 days = $142.86/day
  14 days worked = $2,000.00 ✓

Hours Tracked: 98.5 hrs  ℹ️
  • Exempt: Hours tracked but don't affect pay
  • No overtime for exempt employees

────────────────────────────────────────
JANE WILLIAMS - Server
Classification: Hourly
Hourly Rate: $15.00

Calculation:
  Regular: 72.0 hrs × $15.00 = $1,080.00
  Overtime: 4.5 hrs × $22.50 = $101.25
  Tips: (from POS)           = $450.00
  ──────────────────────────────────────
  Total:                     = $1,631.25

Hours Breakdown:
  Week 1: 38.0 hrs (no OT)
  Week 2: 42.0 hrs (2.0 hrs OT)  ⚠️
  
────────────────────────────────────────
BOB JOHNSON - Cook  
Classification: Hourly
Hired: Jan 8 (mid-period)  ⚠️
Hourly Rate: $18.00

Calculation (Prorated):
  Days worked: 7 of 14 days
  Regular: 56.0 hrs × $18.00 = $1,008.00
  No overtime
  ──────────────────────────────────────
  Total:                     = $1,008.00

[⚠️] Prorated: Hired mid-period, only paid for 
     days worked (Jan 8-14)
```

**Warnings to Add:**
- 🟡 Mid-period hire/termination
- 🔴 Unusual overtime (>10 hours)
- 🔵 Missing time punches
- 🟣 Exempt classification needs review (salary < $35,568)

---

### 5. Employee Form - Classification Helper

**When Creating/Editing Employee:**

```tsx
<Card>
  <CardHeader>
    <CardTitle>Compensation</CardTitle>
    <CardDescription>
      Choose how this employee is paid
    </CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    
    {/* Compensation Type Selector */}
    <RadioGroup value={compensationType} onValueChange={setCompensationType}>
      
      <div className="flex items-start gap-3 p-4 border rounded-lg">
        <RadioGroupItem value="hourly" />
        <div className="flex-1">
          <Label className="text-base font-semibold">Hourly</Label>
          <p className="text-sm text-muted-foreground">
            Paid by the hour, eligible for overtime (1.5× after 40 hrs/week)
          </p>
          <Badge variant="secondary" className="mt-2">
            Best for: Servers, cooks, dishwashers
          </Badge>
        </div>
      </div>

      <div className="flex items-start gap-3 p-4 border rounded-lg">
        <RadioGroupItem value="salary" />
        <div className="flex-1">
          <Label className="text-base font-semibold">Salaried (Exempt)</Label>
          <p className="text-sm text-muted-foreground">
            Fixed salary, no overtime pay. For managers and professionals.
          </p>
          <Badge variant="secondary" className="mt-2">
            Best for: General managers, executive chefs
          </Badge>
          <Alert className="mt-3">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <strong>Legal requirement:</strong> Must earn ≥$35,568/year 
              and have management duties to be exempt from overtime.
            </AlertDescription>
          </Alert>
        </div>
      </div>

      <div className="flex items-start gap-3 p-4 border rounded-lg opacity-50">
        <RadioGroupItem value="salary-non-exempt" disabled />
        <div className="flex-1">
          <Label className="text-base font-semibold">
            Salaried (Non-Exempt)
            <Badge variant="outline" className="ml-2">Coming Soon</Badge>
          </Label>
          <p className="text-sm text-muted-foreground">
            Fixed salary but eligible for overtime. For assistant managers.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            💡 Workaround: Use "Hourly" with 40 hrs/week base
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 p-4 border rounded-lg">
        <RadioGroupItem value="contractor" />
        <div className="flex-1">
          <Label className="text-base font-semibold">Contractor</Label>
          <p className="text-sm text-muted-foreground">
            Independent contractor, no overtime or benefits
          </p>
          <Badge variant="secondary" className="mt-2">
            Best for: Cleaning service, consultants, per-project work
          </Badge>
        </div>
      </div>
    </RadioGroup>

    {/* Conditional Fields Based on Type */}
    {compensationType === 'salary' && (
      <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
        <div>
          <Label>Salary Amount</Label>
          <Input type="number" />
        </div>
        
        <div>
          <Label>Pay Period</Label>
          <Select>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">
                Weekly (52 payments/year)
              </SelectItem>
              <SelectItem value="bi-weekly">
                Bi-Weekly (26 payments/year) - Most common
              </SelectItem>
              <SelectItem value="semi-monthly">
                Semi-Monthly (24 payments/year) - 1st & 16th
              </SelectItem>
              <SelectItem value="monthly">
                Monthly (12 payments/year)
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Affects daily P&L allocation: salary ÷ days in period
          </p>
        </div>

        <div className="flex items-start gap-2">
          <Checkbox 
            id="allocate_daily" 
            checked={allocateDaily}
            onCheckedChange={setAllocateDaily}
          />
          <div>
            <Label htmlFor="allocate_daily">
              Allocate salary daily (Recommended)
            </Label>
            <p className="text-xs text-muted-foreground">
              Spreads salary across each day for smooth P&L. 
              Uncheck to record expense only on payday (cash basis).
            </p>
          </div>
        </div>

        {/* Salary Calculation Preview */}
        <Alert>
          <Calculator className="h-4 w-4" />
          <AlertTitle>Daily P&L Impact</AlertTitle>
          <AlertDescription className="text-sm">
            {allocateDaily ? (
              <>
                Dashboard will show <strong>${dailyRate}/day</strong>
                <br />
                <span className="text-xs">
                  (${salaryAmount} ÷ {daysInPeriod} days = ${dailyRate}/day)
                </span>
              </>
            ) : (
              <>
                Dashboard shows <strong>$0 daily</strong>, full amount on payday
                <br />
                <span className="text-xs">
                  Cash basis: expense recorded when paid
                </span>
              </>
            )}
          </AlertDescription>
        </Alert>
      </div>
    )}
  </CardContent>
</Card>
```

---

## 🎨 Visual Design Patterns

### Color Coding

**Compensation Type Badges:**
```tsx
const COMP_TYPE_COLORS = {
  hourly: 'bg-blue-100 text-blue-700 border-blue-300',
  salary: 'bg-green-100 text-green-700 border-green-300',
  'salary-non-exempt': 'bg-yellow-100 text-yellow-700 border-yellow-300',
  contractor: 'bg-purple-100 text-purple-700 border-purple-300',
};
```

**Budget Variance:**
```tsx
const VARIANCE_COLORS = {
  under: 'text-green-600',      // Under budget
  onTarget: 'text-blue-600',    // Within 2%
  warning: 'text-yellow-600',   // 2-10% over
  danger: 'text-red-600',       // >10% over
};
```

---

### Icons

**Compensation Types:**
- Hourly: `<Clock className="h-4 w-4" />`
- Salary (Exempt): `<Briefcase className="h-4 w-4" />`
- Salary (Non-Exempt): `<ClipboardList className="h-4 w-4" />`
- Contractor: `<FileText className="h-4 w-4" />`

**Status Indicators:**
- Allocated: `<TrendingUp className="h-4 w-4" />`
- Actual: `<CheckCircle className="h-4 w-4" />`
- Overtime: `<AlertCircle className="h-4 w-4" />`
- Prorated: `<Scissors className="h-4 w-4" />`

---

## 📊 New Components to Build

### 1. `<LaborCostBreakdown />` Component

```tsx
interface LaborCostBreakdownProps {
  date: string;
  hourlyStaff: Array<{
    name: string;
    hours: number;
    rate: number;
    total: number;
  }>;
  salariedStaff: Array<{
    name: string;
    salary: number;
    payPeriod: PayPeriodType;
    dailyRate: number;
  }>;
  contractors: Array<{
    name: string;
    payment: number;
    interval: string;
    dailyRate: number;
  }>;
}

export function LaborCostBreakdown({ date, hourlyStaff, salariedStaff, contractors }: LaborCostBreakdownProps) {
  // Expandable breakdown with calculation details
  // Shows Actual vs Allocated clearly
  // Links to individual employee details
}
```

### 2. `<CompensationCalculator />` Preview

```tsx
// Real-time calculation preview when editing employee
export function CompensationCalculator({ 
  type, 
  amount, 
  period 
}: CompensationCalculatorProps) {
  const dailyRate = calculateDailySalaryAllocation(amount, period);
  const annualCost = calculateAnnualCost(amount, period);
  
  return (
    <Card className="bg-muted/50">
      <CardHeader>
        <CardTitle className="text-sm">Cost Preview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between">
          <span className="text-sm text-muted-foreground">Daily P&L:</span>
          <span className="font-semibold">${(dailyRate / 100).toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-muted-foreground">Annual Cost:</span>
          <span className="font-semibold">${(annualCost / 100).toLocaleString()}</span>
        </div>
        <Separator />
        <p className="text-xs text-muted-foreground">
          Calculation: ${(amount/100).toFixed(2)}/{period} = ${(dailyRate/100).toFixed(2)}/day
        </p>
      </CardContent>
    </Card>
  );
}
```

### 3. `<ExemptClassificationChecker />` Warning

```tsx
export function ExemptClassificationChecker({ 
  salary, 
  payPeriod, 
  jobTitle 
}: ExemptClassificationCheckerProps) {
  const annualSalary = calculateAnnualSalary(salary, payPeriod);
  const isUnderThreshold = annualSalary < 3556800; // $35,568
  
  if (isUnderThreshold) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Possible Misclassification</AlertTitle>
        <AlertDescription>
          Annual salary (${(annualSalary/100).toLocaleString()}) is below 
          the federal exempt threshold ($35,568).
          
          <p className="mt-2 font-semibold">
            This employee may be entitled to overtime pay.
          </p>
          
          <Button variant="outline" size="sm" className="mt-2">
            Learn about exempt vs non-exempt
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  
  return null;
}
```

---

## 🔄 Consistent Terminology

**Use Everywhere:**

| ✅ Use This | ❌ Not This | Context |
|------------|-------------|---------|
| "Allocated" | "Estimated", "Spread" | Salaried/contractor daily costs |
| "Actual" | "Real", "True" | Hourly costs from time punches |
| "Exempt" | "Salaried", "No OT" | FLSA classification |
| "Non-Exempt" | "Gets OT", "Hourly-ish" | FLSA classification |
| "Prorated" | "Partial", "Adjusted" | Mid-period hire/term |
| "Pay Period" | "Cycle", "Schedule" | Weekly/bi-weekly/etc |
| "Accrual" | "Daily allocation" | Accounting method |
| "Cash Basis" | "Pay when paid" | Accounting method |

---

## 📱 Mobile Considerations

**Dashboard on Mobile:**
```
Labor Today: $2,078.57  [▼]

[Tap to expand breakdown]

When expanded:
─────────────────
Hourly      $1,450
Salaried    $  429
Contractors $  200
─────────────────

[Tap row for details]
```

**Keep it simple:**
- Single-column layout
- Collapsible sections
- Bottom sheet for details
- Clear "Allocated" vs "Actual" labels

---

## 🎓 Help Center Integration

**Add Help Links Throughout:**

```tsx
<Button variant="ghost" size="sm" asChild>
  <a href="/help/payroll/accrual-accounting" target="_blank">
    <HelpCircle className="h-4 w-4 mr-1" />
    What is accrual accounting?
  </a>
</Button>
```

**Topics to Create:**
1. "Understanding Exempt vs Non-Exempt Employees"
2. "How Daily Labor Costs Are Calculated"
3. "Why Semi-Monthly Pay Periods Vary"
4. "Accrual vs Cash Basis Accounting"
5. "When to Use Contractors vs Employees"
6. "How Proration Works for Mid-Period Hires"

---

## ✅ Implementation Checklist

### Phase 1: Critical (Do First)
- [ ] Add compensation type badges to employee cards
- [ ] Add calculation tooltips to dashboard labor costs
- [ ] Show "Allocated" vs "Actual" labels clearly
- [ ] Add exempt classification checker to employee form
- [ ] Create PAYROLL_USER_GUIDE.md (done ✓)

### Phase 2: Important (Do Next)
- [ ] Build `<LaborCostBreakdown />` component
- [ ] Add pay period explanation to payroll report
- [ ] Show daily rate preview in employee form
- [ ] Add proration warnings for mid-period hires/terms
- [ ] Create help center articles

### Phase 3: Nice to Have
- [ ] Build `<CompensationCalculator />` preview
- [ ] Add overtime warnings in scheduling
- [ ] Color-code budget variance
- [ ] Mobile-optimized breakdowns
- [ ] Export calculation details to CSV

---

## 🎯 Success Metrics

**You'll know it's working when:**
1. Support tickets about "where did this number come from?" drop to near zero
2. Users correctly understand exempt vs non-exempt without asking
3. No confusion about why salaried costs are "the same every day"
4. Accountants approve the accrual vs cash basis handling
5. Users can explain to new staff how payroll calculations work

**User Testing Questions:**
- "Why does this manager cost $142.86 today?"
- "What happens if a salaried employee works overtime?"
- "Why is this period's payroll different from last period?"
- "When does the expense hit my P&L?"

If users can answer these without help, the UI is clear enough.

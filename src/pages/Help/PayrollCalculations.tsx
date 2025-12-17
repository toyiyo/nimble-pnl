/**
 * User-Facing Help Page: How Payroll Is Calculated
 * 
 * Accessible from dashboard tooltips and employee management screens
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Calculator,
  Clock,
  Briefcase,
  FileText,
  CheckCircle,
  AlertCircle,
  HelpCircle,
  DollarSign,
  Calendar,
  TrendingUp,
} from 'lucide-react';

export default function PayrollCalculationsHelp() {
  return (
    <div className="container max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Understanding Payroll Calculations</h1>
        <p className="text-muted-foreground">
          How your labor costs are calculated and displayed across the system
        </p>
      </div>

      {/* Quick Reference */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Quick Reference
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-sm font-semibold">When does salary expense appear?</p>
              <p className="text-sm text-muted-foreground">
                Daily (if "Allocate Daily" is on) or on Payday (if off)
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">How is daily salary calculated?</p>
              <p className="text-sm text-muted-foreground">
                Salary Amount ÷ Days in Pay Period
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">Do salaried employees get overtime?</p>
              <p className="text-sm text-muted-foreground">
                Only if classified as "Non-Exempt" (currently all are Exempt)
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">How are partial weeks handled?</p>
              <p className="text-sm text-muted-foreground">
                Prorated by days worked (based on hire/termination dates)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
      <Tabs defaultValue="types" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="types">
            <span className="hidden sm:inline">Compensation </span>Types
          </TabsTrigger>
          <TabsTrigger value="periods">
            <span className="hidden sm:inline">Pay </span>Periods
          </TabsTrigger>
          <TabsTrigger value="views">Where to See It</TabsTrigger>
          <TabsTrigger value="faq">
            <span className="hidden sm:inline">Common </span>Questions
          </TabsTrigger>
        </TabsList>

        {/* Compensation Types Tab */}
        <TabsContent value="types" className="space-y-4">
          {/* Hourly */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-blue-600" />
                <div>
                  <CardTitle>Hourly Employees</CardTitle>
                  <CardDescription>Paid by the hour, eligible for overtime</CardDescription>
                </div>
                <Badge variant="outline" className="ml-auto bg-blue-50 text-blue-700 border-blue-300">
                  Hourly
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-muted p-4 font-mono text-sm">
                <p>Pay = (Regular Hours × Rate) + (OT Hours × Rate × 1.5)</p>
                <p className="text-muted-foreground mt-1">Overtime = Hours over 40 per week</p>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-sm">Dashboard Display:</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Shows actual hours worked × rate</li>
                  <li>Updates in real-time as employees clock in/out</li>
                  <li>Overtime automatically calculated weekly</li>
                </ul>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-sm">Example:</p>
                <div className="rounded-lg border p-3 space-y-1 text-sm">
                  <p>Server works 45 hours at $15/hour</p>
                  <p className="text-muted-foreground">
                    • Regular: 40 hrs × $15 = $600.00
                  </p>
                  <p className="text-muted-foreground">
                    • Overtime: 5 hrs × $22.50 (1.5×) = $112.50
                  </p>
                  <p className="font-semibold">• Total: $712.50</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Salaried (Exempt) */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Briefcase className="h-5 w-5 text-green-600" />
                <div>
                  <CardTitle>Salaried Employees (Exempt)</CardTitle>
                  <CardDescription>Fixed salary, no overtime - for managers</CardDescription>
                </div>
                <Badge variant="outline" className="ml-auto bg-green-50 text-green-700 border-green-300">
                  Exempt
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>What "Exempt" Means</AlertTitle>
                <AlertDescription className="text-sm">
                  Employee is <strong>exempt from overtime pay</strong> under federal law (FLSA).
                  Paid the same salary regardless of hours worked. Typically managers,
                  professionals earning ≥$35,568/year.
                </AlertDescription>
              </Alert>

              <div className="rounded-lg bg-muted p-4 space-y-2">
                <p className="font-semibold text-sm">How Daily Allocation Works:</p>
                <div className="font-mono text-sm space-y-1">
                  <p>Weekly Salary: $1,000</p>
                  <p className="text-muted-foreground">Daily Rate: $1,000 ÷ 7 days = $142.86/day</p>
                  <Separator className="my-2" />
                  <p className="text-muted-foreground">Dashboard shows: $142.86 every day</p>
                  <p className="text-muted-foreground">Payroll shows: $1,000 on payday</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-sm">Example Schedule:</p>
                <div className="rounded-lg border p-3 space-y-2 text-sm">
                  <p>Manager works 50 hours in one week</p>
                  <div className="flex items-start gap-2">
                    <span className="text-red-500">❌</span>
                    <span className="text-muted-foreground">NO overtime pay (exempt)</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-green-500">✅</span>
                    <span className="text-muted-foreground">Receives full $1,000 salary</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span>📊</span>
                    <span className="text-muted-foreground">Dashboard shows $142.86/day all week</span>
                  </div>
                </div>
              </div>

              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Non-Exempt Not Yet Supported</AlertTitle>
                <AlertDescription className="text-sm">
                  <p>
                    Some salaried employees ARE entitled to overtime (non-exempt), typically
                    earning less than $35,568/year.
                  </p>
                  <p className="mt-2 font-semibold">
                    Workaround: Enter these employees as "Hourly" with 40 hrs/week base.
                  </p>
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Contractors */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-purple-600" />
                <div>
                  <CardTitle>Contractors</CardTitle>
                  <CardDescription>Independent contractors, no overtime</CardDescription>
                </div>
                <Badge variant="outline" className="ml-auto bg-purple-50 text-purple-700 border-purple-300">
                  Contractor
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-muted p-4 space-y-2">
                <p className="font-semibold text-sm">Weekly/Monthly Contractors:</p>
                <div className="font-mono text-sm space-y-1">
                  <p>Payment: $700/week</p>
                  <p className="text-muted-foreground">Daily Allocation: $700 ÷ 7 = $100/day</p>
                  <Separator className="my-2" />
                  <p className="text-muted-foreground">Dashboard: $100/day every day</p>
                  <p className="text-muted-foreground">Payroll: $700 on payment date</p>
                </div>
              </div>

              <div className="rounded-lg bg-muted p-4 space-y-2">
                <p className="font-semibold text-sm">Per-Job Contractors:</p>
                <div className="font-mono text-sm space-y-1">
                  <p>Payment: $5,000 per project</p>
                  <p className="text-muted-foreground">Daily Allocation: $0 (doesn't appear daily)</p>
                  <Separator className="my-2" />
                  <p className="text-muted-foreground">Dashboard: $0 daily</p>
                  <p className="text-muted-foreground">Record manually when job completes</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pay Periods Tab */}
        <TabsContent value="periods" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-primary" />
                <CardTitle>Pay Periods & Proration</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Weekly */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge>Weekly</Badge>
                  <span className="text-sm text-muted-foreground">7 days</span>
                </div>
                <div className="rounded-lg border p-3 space-y-1 text-sm">
                  <p className="font-semibold">Employee hired Wednesday (5 days in first week)</p>
                  <p className="text-muted-foreground">Salary: $1,000/week</p>
                  <p className="text-muted-foreground">Prorated: $1,000 × (5 days ÷ 7 days) = $714.29</p>
                </div>
              </div>

              {/* Bi-Weekly */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge>Bi-Weekly</Badge>
                  <span className="text-sm text-muted-foreground">14 days</span>
                </div>
                <div className="rounded-lg border p-3 space-y-1 text-sm">
                  <p className="font-semibold">Employee terminated Thursday (11 days worked)</p>
                  <p className="text-muted-foreground">Salary: $2,000/bi-weekly</p>
                  <p className="text-muted-foreground">Prorated: $2,000 × (11 days ÷ 14 days) = $1,571.43</p>
                </div>
              </div>

              {/* Semi-Monthly with Warning */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge>Semi-Monthly</Badge>
                  <span className="text-sm text-muted-foreground">15.22 days (average)</span>
                  <HelpCircle className="h-4 w-4 text-yellow-600" />
                </div>
                
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Uses Average Days</AlertTitle>
                  <AlertDescription className="text-sm space-y-2">
                    <p>
                      <strong>Period 1 (1st-15th):</strong> Always 15 days
                      <br />
                      <strong>Period 2 (16th-end):</strong> Varies 13-16 days (depends on month)
                    </p>
                    <p>
                      System currently uses <strong>15.22 average days</strong> for both periods.
                    </p>
                    <div className="mt-2 rounded-lg bg-yellow-50 border border-yellow-200 p-2">
                      <p className="text-xs font-semibold">Example with $2,500 semi-monthly:</p>
                      <p className="text-xs">• Feb 16-29 (14 days): Shows $2,299.64 ❌ (should be $2,500)</p>
                      <p className="text-xs">• Jan 16-31 (16 days): Shows $2,628.16 ❌ (should be $2,500)</p>
                      <p className="text-xs mt-1">✅ Annual total is correct, individual periods vary ±8%</p>
                    </div>
                  </AlertDescription>
                </Alert>
              </div>

              {/* Monthly */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge>Monthly</Badge>
                  <span className="text-sm text-muted-foreground">30.44 days (average)</span>
                </div>
                <div className="rounded-lg border p-3 space-y-1 text-sm">
                  <p className="text-muted-foreground">
                    Similar to semi-monthly: uses average instead of actual days
                  </p>
                  <p className="text-muted-foreground">• February (29 days): Slightly underpaid</p>
                  <p className="text-muted-foreground">• March (31 days): Slightly overpaid</p>
                  <p className="text-muted-foreground">• Annual total: Correct</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Where to See It Tab */}
        <TabsContent value="views" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <TrendingUp className="h-5 w-5 text-primary" />
                <CardTitle>Dashboard - Labor Costs</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-muted p-4 font-mono text-sm space-y-1">
                <p className="font-semibold">Date: January 15, 2024</p>
                <Separator className="my-2" />
                <div className="space-y-1">
                  <p>Hourly Staff:    $1,450.00  (actual hours worked)</p>
                  <p>Salaried (daily): $  428.57  (3 managers × $142.86/day)</p>
                  <p>Contractors:     $  200.00  (2 contractors × $100/day)</p>
                  <Separator className="my-2" />
                  <p className="font-semibold">Total Labor:     $2,078.57</p>
                </div>
              </div>

              <Alert>
                <HelpCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  <strong>Updates real-time</strong> for hourly (as time punches happen)
                  <br />
                  <strong>Constant</strong> for salaried/contractors (spread evenly)
                  <br />
                  <span className="text-xs mt-1 block">
                    If "Allocate Daily" is off, salaried shows $0 daily and full amount on payday
                  </span>
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-primary" />
                <CardTitle>Scheduling - Labor Cost Preview</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-muted p-4 font-mono text-sm space-y-1">
                <p className="font-semibold">Week of Jan 15-21, 2024</p>
                <Separator className="my-2" />
                <div className="space-y-2">
                  <div>
                    <p className="text-muted-foreground">SCHEDULED (before shifts happen):</p>
                    <p>Hourly:   $3,200  (160 hours scheduled)</p>
                    <p>Salaried: $3,000  (3 managers)</p>
                    <p>Total:    $6,200</p>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-muted-foreground">ACTUAL (as shifts are worked):</p>
                    <p>Hourly:   $3,450  (overtime happened)</p>
                    <p>Salaried: $3,000  (same - no overtime)</p>
                    <p className="text-red-600 font-semibold">Total:    $6,450  ⚠️ $250 over budget</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <DollarSign className="h-5 w-5 text-primary" />
                <CardTitle>Payroll Report</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-2">Employee</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-right p-2">Base</th>
                      <th className="text-right p-2">OT</th>
                      <th className="text-right p-2">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <tr>
                      <td className="p-2">John (Manager)</td>
                      <td className="p-2">
                        <Badge variant="outline" className="text-xs">Exempt</Badge>
                      </td>
                      <td className="text-right p-2">$2,000</td>
                      <td className="text-right p-2 text-muted-foreground">—</td>
                      <td className="text-right p-2 font-semibold">$2,000</td>
                    </tr>
                    <tr>
                      <td className="p-2">Jane (Server)</td>
                      <td className="p-2">
                        <Badge variant="outline" className="text-xs">Hourly</Badge>
                      </td>
                      <td className="text-right p-2">$840</td>
                      <td className="text-right p-2">$63</td>
                      <td className="text-right p-2 font-semibold">$903</td>
                    </tr>
                    <tr>
                      <td className="p-2">Alice (Contract)</td>
                      <td className="p-2">
                        <Badge variant="outline" className="text-xs">Contractor</Badge>
                      </td>
                      <td className="text-right p-2">$1,400</td>
                      <td className="text-right p-2 text-muted-foreground">—</td>
                      <td className="text-right p-2 font-semibold">$1,400</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Footnotes: Exempt = no overtime • Hourly OT = hours over 40/week × 1.5 • Contractor = paid per agreement
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* FAQ Tab */}
        <TabsContent value="faq" className="space-y-4">
          {/* Question 1 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Why does my salaried manager cost the same on busy days?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Salaried employees are paid for <strong>availability</strong>, not hours worked.
                The daily allocation spreads their salary evenly across the pay period for smooth P&L.
              </p>
              <Alert>
                <HelpCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  <strong>If you need to track salaried hours:</strong>
                  <br />• Enable "Requires Time Punch" for the employee
                  <br />• Hours tracked but don't affect pay
                  <br />• Use for client billing or performance review
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Question 2 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                My assistant manager worked 50 hours - where's the OT?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Check if they're properly classified:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground ml-2">
                <li><strong>Exempt</strong> (&gt;$35,568/year, management duties): No OT</li>
                <li><strong>Non-Exempt</strong> (&lt;$35,568/year): Should get OT</li>
              </ul>
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  <strong>Current System:</strong> All salaried = exempt (no OT)
                  <br />
                  <strong>Workaround:</strong> Enter non-exempt salaried as hourly with 40 hrs/week base
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Question 3 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Semi-monthly payroll doesn't match exactly
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                System uses <strong>15.22 average days</strong> for both periods, but actual periods vary:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground ml-2">
                <li>1st-15th: Always 15 days</li>
                <li>16th-end: 13-16 days (depends on month)</li>
              </ul>
              <p className="text-sm font-semibold mt-2">
                Impact: Individual periods off by ~8%, annual total correct
              </p>
            </CardContent>
          </Card>

          {/* Question 4 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Dashboard shows different labor cost than payroll
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm font-semibold">Possible Reasons:</p>
              <ul className="list-decimal list-inside space-y-2 text-sm text-muted-foreground ml-2">
                <li>
                  <strong>Time Tracking:</strong> Payroll uses actual punches, dashboard may show scheduled
                </li>
                <li>
                  <strong>Allocation Method:</strong> If "Allocate Daily" is off, dashboard shows $0
                </li>
                <li>
                  <strong>Pay Period Boundaries:</strong> Dashboard is daily, payroll is per period
                </li>
                <li>
                  <strong>Tips:</strong> Dashboard may not include tips
                </li>
              </ul>
              <Alert className="mt-3">
                <CheckCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  <strong>How to Match:</strong>
                  <br />• Compare same date ranges
                  <br />• Check "Allocate Daily" setting
                  <br />• Verify tips are included in both
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <Card className="bg-gradient-to-r from-primary/5 to-accent/5 border-primary/10">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <HelpCircle className="h-5 w-5 text-primary mt-0.5" />
            <div className="space-y-2">
              <p className="font-semibold">Need More Help?</p>
              <p className="text-sm text-muted-foreground">
                For questions about accounting methods, talk to your accountant about accrual vs cash.
                For FLSA compliance, consult an employment lawyer for exempt/non-exempt classification.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

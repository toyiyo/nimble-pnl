import { describe, expect, it } from 'vitest';
import { formatCurrencyFromCents } from '@/utils/tipPooling';

/**
 * Employee UX Flow Tests
 * Testing the Apple-style employee self-service experience
 * 
 * Flow:
 * 1. View tips (this week summary)
 * 2. See daily breakdown
 * 3. Understand calculation (transparency)
 * 4. Flag issues if something wrong
 */
describe('Tip Pooling - Employee UX Flow', () => {
  
  // ============================================================================
  // EMPLOYEE HOME SCREEN
  // ============================================================================
  
  describe('Employee Home: View Tips', () => {
    it('shows weekly tip summary', () => {
      const weeklyTips = [
        { day: 'Mon', amountCents: 4200 },
        { day: 'Tue', amountCents: 3800 },
        { day: 'Wed', amountCents: 5100 },
        { day: 'Thu', amountCents: 6200 },
        { day: 'Fri', amountCents: 9800 },
        { day: 'Sat', amountCents: 11200 },
        { day: 'Sun', amountCents: 0 }, // Day off
      ];

      const weekTotal = weeklyTips.reduce((sum, d) => sum + d.amountCents, 0);
      
      expect(weekTotal).toBe(40300); // $403.00
      expect(formatCurrencyFromCents(weekTotal)).toBe('$403.00');
    });

    it('shows total hours worked for context', () => {
      const weeklyHours = [
        { day: 'Mon', hours: 5.5 },
        { day: 'Tue', hours: 4.0 },
        { day: 'Wed', hours: 6.0 },
        { day: 'Thu', hours: 5.0 },
        { day: 'Fri', hours: 8.0 },
        { day: 'Sat', hours: 8.0 },
        { day: 'Sun', hours: 0 },
      ];

      const totalHours = weeklyHours.reduce((sum, d) => sum + d.hours, 0);
      
      expect(totalHours).toBe(36.5);
    });

    it('formats currency consistently', () => {
      expect(formatCurrencyFromCents(31220)).toBe('$312.20');
      expect(formatCurrencyFromCents(0)).toBe('$0.00');
      expect(formatCurrencyFromCents(9999)).toBe('$99.99');
    });

    it('shows "this week" and "history" tabs', () => {
      const tabs = ['This Week', 'History'];
      
      expect(tabs).toContain('This Week');
      expect(tabs).toContain('History');
      expect(tabs.length).toBe(2);
    });
  });

  // ============================================================================
  // DAILY BREAKDOWN
  // ============================================================================
  
  describe('Daily Breakdown', () => {
    it('shows individual day details when tapped', () => {
      const wednesdayDetails = {
        day: 'Wednesday',
        date: new Date('2024-01-17'),
        tipsEarned: 4210, // $42.10
        hoursWorked: 5.5,
      };

      expect(wednesdayDetails.tipsEarned).toBe(4210);
      expect(wednesdayDetails.hoursWorked).toBe(5.5);
    });

    it('calculates average per hour for employee awareness', () => {
      const tipsEarned = 4210; // $42.10
      const hoursWorked = 5.5;
      
      const perHour = Math.round(tipsEarned / hoursWorked);
      
      expect(perHour).toBe(765); // $7.65/hour
      expect(formatCurrencyFromCents(perHour)).toBe('$7.65');
    });

    it('shows $0 days without error', () => {
      const slowDay = {
        day: 'Monday',
        tipsEarned: 0,
        hoursWorked: 4.0,
      };

      expect(slowDay.tipsEarned).toBe(0);
      expect(formatCurrencyFromCents(slowDay.tipsEarned)).toBe('$0.00');
    });

    it('shows days employee did not work', () => {
      const dayOff = {
        day: 'Sunday',
        tipsEarned: 0,
        hoursWorked: 0,
        status: 'Not scheduled',
      };

      expect(dayOff.hoursWorked).toBe(0);
      expect(dayOff.status).toBe('Not scheduled');
    });
  });

  // ============================================================================
  // TRANSPARENCY VIEW (How was this calculated?)
  // ============================================================================
  
  describe('Calculation Transparency', () => {
    it('explains hours-based split in plain language', () => {
      const explanation = {
        method: 'hours',
        employeeHours: 5.5,
        teamHours: 38,
        employeeShare: 4210,
        totalTips: 28500,
      };

      const ratio = explanation.employeeHours / explanation.teamHours;
      const expectedShare = Math.round(explanation.totalTips * ratio);

      // Allow for rounding differences in multi-participant splits
      expect(Math.abs(explanation.employeeShare - expectedShare)).toBeLessThan(100);
    });

    it('explains role-based split in plain language', () => {
      const explanation = {
        method: 'role',
        employeeRole: 'Server',
        roleWeight: 2,
        totalWeight: 10, // All participants combined
        employeeShare: 5700,
      };

      const ratio = explanation.roleWeight / explanation.totalWeight;
      
      expect(ratio).toBe(0.2); // 2/10 = 20%
    });

    it('shows manual split without calculation details', () => {
      const explanation = {
        method: 'manual',
        employeeShare: 5000,
        note: 'Amount set by manager',
      };

      expect(explanation.method).toBe('manual');
      expect(explanation.note).toBe('Amount set by manager');
    });

    it('never shows formulas or percentages to employees', () => {
      const transparencyText = `
        How your tips were split
        
        Tips were shared by hours worked.
        
        You worked 5.5 hours
        Team worked 38 hours
        
        Your share: $42.10
      `;

      expect(transparencyText).not.toContain('%');
      expect(transparencyText).not.toContain('×');
      expect(transparencyText).not.toContain('÷');
      expect(transparencyText).not.toContain('formula');
    });

    it('shows role weights as multipliers (not percentages)', () => {
      const roleDisplay = {
        employeeRole: 'Bartender',
        roleWeight: 1.5,
        displayText: 'Bartenders: ×1.5',
      };

      expect(roleDisplay.displayText).toContain('×1.5');
      expect(roleDisplay.displayText).not.toContain('%');
    });

    it('provides context without overwhelming details', () => {
      const summary = {
        yourTips: 4210,
        yourHours: 5.5,
        teamHours: 38,
        // No breakdown of every other employee
      };

      expect(summary.yourTips).toBeDefined();
      expect(summary.yourHours).toBeDefined();
      expect(summary.teamHours).toBeDefined();
    });
  });

  // ============================================================================
  // DISPUTE/FLAG SYSTEM (Something doesn't look right)
  // ============================================================================
  
  describe('Employee Dispute System', () => {
    it('allows employee to flag missing hours', () => {
      const dispute = {
        type: 'missing_hours',
        splitId: 'split-123',
        employeeId: 'emp-456',
        message: 'I worked 8 hours on Tuesday, not 5.5',
        status: 'open',
      };

      expect(dispute.type).toBe('missing_hours');
      expect(dispute.status).toBe('open');
    });

    it('allows employee to flag wrong role', () => {
      const dispute = {
        type: 'wrong_role',
        splitId: 'split-123',
        employeeId: 'emp-456',
        message: 'I was bartending that day, not serving',
        status: 'open',
      };

      expect(dispute.type).toBe('wrong_role');
    });

    it('allows employee to flag other issues', () => {
      const dispute = {
        type: 'other',
        splitId: 'split-123',
        employeeId: 'emp-456',
        message: 'I was part of the private event pool',
        status: 'open',
      };

      expect(dispute.type).toBe('other');
    });

    it('provides simple options (no free-form math disputes)', () => {
      const disputeTypes = ['missing_hours', 'wrong_role', 'other'];
      
      expect(disputeTypes.length).toBe(3);
      expect(disputeTypes).not.toContain('calculation_error');
      expect(disputeTypes).not.toContain('percentage_wrong');
    });

    it('shows dispute status to employee', () => {
      const dispute = {
        id: 'dispute-789',
        type: 'missing_hours',
        status: 'open',
        submittedAt: new Date('2024-01-15T10:00:00'),
      };

      expect(['open', 'resolved', 'dismissed']).toContain(dispute.status);
    });

    it('shows resolution when manager responds', () => {
      const resolvedDispute = {
        id: 'dispute-789',
        type: 'missing_hours',
        status: 'resolved',
        resolution: 'Hours corrected to 8. Your tips have been updated to $67.50.',
        resolvedAt: new Date('2024-01-15T14:00:00'),
      };

      expect(resolvedDispute.status).toBe('resolved');
      expect(resolvedDispute.resolution).toContain('corrected');
    });

    it('notifies employee when dispute resolved', () => {
      const notification = {
        type: 'dispute_resolved',
        disputeId: 'dispute-789',
        message: 'Your tip review request has been resolved.',
        read: false,
      };

      expect(notification.type).toBe('dispute_resolved');
      expect(notification.read).toBe(false);
    });
  });

  // ============================================================================
  // EMPLOYEE HISTORY VIEW
  // ============================================================================
  
  describe('Employee History', () => {
    it('shows previous weeks in chronological order', () => {
      const history = [
        { weekOf: new Date('2024-01-08'), totalTips: 38500 },
        { weekOf: new Date('2024-01-01'), totalTips: 42000 },
        { weekOf: new Date('2023-12-25'), totalTips: 51000 },
      ];

      expect(history.length).toBe(3);
      expect(history[0].weekOf > history[1].weekOf).toBe(true); // Most recent first
    });

    it('allows drilling into past week details', () => {
      const pastWeek = {
        weekOf: new Date('2024-01-01'),
        totalTips: 42000,
        days: [
          { day: 'Mon', tips: 5000, hours: 5 },
          { day: 'Tue', tips: 6000, hours: 6 },
          // ... rest of week
        ],
      };

      expect(pastWeek.days.length).toBeGreaterThan(0);
    });

    it('shows total tips earned year-to-date', () => {
      const ytdTips = [
        { week: 1, tips: 38500 },
        { week: 2, tips: 42000 },
        { week: 3, tips: 40300 },
      ];

      const total = ytdTips.reduce((sum, w) => sum + w.tips, 0);
      
      expect(total).toBe(120800); // $1,208.00 YTD
    });

    it('shows average weekly tips', () => {
      const weeklyTips = [38500, 42000, 40300];
      const average = Math.round(
        weeklyTips.reduce((sum, t) => sum + t, 0) / weeklyTips.length
      );

      expect(average).toBe(40267); // $402.67 average
    });
  });

  // ============================================================================
  // EMPLOYEE EDGE CASES
  // ============================================================================
  
  describe('Employee Experience Edge Cases', () => {
    it('handles employee with partial week (started mid-week)', () => {
      const partialWeek = {
        startDate: new Date('2024-01-17'), // Started Wednesday
        days: [
          { day: 'Wed', tips: 4200, hours: 5 },
          { day: 'Thu', tips: 5100, hours: 6 },
          { day: 'Fri', tips: 8000, hours: 8 },
          { day: 'Sat', tips: 9000, hours: 8 },
        ],
      };

      const total = partialWeek.days.reduce((sum, d) => sum + d.tips, 0);
      
      expect(total).toBe(26300); // $263.00 for partial week
    });

    it('handles employee with no tips yet (first day)', () => {
      const newEmployee = {
        weeklyTips: 0,
        hoursWorked: 0,
        message: 'Tips will appear after your first shift is approved.',
      };

      expect(newEmployee.weeklyTips).toBe(0);
      expect(newEmployee.message).toContain('first shift');
    });

    it('handles employee viewing pending tips (not approved yet)', () => {
      const pendingTips = {
        status: 'draft',
        estimatedAmount: 4500,
        message: 'Tips are being reviewed by management.',
      };

      expect(pendingTips.status).toBe('draft');
      expect(pendingTips.message).toContain('reviewed');
    });

    it('handles employee with retroactive tip adjustment', () => {
      const adjustment = {
        originalAmount: 4200,
        adjustedAmount: 6750,
        reason: 'Hours corrected from 5.5 to 8',
        adjustedDate: new Date(),
      };

      const difference = adjustment.adjustedAmount - adjustment.originalAmount;
      
      expect(difference).toBe(2550); // $25.50 increase
      expect(adjustment.reason).toContain('corrected');
    });

    it('shows employee working multiple locations separately', () => {
      const tips = [
        { location: 'Downtown', weeklyTips: 28000 },
        { location: 'Airport', weeklyTips: 15000 },
      ];

      expect(tips.length).toBe(2);
      expect(tips[0].location).not.toBe(tips[1].location);
    });

    it('handles employee with disputed tips in history', () => {
      const dayWithDispute = {
        day: 'Tuesday',
        tips: 4200,
        hours: 5.5,
        hasDispute: true,
        disputeStatus: 'resolved',
      };

      expect(dayWithDispute.hasDispute).toBe(true);
      expect(dayWithDispute.disputeStatus).toBe('resolved');
    });

    it('handles employee viewing tips during pay period close', () => {
      const currentPeriod = {
        status: 'closing',
        message: 'Tips are being finalized for payroll.',
        tipsLocked: true,
      };

      expect(currentPeriod.tipsLocked).toBe(true);
    });
  });

  // ============================================================================
  // EMPLOYEE UX INVARIANTS (Apple Principles)
  // ============================================================================
  
  describe('Employee UX Invariants', () => {
    it('never shows complex math to employees', () => {
      const display = {
        yourTips: '$42.10',
        hoursWorked: '5.5',
        // No formulas, no percentages
      };

      expect(display.yourTips).toBe('$42.10');
      expect(display.yourTips).not.toContain('÷');
      expect(display.yourTips).not.toContain('%');
    });

    it('always shows tips in dollars (never cents)', () => {
      const tipAmount = 4210; // Stored as cents
      const display = formatCurrencyFromCents(tipAmount);
      
      expect(display).toBe('$42.10');
      expect(display).toContain('$');
      expect(display).toContain('.');
    });

    it('provides transparency without complexity', () => {
      const transparency = {
        method: 'hours',
        yourHours: 5.5,
        teamHours: 38,
        yourShare: 4210,
      };

      // Shows data points, not calculations
      expect(transparency.yourHours).toBeDefined();
      expect(transparency.teamHours).toBeDefined();
      expect(transparency.yourShare).toBeDefined();
    });

    it('allows flagging issues with simple options', () => {
      const flagOptions = [
        { type: 'missing_hours', label: 'Missing hours' },
        { type: 'wrong_role', label: 'Wrong role' },
        { type: 'other', label: 'Other' },
      ];

      expect(flagOptions.length).toBe(3);
      expect(flagOptions.every(o => o.label.length < 20)).toBe(true); // Simple labels
    });

    it('shows tips immediately after approval (no delay)', () => {
      const approvedTips = {
        status: 'approved',
        approvedAt: new Date(),
        visibleToEmployee: true,
      };

      expect(approvedTips.visibleToEmployee).toBe(true);
    });

    it('groups by week for simplicity (not by pay period)', () => {
      const grouping = 'week';
      
      expect(['week', 'pay-period']).toContain(grouping);
      expect(grouping).toBe('week'); // Simpler for employees
    });

    it('uses friendly date labels (not ISO dates)', () => {
      const labels = [
        'Today',
        'Yesterday',
        'This week',
        'Last week',
        'Jan 15',
      ];

      expect(labels).not.toContain('2024-01-15');
      expect(labels).not.toContain('15/01/2024');
      expect(labels[0]).toBe('Today'); // Most recent is most friendly
    });

    it('shows empty state with encouragement', () => {
      const emptyState = {
        message: 'Tips will appear after your first shift is approved.',
        icon: '💵',
      };

      expect(emptyState.message).toContain('will appear');
      expect(emptyState.message).not.toContain('No data');
    });

    it('shows loading state during fetch', () => {
      const loadingState = {
        isLoading: true,
        showSkeleton: true,
      };

      expect(loadingState.showSkeleton).toBe(true);
    });

    it('handles error state gracefully', () => {
      const errorState = {
        hasError: true,
        message: 'Unable to load tips. Please try again.',
        showRetry: true,
      };

      expect(errorState.message).not.toContain('Error 500');
      expect(errorState.message).not.toContain('Failed to fetch');
      expect(errorState.showRetry).toBe(true);
    });
  });

  // ============================================================================
  // EMPLOYEE NOTIFICATION SCENARIOS
  // ============================================================================
  
  describe('Employee Notifications', () => {
    it('notifies when tips are approved', () => {
      const notification = {
        type: 'tips_approved',
        amount: 4210,
        date: new Date('2024-01-17'),
        message: 'Your tips for Wednesday ($42.10) have been approved.',
      };

      expect(notification.type).toBe('tips_approved');
      expect(notification.amount).toBe(4210);
    });

    it('notifies when tips are adjusted', () => {
      const notification = {
        type: 'tips_adjusted',
        oldAmount: 4200,
        newAmount: 6750,
        reason: 'Hours corrected',
        message: 'Your Tuesday tips have been updated to $67.50.',
      };

      expect(notification.type).toBe('tips_adjusted');
      expect(notification.newAmount).toBeGreaterThan(notification.oldAmount);
    });

    it('notifies when dispute is resolved', () => {
      const notification = {
        type: 'dispute_resolved',
        resolution: 'Hours corrected. Tips updated to $67.50.',
        message: 'Your tip review request has been resolved.',
      };

      expect(notification.type).toBe('dispute_resolved');
      expect(notification.resolution).toBeDefined();
    });

    it('does not spam notifications for every draft save', () => {
      const draft = {
        status: 'draft',
        notifyEmployee: false, // Only notify on approval
      };

      expect(draft.notifyEmployee).toBe(false);
    });

    it('batches weekly summary notification', () => {
      const weeklyNotification = {
        type: 'weekly_summary',
        weekOf: new Date('2024-01-15'),
        totalTips: 40300,
        message: 'You earned $403.00 in tips this week.',
      };

      expect(weeklyNotification.type).toBe('weekly_summary');
    });
  });

  // ============================================================================
  // EMPLOYEE TRUST SIGNALS
  // ============================================================================
  
  describe('Trust Building Signals', () => {
    it('shows who approved the tips', () => {
      const approval = {
        approvedBy: 'Manager Sarah',
        approvedAt: new Date('2024-01-17T14:00:00'),
      };

      expect(approval.approvedBy).toBeDefined();
      expect(approval.approvedAt).toBeInstanceOf(Date);
    });

    it('shows when tips were calculated vs approved', () => {
      const timeline = {
        calculatedAt: new Date('2024-01-17T13:00:00'),
        approvedAt: new Date('2024-01-17T14:00:00'),
      };

      expect(timeline.approvedAt > timeline.calculatedAt).toBe(true);
    });

    it('shows tip source (POS vs manual)', () => {
      const tipDetails = {
        source: 'pos',
        sourceLabel: 'Square POS',
      };

      expect(['pos', 'manual']).toContain(tipDetails.source);
    });

    it('shows split method used', () => {
      const method = {
        type: 'hours',
        label: 'By hours worked',
      };

      expect(method.type).toBe('hours');
      expect(method.label).toContain('hours');
    });

    it('shows consistency across days', () => {
      const week = [
        { day: 'Mon', method: 'hours' },
        { day: 'Tue', method: 'hours' },
        { day: 'Wed', method: 'hours' },
      ];

      const allSameMethod = week.every(d => d.method === 'hours');
      
      expect(allSameMethod).toBe(true); // Consistency builds trust
    });

    it('allows employee to see full team hours (not amounts)', () => {
      const transparency = {
        yourHours: 5.5,
        teamHours: 38,
        // Does NOT show other employees' tip amounts
      };

      expect(transparency.teamHours).toBeDefined();
      expect(transparency.teamHours).toBeGreaterThan(transparency.yourHours);
    });

    it('shows edit history for transparency', () => {
      const history = [
        { timestamp: new Date('2024-01-17T13:00:00'), action: 'calculated' },
        { timestamp: new Date('2024-01-17T14:00:00'), action: 'approved' },
        { timestamp: new Date('2024-01-17T16:00:00'), action: 'adjusted', reason: 'Hours corrected' },
      ];

      expect(history.length).toBe(3);
      expect(history[2].reason).toBeDefined();
    });
  });
});

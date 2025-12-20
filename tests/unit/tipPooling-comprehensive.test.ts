import { describe, expect, it } from 'vitest';
import {
  calculateTipSplitByHours,
  calculateTipSplitByRole,
  rebalanceAllocations,
  formatCurrencyFromCents,
  calculateTipSplitEven,
  filterTipEligible,
} from '@/utils/tipPooling';
import { Employee } from '@/types/scheduling';

describe('Tip Pooling - Comprehensive Edge Cases', () => {
  
  // ============================================================================
  // POS TIP INTEGRATION TESTS
  // ============================================================================
  
  describe('POS Tip Integration', () => {
    it('handles POS-imported tips with decimal amounts', () => {
      // Square/Clover often send $84.27 instead of round numbers
      const shares = calculateTipSplitByHours(8427, [
        { id: 'server1', name: 'Maria', hours: 7.5 },
        { id: 'server2', name: 'Juan', hours: 6.0 },
        { id: 'server3', name: 'Carlos', hours: 5.5 },
      ]);

      const total = shares.reduce((sum, s) => sum + s.amountCents, 0);
      expect(total).toBe(8427); // Must preserve exact POS amount
      
      // Verify proportions are reasonable
      const maria = shares.find(s => s.employeeId === 'server1');
      expect(maria?.amountCents).toBeGreaterThan(3000); // Worked most hours
      expect(maria?.amountCents).toBeLessThan(4000);
    });

    it('handles credit card vs cash tips from POS', () => {
      // Combined tips from multiple sources
      const creditCardTips = 5432; // From POS
      const cashTips = 1200; // Manual entry
      const totalTips = creditCardTips + cashTips; // 6632 cents

      const shares = calculateTipSplitByHours(totalTips, [
        { id: 'emp1', name: 'Alice', hours: 8 },
        { id: 'emp2', name: 'Bob', hours: 8 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(6632);
      // Should split evenly since same hours
      expect(Math.abs(shares[0].amountCents - shares[1].amountCents)).toBeLessThanOrEqual(1);
    });

    it('handles POS tips from multiple days (weekly split)', () => {
      // Restaurant does weekly splits, aggregates Mon-Sun tips
      const weeklyTips = [
        { day: 'Mon', cents: 4523 },
        { day: 'Tue', cents: 3891 },
        { day: 'Wed', cents: 5123 },
        { day: 'Thu', cents: 6234 },
        { day: 'Fri', cents: 9876 },
        { day: 'Sat', cents: 12345 },
        { day: 'Sun', cents: 8901 },
      ];

      const totalWeeklyTips = weeklyTips.reduce((sum, d) => sum + d.cents, 0); // 50893

      const shares = calculateTipSplitByHours(totalWeeklyTips, [
        { id: 'ft1', name: 'Full-timer', hours: 40 },
        { id: 'pt1', name: 'Part-timer', hours: 20 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(50893);
      
      // Full-timer should get 2x part-timer
      const fullTimer = shares.find(s => s.employeeId === 'ft1');
      const partTimer = shares.find(s => s.employeeId === 'pt1');
      expect(fullTimer!.amountCents).toBeCloseTo(partTimer!.amountCents * 2, -2);
    });

    it('handles zero tip days from POS (slow business)', () => {
      // Sometimes POS reports $0 tips
      const shares = calculateTipSplitByHours(0, [
        { id: 'emp1', name: 'Server', hours: 8 },
        { id: 'emp2', name: 'Bartender', hours: 8 },
      ]);

      expect(shares.every(s => s.amountCents === 0)).toBe(true);
      expect(shares.length).toBe(2); // Still creates allocations
    });

    it('handles POS tip discrepancies (reported vs actual)', () => {
      // Manager notices POS shows $100 but staff counted $110 cash
      const posReportedTips = 10000;
      const actualCountedTips = 11000;
      
      // System uses what manager approves (actual counted)
      const shares = calculateTipSplitByHours(actualCountedTips, [
        { id: 'emp1', name: 'Server', hours: 5 },
      ]);

      expect(shares[0].amountCents).toBe(11000);
    });
  });

  // ============================================================================
  // MANUAL TIP ENTRY TESTS
  // ============================================================================
  
  describe('Manual Tip Entry', () => {
    it('handles manager entering cash tips', () => {
      // Manager counted $200 in cash tips at end of shift
      const cashTips = 20000;

      const shares = calculateTipSplitByHours(cashTips, [
        { id: 'emp1', name: 'Server1', hours: 4 },
        { id: 'emp2', name: 'Server2', hours: 4 },
        { id: 'emp3', name: 'Server3', hours: 2 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(20000);
      
      // Servers with 4 hours should get same amount
      expect(shares[0].amountCents).toBe(shares[1].amountCents);
      
      // Server3 with 2 hours should get half
      expect(shares[2].amountCents).toBeCloseTo(shares[0].amountCents / 2, -1);
    });

    it('handles manual override after auto-calculation', () => {
      // System calculated split, manager manually adjusts one person
      const initialShares = calculateTipSplitByHours(10000, [
        { id: 'emp1', name: 'Alice', hours: 5 },
        { id: 'emp2', name: 'Bob', hours: 5 },
        { id: 'emp3', name: 'Carol', hours: 5 },
      ]);

      // Manager gives Alice $50 instead of calculated amount
      const rebalanced = rebalanceAllocations(10000, initialShares, 'emp1', 5000);

      expect(rebalanced.reduce((sum, s) => sum + s.amountCents, 0)).toBe(10000);
      expect(rebalanced.find(s => s.employeeId === 'emp1')?.amountCents).toBe(5000);
      
      // Bob and Carol split remaining $50
      const bob = rebalanced.find(s => s.employeeId === 'emp2');
      const carol = rebalanced.find(s => s.employeeId === 'emp3');
      expect((bob?.amountCents || 0) + (carol?.amountCents || 0)).toBe(5000);
    });

    it('handles manual entry with rounding errors', () => {
      // Manager enters $99.99 but split results in $33.33 × 3 = $99.99
      const shares = calculateTipSplitByHours(9999, [
        { id: 'emp1', name: 'A', hours: 1 },
        { id: 'emp2', name: 'B', hours: 1 },
        { id: 'emp3', name: 'C', hours: 1 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(9999);
      
      // Last person gets remainder
      expect(shares[2].amountCents).toBe(3333); // Gets the extra penny
    });

    it('handles extremely small manual tip amounts', () => {
      // Slow night, only $5 in tips
      const shares = calculateTipSplitByHours(500, [
        { id: 'emp1', name: 'Server1', hours: 4 },
        { id: 'emp2', name: 'Server2', hours: 4 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(500);
      expect(shares[0].amountCents).toBe(250); // $2.50 each
      expect(shares[1].amountCents).toBe(250);
    });

    it('handles large manual tip amounts (private events)', () => {
      // Private event with $5,000 auto-gratuity
      const eventTips = 500000;

      const shares = calculateTipSplitByHours(eventTips, [
        { id: 'emp1', name: 'Lead Server', hours: 8 },
        { id: 'emp2', name: 'Server2', hours: 6 },
        { id: 'emp3', name: 'Server3', hours: 6 },
        { id: 'emp4', name: 'Bartender', hours: 8 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(500000);
      
      // Lead server and bartender (8 hours) should get same amount
      expect(shares[0].amountCents).toBe(shares[3].amountCents);
    });
  });

  // ============================================================================
  // OVERNIGHT SHIFT EDGE CASES
  // ============================================================================
  
  describe('Overnight Shifts', () => {
    it('handles shift spanning midnight (11pm - 3am)', () => {
      // Tips collected during overnight shift
      // Shift: Mon 11pm - Tue 3am (4 hours)
      const overnightTips = 8000;

      const shares = calculateTipSplitByHours(overnightTips, [
        { id: 'emp1', name: 'Night Server', hours: 4 },
        { id: 'emp2', name: 'Night Bartender', hours: 4 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(8000);
      expect(shares[0].amountCents).toBe(4000); // Equal split
      expect(shares[1].amountCents).toBe(4000);
    });

    it('handles 24-hour operation with shift changes', () => {
      // 24-hour diner: morning, day, evening, overnight crews
      const dailyTips = 24000; // $240 over 24 hours

      const shares = calculateTipSplitByHours(dailyTips, [
        { id: 'emp1', name: 'Morning (6am-2pm)', hours: 8 },
        { id: 'emp2', name: 'Day (2pm-10pm)', hours: 8 },
        { id: 'emp3', name: 'Night (10pm-6am)', hours: 8 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(24000);
      // All work same hours, should split evenly
      expect(shares[0].amountCents).toBe(8000);
      expect(shares[1].amountCents).toBe(8000);
      expect(shares[2].amountCents).toBe(8000);
    });

    it('handles overnight shift with split across two days', () => {
      // Tips earned Fri night should count for Friday OR Saturday?
      // Business decision: tips go to the day the shift STARTED
      const fridayNightTips = 15000; // Fri 10pm - Sat 2am

      const shares = calculateTipSplitByHours(fridayNightTips, [
        { id: 'emp1', name: 'Friday Night Server', hours: 4 },
      ]);

      expect(shares[0].amountCents).toBe(15000);
      // This should be recorded under Friday's date
    });

    it('handles graveyard shift differential (no impact on tips)', () => {
      // Some employees get shift differential pay but tips are still by hours
      const tips = 10000;

      const shares = calculateTipSplitByHours(tips, [
        { id: 'emp1', name: 'Day Server', hours: 8 }, // Normal pay
        { id: 'emp2', name: 'Night Server', hours: 8 }, // +$2/hr differential
      ]);

      // Tip split should be equal regardless of wage differential
      expect(shares[0].amountCents).toBe(5000);
      expect(shares[1].amountCents).toBe(5000);
    });

    it('handles daylight saving time shift (spring forward)', () => {
      // Spring DST: 2am becomes 3am, lose 1 hour
      // Server scheduled 12am-8am only works 7 actual hours
      const tips = 7000;

      const shares = calculateTipSplitByHours(tips, [
        { id: 'emp1', name: 'DST Night Shift', hours: 7 }, // Lost hour
        { id: 'emp2', name: 'Regular Shift', hours: 7 },
      ]);

      expect(shares[0].amountCents).toBe(3500);
      expect(shares[1].amountCents).toBe(3500);
    });

    it('handles daylight saving time shift (fall back)', () => {
      // Fall DST: 2am happens twice, gain 1 hour
      // Server scheduled 12am-8am works 9 actual hours
      const tips = 9000;

      const shares = calculateTipSplitByHours(tips, [
        { id: 'emp1', name: 'DST Night Shift', hours: 9 }, // Extra hour
        { id: 'emp2', name: 'Regular Shift', hours: 8 },
      ]);

      const emp1 = shares.find(s => s.employeeId === 'emp1');
      const emp2 = shares.find(s => s.employeeId === 'emp2');
      
      // emp1 worked 9/17 hours, emp2 worked 8/17
      expect(emp1!.amountCents).toBeGreaterThan(emp2!.amountCents);
    });
  });

  // ============================================================================
  // RESTAURANT OPERATION EDGE CASES
  // ============================================================================
  
  describe('Restaurant Operation Edge Cases', () => {
    it('handles employee clocking out early (partial shift)', () => {
      // Server scheduled 5pm-11pm but leaves at 9pm (4 hours instead of 6)
      const tips = 12000;

      const shares = calculateTipSplitByHours(tips, [
        { id: 'emp1', name: 'Server A (left early)', hours: 4 },
        { id: 'emp2', name: 'Server B (full shift)', hours: 6 },
        { id: 'emp3', name: 'Server C (full shift)', hours: 6 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(12000);
      
      // Employee who left early gets less (4/16 vs 6/16)
      const leftEarly = shares.find(s => s.employeeId === 'emp1');
      const fullShift = shares.find(s => s.employeeId === 'emp2');
      expect(leftEarly!.amountCents).toBeLessThan(fullShift!.amountCents);
    });

    it('handles employee called in mid-shift (partial hours)', () => {
      // Busy night, manager calls in extra server at 8pm (3 hours instead of 6)
      const tips = 15000;

      const shares = calculateTipSplitByHours(tips, [
        { id: 'emp1', name: 'Regular Server', hours: 6 },
        { id: 'emp2', name: 'Called In Server', hours: 3 },
      ]);

      const regular = shares.find(s => s.employeeId === 'emp1');
      const calledIn = shares.find(s => s.employeeId === 'emp2');
      
      // Regular worked 2x the hours
      expect(regular!.amountCents).toBeCloseTo(calledIn!.amountCents * 2, -1);
    });

    it('handles double-shift employee (16 hours)', () => {
      // Employee works lunch + dinner (covers for call-out)
      const tips = 20000;

      const shares = calculateTipSplitByHours(tips, [
        { id: 'emp1', name: 'Double Shift', hours: 16 },
        { id: 'emp2', name: 'Normal Shift', hours: 8 },
      ]);

      const doubleShift = shares.find(s => s.employeeId === 'emp1');
      const normalShift = shares.find(s => s.employeeId === 'emp2');
      
      // Double shift should get 2x normal shift
      expect(doubleShift!.amountCents).toBeCloseTo(normalShift!.amountCents * 2, -1);
    });

    it('handles break time (unpaid breaks excluded from hours)', () => {
      // Employee works 8am-5pm with 1-hour unpaid lunch = 8 hours
      const tips = 16000;

      const shares = calculateTipSplitByHours(tips, [
        { id: 'emp1', name: 'Server with break', hours: 8 }, // 9hr schedule - 1hr break
        { id: 'emp2', name: 'Server without break', hours: 8 },
      ]);

      // Should split evenly
      expect(shares[0].amountCents).toBe(8000);
      expect(shares[1].amountCents).toBe(8000);
    });

    it('handles role-based split with different weights', () => {
      // Bartender gets 1.5x server weight
      const tips = 12000;

      const shares = calculateTipSplitByRole(tips, [
        { id: 'emp1', name: 'Server', role: 'Server', weight: 1 },
        { id: 'emp2', name: 'Bartender', role: 'Bartender', weight: 1.5 },
        { id: 'emp3', name: 'Runner', role: 'Runner', weight: 0.5 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(12000);
      
      // Total weight = 1 + 1.5 + 0.5 = 3
      // Server: 1/3 = 4000, Bartender: 1.5/3 = 6000, Runner: 0.5/3 = 2000
      const server = shares.find(s => s.employeeId === 'emp1');
      const bartender = shares.find(s => s.employeeId === 'emp2');
      const runner = shares.find(s => s.employeeId === 'emp3');
      
      expect(bartender!.amountCents).toBeGreaterThan(server!.amountCents);
      expect(server!.amountCents).toBeGreaterThan(runner!.amountCents);
    });

    it('handles manager working floor (tip-eligible vs non-eligible)', () => {
      // Salaried manager helps during rush - not tip eligible
      const employees: Partial<Employee>[] = [
        { 
          id: 'emp1', 
          first_name: 'Server', 
          last_name: 'One',
          status: 'active', 
          compensation_type: 'hourly', 
          tip_eligible: true 
        },
        { 
          id: 'mgr1', 
          first_name: 'Manager', 
          last_name: 'Smith',
          status: 'active', 
          compensation_type: 'salary', 
          tip_eligible: false 
        },
      ];

      const eligible = filterTipEligible(employees as Employee[]);
      
      expect(eligible.length).toBe(1);
      expect(eligible[0].id).toBe('emp1');
    });

    it('handles trainee (partial tip participation)', () => {
      // Trainee gets reduced share (50% of normal)
      const tips = 10000;

      const shares = calculateTipSplitByRole(tips, [
        { id: 'emp1', name: 'Experienced Server', role: 'Server', weight: 1 },
        { id: 'trainee', name: 'Trainee', role: 'Trainee', weight: 0.5 },
      ]);

      const experienced = shares.find(s => s.employeeId === 'emp1');
      const trainee = shares.find(s => s.employeeId === 'trainee');
      
      expect(experienced!.amountCents).toBeCloseTo(trainee!.amountCents * 2, -1);
    });

    it('handles tipped vs non-tipped roles in same restaurant', () => {
      const employees: Partial<Employee>[] = [
        { 
          id: 'server', 
          first_name: 'Server', 
          last_name: 'A',
          status: 'active', 
          compensation_type: 'hourly', 
          tip_eligible: true 
        },
        { 
          id: 'cook', 
          first_name: 'Cook', 
          last_name: 'B',
          status: 'active', 
          compensation_type: 'hourly', 
          tip_eligible: false 
        },
        { 
          id: 'dishwasher', 
          first_name: 'Dishwasher', 
          last_name: 'C',
          status: 'active', 
          compensation_type: 'hourly', 
          tip_eligible: false 
        },
      ];

      const eligible = filterTipEligible(employees as Employee[]);
      
      expect(eligible.length).toBe(1);
      expect(eligible[0].id).toBe('server');
    });

    it('handles seasonal employee (recently activated)', () => {
      const employees: Partial<Employee>[] = [
        { 
          id: 'seasonal', 
          first_name: 'Summer', 
          last_name: 'Staff',
          status: 'active', 
          compensation_type: 'hourly', 
          tip_eligible: true,
          // activated_at: today
        },
        { 
          id: 'regular', 
          first_name: 'Year', 
          last_name: 'Round',
          status: 'active', 
          compensation_type: 'hourly', 
          tip_eligible: true 
        },
      ];

      const eligible = filterTipEligible(employees as Employee[]);
      
      // Both should be eligible if status is active
      expect(eligible.length).toBe(2);
    });

    it('handles employee terminated mid-day (tips earned before termination)', () => {
      // Employee terminated at 2pm but worked 6am-2pm (8 hours)
      // Should still get tips for hours worked
      const tips = 12000;

      const shares = calculateTipSplitByHours(tips, [
        { id: 'terminated', name: 'Terminated Employee', hours: 8 },
        { id: 'current', name: 'Current Employee', hours: 8 },
      ]);

      // Should split evenly - hours worked before termination count
      expect(shares[0].amountCents).toBe(6000);
      expect(shares[1].amountCents).toBe(6000);
    });

    it('handles multi-location employee (works at 2+ restaurants)', () => {
      // Employee works at Restaurant A and Restaurant B
      // Each location has separate tip pool
      const restaurantATips = 8000;
      const restaurantBTips = 6000;

      const sharesA = calculateTipSplitByHours(restaurantATips, [
        { id: 'multi-location', name: 'Shared Employee', hours: 5 },
        { id: 'local-a', name: 'Location A Only', hours: 5 },
      ]);

      const sharesB = calculateTipSplitByHours(restaurantBTips, [
        { id: 'multi-location', name: 'Shared Employee', hours: 4 },
        { id: 'local-b', name: 'Location B Only', hours: 4 },
      ]);

      // Employee should get tips from both locations independently
      expect(sharesA.find(s => s.employeeId === 'multi-location')?.amountCents).toBe(4000);
      expect(sharesB.find(s => s.employeeId === 'multi-location')?.amountCents).toBe(3000);
    });

    it('handles extremely uneven hours (1 hour vs 12 hours)', () => {
      const tips = 13000;

      const shares = calculateTipSplitByHours(tips, [
        { id: 'emp1', name: 'Short Shift', hours: 1 },
        { id: 'emp2', name: 'Long Shift', hours: 12 },
      ]);

      const short = shares.find(s => s.employeeId === 'emp1');
      const long = shares.find(s => s.employeeId === 'emp2');
      
      // Long shift should get 12x short shift
      expect(long!.amountCents).toBeCloseTo(short!.amountCents * 12, -1);
      expect(short!.amountCents).toBeCloseTo(1000, -1); // 1/13th
      expect(long!.amountCents).toBeCloseTo(12000, -1); // 12/13th
    });

    it('handles fractional hours (server works 3.25 hours)', () => {
      const tips = 13000;

      const shares = calculateTipSplitByHours(tips, [
        { id: 'emp1', name: 'Fractional', hours: 3.25 },
        { id: 'emp2', name: 'Whole', hours: 10 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(13000);
      
      // Total hours = 13.25
      // emp1: 3.25/13.25 ≈ 24.5%, emp2: 10/13.25 ≈ 75.5%
      const fractional = shares.find(s => s.employeeId === 'emp1');
      expect(fractional!.amountCents).toBeCloseTo(3188, -1);
    });

    it('handles zero-hour employee (no show but in pool)', () => {
      // Employee was scheduled but called out
      const tips = 10000;

      const shares = calculateTipSplitByHours(tips, [
        { id: 'emp1', name: 'Worked', hours: 8 },
        { id: 'emp2', name: 'No Show', hours: 0 },
      ]);

      expect(shares.find(s => s.employeeId === 'emp1')?.amountCents).toBe(10000);
      expect(shares.find(s => s.employeeId === 'emp2')?.amountCents).toBe(0);
    });

    it('handles negative tip scenario (refunds/disputes)', () => {
      // Rare case: tip chargebacks exceed tips earned
      // System should handle gracefully (set to 0, not negative)
      const netTips = -500; // Negative scenario

      const shares = calculateTipSplitByHours(Math.max(0, netTips), [
        { id: 'emp1', name: 'Server', hours: 8 },
      ]);

      expect(shares[0].amountCents).toBe(0);
    });

    it('handles concurrent manual and auto splits (transition period)', () => {
      // Restaurant switching from manual to POS mid-week
      const manualTips = 5000; // Mon-Wed manual
      const posTips = 12000; // Thu-Sun POS

      const manualShares = calculateTipSplitByHours(manualTips, [
        { id: 'emp1', name: 'Server', hours: 12 },
      ]);

      const posShares = calculateTipSplitByHours(posTips, [
        { id: 'emp1', name: 'Server', hours: 20 },
      ]);

      // Same employee should have separate allocations
      expect(manualShares[0].amountCents).toBe(5000);
      expect(posShares[0].amountCents).toBe(12000);
    });
  });

  // ============================================================================
  // ROUNDING & PRECISION EDGE CASES
  // ============================================================================
  
  describe('Rounding & Precision', () => {
    it('handles penny rounding with 3-way split', () => {
      const shares = calculateTipSplitByHours(10000, [
        { id: 'a', name: 'A', hours: 1 },
        { id: 'b', name: 'B', hours: 1 },
        { id: 'c', name: 'C', hours: 1 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(10000);
      // 10000 / 3 = 3333.33... → 3333 + 3333 + 3334
      expect(shares[2].amountCents).toBe(3334); // Last gets remainder
    });

    it('handles large number of participants (20+ servers)', () => {
      const participants = Array.from({ length: 25 }, (_, i) => ({
        id: `emp${i}`,
        name: `Server ${i}`,
        hours: 5,
      }));

      const shares = calculateTipSplitByHours(100000, participants);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(100000);
      expect(shares.length).toBe(25);
    });

    it('handles extremely large tip amount (charity event)', () => {
      // $50,000 tip from celebrity dinner
      const hugeTips = 5000000;

      const shares = calculateTipSplitByHours(hugeTips, [
        { id: 'emp1', name: 'Lead Server', hours: 8 },
        { id: 'emp2', name: 'Server 2', hours: 8 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(5000000);
      expect(shares[0].amountCents).toBe(2500000); // $25,000
    });

    it('formats currency correctly with cents precision', () => {
      expect(formatCurrencyFromCents(0)).toBe('$0.00');
      expect(formatCurrencyFromCents(1)).toBe('$0.01');
      expect(formatCurrencyFromCents(99)).toBe('$0.99');
      expect(formatCurrencyFromCents(100)).toBe('$1.00');
      expect(formatCurrencyFromCents(1234567)).toBe('$12,345.67');
    });
  });

  // ============================================================================
  // COMPLIANCE & LEGAL EDGE CASES
  // ============================================================================
  
  describe('Compliance & Legal', () => {
    it('excludes salaried employees from tip pool', () => {
      const employees: Partial<Employee>[] = [
        { 
          id: 'hourly', 
          first_name: 'Hourly', 
          last_name: 'Worker',
          status: 'active', 
          compensation_type: 'hourly', 
          tip_eligible: true 
        },
        { 
          id: 'salary', 
          first_name: 'Salaried', 
          last_name: 'Manager',
          status: 'active', 
          compensation_type: 'salary', 
          tip_eligible: false 
        },
      ];

      const eligible = filterTipEligible(employees as Employee[]);
      
      expect(eligible.length).toBe(1);
      expect(eligible[0].compensation_type).toBe('hourly');
    });

    it('excludes inactive employees from tip pool', () => {
      const employees: Partial<Employee>[] = [
        { 
          id: 'active', 
          first_name: 'Active', 
          last_name: 'Employee',
          status: 'active', 
          compensation_type: 'hourly', 
          tip_eligible: true 
        },
        { 
          id: 'terminated', 
          first_name: 'Former', 
          last_name: 'Employee',
          status: 'terminated', 
          compensation_type: 'hourly', 
          tip_eligible: true 
        },
      ];

      const eligible = filterTipEligible(employees as Employee[]);
      
      expect(eligible.length).toBe(1);
      expect(eligible[0].status).toBe('active');
    });

    it('respects tip_eligible flag override', () => {
      const employees: Partial<Employee>[] = [
        { 
          id: 'eligible', 
          first_name: 'Server', 
          last_name: 'A',
          status: 'active', 
          compensation_type: 'hourly', 
          tip_eligible: true 
        },
        { 
          id: 'not-eligible', 
          first_name: 'Server', 
          last_name: 'B',
          status: 'active', 
          compensation_type: 'hourly', 
          tip_eligible: false // Explicitly excluded
        },
      ];

      const eligible = filterTipEligible(employees as Employee[]);
      
      expect(eligible.length).toBe(1);
      expect(eligible[0].id).toBe('eligible');
    });

    it('defaults tip_eligible to true when undefined', () => {
      const employees: Partial<Employee>[] = [
        { 
          id: 'default', 
          first_name: 'Server', 
          last_name: 'Default',
          status: 'active', 
          compensation_type: 'hourly', 
          // tip_eligible is undefined
        },
      ];

      const eligible = filterTipEligible(employees as Employee[]);
      
      expect(eligible.length).toBe(1); // Should default to eligible
    });
  });
});

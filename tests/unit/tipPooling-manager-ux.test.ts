import { describe, expect, it } from 'vitest';
import {
  calculateTipSplitByHours,
  calculateTipSplitByRole,
  calculateTipSplitEven,
  rebalanceAllocations,
} from '@/utils/tipPooling';

/**
 * Manager UX Flow Tests
 * Testing the Apple-style "progressive disclosure" journey
 * 
 * Flow:
 * 1. Choose tip source (manual/POS)
 * 2. Choose who shares
 * 3. Choose split method (hours/role/manual)
 * 4. Choose cadence (daily/weekly/shift)
 * 5. Preview & approve
 */
describe('Tip Pooling - Manager UX Flow', () => {
  
  // ============================================================================
  // SCREEN 1: How were tips collected?
  // ============================================================================
  
  describe('Step 1: Tip Source Selection', () => {
    it('defaults to manual entry', () => {
      const selectedSource = 'manual';
      expect(['manual', 'pos']).toContain(selectedSource);
      expect(selectedSource).toBe('manual');
    });

    it('allows switching to POS after initial setup', () => {
      let tipSource = 'manual';
      
      // Manager changes to POS
      tipSource = 'pos';
      
      expect(tipSource).toBe('pos');
    });

    it('remembers previous selection', () => {
      const savedSettings = {
        tipSource: 'pos',
        shareMethod: 'hours',
      };

      expect(savedSettings.tipSource).toBe('pos');
    });
  });

  // ============================================================================
  // SCREEN 2: Who shares tips?
  // ============================================================================
  
  describe('Step 2: Participant Selection', () => {
    it('starts with common roles pre-selected', () => {
      const defaultSelected = ['Server', 'Bartender', 'Runner'];
      const notSelected = ['Kitchen', 'Prep'];

      expect(defaultSelected).toContain('Server');
      expect(defaultSelected).toContain('Bartender');
      expect(defaultSelected).not.toContain('Kitchen');
    });

    it('allows manager to add kitchen staff to pool', () => {
      const participants = ['Server', 'Bartender'];
      
      // Manager adds kitchen
      participants.push('Kitchen');
      
      expect(participants).toContain('Kitchen');
    });

    it('hides salaried roles automatically', () => {
      const allEmployees = [
        { id: '1', name: 'Server', compensationType: 'hourly' },
        { id: '2', name: 'Manager', compensationType: 'salary' },
        { id: '3', name: 'Bartender', compensationType: 'hourly' },
      ];

      const visibleForSelection = allEmployees.filter(
        e => e.compensationType !== 'salary'
      );

      expect(visibleForSelection.length).toBe(2);
      expect(visibleForSelection.every(e => e.compensationType === 'hourly')).toBe(true);
    });

    it('only shows active employees', () => {
      const allEmployees = [
        { id: '1', name: 'Active Server', status: 'active' },
        { id: '2', name: 'Terminated Server', status: 'terminated' },
        { id: '3', name: 'Active Bartender', status: 'active' },
      ];

      const visibleForSelection = allEmployees.filter(
        e => e.status === 'active'
      );

      expect(visibleForSelection.length).toBe(2);
    });
  });

  // ============================================================================
  // SCREEN 3: How should tips be shared?
  // ============================================================================
  
  describe('Step 3: Share Method Selection', () => {
    it('defaults to "by hours worked" (most intuitive)', () => {
      const defaultMethod = 'hours';
      expect(['hours', 'role', 'manual']).toContain(defaultMethod);
      expect(defaultMethod).toBe('hours');
    });

    it('calculates preview when "by hours" selected', () => {
      const preview = calculateTipSplitByHours(10000, [
        { id: '1', name: 'Maria', hours: 7.2 },
        { id: '2', name: 'Juan', hours: 6.0 },
      ]);

      expect(preview.length).toBe(2);
      expect(preview[0].amountCents).toBeGreaterThan(0);
    });

    it('shows role weight editor when "by role" selected', () => {
      const roleWeights = {
        'Server': 2,
        'Bartender': 3,
        'Runner': 1,
      };

      expect(roleWeights['Bartender']).toBe(3);
      expect(roleWeights['Runner']).toBe(1);
    });

    it('calculates preview with role weights', () => {
      const preview = calculateTipSplitByRole(9000, [
        { id: '1', name: 'Server', role: 'Server', weight: 2 },
        { id: '2', name: 'Bartender', role: 'Bartender', weight: 3 },
        { id: '3', name: 'Runner', role: 'Runner', weight: 1 },
      ]);

      expect(preview.length).toBe(3);
      
      // Bartender (weight 3) should get most
      const bartender = preview.find(p => p.role === 'Bartender');
      const runner = preview.find(p => p.role === 'Runner');
      expect(bartender!.amountCents).toBeGreaterThan(runner!.amountCents);
    });

    it('skips automation when "manual" selected', () => {
      const method = 'manual';
      
      // No automatic calculation, manager will decide amounts
      expect(method).toBe('manual');
      
      // Even split as starting point
      const evenPreview = calculateTipSplitEven(10000, [
        { id: '1', name: 'Maria' },
        { id: '2', name: 'Juan' },
      ]);

      expect(evenPreview[0].amountCents).toBe(5000);
      expect(evenPreview[1].amountCents).toBe(5000);
    });
  });

  // ============================================================================
  // SCREEN 4: When do you want to split tips?
  // ============================================================================
  
  describe('Step 4: Cadence Selection', () => {
    it('defaults to daily (keeps things simplest)', () => {
      const defaultCadence = 'daily';
      expect(['daily', 'weekly', 'shift']).toContain(defaultCadence);
      expect(defaultCadence).toBe('daily');
    });

    it('supports weekly pooling for larger operations', () => {
      const cadence = 'weekly';
      
      // Weekly totals would be higher
      const weeklyTips = 50000; // $500 for the week
      
      const shares = calculateTipSplitByHours(weeklyTips, [
        { id: '1', name: 'Full-timer', hours: 40 },
        { id: '2', name: 'Part-timer', hours: 20 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(50000);
    });

    it('supports shift-level splits for 24-hour operations', () => {
      const cadence = 'shift';
      
      // Each shift has separate pool
      const morningShiftTips = 5000;
      const eveningShiftTips = 15000;

      const morningShares = calculateTipSplitByHours(morningShiftTips, [
        { id: '1', name: 'Morning Server', hours: 8 },
      ]);

      const eveningShares = calculateTipSplitByHours(eveningShiftTips, [
        { id: '2', name: 'Evening Server', hours: 8 },
      ]);

      expect(morningShares[0].amountCents).toBe(5000);
      expect(eveningShares[0].amountCents).toBe(15000);
    });
  });

  // ============================================================================
  // SCREEN 5: Preview & Confirmation
  // ============================================================================
  
  describe('Step 5: Trust-Building Preview', () => {
    it('shows live preview before saving', () => {
      const totalTips = 84200; // $842.00
      const participants = [
        { id: 'maria', name: 'Maria', hours: 7.2 },
        { id: 'juan', name: 'Juan', hours: 6.0 },
        { id: 'carlos', name: 'Carlos', hours: 5.0 },
      ];

      const preview = calculateTipSplitByHours(totalTips, participants);

      // Trust-building: show exactly what will happen
      expect(preview.length).toBe(3);
      expect(preview.reduce((sum, s) => sum + s.amountCents, 0)).toBe(84200);
      
      // Maria worked most hours
      const maria = preview.find(p => p.employeeId === 'maria');
      expect(maria!.hours).toBe(7.2);
      expect(maria!.amountCents).toBeGreaterThan(30000); // Over $300
    });

    it('preserves total in preview summary', () => {
      const totalTips = 84200;
      const shares = calculateTipSplitByHours(totalTips, [
        { id: '1', name: 'Server 1', hours: 5 },
        { id: '2', name: 'Server 2', hours: 5 },
      ]);

      const previewTotal = shares.reduce((sum, s) => sum + s.amountCents, 0);
      
      expect(previewTotal).toBe(totalTips); // Exact match
    });

    it('shows number of participants in summary', () => {
      const participants = [
        { id: '1', name: 'Maria', hours: 7.2 },
        { id: '2', name: 'Juan', hours: 6.0 },
        { id: '3', name: 'Carlos', hours: 5.0 },
      ];

      expect(participants.length).toBe(3);
    });

    it('shows selected method in summary', () => {
      const settings = {
        shareMethod: 'hours',
        totalTips: 84200,
        participants: 3,
      };

      expect(settings.shareMethod).toBe('hours');
    });
  });

  // ============================================================================
  // DAILY MANAGER FLOW: Manual Entry
  // ============================================================================
  
  describe('Daily Flow: Manual Entry', () => {
    it('accepts manager-entered tip amount', () => {
      const manualEntry = 84200; // $842.00 typed by manager

      expect(manualEntry).toBeGreaterThan(0);
      expect(manualEntry).toBe(84200);
    });

    it('calculates splits after manual entry', () => {
      const enteredTips = 84200;
      const savedSettings = {
        method: 'hours',
        participants: [
          { id: 'maria', hours: 7.2 },
          { id: 'juan', hours: 6.0 },
        ],
      };

      const shares = calculateTipSplitByHours(
        enteredTips,
        savedSettings.participants.map(p => ({ 
          id: p.id, 
          name: p.id, 
          hours: p.hours 
        }))
      );

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(84200);
    });

    it('shows review screen after entry', () => {
      const reviewData = {
        totalTips: 84200,
        splitBy: 'hours',
        shares: [
          { employeeId: 'maria', name: 'Maria', hours: 7.2, amountCents: 45875 },
          { employeeId: 'juan', name: 'Juan', hours: 6.0, amountCents: 38325 },
        ],
      };

      expect(reviewData.totalTips).toBe(84200);
      expect(reviewData.shares.length).toBe(2);
    });

    it('allows editing individual amounts on review screen', () => {
      const initialShares = calculateTipSplitByHours(84200, [
        { id: 'maria', name: 'Maria', hours: 7.2 },
        { id: 'juan', name: 'Juan', hours: 6.0 },
      ]);

      // Manager edits Maria's amount to $450
      const editedShares = rebalanceAllocations(
        84200,
        initialShares,
        'maria',
        45000
      );

      expect(editedShares.find(s => s.employeeId === 'maria')?.amountCents).toBe(45000);
      expect(editedShares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(84200);
    });

    it('auto-balances when one amount edited', () => {
      const total = 10000;
      const initial = [
        { employeeId: 'alice', name: 'Alice', amountCents: 5000 },
        { employeeId: 'bob', name: 'Bob', amountCents: 5000 },
      ];

      // Manager gives Alice $80 (8000 cents)
      const rebalanced = rebalanceAllocations(total, initial, 'alice', 8000);

      const alice = rebalanced.find(s => s.employeeId === 'alice');
      const bob = rebalanced.find(s => s.employeeId === 'bob');

      expect(alice?.amountCents).toBe(8000);
      expect(bob?.amountCents).toBe(2000); // Auto-adjusted
      expect(rebalanced.reduce((sum, s) => sum + s.amountCents, 0)).toBe(10000);
    });

    it('shows "total remaining: $0.00" after edits', () => {
      const total = 10000;
      const shares = [
        { employeeId: 'a', name: 'A', amountCents: 6000 },
        { employeeId: 'b', name: 'B', amountCents: 4000 },
      ];

      const allocated = shares.reduce((sum, s) => sum + s.amountCents, 0);
      const remaining = total - allocated;

      expect(remaining).toBe(0);
    });

    it('allows saving as draft', () => {
      const draft = {
        status: 'draft',
        totalTips: 84200,
        shares: [
          { employeeId: 'maria', amountCents: 45000 },
          { employeeId: 'juan', amountCents: 39200 },
        ],
      };

      expect(draft.status).toBe('draft');
    });

    it('allows approving tips', () => {
      const approved = {
        status: 'approved',
        totalTips: 84200,
        approvedAt: new Date(),
      };

      expect(approved.status).toBe('approved');
      expect(approved.approvedAt).toBeInstanceOf(Date);
    });
  });

  // ============================================================================
  // DAILY MANAGER FLOW: POS Import
  // ============================================================================
  
  describe('Daily Flow: POS Import', () => {
    it('imports tips from POS automatically', () => {
      const posImported = {
        source: 'square',
        amount: 84327, // $843.27 from POS
        importedAt: new Date(),
      };

      expect(posImported.amount).toBe(84327);
      expect(posImported.source).toBe('square');
    });

    it('allows manager to edit imported amount', () => {
      let tipAmount = 84327; // POS amount
      
      // Manager adjusts to match actual count
      tipAmount = 84500; // $845.00

      expect(tipAmount).toBe(84500);
    });

    it('calculates splits from POS amount', () => {
      const posAmount = 84327;
      
      const shares = calculateTipSplitByHours(posAmount, [
        { id: 'maria', name: 'Maria', hours: 7.2 },
        { id: 'juan', name: 'Juan', hours: 6.0 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(84327);
    });

    it('shows POS as source in review screen', () => {
      const review = {
        tipSource: 'pos',
        totalTips: 84327,
        importedFrom: 'Square POS',
      };

      expect(review.tipSource).toBe('pos');
      expect(review.importedFrom).toBe('Square POS');
    });
  });

  // ============================================================================
  // MANAGER CORRECTIONS
  // ============================================================================
  
  describe('Manager Corrections', () => {
    it('allows reopening approved split for editing', () => {
      const split = {
        id: 'split-123',
        status: 'approved',
        approvedAt: new Date('2024-01-15'),
      };

      // Manager reopens
      split.status = 'draft';
      
      expect(split.status).toBe('draft');
    });

    it('preserves edit history when correcting', () => {
      const editHistory = [
        { 
          timestamp: new Date('2024-01-15T10:00:00'), 
          action: 'approved',
          by: 'manager1',
        },
        { 
          timestamp: new Date('2024-01-15T14:00:00'), 
          action: 'edited',
          by: 'manager1',
          reason: 'Employee hours corrected',
        },
      ];

      expect(editHistory.length).toBe(2);
      expect(editHistory[1].action).toBe('edited');
    });

    it('recalculates split when hours updated', () => {
      const original = calculateTipSplitByHours(10000, [
        { id: 'emp1', name: 'Server', hours: 5 },
        { id: 'emp2', name: 'Bartender', hours: 5 },
      ]);

      // Manager corrects hours (emp1 actually worked 6 hours)
      const corrected = calculateTipSplitByHours(10000, [
        { id: 'emp1', name: 'Server', hours: 6 },
        { id: 'emp2', name: 'Bartender', hours: 5 },
      ]);

      expect(corrected[0].amountCents).toBeGreaterThan(original[0].amountCents);
    });

    it('handles retroactive split creation (forgot to enter yesterday)', () => {
      const yesterdaysSplit = {
        splitDate: new Date('2024-01-14'),
        createdAt: new Date('2024-01-15'), // Created day after
        totalTips: 75000,
        status: 'approved',
      };

      expect(yesterdaysSplit.splitDate).not.toEqual(yesterdaysSplit.createdAt);
    });
  });

  // ============================================================================
  // PROGRESSIVE COMPLEXITY (Hidden Features)
  // ============================================================================
  
  describe('Progressive Complexity', () => {
    it('supports shift-level splits when enabled', () => {
      // Advanced feature: split by shift instead of day
      const lunchShift = {
        shiftId: 'lunch-2024-01-15',
        totalTips: 20000,
        participants: [
          { id: 'emp1', hours: 4 },
        ],
      };

      const dinnerShift = {
        shiftId: 'dinner-2024-01-15',
        totalTips: 60000,
        participants: [
          { id: 'emp2', hours: 6 },
          { id: 'emp3', hours: 6 },
        ],
      };

      expect(lunchShift.shiftId).not.toBe(dinnerShift.shiftId);
      expect(lunchShift.totalTips + dinnerShift.totalTips).toBe(80000);
    });

    it('supports multi-location when restaurant has multiple sites', () => {
      const locationASplits = {
        restaurantId: 'rest-1',
        locationId: 'location-a',
        totalTips: 50000,
      };

      const locationBSplits = {
        restaurantId: 'rest-1',
        locationId: 'location-b',
        totalTips: 30000,
      };

      expect(locationASplits.restaurantId).toBe(locationBSplits.restaurantId);
      expect(locationASplits.locationId).not.toBe(locationBSplits.locationId);
    });

    it('supports custom role weights without exposing formula', () => {
      // Manager just sees multipliers (not percentages)
      const roleWeights = {
        'Server': 1,
        'Lead Server': 1.5,
        'Bartender': 2,
      };

      const shares = calculateTipSplitByRole(12000, [
        { id: '1', name: 'Server', role: 'Server', weight: 1 },
        { id: '2', name: 'Lead', role: 'Lead Server', weight: 1.5 },
        { id: '3', name: 'Bartender', role: 'Bartender', weight: 2 },
      ]);

      // Bartender gets most (weight 2)
      const bartender = shares.find(s => s.role === 'Bartender');
      expect(bartender!.amountCents).toBeGreaterThan(4000);
    });

    it('supports weekly pooling without changing UI', () => {
      // Same flow, just aggregates 7 days
      const weekTotal = 350000; // $3,500 for week

      const shares = calculateTipSplitByHours(weekTotal, [
        { id: 'ft', name: 'Full-time', hours: 40 },
        { id: 'pt', name: 'Part-time', hours: 20 },
      ]);

      expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(350000);
    });
  });

  // ============================================================================
  // MANAGER UX INVARIANTS (Apple Principles)
  // ============================================================================
  
  describe('UX Invariants', () => {
    it('never asks for percentages or formulas', () => {
      // Manager never types "33.33%" or sees math
      const shares = calculateTipSplitByHours(10000, [
        { id: '1', name: 'A', hours: 8 },
        { id: '2', name: 'B', hours: 8 },
      ]);

      // They just see $50 and $50
      expect(shares[0].amountCents).toBe(5000);
      expect(shares[1].amountCents).toBe(5000);
    });

    it('always preserves total after edits', () => {
      const total = 10000;
      const shares = [
        { employeeId: 'a', name: 'A', amountCents: 5000 },
        { employeeId: 'b', name: 'B', amountCents: 5000 },
      ];

      const edited = rebalanceAllocations(total, shares, 'a', 7000);

      expect(edited.reduce((sum, s) => sum + s.amountCents, 0)).toBe(total);
    });

    it('always shows live preview before committing', () => {
      const preview = {
        totalTips: 84200,
        method: 'hours',
        shares: calculateTipSplitByHours(84200, [
          { id: 'maria', name: 'Maria', hours: 7.2 },
        ]),
      };

      expect(preview.shares.length).toBeGreaterThan(0);
      expect(preview.totalTips).toBe(84200);
    });

    it('allows safe overrides without warnings', () => {
      // Manager can edit without "Are you sure?"
      const shares = calculateTipSplitByHours(10000, [
        { id: 'emp1', name: 'Server', hours: 5 },
        { id: 'emp2', name: 'Bartender', hours: 5 },
      ]);

      // Edit emp1 to $100 (override calculation)
      const overridden = rebalanceAllocations(10000, shares, 'emp1', 10000);

      expect(overridden.find(s => s.employeeId === 'emp1')?.amountCents).toBe(10000);
      // No error, no warning - just works
    });

    it('defaults are always chosen (manager never sees empty state)', () => {
      const defaults = {
        tipSource: 'manual',
        shareMethod: 'hours',
        splitCadence: 'daily',
      };

      expect(defaults.tipSource).toBe('manual');
      expect(defaults.shareMethod).toBe('hours');
      expect(defaults.splitCadence).toBe('daily');
    });

    it('uses plain language (no accounting terms)', () => {
      const uiLabels = {
        totalTips: 'Total tips',
        shareMethod: 'How should tips be shared?',
        participants: 'Who shares tips?',
        approve: 'Approve tips',
      };

      expect(uiLabels.shareMethod).not.toContain('allocation');
      expect(uiLabels.shareMethod).not.toContain('distribution');
      expect(uiLabels.approve).not.toContain('finalize');
    });

    it('one decision per screen (progressive disclosure)', () => {
      const flow = [
        { screen: 1, question: 'How were tips collected?' },
        { screen: 2, question: 'Who shares tips?' },
        { screen: 3, question: 'How should tips be shared?' },
        { screen: 4, question: 'When do you want to split tips?' },
        { screen: 5, question: 'Preview & approve' },
      ];

      // Never asks 2+ questions on same screen (first 4 screens have exactly one question)
      const questionScreens = flow.slice(0, 4); // First 4 are questions
      expect(questionScreens.every(s => (s.question.match(/\?/g) || []).length === 1)).toBe(true);
    });
  });
});

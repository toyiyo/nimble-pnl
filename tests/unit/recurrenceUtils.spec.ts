import { describe, test, expect } from '@playwright/test';
import { 
  generateRecurringDates, 
  getRecurrenceDescription,
  getRecurrencePresetsForDate 
} from '../../src/utils/recurrenceUtils';
import { RecurrencePattern } from '../../src/types/scheduling';

describe('Recurrence Utilities', () => {
  test('generateRecurringDates - Daily recurrence', () => {
    const startDate = new Date('2024-01-01T09:00:00');
    const pattern: RecurrencePattern = {
      type: 'daily',
      interval: 1,
      endType: 'after',
      occurrences: 5,
    };

    const dates = generateRecurringDates(startDate, pattern);
    
    expect(dates.length).toBe(5);
    expect(dates[0].toISOString()).toBe(startDate.toISOString());
    expect(dates[1].toISOString()).toBe(new Date('2024-01-02T09:00:00').toISOString());
    expect(dates[4].toISOString()).toBe(new Date('2024-01-05T09:00:00').toISOString());
  });

  test('generateRecurringDates - Weekly recurrence', () => {
    const startDate = new Date('2024-01-01T09:00:00'); // Monday
    const pattern: RecurrencePattern = {
      type: 'weekly',
      interval: 1,
      daysOfWeek: [1], // Monday
      endType: 'after',
      occurrences: 3,
    };

    const dates = generateRecurringDates(startDate, pattern);
    
    expect(dates.length).toBe(3);
    expect(dates[0].toISOString()).toBe(startDate.toISOString());
    expect(dates[1].toISOString()).toBe(new Date('2024-01-08T09:00:00').toISOString());
    expect(dates[2].toISOString()).toBe(new Date('2024-01-15T09:00:00').toISOString());
  });

  test('generateRecurringDates - Weekday recurrence', () => {
    const startDate = new Date('2024-01-01T09:00:00'); // Monday
    const pattern: RecurrencePattern = {
      type: 'weekday',
      endType: 'after',
      occurrences: 5,
    };

    const dates = generateRecurringDates(startDate, pattern);
    
    expect(dates.length).toBe(5);
    // Should skip weekend
    expect(dates[0].getDay()).toBe(1); // Monday
    expect(dates[1].getDay()).toBe(2); // Tuesday
    expect(dates[2].getDay()).toBe(3); // Wednesday
    expect(dates[3].getDay()).toBe(4); // Thursday
    expect(dates[4].getDay()).toBe(5); // Friday
  });

  test('generateRecurringDates - Monthly recurrence', () => {
    const startDate = new Date('2024-01-15T09:00:00');
    const pattern: RecurrencePattern = {
      type: 'monthly',
      interval: 1,
      endType: 'after',
      occurrences: 3,
    };

    const dates = generateRecurringDates(startDate, pattern);
    
    expect(dates.length).toBe(3);
    expect(dates[0].getDate()).toBe(15);
    expect(dates[1].getDate()).toBe(15);
    expect(dates[2].getDate()).toBe(15);
    expect(dates[0].getMonth()).toBe(0); // January
    expect(dates[1].getMonth()).toBe(1); // February
    expect(dates[2].getMonth()).toBe(2); // March
  });

  test('generateRecurringDates - Yearly recurrence', () => {
    const startDate = new Date('2024-01-15T09:00:00');
    const pattern: RecurrencePattern = {
      type: 'yearly',
      interval: 1,
      endType: 'after',
      occurrences: 3,
    };

    const dates = generateRecurringDates(startDate, pattern);
    
    expect(dates.length).toBe(3);
    expect(dates[0].getFullYear()).toBe(2024);
    expect(dates[1].getFullYear()).toBe(2025);
    expect(dates[2].getFullYear()).toBe(2026);
  });

  test('getRecurrenceDescription - Daily', () => {
    const pattern: RecurrencePattern = {
      type: 'daily',
      interval: 1,
      endType: 'never',
    };

    const description = getRecurrenceDescription(pattern);
    expect(description).toBe('Daily');
  });

  test('getRecurrenceDescription - Weekly on Sunday', () => {
    const pattern: RecurrencePattern = {
      type: 'weekly',
      interval: 1,
      daysOfWeek: [0],
      endType: 'never',
    };

    const description = getRecurrenceDescription(pattern);
    expect(description).toBe('Weekly on Sunday');
  });

  test('getRecurrenceDescription - Every weekday', () => {
    const pattern: RecurrencePattern = {
      type: 'weekday',
      endType: 'never',
    };

    const description = getRecurrenceDescription(pattern);
    expect(description).toBe('Every weekday (Monday to Friday)');
  });

  test('getRecurrenceDescription - Monthly on third Sunday', () => {
    const pattern: RecurrencePattern = {
      type: 'monthly',
      interval: 1,
      daysOfWeek: [0],
      weekOfMonth: 3,
      endType: 'never',
    };

    const description = getRecurrenceDescription(pattern);
    expect(description).toBe('Monthly on the third Sunday');
  });

  test('getRecurrenceDescription - With end date', () => {
    const pattern: RecurrencePattern = {
      type: 'daily',
      interval: 1,
      endType: 'on',
      endDate: '2024-12-31',
    };

    const description = getRecurrenceDescription(pattern);
    expect(description).toContain('Daily');
    expect(description).toContain('Dec 31, 2024');
  });

  test('getRecurrenceDescription - With occurrences', () => {
    const pattern: RecurrencePattern = {
      type: 'weekly',
      interval: 1,
      daysOfWeek: [1],
      endType: 'after',
      occurrences: 10,
    };

    const description = getRecurrenceDescription(pattern);
    expect(description).toContain('Weekly on Monday');
    expect(description).toContain('10 times');
  });

  test('getRecurrencePresetsForDate - Monday', () => {
    const date = new Date('2024-01-01T09:00:00'); // Monday
    const presets = getRecurrencePresetsForDate(date);
    
    expect(presets.length).toBe(7);
    expect(presets[0].label).toBe('Does not repeat');
    expect(presets[2].label).toBe('Weekly on Monday');
    expect(presets[3].label).toContain('first Monday');
    expect(presets[4].label).toBe('Annually on January 1');
    expect(presets[5].label).toBe('Every weekday (Monday to Friday)');
    expect(presets[6].label).toBe('Custom...');
  });

  test('getRecurrencePresetsForDate - Sunday', () => {
    const date = new Date('2024-11-17T09:00:00'); // Sunday
    const presets = getRecurrencePresetsForDate(date);
    
    expect(presets[2].label).toBe('Weekly on Sunday');
    expect(presets[3].label).toContain('third Sunday');
    expect(presets[4].label).toBe('Annually on November 17');
  });
});

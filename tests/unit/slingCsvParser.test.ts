import { describe, it, expect } from 'vitest';
import {
  isSlingFormat,
  parseSlingShiftCell,
  parseSlingCSV,
  type ParsedShift,
} from '@/utils/slingCsvParser';

describe('slingCsvParser', () => {
  describe('isSlingFormat', () => {
    it('detects Sling grid format from date headers', () => {
      const headers = ['', '2026-02-23', '2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01'];
      const rows = [
        { '': 'Unassigned shifts', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
        { '': '', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
        { '': 'Scheduled shifts', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
        { '': 'Abraham Dominguez', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '10:00 AM - 11:00 PM • 13h\nServer • San Antonio\n ', '2026-03-01': '' },
      ];
      expect(isSlingFormat(headers, rows)).toBe(true);
    });

    it('rejects non-Sling CSV with regular headers', () => {
      const headers = ['Employee', 'Date', 'Start Time', 'End Time', 'Position'];
      const rows = [{ Employee: 'John', Date: '2026-02-23', 'Start Time': '9:00 AM', 'End Time': '5:00 PM', Position: 'Server' }];
      expect(isSlingFormat(headers, rows)).toBe(false);
    });
  });

  describe('parseSlingShiftCell', () => {
    it('parses a single shift cell', () => {
      const cell = '10:00 AM - 11:00 PM • 13h\nServer • San Antonio\n ';
      const shifts = parseSlingShiftCell(cell, '2026-02-28');
      expect(shifts).toHaveLength(1);
      expect(shifts[0].startTime).toBe('2026-02-28T10:00:00.000');
      expect(shifts[0].endTime).toBe('2026-02-28T23:00:00.000');
      expect(shifts[0].position).toBe('Server');
    });

    it('parses multiple shifts in one cell', () => {
      const cell = '10:00 AM - 5:00 PM • 7h\nServer • San Antonio\n \n5:00 PM - 1:00 AM • 8h\nServer • San Antonio\n ';
      const shifts = parseSlingShiftCell(cell, '2026-02-28');
      expect(shifts).toHaveLength(2);
      expect(shifts[0].endTime).toBe('2026-02-28T17:00:00.000');
      expect(shifts[1].startTime).toBe('2026-02-28T17:00:00.000');
      expect(shifts[1].endTime).toBe('2026-03-01T01:00:00.000');
    });

    it('handles overnight shifts (end time before start time)', () => {
      const cell = '5:00 PM - 1:00 AM • 8h\nBartender • San Antonio\n ';
      const shifts = parseSlingShiftCell(cell, '2026-02-28');
      expect(shifts).toHaveLength(1);
      expect(shifts[0].startTime).toBe('2026-02-28T17:00:00.000');
      expect(shifts[0].endTime).toBe('2026-03-01T01:00:00.000');
      expect(shifts[0].position).toBe('Bartender');
    });

    it('returns empty array for empty cell', () => {
      expect(parseSlingShiftCell('', '2026-02-28')).toEqual([]);
      expect(parseSlingShiftCell('  ', '2026-02-28')).toEqual([]);
    });
  });

  describe('parseSlingCSV', () => {
    const slingHeaders = ['', '2026-02-23', '2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01'];
    const slingRows = [
      { '': 'Unassigned shifts', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
      { '': '', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
      { '': 'Available shifts', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
      { '': '', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
      { '': 'Scheduled shifts', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
      {
        '': 'Abraham Dominguez',
        '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '',
        '2026-02-28': '10:00 AM - 11:00 PM • 13h\nServer • San Antonio\n ',
        '2026-03-01': '5:00 PM - 11:00 PM • 6h\nServer • San Antonio\n ',
      },
      {
        '': 'Gaspar Chef  Vidanez',
        '2026-02-23': '9:30 AM - 10:00 PM • 12h 30min\nKitchen Manager • San Antonio\n ',
        '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '',
      },
    ];

    it('parses all scheduled shifts from Sling grid', () => {
      const result = parseSlingCSV(slingHeaders, slingRows);
      expect(result).toHaveLength(3);
    });

    it('extracts employee names correctly', () => {
      const result = parseSlingCSV(slingHeaders, slingRows);
      const names = [...new Set(result.map(s => s.employeeName))];
      expect(names).toContain('Abraham Dominguez');
      expect(names).toContain('Gaspar Chef  Vidanez');
    });

    it('skips section header rows', () => {
      const result = parseSlingCSV(slingHeaders, slingRows);
      const names = result.map(s => s.employeeName);
      expect(names).not.toContain('Unassigned shifts');
      expect(names).not.toContain('Available shifts');
      expect(names).not.toContain('Scheduled shifts');
    });

    it('skips employees with no shifts in any column', () => {
      const rowsWithEmpty = [
        ...slingRows,
        { '': 'Angel Hernandez', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
      ];
      const result = parseSlingCSV(slingHeaders, rowsWithEmpty);
      const names = result.map(s => s.employeeName);
      expect(names).not.toContain('Angel Hernandez');
    });

    it('associates correct dates with shifts', () => {
      const result = parseSlingCSV(slingHeaders, slingRows);
      const abrahamShifts = result.filter(s => s.employeeName === 'Abraham Dominguez');
      expect(abrahamShifts[0].startTime).toContain('2026-02-28');
      expect(abrahamShifts[1].startTime).toContain('2026-03-01');
    });
  });
});

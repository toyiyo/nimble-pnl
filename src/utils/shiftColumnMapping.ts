import { normalizeEmployeeKey } from '@/utils/timePunchImport';

export type ShiftTargetField =
  | 'employee_name'
  | 'employee_id'
  | 'date'
  | 'start_time'
  | 'end_time'
  | 'start_datetime'
  | 'end_datetime'
  | 'position'
  | 'break_duration'
  | 'notes';

export interface ShiftColumnMapping {
  csvColumn: string;
  targetField: ShiftTargetField | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export interface ShiftFieldOption {
  value: ShiftTargetField | 'ignore';
  label: string;
  required?: boolean;
}

export const SHIFT_FIELD_OPTIONS: ShiftFieldOption[] = [
  { value: 'employee_name', label: 'Employee Name', required: true },
  { value: 'employee_id', label: 'Employee ID' },
  { value: 'date', label: 'Date' },
  { value: 'start_time', label: 'Start Time', required: true },
  { value: 'end_time', label: 'End Time', required: true },
  { value: 'start_datetime', label: 'Start Date/Time' },
  { value: 'end_datetime', label: 'End Date/Time' },
  { value: 'position', label: 'Position / Role' },
  { value: 'break_duration', label: 'Break Duration (min)' },
  { value: 'notes', label: 'Notes' },
  { value: 'ignore', label: '(Ignore this column)' },
];

interface KeywordPattern {
  keywords: string[];
  aliases?: string[];
  weight: number;
}

const FIELD_PATTERNS: Record<ShiftTargetField, KeywordPattern> = {
  employee_name: {
    keywords: ['employee', 'employee name', 'name', 'staff', 'team member', 'worker'],
    aliases: ['employee_name', 'staff_name'],
    weight: 10,
  },
  employee_id: {
    keywords: ['employee id', 'emp id', 'staff id', 'employee number'],
    aliases: ['employee_id', 'empid'],
    weight: 8,
  },
  date: {
    keywords: ['date', 'work date', 'shift date', 'day'],
    aliases: ['shift_date', 'work_date'],
    weight: 8,
  },
  start_time: {
    keywords: ['start time', 'time in', 'clock in', 'in time', 'start', 'begin', 'shift start'],
    aliases: ['start_time', 'clock_in', 'time_in'],
    weight: 9,
  },
  end_time: {
    keywords: ['end time', 'time out', 'clock out', 'out time', 'end', 'finish', 'shift end'],
    aliases: ['end_time', 'clock_out', 'time_out'],
    weight: 9,
  },
  start_datetime: {
    keywords: ['start datetime', 'shift start datetime'],
    aliases: ['start_datetime'],
    weight: 7,
  },
  end_datetime: {
    keywords: ['end datetime', 'shift end datetime'],
    aliases: ['end_datetime'],
    weight: 7,
  },
  position: {
    keywords: ['position', 'role', 'job', 'job title', 'department', 'station', 'title'],
    aliases: ['job_title', 'dept'],
    weight: 7,
  },
  break_duration: {
    keywords: ['break', 'break duration', 'break length', 'meal break', 'lunch', 'rest'],
    aliases: ['break_duration', 'break_minutes'],
    weight: 7,
  },
  notes: {
    keywords: ['notes', 'note', 'comments', 'comment', 'memo'],
    aliases: ['remarks'],
    weight: 5,
  },
};

const calculateConfidence = (csvColumn: string, targetField: ShiftTargetField) => {
  const pattern = FIELD_PATTERNS[targetField];
  const normalizedColumn = normalizeEmployeeKey(csvColumn);
  let score = 0;

  if (pattern.keywords.some(kw => normalizeEmployeeKey(kw) === normalizedColumn)) {
    score = pattern.weight * 10;
  } else if (pattern.aliases?.some(alias => normalizeEmployeeKey(alias) === normalizedColumn)) {
    score = pattern.weight * 9;
  } else if (pattern.keywords.some(kw => normalizedColumn.includes(normalizeEmployeeKey(kw)))) {
    score = pattern.weight * 7;
  }

  let confidence: ShiftColumnMapping['confidence'] = 'none';
  if (score >= 70) confidence = 'high';
  else if (score >= 40) confidence = 'medium';
  else if (score >= 20) confidence = 'low';

  return { score, confidence };
};

export const suggestShiftMappings = (
  headers: string[],
  sampleData: Record<string, string>[],
): ShiftColumnMapping[] => {
  const mappings: ShiftColumnMapping[] = [];
  const mappedFields = new Set<ShiftTargetField>();

  headers.forEach(csvColumn => {
    let bestMatch: { field: ShiftTargetField; score: number; confidence: ShiftColumnMapping['confidence'] } | null = null;

    (Object.keys(FIELD_PATTERNS) as ShiftTargetField[]).forEach(targetField => {
      const { score, confidence } = calculateConfidence(csvColumn, targetField);
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        if (!mappedFields.has(targetField)) {
          bestMatch = { field: targetField, score, confidence };
        }
      }
    });

    if (bestMatch && bestMatch.confidence !== 'none') {
      mappedFields.add(bestMatch.field);
      mappings.push({
        csvColumn,
        targetField: bestMatch.field,
        confidence: bestMatch.confidence,
      });
    } else {
      mappings.push({
        csvColumn,
        targetField: null,
        confidence: 'none',
      });
    }
  });

  const hasEmployee = mappings.some(m => m.targetField === 'employee_name');
  if (!hasEmployee) {
    const firstTextColumn = mappings.find(m => {
      if (m.targetField !== null) return false;
      const samples = sampleData.slice(0, 5).map(row => row[m.csvColumn]);
      return samples.some(v => v && Number.isNaN(Number.parseFloat(v)));
    });
    if (firstTextColumn) {
      firstTextColumn.targetField = 'employee_name';
      firstTextColumn.confidence = 'low';
    }
  }

  return mappings;
};

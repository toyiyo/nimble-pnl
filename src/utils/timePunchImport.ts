import { parseWorkPeriods } from '@/utils/payrollCalculations';
import { TimePunch } from '@/types/timeTracking';
import { Employee } from '@/types/scheduling';

export type TimePunchTargetField =
  | 'employee_name'
  | 'employee_id'
  | 'action'
  | 'timestamp'
  | 'date'
  | 'clock_in_time'
  | 'clock_out_time'
  | 'break_start_time'
  | 'break_end_time'
  | 'tips'
  | 'notes';

export interface TimePunchColumnMapping {
  csvColumn: string;
  targetField: TimePunchTargetField | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export interface TimePunchFieldOption {
  value: TimePunchTargetField | 'ignore';
  label: string;
  required?: boolean;
}

export const TIME_PUNCH_FIELD_OPTIONS: TimePunchFieldOption[] = [
  { value: 'employee_name', label: 'Employee Name', required: true },
  { value: 'employee_id', label: 'Employee ID' },
  { value: 'action', label: 'Action (Clock In/Out)' },
  { value: 'timestamp', label: 'Timestamp' },
  { value: 'date', label: 'Date' },
  { value: 'clock_in_time', label: 'Clock In Time' },
  { value: 'clock_out_time', label: 'Clock Out Time' },
  { value: 'break_start_time', label: 'Break Start Time' },
  { value: 'break_end_time', label: 'Break End Time' },
  { value: 'tips', label: 'Tips' },
  { value: 'notes', label: 'Notes' },
  { value: 'ignore', label: '(Ignore this column)' },
];

interface KeywordPattern {
  keywords: string[];
  aliases?: string[];
  weight: number;
}

const FIELD_PATTERNS: Record<TimePunchTargetField, KeywordPattern> = {
  employee_name: {
    keywords: ['employee', 'employee name', 'staff', 'team member', 'name'],
    aliases: ['employee_name', 'staff member'],
    weight: 10,
  },
  employee_id: {
    keywords: ['employee id', 'emp id', 'staff id', 'employee number', 'id'],
    aliases: ['employee_id', 'empid'],
    weight: 8,
  },
  action: {
    keywords: ['action', 'type', 'punch type', 'event', 'status'],
    aliases: ['punch_type'],
    weight: 8,
  },
  timestamp: {
    keywords: ['timestamp', 'time', 'punch time', 'datetime', 'clock time'],
    aliases: ['punch_time'],
    weight: 7,
  },
  date: {
    keywords: ['date', 'work date', 'punch date', 'shift date'],
    aliases: ['work_date'],
    weight: 8,
  },
  clock_in_time: {
    keywords: ['time in', 'clock in', 'in time', 'start time', 'shift start'],
    aliases: ['clock_in'],
    weight: 9,
  },
  clock_out_time: {
    keywords: ['time out', 'clock out', 'out time', 'end time', 'shift end'],
    aliases: ['clock_out'],
    weight: 9,
  },
  break_start_time: {
    keywords: ['break start', 'break in', 'meal start', 'lunch start'],
    aliases: ['break_start'],
    weight: 6,
  },
  break_end_time: {
    keywords: ['break end', 'break out', 'meal end', 'lunch end', 'return'],
    aliases: ['break_end'],
    weight: 6,
  },
  tips: {
    keywords: ['tip', 'tips', 'gratuity', 'cash tips'],
    aliases: ['tip_amount'],
    weight: 7,
  },
  notes: {
    keywords: ['notes', 'note', 'comments', 'comment', 'anomalies', 'flags'],
    aliases: ['remarks'],
    weight: 5,
  },
};

export interface TimePunchInsert {
  restaurant_id: string;
  employee_id: string;
  punch_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  punch_time: string;
  notes?: string | null;
  device_info?: string | null;
}

export interface EmployeeTipInsert {
  restaurant_id: string;
  employee_id: string;
  tip_amount: number;
  tip_source: string;
  tip_date: string;
  recorded_at: string;
  notes?: string | null;
}

export interface TimePunchImportPreview {
  punches: TimePunchInsert[];
  tips: EmployeeTipInsert[];
  totalPunches: number;
  totalTips: number;
  incompleteShifts: number;
  overlappingShifts: number;
  missingEmployees: number;
  invalidTimes: number;
  skippedRows: number;
  mode: 'action' | 'shift';
  unmatchedEmployees: Array<{ name: string; count: number }>;
}

export const normalizeEmployeeKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeNumber = (value: string | undefined): number | null => {
  if (!value) return null;
  let normalized = value.trim();
  if (!normalized) return null;

  normalized = normalized.replace(/[$,]/g, '');
  if (normalized.startsWith('(') && normalized.endsWith(')')) {
    normalized = `-${normalized.slice(1, -1)}`;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isNaN(parsed) ? null : parsed;
};

const looksLikeDate = (value: string) =>
  /(\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\/\d{1,2})/i.test(value);

const parseDateTime = (datePart?: string, timePart?: string) => {
  const combined = [datePart, timePart].filter(Boolean).join(' ').trim();
  if (!combined) return null;
  const parsed = new Date(combined);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const resolveEmployeeId = (
  row: Record<string, string>,
  mappings: Map<TimePunchTargetField, string>,
  employees: Employee[],
  overrides?: Record<string, string>,
): { employeeId: string | null; missing: boolean } => {
  const employeeNameColumn = mappings.get('employee_name');
  const rawName = employeeNameColumn ? row[employeeNameColumn]?.trim() : '';
  const normalizedName = rawName ? normalizeEmployeeKey(rawName) : '';
  if (normalizedName && overrides?.[normalizedName]) {
    return { employeeId: overrides[normalizedName], missing: false };
  }

  const employeeIdColumn = mappings.get('employee_id');
  if (employeeIdColumn) {
    const rawId = row[employeeIdColumn]?.trim();
    if (rawId) {
      const match = employees.find(emp => emp.id === rawId);
      if (match) {
        return { employeeId: match.id, missing: false };
      }
    }
  }

  if (!employeeNameColumn || !rawName) {
    return { employeeId: null, missing: true };
  }

  const lookup = buildEmployeeLookup(employees);
  const match = lookup.get(normalizedName);
  return { employeeId: match?.id ?? null, missing: !match };
};

const buildEmployeeLookup = (employees: Employee[]) => {
  const lookup = new Map<string, Employee>();

  const add = (name: string, employee: Employee) => {
    const normalized = normalizeEmployeeKey(name);
    if (normalized) {
      lookup.set(normalized, employee);
    }
  };

  employees.forEach(employee => {
    add(employee.name, employee);

    const commaParts = employee.name.split(',').map(part => part.trim()).filter(Boolean);
    if (commaParts.length === 2) {
      const [last, first] = commaParts;
      add(`${first} ${last}`, employee);
      add(`${last} ${first}`, employee);
    } else {
      const words = employee.name.trim().split(/\s+/);
      if (words.length >= 2) {
        const first = words[0];
        const last = words[words.length - 1];
        add(`${last}, ${first}`, employee);
        add(`${last} ${first}`, employee);
      }
    }
  });

  return lookup;
};

const getMappedValue = (
  row: Record<string, string>,
  mappings: Map<TimePunchTargetField, string>,
  field: TimePunchTargetField,
) => {
  const column = mappings.get(field);
  return column ? row[column] : undefined;
};

const mapActionToPunchType = (value: string | undefined) => {
  if (!value) return null;
  const normalized = normalizeEmployeeKey(value);

  if (normalized.includes('break') || normalized.includes('meal')) {
    if (normalized.includes('start') || normalized.includes('in') || normalized.includes('begin')) {
      return 'break_start' as const;
    }
    if (normalized.includes('end') || normalized.includes('out') || normalized.includes('return')) {
      return 'break_end' as const;
    }
  }

  if (normalized.includes('clock') || normalized.includes('shift')) {
    if (normalized.includes('out') || normalized.includes('end')) {
      return 'clock_out' as const;
    }
    if (normalized.includes('in') || normalized.includes('start')) {
      return 'clock_in' as const;
    }
  }

  if (normalized === 'in' || normalized.includes('clock in')) {
    return 'clock_in' as const;
  }
  if (normalized === 'out' || normalized.includes('clock out') || normalized.includes('auto clock out')) {
    return 'clock_out' as const;
  }

  return null;
};

const calculateConfidence = (csvColumn: string, targetField: TimePunchTargetField) => {
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

  const confidence: TimePunchColumnMapping['confidence'] =
    score >= 70 ? 'high' :
    score >= 40 ? 'medium' :
    score >= 20 ? 'low' :
    'none';

  return { score, confidence };
};

export const suggestTimePunchMappings = (
  headers: string[],
  sampleData: Record<string, string>[],
): TimePunchColumnMapping[] => {
  const mappings: TimePunchColumnMapping[] = [];
  const mappedFields = new Set<TimePunchTargetField>();

  headers.forEach(csvColumn => {
    let bestMatch: { field: TimePunchTargetField; score: number; confidence: TimePunchColumnMapping['confidence'] } | null = null;

    (Object.keys(FIELD_PATTERNS) as TimePunchTargetField[]).forEach(targetField => {
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

export const buildTimePunchImportPreview = ({
  rows,
  mappings,
  employees,
  restaurantId,
  sourceLabel,
  employeeOverrides,
}: {
  rows: Record<string, string>[];
  mappings: TimePunchColumnMapping[];
  employees: Employee[];
  restaurantId: string;
  sourceLabel: string;
  employeeOverrides?: Record<string, string>;
}): TimePunchImportPreview => {
  const mappingLookup = new Map<TimePunchTargetField, string>();
  mappings.forEach(mapping => {
    if (mapping.targetField) {
      mappingLookup.set(mapping.targetField, mapping.csvColumn);
    }
  });

  const hasActionMode = mappingLookup.has('action') && mappingLookup.has('timestamp');
  const hasShiftMode = mappingLookup.has('clock_in_time') || mappingLookup.has('clock_out_time') || mappingLookup.has('break_start_time') || mappingLookup.has('break_end_time');
  const mode: TimePunchImportPreview['mode'] = hasActionMode ? 'action' : 'shift';
  const deviceInfo = `import:${sourceLabel}`;
  const tipColumn = mappingLookup.get('tips');
  const tipSource = tipColumn?.toLowerCase().includes('cash') ? 'cash' : 'other';

  let missingEmployees = 0;
  let invalidTimes = 0;
  let skippedRows = 0;
  let totalTips = 0;
  const unmatchedMap = new Map<string, { name: string; count: number }>();

  const punches: TimePunchInsert[] = [];
  const tips: EmployeeTipInsert[] = [];

  rows.forEach((row) => {
    const { employeeId, missing } = resolveEmployeeId(row, mappingLookup, employees, employeeOverrides);
    if (!employeeId) {
      missingEmployees += missing ? 1 : 0;
      skippedRows += 1;
      const nameColumn = mappingLookup.get('employee_name');
      const rawName = nameColumn ? row[nameColumn]?.trim() : '';
      if (rawName) {
        const normalized = normalizeEmployeeKey(rawName);
        if (normalized) {
          const current = unmatchedMap.get(normalized) ?? { name: rawName, count: 0 };
          unmatchedMap.set(normalized, { name: current.name, count: current.count + 1 });
        }
      }
      return;
    }

    const dateValue = getMappedValue(row, mappingLookup, 'date')?.trim();
    const notesValue = getMappedValue(row, mappingLookup, 'notes')?.trim();

    if (mode === 'action') {
      const actionValue = getMappedValue(row, mappingLookup, 'action');
      const type = mapActionToPunchType(actionValue);
      const timestampValue = getMappedValue(row, mappingLookup, 'timestamp')?.trim();
      if (
        timestampValue
        && !looksLikeDate(timestampValue)
        && !dateValue
      ) {
        invalidTimes += 1;
        skippedRows += 1;
        return;
      }

      const parsed = timestampValue
        ? looksLikeDate(timestampValue)
          ? parseDateTime(undefined, timestampValue)
          : parseDateTime(dateValue, timestampValue)
        : null;
      if (!type || !parsed) {
        invalidTimes += 1;
        skippedRows += 1;
        return;
      }

      punches.push({
        restaurant_id: restaurantId,
        employee_id: employeeId,
        punch_type: type,
        punch_time: parsed.toISOString(),
        notes: notesValue || null,
        device_info: deviceInfo,
      });
    } else {
      const timeColumns: Array<{ field: TimePunchTargetField; type: TimePunchInsert['punch_type'] }> = [
        { field: 'clock_in_time', type: 'clock_in' },
        { field: 'clock_out_time', type: 'clock_out' },
        { field: 'break_start_time', type: 'break_start' },
        { field: 'break_end_time', type: 'break_end' },
      ];

      let rowHadTime = false;
      timeColumns.forEach(({ field, type }) => {
        const timeValue = getMappedValue(row, mappingLookup, field)?.trim();
        if (!timeValue) return;

        if (!looksLikeDate(timeValue) && !dateValue) {
          invalidTimes += 1;
          return;
        }

        const parsed = looksLikeDate(timeValue)
          ? parseDateTime(undefined, timeValue)
          : parseDateTime(dateValue, timeValue);
        if (!parsed) {
          invalidTimes += 1;
          return;
        }
        rowHadTime = true;
        punches.push({
          restaurant_id: restaurantId,
          employee_id: employeeId,
          punch_type: type,
          punch_time: parsed.toISOString(),
          notes: notesValue || null,
          device_info: deviceInfo,
        });
      });

      if (!rowHadTime) {
        skippedRows += 1;
      }
    }

    const tipValue = getMappedValue(row, mappingLookup, 'tips');
    const tipAmount = normalizeNumber(tipValue);
    if (tipAmount && tipAmount !== 0) {
      totalTips += tipAmount;
      const tipDate = parseDateTime(dateValue)?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      tips.push({
        restaurant_id: restaurantId,
        employee_id: employeeId,
        tip_amount: Math.round(tipAmount * 100),
        tip_source: tipSource ?? 'other',
        tip_date: tipDate,
        recorded_at: new Date().toISOString(),
        notes: notesValue || null,
      });
    }
  });

  let incompleteShifts = 0;
  let overlappingShifts = 0;

  const punchesByEmployee = new Map<string, TimePunch[]>();
  punches.forEach((punch, index) => {
    const existing = punchesByEmployee.get(punch.employee_id) || [];
    existing.push({
      id: `${punch.employee_id}-${index}`,
      restaurant_id: punch.restaurant_id,
      employee_id: punch.employee_id,
      punch_type: punch.punch_type,
      punch_time: punch.punch_time,
      created_at: '',
      updated_at: '',
    } as TimePunch);
    punchesByEmployee.set(punch.employee_id, existing);
  });

  punchesByEmployee.forEach((employeePunches) => {
    const { periods, incompleteShifts: employeeIncomplete } = parseWorkPeriods(employeePunches);
    incompleteShifts += employeeIncomplete.length;

    const workPeriods = periods
      .filter(period => !period.isBreak)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    let lastEnd: Date | null = null;
    workPeriods.forEach(period => {
      if (lastEnd && period.startTime < lastEnd) {
        overlappingShifts += 1;
      }
      if (!lastEnd || period.endTime > lastEnd) {
        lastEnd = period.endTime;
      }
    });
  });

  return {
    punches,
    tips,
    totalPunches: punches.length,
    totalTips,
    incompleteShifts,
    overlappingShifts,
    missingEmployees,
    invalidTimes,
    skippedRows,
    mode,
    unmatchedEmployees: Array.from(unmatchedMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
  };
};

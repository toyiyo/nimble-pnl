import { Employee } from '@/types/scheduling';
import { normalizeEmployeeKey } from '@/utils/timePunchImport';

export interface ShiftImportEmployee {
  csvName: string;
  normalizedName: string;
  matchedEmployeeId: string | null;
  matchedEmployeeName: string | null;
  matchConfidence: 'exact' | 'partial' | 'none';
  csvPosition: string;
  action: 'link' | 'create' | 'skip';
  suggestedEmployeeId?: string;
  suggestedEmployeeName?: string;
}

function buildEmployeeLookup(employees: Employee[]) {
  const lookup = new Map<string, Employee>();
  const add = (name: string, employee: Employee) => {
    const normalized = normalizeEmployeeKey(name);
    if (normalized && !lookup.has(normalized)) lookup.set(normalized, employee);
  };
  employees.forEach(employee => {
    add(employee.name, employee);
    const commaParts = employee.name.split(',').map(p => p.trim()).filter(Boolean);
    if (commaParts.length === 2) {
      const [last, first] = commaParts;
      add(`${first} ${last}`, employee);
      add(`${last} ${first}`, employee);
    } else {
      const words = employee.name.trim().split(/\s+/);
      if (words.length >= 2) {
        const first = words[0];
        const last = words.at(-1);
        add(`${last}, ${first}`, employee);
        add(`${last} ${first}`, employee);
      }
    }
  });
  return lookup;
}

function findPartialMatch(normalizedName: string, employees: Employee[]): Employee | null {
  const csvWords = normalizedName.split(' ').filter(w => w.length > 1);
  if (csvWords.length === 0) return null;
  let bestMatch: Employee | null = null;
  let bestScore = 0;
  for (const emp of employees) {
    const empWords = normalizeEmployeeKey(emp.name).split(' ').filter(w => w.length > 1);
    const matchingWords = csvWords.filter(w => empWords.includes(w));
    // Asymmetric: fraction of DB employee's name words found in CSV
    // "Gaspar Chef Vidanez" vs "Gaspar Vidanez" → 2/2 = 1.0 (good)
    // "Carlos García López" vs "José García López" → 2/3 = 0.67 (rejected)
    const score = empWords.length > 0 ? matchingWords.length / empWords.length : 0;
    if (score >= 0.8 && score > bestScore && matchingWords.length >= 2) {
      bestScore = score;
      bestMatch = emp;
    }
  }
  return bestMatch;
}

function getMostFrequent(values: string[]): string {
  const counts = new Map<string, number>();
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  let best = values[0] || '';
  let bestCount = 0;
  counts.forEach((count, value) => {
    if (count > bestCount) { best = value; bestCount = count; }
  });
  return best;
}

export function matchEmployees(
  csvNames: Array<{ name: string; position: string }>,
  employees: Employee[],
): ShiftImportEmployee[] {
  const lookup = buildEmployeeLookup(employees);
  const grouped = new Map<string, { originalNames: string[]; positions: string[] }>();
  for (const { name, position } of csvNames) {
    const normalized = normalizeEmployeeKey(name);
    if (!normalized) continue;
    const entry = grouped.get(normalized) || { originalNames: [], positions: [] };
    if (!entry.originalNames.includes(name)) entry.originalNames.push(name);
    entry.positions.push(position);
    grouped.set(normalized, entry);
  }
  const results: ShiftImportEmployee[] = [];
  grouped.forEach((group, normalizedName) => {
    const csvName = group.originalNames[0];
    const csvPosition = getMostFrequent(group.positions.filter(Boolean)) || '';
    const exactMatch = lookup.get(normalizedName);
    if (exactMatch) {
      results.push({ csvName, normalizedName, matchedEmployeeId: exactMatch.id, matchedEmployeeName: exactMatch.name, matchConfidence: 'exact', csvPosition, action: 'link' });
      return;
    }
    const partialMatch = findPartialMatch(normalizedName, employees);
    if (partialMatch) {
      results.push({
        csvName,
        normalizedName,
        matchedEmployeeId: null,
        matchedEmployeeName: null,
        matchConfidence: 'partial',
        csvPosition,
        action: 'create',
        suggestedEmployeeId: partialMatch.id,
        suggestedEmployeeName: partialMatch.name,
      });
      return;
    }
    results.push({ csvName, normalizedName, matchedEmployeeId: null, matchedEmployeeName: null, matchConfidence: 'none', csvPosition, action: 'create' });
  });
  return results.sort((a, b) => a.csvName.localeCompare(b.csvName));
}

export function getDuplicateEmployeeIds(matches: ShiftImportEmployee[]): Set<string> {
  const counts = new Map<string, number>();
  for (const m of matches) {
    if (m.matchedEmployeeId && m.action === 'link') {
      counts.set(m.matchedEmployeeId, (counts.get(m.matchedEmployeeId) || 0) + 1);
    }
  }
  const dupes = new Set<string>();
  counts.forEach((count, id) => {
    if (count > 1) dupes.add(id);
  });
  return dupes;
}

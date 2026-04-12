import type { ShiftTemplate } from '@/types/scheduling';

const UNASSIGNED = 'Unassigned';

export interface TemplateAreaGroup {
  area: string;
  templates: ShiftTemplate[];
}

/**
 * Groups templates by area, sorted alphabetically with "Unassigned" last.
 * If areaFilter is provided, returns only that area's group.
 */
export function groupTemplatesByArea(
  templates: ShiftTemplate[],
  areaFilter?: string | null,
): TemplateAreaGroup[] {
  if (templates.length === 0) return [];

  const filtered = areaFilter
    ? templates.filter((t) =>
        areaFilter === UNASSIGNED ? !t.area : t.area === areaFilter,
      )
    : templates;

  const map = new Map<string, ShiftTemplate[]>();

  for (const t of filtered) {
    const key = t.area ?? UNASSIGNED;
    const group = map.get(key);
    if (group) {
      group.push(t);
    } else {
      map.set(key, [t]);
    }
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === UNASSIGNED) return 1;
      if (b === UNASSIGNED) return -1;
      return a.localeCompare(b);
    })
    .map(([area, templates]) => ({ area, templates }));
}

/** Extract unique area names from templates (for filter pills) */
export function getTemplateAreas(templates: ShiftTemplate[]): string[] {
  const areas = new Set<string>();
  for (const t of templates) {
    if (t.area) areas.add(t.area);
  }
  return Array.from(areas).sort();
}

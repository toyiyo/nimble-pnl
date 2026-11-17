import type { GroupByMode } from '@/lib/scheduleGrouping';

/** The six tabs of the Scheduling page. */
export const SCHEDULING_TABS = [
  'schedule',
  'timeoff',
  'availability',
  'trades',
  'planner',
  'templates',
] as const;
export type SchedulingTab = (typeof SCHEDULING_TABS)[number];

/** Every URL param name of the Scheduling page. One name for one feature. */
export const SCHEDULING_PARAMS = {
  tab: 'tab',
  week: 'week',
  area: 'area',
  position: 'position',
  group: 'group',
  day: 'day',
  view: 'view',
  plannerArea: 'plannerArea',
  hidden: 'hidden',
  timelineGroup: 'timelineGroup',
  template: 'template',
} as const;

export type PlannerView = 'plan' | 'timeline';

/** A parser returns the typed value, or null when the raw value is not valid. */
export type ParamParser<T extends string> = (raw: string | null) => T | null;

export interface ParamSpec<T extends string> {
  key: string;
  fallback: T;
  parse: ParamParser<T>;
  /** When true, the setter writes the value even if it equals the fallback. */
  keepDefault?: boolean;
}

const MAX_FREE_TEXT = 200;

export const parseTab: ParamParser<SchedulingTab> = (raw) =>
  (SCHEDULING_TABS as readonly string[]).includes(raw ?? '') ? (raw as SchedulingTab) : null;

export const parseGroupBy: ParamParser<GroupByMode> = (raw) =>
  raw === 'none' || raw === 'area' || raw === 'position' ? raw : null;

export const parsePlannerView: ParamParser<PlannerView> = (raw) =>
  raw === 'plan' || raw === 'timeline' ? raw : null;

export const parseIsoDay: ParamParser<string> = (raw) => {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const valid =
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return valid ? raw : null;
};

export const parseFlag: ParamParser<'1'> = (raw) => (raw === '1' ? '1' : null);

export const parseFreeText: ParamParser<string> = (raw) =>
  raw && raw.length <= MAX_FREE_TEXT ? raw : null;

export const tabParam: ParamSpec<SchedulingTab> = {
  key: SCHEDULING_PARAMS.tab,
  fallback: 'schedule',
  parse: parseTab,
};
export const areaParam: ParamSpec<string> = {
  key: SCHEDULING_PARAMS.area,
  fallback: 'all',
  parse: parseFreeText,
};
export const positionParam: ParamSpec<string> = {
  key: SCHEDULING_PARAMS.position,
  fallback: 'all',
  parse: parseFreeText,
};
export const groupParam: ParamSpec<GroupByMode> = {
  key: SCHEDULING_PARAMS.group,
  fallback: 'none',
  parse: parseGroupBy,
  keepDefault: true,
};
export const dayParam: ParamSpec<string> = {
  key: SCHEDULING_PARAMS.day,
  fallback: '',
  parse: parseIsoDay,
};
export const viewParam: ParamSpec<PlannerView> = {
  key: SCHEDULING_PARAMS.view,
  fallback: 'plan',
  parse: parsePlannerView,
};
export const plannerAreaParam: ParamSpec<string> = {
  key: SCHEDULING_PARAMS.plannerArea,
  fallback: 'all',
  parse: parseFreeText,
};
export const hiddenParam: ParamSpec<'1' | ''> = {
  key: SCHEDULING_PARAMS.hidden,
  fallback: '',
  parse: parseFlag,
};
export const timelineGroupParam: ParamSpec<GroupByMode> = {
  key: SCHEDULING_PARAMS.timelineGroup,
  fallback: 'area',
  parse: parseGroupBy,
};
export const templateParam: ParamSpec<string> = {
  key: SCHEDULING_PARAMS.template,
  fallback: '',
  parse: parseFreeText,
};

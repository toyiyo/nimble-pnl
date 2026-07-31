import { useMemo, useState } from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { AlertTriangle, ArrowLeft, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RolePreviewPanel } from '@/components/roles/RolePreviewPanel';
import { useRoles, type RoleAreaGrant, type RoleWithGrants } from '@/hooks/useRoles';
import { useRestaurants } from '@/hooks/useRestaurants';
import {
  AREA_DEFINITIONS,
  type AreaDefinition,
  type AreaKey,
  type AreaLevel,
  type Band,
  type SensitiveFlag,
} from '@/lib/permissions/areas';
import { cn } from '@/lib/utils';

/**
 * RoleEditor — the full-page, two-column custom role editor (roles-and-areas
 * design, Phase 4 task 9d).
 *
 * **Corrected against the approved prototype** (docs/design-reference/
 * roles-and-areas.html, editor.png/editor-dark.png): a full page reached from
 * the roles list via a "← All roles" back link, not a dialog — an earlier
 * draft of the design doc described a `max-w-2xl` dialog, which the design
 * doc's own "The role editor" section calls out as an explicitly corrected
 * mistake. Left column: identity card, then the ten areas grouped into three
 * bands. Right column (sticky at `lg`): `RolePreviewPanel` (task 9e), which
 * renders `buildRolePreview`'s (preview.ts, task 9b) output — this file only
 * owns the `grants`/`flags`/`name` state and passes it down, it does not
 * render the preview column itself.
 *
 * The three-state area control is a real `RadioGroup` (Radix's
 * `react-radio-group` primitives, used directly rather than through
 * `ui/radio-group.tsx`'s circular-radio styling, which cannot be restyled
 * into a segmented control without changing that shared component) — "No
 * access / View / Manage" are mutually exclusive values of one setting, radio
 * semantics, not a `ToggleGroup`'s independent pressed buttons. Per-area caps
 * (`AreaDefinition.maxLevelForCollaborator`) drive which segments are
 * `disabled` + `aria-disabled`, with the reason text as their
 * `aria-describedby` target — transcribed from the design doc's per-area cap
 * table and the prototype's `AREAS` array, keyed by `AREA_DEFINITIONS`' row
 * keys (which match the prototype's own area keys 1:1).
 *
 * Builtin roles are read-only: no field or control here writes anything (the
 * database's `role_areas_enforce_collaborator_cap`/immutability triggers are
 * the actual guard, per the design doc — this is only the UI hint). A
 * builtin row whose underlying `area_key`s hold *different* levels (only
 * possible for a builtin, seeded directly in SQL — a custom role's own
 * segmented control always writes the same level to every `area_key` in a
 * row) cannot be represented by one three-state control, so it renders a
 * static "Partial" marker instead.
 *
 * "Copy role to other restaurants" (design doc, same section) has no
 * prototype precedent — confirmed by a full read of
 * docs/design-reference/roles-and-areas.html, which contains no such UI at
 * all — so it is built net-new here per the design doc's abstract
 * requirement: "a multi-select of the caller's other restaurants... a
 * labelled listbox, not a bare div of checkboxes." A native `<select
 * multiple>` wired to a `<Label htmlFor>` gets real `listbox`/`option` ARIA
 * roles and an accessible name for free, which is exactly that requirement,
 * without inventing bespoke listbox keyboard handling.
 */

export interface RoleEditorProps {
  restaurantId: string;
  /** `null` means a brand-new, unsaved draft. */
  role: RoleWithGrants | null;
  onBack: () => void;
}

type Grants = Partial<Record<AreaKey, AreaLevel>>;

/** Per-row hint text, transcribed verbatim from the prototype's `AREAS[].hint`. */
const AREA_HINT: Record<string, string> = {
  reports: 'Daily numbers, saved reports, AI assistant',
  sales: 'Ticket-level sales from your POS',
  inventory: 'Counts, audits, purchase orders, receipts',
  recipes: 'Recipes, prep recipes, production batches',
  scheduling: 'Schedules, time punches, tip pools',
  books: 'Transactions, banking, expenses, invoices, statements',
  payroll: 'Pay runs and payroll history',
  employees: 'Roster, jobs, wage assignments',
  team: 'Invite people, assign roles, edit these roles',
  settings: 'Restaurant settings, POS and bank connections',
};

/**
 * Per-row cap reason, transcribed verbatim from the design doc's per-area cap
 * table and the prototype's `AREAS[].viewOnlyReason`/`manageOwnerOnly`/
 * `ownerOnly`. Only rows with a non-'manage' `maxLevelForCollaborator` need
 * one — every other row is uncapped.
 */
const AREA_LOCK_REASON: Record<string, string> = {
  reports: 'Nothing there is editable.',
  sales: 'Sales come from your POS — nobody edits them here.',
  payroll: 'Owners and Managers only.',
  team: 'Owners and Managers only — a collaborator can never grant access.',
  settings: 'Owners and Managers only.',
};

const SENSITIVE_FLAGS: ReadonlyArray<{
  flag: SensitiveFlag;
  name: string;
  hint: string;
  requires: readonly AreaKey[];
}> = [
  {
    flag: 'view:costs',
    name: 'Item costs & margins',
    hint: 'Unit costs, recipe cost, plate margin',
    requires: ['inventory', 'recipes', 'reports'],
  },
  {
    flag: 'view:pay_rates',
    name: 'Employee pay rates',
    hint: 'Hourly and salary amounts on the roster and schedule',
    requires: ['employees', 'scheduling'],
  },
  {
    flag: 'view:employee_pii',
    name: 'Contact details & tax IDs',
    hint: 'Phone, address, last 4 of SSN',
    requires: ['employees'],
  },
];

const BAND_ORDER: readonly Band[] = ['Operations', 'Money', 'People & admin'];

function grantMapFrom(areas: RoleAreaGrant[]): Grants {
  const map: Grants = {};
  for (const grant of areas) map[grant.area_key] = grant.level;
  return map;
}

/** A row is "partial" when its underlying area_keys disagree — only possible for a builtin. */
function rowIsPartial(row: AreaDefinition, grants: Grants): boolean {
  if (row.areaKeys.length < 2) return false;
  const levels = row.areaKeys.map((key) => grants[key] ?? null);
  return new Set(levels).size > 1;
}

function areaKeyLabel(key: AreaKey): string {
  return AREA_DEFINITIONS.find((row) => row.areaKeys.includes(key))?.label ?? key;
}

function memberNoticeText(count: number): string {
  return count === 1
    ? '1 person has this role. Saving changes what they can reach the next time they load a page.'
    : `${count} people have this role. Saving changes what they can reach the next time they load a page.`;
}

/**
 * A band's tinted full-bleed header strip, with the column legend on the right.
 *
 * Full-bleed (no horizontal padding on the parent) is what separates one band
 * from the next in the approved design — the rows below it are the ones that
 * get the padding.
 */
function BandHeader({ label, legend, first }: { label: string; legend?: string; first?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 px-5 py-2.5 bg-muted border-b border-border/40',
        !first && 'border-t'
      )}
    >
      {/* Mono, small, wide-tracked — the prototype's `.band h3` / `.band .legend`. */}
      <h3 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">{label}</h3>
      {legend && (
        // Hidden on narrow screens: the rows below stack there, so the legend
        // no longer sits above the columns it names — the prototype drops it
        // at the same breakpoint (`@media (max-width: 620px)`).
        <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70 whitespace-nowrap">
          {legend}
        </span>
      )}
    </div>
  );
}

/**
 * One segment ("No access" / "View" / "Manage") of the segmented RadioGroup.
 *
 * A capped segment carries a padlock, per the approved prototype — the
 * `disabled` opacity alone reads as "not selected yet" rather than "you can
 * never pick this". The glyph is `aria-hidden` so it stays out of the radio's
 * accessible name (which the E2E spec matches exactly, `/^manage$/i`); the
 * *reason* is already exposed through `aria-describedby`, which is where a
 * screen reader should get it from.
 *
 * `accent` makes the checked state solid-primary instead of the plain
 * background pill. Only Manage passes it: the prototype uses the accent fill
 * to make "this role can change things" legible at a glance down the column,
 * which a uniformly-white pill does not.
 */
function Segment({
  value,
  label,
  disabled,
  locked,
  describedBy,
  accent,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  /** Draws the padlock. Separate from `disabled` so a wholly read-only builtin row doesn't sprout three of them. */
  locked?: boolean;
  describedBy?: string;
  accent?: boolean;
}) {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      disabled={disabled}
      aria-disabled={disabled ? true : undefined}
      aria-describedby={describedBy}
      className={cn(
        'relative z-10 flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5',
        'text-[12.5px] font-medium text-muted-foreground transition-colors whitespace-nowrap',
        accent ? 'data-[state=checked]:text-primary-foreground' : 'data-[state=checked]:text-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      )}
    >
      {locked && <Lock className="h-3 w-3 flex-shrink-0" aria-hidden="true" />}
      {label}
    </RadioGroupPrimitive.Item>
  );
}

/** The three-state segmented control for one editable area row. */
function LevelControl({
  row,
  level,
  onChange,
}: {
  row: AreaDefinition;
  level: AreaLevel | null;
  onChange: (level: AreaLevel | null) => void;
}) {
  const cap = row.maxLevelForCollaborator;
  const viewLocked = cap === null;
  const manageLocked = cap !== 'manage';
  const reasonId = `${row.key}-cap-reason`;
  const dataLevel = level ?? 'none';

  return (
    <RadioGroupPrimitive.Root
      className="relative grid w-full grid-cols-3 sm:max-w-[268px] gap-0.5 rounded-lg bg-muted/50 p-0.5"
      aria-label={`${row.label} access`}
      value={dataLevel}
      onValueChange={(value) => onChange(value === 'none' ? null : (value as AreaLevel))}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(33.333%-2px)] rounded-md border shadow-sm transition-transform duration-150',
          dataLevel === 'manage' ? 'bg-primary border-primary' : 'bg-card border-border/40'
        )}
        style={{
          transform: `translateX(${dataLevel === 'none' ? 0 : dataLevel === 'view' ? 100 : 200}%)`,
        }}
      />
      <Segment value="none" label="No access" />
      <Segment
        value="view"
        label="View"
        disabled={viewLocked}
        locked={viewLocked}
        describedBy={viewLocked ? reasonId : undefined}
      />
      <Segment
        value="manage"
        label="Manage"
        accent
        disabled={manageLocked}
        locked={manageLocked}
        describedBy={manageLocked ? reasonId : undefined}
      />
    </RadioGroupPrimitive.Root>
  );
}

/** A fully-disabled reflection of a builtin row's single (non-partial) level — same visual, no interaction. */
function ReadOnlyLevelControl({ row, level }: { row: AreaDefinition; level: AreaLevel | null }) {
  const dataLevel = level ?? 'none';
  return (
    <RadioGroupPrimitive.Root
      className="relative grid w-full grid-cols-3 sm:max-w-[268px] gap-0.5 rounded-lg bg-muted/50 p-0.5 opacity-70"
      aria-label={`${row.label} access`}
      value={dataLevel}
      disabled
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(33.333%-2px)] rounded-md border shadow-sm',
          dataLevel === 'manage' ? 'bg-primary border-primary' : 'bg-card border-border/40'
        )}
        style={{
          transform: `translateX(${dataLevel === 'none' ? 0 : dataLevel === 'view' ? 100 : 200}%)`,
        }}
      />
      {/*
        No padlocks here: on a read-only builtin every segment is disabled, so
        a lock on all three would say "capped" where the truth is "this whole
        role is not editable" — which the identity card's banner already says.
      */}
      <Segment value="none" label="No access" disabled />
      <Segment value="view" label="View" disabled />
      <Segment value="manage" label="Manage" accent disabled />
    </RadioGroupPrimitive.Root>
  );
}

function AreaRow({
  row,
  grants,
  builtinReadOnly,
  onChange,
}: {
  row: AreaDefinition;
  grants: Grants;
  builtinReadOnly: boolean;
  onChange: (row: AreaDefinition, level: AreaLevel | null) => void;
}) {
  const partial = builtinReadOnly && rowIsPartial(row, grants);
  const level = partial ? null : row.areaKeys.reduce<AreaLevel | null>((acc, key) => {
    const granted = grants[key];
    if (granted === 'manage') return 'manage';
    if (granted === 'view' && acc !== 'manage') return 'view';
    return acc;
  }, null);
  const reason = AREA_LOCK_REASON[row.key];
  const showReason = !builtinReadOnly && row.maxLevelForCollaborator !== 'manage';

  return (
    // Stacked below `sm`, side-by-side above it — the prototype collapses this
    // row to a single column at 620px, and without that the segmented control
    // and the area hint fight over the same line on a phone.
    <div className="flex flex-col items-stretch gap-2.5 border-b border-border/40 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-foreground">{row.label}</div>
        <p id={`${row.key}-cap-reason`} className="mt-0.5 text-[13px] text-muted-foreground">
          {AREA_HINT[row.key]}
          {showReason && reason && <span className="text-amber-600 dark:text-amber-500"> · {reason}</span>}
        </p>
      </div>
      {partial ? (
        <span className="self-start sm:self-auto text-[11px] px-1.5 py-0.5 rounded-md border border-border/40 font-mono uppercase tracking-wider text-muted-foreground">
          Partial
        </span>
      ) : builtinReadOnly ? (
        <ReadOnlyLevelControl row={row} level={level} />
      ) : (
        <LevelControl row={row} level={level} onChange={(next) => onChange(row, next)} />
      )}
    </div>
  );
}

export function RoleEditor({ restaurantId, role, onBack }: RoleEditorProps) {
  const { createRole, updateRole, copyRole, isMutating } = useRoles(restaurantId);
  const { restaurants } = useRestaurants();

  const isNewDraft = role === null;
  const builtinReadOnly = role?.builtin ?? false;

  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [grants, setGrants] = useState<Grants>(() => grantMapFrom(role?.role_areas ?? []));
  const [flags, setFlags] = useState<Set<SensitiveFlag>>(
    () => new Set((role?.role_flags ?? []).map((f) => f.flag))
  );
  const [copyTargetIds, setCopyTargetIds] = useState<string[]>([]);
  const [copyReport, setCopyReport] = useState<{ copied: string[]; nameCollisions: string[] } | null>(null);

  const previewFlags = useMemo(() => Array.from(flags), [flags]);

  const rowsByBand = useMemo(() => {
    const groups = new Map<Band, AreaDefinition[]>();
    for (const row of AREA_DEFINITIONS) {
      const list = groups.get(row.band) ?? [];
      list.push(row);
      groups.set(row.band, list);
    }
    return groups;
  }, []);

  const otherRestaurants = useMemo(
    () =>
      restaurants
        .filter((r) => r.restaurant_id !== restaurantId)
        .map((r) => ({ id: r.restaurant_id, name: r.restaurant.name })),
    [restaurants, restaurantId]
  );

  function handleAreaChange(row: AreaDefinition, level: AreaLevel | null) {
    setGrants((prev) => {
      const next = { ...prev };
      for (const key of row.areaKeys) {
        if (level === null) delete next[key];
        else next[key] = level;
      }
      return next;
    });
  }

  function toggleFlag(flag: SensitiveFlag, on: boolean) {
    setFlags((prev) => {
      const next = new Set(prev);
      if (on) next.add(flag);
      else next.delete(flag);
      return next;
    });
  }

  const nameEmpty = name.trim().length === 0;
  const saveHint = builtinReadOnly
    ? 'This is read-only.'
    : nameEmpty
      ? 'Role name is required.'
      : isNewDraft
        ? 'New role — nobody is assigned yet.'
        : '';
  const saveDisabled = builtinReadOnly || nameEmpty || isMutating;

  async function handleSave() {
    if (saveDisabled) return;
    const draft = {
      name: name.trim(),
      description: description.trim(),
      areas: (Object.keys(grants) as AreaKey[]).map((area_key) => ({ area_key, level: grants[area_key]! })),
      flags: Array.from(flags),
    };
    if (role) {
      await updateRole({ ...draft, id: role.id });
    } else {
      await createRole(draft);
    }
    onBack();
  }

  async function handleCopy() {
    if (!role || copyTargetIds.length === 0) return;
    const report = await copyRole({ roleId: role.id, targetRestaurantIds: copyTargetIds });
    setCopyReport({ copied: report.copied, nameCollisions: report.name_collisions.map((c) => c.name) });
    setCopyTargetIds([]);
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All roles
      </button>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5 min-w-0">
          {/* Identity card */}
          <div className="rounded-xl border border-border/40 bg-card p-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label
                  htmlFor="role-name"
                  className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Role name
                </Label>
                <Input
                  id="role-name"
                  value={name}
                  disabled={builtinReadOnly}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1.5 h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                />
              </div>
              <div>
                <Label
                  htmlFor="role-description"
                  className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  What this person does
                </Label>
                <Input
                  id="role-description"
                  value={description}
                  disabled={builtinReadOnly}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1.5 h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                />
              </div>
            </div>

            {/* Banner sits under the two fields, as in the approved design — the
                name is what identifies the card, so it reads first. */}
            {builtinReadOnly ? (
              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-500" aria-hidden="true" />
                <p className="text-[13px] text-foreground">
                  Built-in role. Read-only — keeps getting new areas as we ship features. Duplicate it to make a
                  version you control.
                </p>
              </div>
            ) : role && role.memberCount > 0 ? (
              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-500" aria-hidden="true" />
                <p className="text-[13px] text-foreground">{memberNoticeText(role.memberCount)}</p>
              </div>
            ) : null}
          </div>

          {/* Area bands */}
          <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
            {BAND_ORDER.map((band, bandIndex) => (
              <div key={band}>
                <BandHeader
                  label={band}
                  legend={bandIndex === 0 ? 'No access · View · Manage' : undefined}
                  first={bandIndex === 0}
                />
                <div className="px-5">
                  {(rowsByBand.get(band) ?? []).map((row) => (
                    <AreaRow
                      key={row.key}
                      row={row}
                      grants={grants}
                      builtinReadOnly={builtinReadOnly}
                      onChange={handleAreaChange}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* Sensitive data closes the same card, as its own band — the flags
                are cross-cutting, but they are read as one more thing this role
                either can or cannot see. */}
            <BandHeader label="Sensitive data" legend="Off · On" />
            <div className="p-5 pt-4 space-y-1">
              {SENSITIVE_FLAGS.map((s) => {
                const available = builtinReadOnly || s.requires.some((key) => !!grants[key]);
                const checked = available && flags.has(s.flag);
                const requiredLabels = s.requires.map(areaKeyLabel).join(', ');
                return (
                  <div
                    key={s.flag}
                    data-testid={`flag-row-${s.flag}`}
                    className={cn(
                      'flex items-center justify-between gap-3 p-2.5 rounded-lg border border-border/40',
                      // The amber wash means "this role can see sensitive data",
                      // so it appears only when the switch is actually on —
                      // never merely because the flag is available.
                      checked && 'bg-amber-500/10 border-amber-500/20',
                      !available && 'bg-muted/40 opacity-70'
                    )}
                  >
                    <div className="min-w-0">
                      <Label htmlFor={`flag-${s.flag}`} className="text-[13px] font-medium text-foreground">
                        {s.name}
                      </Label>
                      <p className="text-[12px] text-muted-foreground">
                        {available ? s.hint : `Needs access to ${requiredLabels}`}
                      </p>
                    </div>
                    <Switch
                      id={`flag-${s.flag}`}
                      aria-label={s.name}
                      checked={checked}
                      disabled={builtinReadOnly || !available}
                      onCheckedChange={(v) => toggleFlag(s.flag, v)}
                      // Amber when on, matching the row's caution wash — these
                      // switches grant sensitive data, not an ordinary setting.
                      className="data-[state=checked]:bg-amber-600 dark:data-[state=checked]:bg-amber-500"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Copy to other restaurants — only meaningful for an already-saved
              custom role, and only when there is somewhere to copy it to: a
              single-restaurant operator would otherwise get an empty picker. */}
          {role && !role.builtin && otherRestaurants.length > 0 && (
            <div className="rounded-xl border border-border/40 bg-card p-5 space-y-3">
              <div>
                <Label
                  htmlFor="copy-targets"
                  className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Copy to other restaurants
                </Label>
                <p className="text-[13px] text-muted-foreground mt-0.5">
                  Clone this role's areas and sensitive-data flags into other restaurants you manage.
                </p>
              </div>
              <select
                id="copy-targets"
                multiple
                aria-label="Other restaurants"
                value={copyTargetIds}
                onChange={(e) =>
                  setCopyTargetIds(Array.from(e.target.selectedOptions).map((option) => option.value))
                }
                className="w-full min-h-[92px] rounded-lg border border-border/40 bg-muted/30 text-[14px] p-2"
              >
                {otherRestaurants.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                disabled={copyTargetIds.length === 0 || isMutating}
                onClick={handleCopy}
                className="h-9 px-4 rounded-lg text-[13px] font-medium"
              >
                Copy role
              </Button>
              {copyReport && (
                <div className="text-[12px] space-y-1">
                  {copyReport.copied.length > 0 && (
                    <p className="text-muted-foreground">
                      Copied to {copyReport.copied.length} restaurant{copyReport.copied.length === 1 ? '' : 's'}.
                    </p>
                  )}
                  {copyReport.nameCollisions.length > 0 && (
                    <p className="text-destructive">
                      A role named "{name}" already exists at {copyReport.nameCollisions.length} restaurant
                      {copyReport.nameCollisions.length === 1 ? '' : 's'} — those copies were skipped.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <div>
              {saveHint && (
                <p id="save-hint" className="text-[12px] text-muted-foreground">
                  {saveHint}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onBack}
                className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={saveDisabled}
                aria-describedby={saveHint ? 'save-hint' : undefined}
                onClick={handleSave}
                // Accent-filled, not the usual near-black primary: the approved
                // design ties the save action to the same accent the selected
                // "Manage" segment uses.
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-[13px] font-medium disabled:opacity-45"
              >
                Save role
              </Button>
            </div>
          </div>
        </div>

        {/* Live preview */}
        <RolePreviewPanel grants={grants} flags={previewFlags} roleName={name.trim() || 'This role'} />
      </div>
    </div>
  );
}

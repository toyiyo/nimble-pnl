import { useMemo } from 'react';
import { buildRolePreview } from '@/lib/permissions/preview';
import type { AreaKey, AreaLevel, SensitiveFlag } from '@/lib/permissions/areas';
import { cn } from '@/lib/utils';

/**
 * RolePreviewPanel — the sticky "What they'll see" preview column (Phase 4
 * task 9e, roles-and-areas plan, 2026-07-29).
 *
 * Extracted out of `RoleEditor.tsx` (task 9d), which built this column
 * inline pending this later, separately-named plan task — see that file's
 * header comment. No behavior changes: same markup, same classes, same
 * `buildRolePreview` call, just moved into its own file so it has one
 * place to live and one test file of its own.
 *
 * Purely presentational over `buildRolePreview`
 * (`src/lib/permissions/preview.ts`, task 9b) — this component renders that
 * function's `{ summary, navPreview, grantCount }` output, it does not
 * reimplement any of the derivation (prose wording, nav grouping, landing-
 * item selection). That derivation is unit tested directly in
 * `tests/unit/preview.test.ts`; this file's own test
 * (`tests/unit/RolePreviewPanel.test.tsx`) only covers how that output is
 * rendered — the struck-through/READ ONLY/OPENS HERE markers and the sticky
 * layout the design doc's "The live preview" section asks for.
 *
 * `grants`/`flags` are keyed/typed exactly as `buildRolePreview` expects
 * (fourteen SQL `area_key`s, not the ten UI rows) — the same shape
 * `RoleEditor.tsx`'s own `Grants` state already uses, so no reshaping happens
 * at the call site.
 */

export interface RolePreviewPanelProps {
  grants: Partial<Record<AreaKey, AreaLevel>>;
  flags: readonly SensitiveFlag[];
  /** Defaults to "This role", matching `buildRolePreview`'s own default. */
  roleName?: string;
}

export function RolePreviewPanel({ grants, flags, roleName }: RolePreviewPanelProps) {
  const preview = useMemo(() => buildRolePreview(grants, flags, roleName), [grants, flags, roleName]);

  return (
    <aside className="lg:sticky lg:top-5 h-fit space-y-3">
      <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
        {/* Head: eyebrow + prose summary, then a rule — the prototype's `.rail__head`. */}
        <div className="px-4 pt-4 pb-3 border-b border-border/40">
          <h3 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
            What they'll see
          </h3>
          <p className="mt-1.5 text-[13px] text-foreground leading-relaxed">{preview.summary}</p>
        </div>

        <div className="px-2 pt-1 pb-3">
          {preview.navPreview.map((group) => (
            <div key={group.label}>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground px-2.5 pt-2.5 pb-1">
                {group.label}
              </div>
              {group.items.map((item) => (
                <div
                  key={item.path}
                  className={cn(
                    'flex items-center gap-2.5 px-2.5 py-1 rounded-md text-[13px]',
                    item.reachable ? 'text-foreground' : 'text-muted-foreground/50',
                    item.isLanding && 'bg-primary/10 text-primary font-semibold'
                  )}
                >
                  {/* currentColor dot: the row's own state colours it, per the prototype. */}
                  <span
                    aria-hidden="true"
                    className="h-[5px] w-[5px] flex-none rounded-full bg-current"
                  />
                  <span className={cn(!item.reachable && 'line-through')}>{item.label}</span>
                  {item.readOnly && (
                    <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                      Read only
                    </span>
                  )}
                  {item.isLanding && (
                    <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.08em] text-primary">
                      Opens here
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border/40 text-[12.5px] text-muted-foreground">
          <span>Permissions this grants</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {preview.grantCount} granted
          </span>
        </div>
      </div>
    </aside>
  );
}

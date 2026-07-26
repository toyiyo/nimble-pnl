# Design: Admin ↔ My Work dual-mode view switching

**Date:** 2026-07-24
**Branch:** `claude/heuristic-leakey-2802d4`
**Status:** Approved (visual design signed off via `/frontend-design` prototype; this doc is the engineering design)

## Problem

Owner/manager/chef/operations_manager users can also hold a linked `employees`
record (they pick up shifts, clock in, get paid). Today the `/employee/*` pages
are reachable only by typing the URL: there is no UI entry point, the chrome is
wrong (they keep the admin sidebar), and there is no way back. We want these
users to switch into the staff/employee experience ("My Work") and return to
their admin experience seamlessly.

## Non-negotiable constraint

**View mode is a display *lens*, not a role change.** We NEVER mutate
`selectedRestaurant.role`. Role is permission-bearing and RLS-relevant; changing
it would be a privilege/RLS hazard. Instead we add an orthogonal, ephemeral
`viewMode: 'admin' | 'work'` that drives *chrome and navigation only*. Every RLS
policy, every permission check, and every data query is untouched. The employee
pages already resolve identity via `useCurrentEmployee` (`user_id` +
`restaurant_id` + `status='active'`), so they work unchanged for a linked owner.

## Eligibility

`canUseWorkView = !!currentEmployee && role ∉ { staff, kiosk, collaborator_* }`

- `staff`/`kiosk` already live in the employee/kiosk experience — no switch needed.
- `collaborator_*` are external scoped roles that must never see employee self-service.
- `currentEmployee` comes from `useCurrentEmployee(restaurantId)`. Note (lesson
  2026-07-xx, PR #641): a **duplicate** `employees` row for the same
  `(user_id, restaurant_id)` makes `.single()` return `PGRST116`, which the hook
  maps to `null`. That fails **closed** here — the persona card simply won't
  render — which is the safe direction. No behavior change required from this feature.

## State model — module-level store, not sessionStorage

**Critical architectural fact:** `RestaurantProvider` is mounted *inside*
`ProtectedRoute` (`App.tsx:133`), so it **remounts on every route navigation**.
That is why `selectedRestaurant` is re-hydrated from `localStorage` on each mount.
Consequently, any React state we hold for `viewMode` inside that provider would
reset on every navigation — including the navigation to `/employee/schedule` that
*entering* work mode triggers.

Therefore `viewMode` and the stashed return-route live in a **module-level
singleton store** (`src/contexts/viewModeStore.ts`), read via
`useSyncExternalStore`:

```
state = { restaurantId: string | null, mode: 'admin' | 'work', returnPath: string }
```

This gives us exactly the desired lifecycle for free:

| Event | Module store behavior | Result |
|---|---|---|
| In-app navigation | Module persists (ES module singleton) | viewMode survives ✅ |
| Full page reload / new tab | Module re-evaluates → `mode: 'admin'` | resets to admin ✅ |
| Restaurant switch | `restaurantId` mismatch → effective mode = admin | per-restaurant ✅ |

> **Design note / deviation from brief:** the brief suggested `sessionStorage`.
> Plain `sessionStorage` survives a full reload, which contradicts "reset to
> admin on fresh load." The module singleton honors the *intent* (per-restaurant,
> survive in-app nav, reset on reload) without a storage round-trip, and it is
> the natural fit for the remount-driven provider. No secrets or PII are stored.

**`getSnapshot()` reference stability (critical `useSyncExternalStore` rule).**
The store keeps a *single* mutable module-level object. `getSnapshot()` returns
that same reference every call; `enterWorkMode`/`exitWorkMode`/restaurant-change
mutate its fields **in place** and then call `emitChange()` to notify subscribers.
`getSnapshot()` must NEVER allocate (`return { ...state }` is a bug — it makes
React see a new snapshot every render and loops/throws "getSnapshot should be
cached"). No `getServerSnapshot` is needed — this is Vite CSR, not SSR.

The provider derives the **effective** mode so a stale entry can never leak
across restaurants or past eligibility — but **optimistically**, to avoid a
chrome flash on the remount that entering work mode triggers:

```
// selectedRestaurant re-hydrates from localStorage async, so it is briefly
// null right after enterWorkMode()'s navigate() remounts RestaurantProvider.
// Downgrade to 'admin' ONLY once we can confirm a real mismatch/ineligibility —
// never while restaurant context is still loading.
const storeSaysWork = store.mode === 'work' && store.restaurantId != null;
const confirmedWrongRestaurant =
  !!selectedRestaurant && selectedRestaurant.restaurant_id !== store.restaurantId;
const confirmedIneligible = !employeeLoading && !canUseWorkView;

effectiveViewMode =
  storeSaysWork && !confirmedWrongRestaurant && !confirmedIneligible
    ? 'work' : 'admin';
```

> **Why optimistic (major review finding folded in):** `enterWorkMode()` calls
> `navigate('/employee/schedule')`, which remounts `RestaurantProvider`;
> `selectedRestaurant` starts `null` and `currentEmployee` is refetching. A strict
> `store.restaurantId === currentRestaurantId` test would evaluate `admin` for those
> first renders (null ≠ id), flashing the full admin sidebar before flipping to the
> employee chrome. Trusting `store.mode` until a mismatch/ineligibility is *confirmed*
> removes the flash while keeping the same end state.

`enterWorkMode()` / `exitWorkMode()` own navigation (they run where `useNavigate`
is available):

- **enter:** stash `location.pathname` → store; set `mode='work'`,
  `restaurantId=current`; `navigate('/employee/schedule')`.
- **exit:** set `mode='admin'`; `navigate(store.returnPath || '/')`.

## Components & touch points

| File | Change |
|---|---|
| `src/contexts/viewModeStore.ts` *(new)* | Module singleton: `subscribe`/`getSnapshot`/`enterWorkMode`/`exitWorkMode`, plus `__resetStore` test helper. Pure, unit-tested. |
| `src/contexts/ViewModeContext.tsx` *(new)* | `ViewModeProvider` (reads store via `useSyncExternalStore`, computes `canUseWorkView` from `useCurrentEmployee` + role, exposes `{ viewMode, canUseWorkView, enterWorkMode, exitWorkMode }`) + `useViewMode()` hook. Mounted inside `RestaurantProvider`. |
| `src/lib/viewModeEligibility.ts` *(new)* | `computeCanUseWorkView({ currentEmployee, role })` pure helper. Unit-tested. |
| `src/components/ViewModeSwitch.tsx` *(new)* | Shared "You're viewing as" persona card: Admin / My Work segmented control + hint. Renders `null` when `!canUseWorkView`. |
| `src/components/PersonalViewBanner.tsx` *(new)* | Persistent slate banner shown in work mode. `variant="desktop"` (full bar in main content) and `variant="mobile"` (slim strip above the tab bar). "Back to admin" calls `exitWorkMode`. |
| `src/components/UserProfileDropdown.tsx` | Insert `<ViewModeSwitch />` at top of the dropdown (desktop entry point — matches prototype). |
| `src/components/AppSidebar.tsx` | Insert `<ViewModeSwitch />` in `SidebarFooter`, **only in the expanded (`!collapsed`) branch** — the **mobile-reachable** entry point (the account dropdown is `hidden md:flex`; a non-staff owner on mobile gets the desktop shell whose dropdown is hidden, but the sidebar renders as a full-width sheet where `collapsed` is never true). In the collapsed desktop icon-rail we omit it — collapse is a desktop-only state and desktop always has the `UserProfileDropdown` entry, so no entry point is lost. |
| `src/App.tsx` `LayoutSwitcher` | `if ((isStaff || viewMode === 'work') && isMobile) return <MobileLayout>`. On desktop work mode: keep the sidebar shell but render `<PersonalViewBanner variant="desktop" />` above `{children}`. |
| `src/App.tsx` mount | Wrap the tree in `<ViewModeProvider>` inside `RestaurantProvider` (so `LayoutSwitcher`, `AppSidebar`, and `UserProfileDropdown` can read it). `StaffRoleChecker` does **not** consume it — its checks stay purely role-based (see Routing section). |
| `src/index.css` + `tailwind.config.ts` | Add a semantic **`--personal-view` / `--personal-view-foreground` / `--personal-view-border`** token trio (light in `:root`, dark in `.dark`), wired into `tailwind.config.ts` `colors` exactly like the existing `sidebar` trio. This is the slate "personal view" accent — see "Visual language". |
| `src/components/AppSidebar.nav.ts` `getNavigationForRole` | Add optional `viewMode` param: when `viewMode === 'work'`, return `staffNav` regardless of role. Default preserves current behavior. Unit-tested. |
| `src/components/AppSidebar.tsx` | Pass `viewMode` into `getNavigationForRole`. |
| `src/components/employee/MobileLayout.tsx` | Render `<PersonalViewBanner variant="mobile" />` (only in work mode) — the slim return strip above `<MobileTabBar />`. Staff (`role==='staff'`) never see it because they have no `viewMode==='work'` (their eligibility is false); gate on `viewMode==='work'`. |

## Routing / StaffRoleChecker

`StaffRoleChecker` (`App.tsx:215`) already lets non-staff through to `/employee/*`
(it only redirects kiosk/collaborator/staff). **No route-gating is added for work
mode** — an owner-in-work-mode retains full permissions, so trapping them inside
`/employee/*` has no security value and risks a redirect loop. The banner + nav
guide them; entering navigates to `/employee/schedule`, exiting restores the
stashed route. This is a **decided trade-off**: chrome follows `viewMode`, route
access follows `role` (unchanged).

## Visual language (from approved prototype)

- Work-mode signal is **slate**, deliberately distinct from the emerald brand
  chrome so "personal view" never reads as the admin brand. Per CLAUDE.md's
  "No Direct Colors" rule (and the shadcn skill's ban on manual `dark:` color
  overrides), this is **not** raw `slate-*` classes. Instead a semantic token
  trio is defined once and consumed as `bg-personal-view text-personal-view-foreground
  border-personal-view-border` — no `dark:` prefixes anywhere. Suggested HSL
  (implementation may retune within the contrast budget below):
  - `:root` → `--personal-view: 214 32% 91%`, `--personal-view-foreground: 215 25% 27%`, `--personal-view-border: 214 20% 78%`
  - `.dark` → `--personal-view: 215 25% 20%`, `--personal-view-foreground: 214 32% 84%`, `--personal-view-border: 215 20% 32%`
- Segmented control, banner, and mobile strip follow CLAUDE.md Apple/Notion tokens
  (`border-border/40`, `bg-muted/30`, `rounded-lg`/`rounded-xl`, `transition-colors`,
  the typography scale).
- Transition respects `prefers-reduced-motion` (fade fallback, no sweep).

## Mock-exact copy & layout (build to these strings)

Captured from the approved prototype (`scratchpad/dual-mode-transition.html`). Match text and structure closely.

**`ViewModeSwitch` (persona card)** — sits directly under the account header (email line):
- Wrapper: slate-tinted card, `border-personal-view-border`, subtle `bg-personal-view` tint, `rounded-lg`, small padding.
- Eyebrow label: `YOU'RE VIEWING AS` — `text-[11px] font-medium uppercase tracking-wider text-muted-foreground`.
- Segmented control (two toggle buttons, full width, equal split): **`Admin`** (Home/`LayoutDashboard` icon) and **`My Work`** (`User`/`UserRound` icon). Active button gets a raised pill (`bg-background` + subtle shadow); inactive is transparent muted text. `aria-pressed` reflects the current effective mode.
- Hint line under the control: **`Switch to clock in, view your schedule, timecard, and pay.`** — `text-[12px] text-muted-foreground`.

**`PersonalViewBanner variant="desktop"`** — full-width bar at the top of the main content, slate:
- Left: `UserRound` icon in a small slate chip, then **`You're in your personal view.`** (`font-medium`/semibold) followed by **`Seeing your own schedule & pay — not the restaurant's admin tools.`** (`text-muted-foreground`).
- Right: **`Back to admin`** button with a leading `ArrowLeft` icon; calls `exitWorkMode`.
- Surface: `bg-personal-view text-personal-view-foreground border border-personal-view-border rounded-xl`.

**`PersonalViewBanner variant="mobile"`** — slim strip directly above `<MobileTabBar />`:
- Left: `UserRound` icon + **`Personal view`** (`text-[13px] font-medium`).
- Right: **`Admin ›`** (a labeled button, e.g. `aria-label="Back to admin"`), `text-[13px]`.
- Same slate token surface; compact height, honors `env(safe-area-inset-bottom)` stacking above the tab bar.

**Avatar sublabel in work mode:** the account trigger's secondary line reads **`{Role} · My Work`** (e.g. `Owner · My Work`) while in work mode, replacing the email-domain sublabel. (Applies to the `UserProfileDropdown` trigger; the mock capitalizes the role.)

**Work-mode sidebar:** groups become `EMPLOYEE` (Time Clock, My Timecard, My Schedule, My Pay, My Requests) + `SETTINGS` (Settings) — this is exactly `staffNav`, so no new nav content is authored.

## Three-state / a11y

- `ViewModeSwitch` renders `null` when ineligible (no empty shell). Its layout is
  compact/truncating so it fits both mount widths — the ~224px account dropdown and
  the narrower sidebar footer (which already carries the email chip + Sign Out).
- Segmented control is **two `aria-pressed` toggle buttons inside a `role="group"`
  with `aria-label="View mode"`** (the CLAUDE.md "Apple-Style Underline Tabs"
  convention already used in the codebase) — NOT a `role="radiogroup"`, which would
  require `role="radio"` + `aria-checked` + roving-tabindex arrow-key handling and
  mis-announce as radios otherwise. Both buttons are Tab-focusable and Enter/Space
  operable.
- Banner has `role="status"` (announces the mode change without stealing focus during
  navigation); "Back to admin" is a labeled `<button>`.
- **Contrast acceptance criterion:** both light and dark `--personal-view` values
  must clear ≥4.5:1 for banner/foreground body text against their surrounding surface,
  and ≥3:1 for the segmented-control border and focus ring. Verify before Phase 8 sign-off.

## Testing strategy

- **Unit (pure):** `computeCanUseWorkView` truth table; `viewModeStore`
  enter/exit/effective + restaurant-mismatch reset; `getNavigationForRole(role,'work')`
  returns `staffNav` for every non-staff role.
- **Component:** `ViewModeSwitch` hides when ineligible / shows + toggles when
  eligible; `PersonalViewBanner` "Back to admin" calls exit.
- **E2E (Playwright):** seed an owner with a linked active employee record; assert
  the persona card appears, switching enters `/employee/schedule` with employee
  chrome, "Back to admin" returns to the stashed route with admin chrome; assert a
  plain owner (no employee record) never sees the card. This covers the cross-layer
  seam per the Phase 8 E2E gate.

## Phase 2.5 design-review dispositions

Frontend reviewer (Supabase reviewer skipped — no DB/RLS/edge-function/SQL surface).
All folded into this doc:

- **[critical] `getSnapshot()` reference stability** → folded into "State model" (single mutable object, in-place mutation, never allocate in getter).
- **[major] chrome flash on entry remount** → folded: optimistic `effectiveViewMode` derivation that only downgrades on *confirmed* mismatch/ineligibility.
- **[major] `slate-*` raw colors violate No-Direct-Colors + shadcn `dark:` ban** → folded: semantic `--personal-view*` token trio wired like `sidebar`.
- **[major] `role="radiogroup"` + `aria-pressed` non-conforming** → folded: two `aria-pressed` toggle buttons in `role="group"` w/ `aria-label`.
- **[minor] collapsed sidebar footer has no room** → folded: render only in `!collapsed`; collapse is desktop-only, dropdown covers it.
- **[minor] `StaffRoleChecker` dangling consumer** → folded: removed from consumer list; it stays role-based only.
- **[minor] contrast verification** → folded: explicit ≥4.5:1 / ≥3:1 acceptance criterion.
- **[minor] `ViewModeSwitch` width at two mounts** → folded: compact/truncating layout note.

## Out of scope

- No DB/RLS/edge-function/migration changes (this is a pure client chrome feature).
- No change to how employee pages fetch data.
- Multi-restaurant "work mode in restaurant A while viewing B" is resolved to admin
  (effective-mode guard), not preserved per-restaurant simultaneously.

/**
 * usePermissions — data-driven roles built from areas (Phase 4, task 8)
 *
 * Covers the client resolution step described in
 * docs/superpowers/plans/2026-07-29-roles-and-areas-plan.md ("Task 8 — client
 * resolution") and docs/superpowers/specs/2026-07-29-roles-and-areas-design.md.
 *
 * Written RED first, against a `usePermissions` that did not yet know about
 * `isResolved`, embedded areas, or `flavor`; it is GREEN now and is the
 * regression guard for that shape. `tests/unit/usePermissions.test.tsx` (note
 * the `.tsx`) covers the legacy string-role path and is left untouched — it
 * must keep passing, since the fallback is required to behave identically.
 *
 * The contract this file pins:
 *
 * - `useRestaurantContext()` keeps returning `selectedRestaurant` and
 *   `loading` exactly as today, but once `useRestaurants` embeds the joined
 *   role, `selectedRestaurant` additionally carries a `roleRecord` (chosen
 *   deliberately *not* named `role`, since `role: Role` is the existing
 *   legacy text column and CLAUDE.md-adjacent call sites read it directly —
 *   see useRestaurants.tsx's `UserRestaurant.role` doc comment):
 *
 *     roleRecord: {
 *       id: string;
 *       name: string;
 *       flavor: 'platform' | 'collaborator';
 *       builtin: boolean;
 *       role_areas: Array<{ area_key: AreaKey; level: AreaLevel }>;
 *       role_flags: Array<{ flag: SensitiveFlag }>;
 *     } | null
 *
 * - `usePermissions()` gains `isResolved: boolean`, sourced from the
 *   context's existing `loading` (`isResolved = !loading`), per the design's
 *   "fail-closed, but distinguishably so" requirement. While `!isResolved`,
 *   the three sensitive flags (`view:costs`, `view:pay_rates`,
 *   `view:employee_pii`) must read `false` regardless of what the
 *   (possibly stale/incoming) role data would otherwise grant.
 *
 * - When `roleRecord` is present, capabilities are computed by
 *   `expandAreas(role_areas, role_flags)` (src/lib/permissions/areas.ts),
 *   not by looking up `ROLE_CAPABILITIES[role]` — this is what lets a
 *   user-named custom role (which has no `ROLE_CAPABILITIES` entry at all)
 *   resolve correctly, and it must reproduce the exact same capability set
 *   for a builtin role that ROLE_CAPABILITIES did (task 2/5's SQL parity
 *   requirement, now asserted client-side too).
 *
 * - `isCollaborator` reads `roleRecord.flavor === 'collaborator'`, not
 *   `role.startsWith('collaborator_')` (definitions.ts's `isCollaboratorRole`,
 *   which cannot survive user-named roles).
 *
 * - `landingPath` derives from the first granted area in a fixed priority
 *   order when `roleRecord` is present, rather than falling through to `'/'`
 *   the way `ROLE_METADATA[role]?.landingPath ?? '/'` does today for a role
 *   with no metadata entry.
 */
import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { usePermissions } from '@/hooks/usePermissions';
import type { Role } from '@/lib/permissions/types';
import { ROLE_CAPABILITIES } from '@/lib/permissions/definitions';
import type { AreaKey, AreaLevel, SensitiveFlag } from '@/lib/permissions/areas';

const mockUseRestaurantContext = vi.fn();

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockUseRestaurantContext(),
}));

interface MockRoleRecord {
  id: string;
  name: string;
  flavor: 'platform' | 'collaborator';
  builtin: boolean;
  role_areas: Array<{ area_key: AreaKey; level: AreaLevel }>;
  role_flags: Array<{ flag: SensitiveFlag }>;
}

interface MockContextOptions {
  role: string;
  roleRecord?: MockRoleRecord | null;
  loading?: boolean;
}

/** Sets up the mocked `useRestaurantContext()` return value for one render. */
const setupMockContext = ({ role, roleRecord = null, loading = false }: MockContextOptions) => {
  mockUseRestaurantContext.mockReturnValue({
    loading,
    selectedRestaurant: {
      restaurant_id: 'restaurant-1',
      role: role as unknown as Role,
      roleRecord,
    },
  });
};

describe('usePermissions — area-based resolution (Phase 4, task 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // 1. isResolved gating
  // ============================================================
  describe('isResolved gating while the restaurant context is loading', () => {
    // A role whose embedded grants WOULD unlock all three sensitive flags,
    // to prove the gate suppresses them specifically because of `loading`,
    // not because the role happens to lack the grants.
    const loadedRoleRecord: MockRoleRecord = {
      id: 'builtin-owner-id',
      name: 'Owner',
      flavor: 'platform',
      builtin: true,
      role_areas: [{ area_key: 'reports', level: 'manage' }],
      role_flags: [{ flag: 'view:costs' }, { flag: 'view:pay_rates' }, { flag: 'view:employee_pii' }],
    };

    it('reports isResolved as false while the context is loading', () => {
      setupMockContext({ role: 'owner', roleRecord: loadedRoleRecord, loading: true });
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isResolved).toBe(false);
    });

    it('gates all three sensitive flags to false while loading, even though the role grants them', () => {
      setupMockContext({ role: 'owner', roleRecord: loadedRoleRecord, loading: true });
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:costs')).toBe(false);
      expect(result.current.hasCapability('view:pay_rates')).toBe(false);
      expect(result.current.hasCapability('view:employee_pii')).toBe(false);
    });

    it('resolves once loading completes, unlocking the same flags', () => {
      setupMockContext({ role: 'owner', roleRecord: loadedRoleRecord, loading: false });
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isResolved).toBe(true);
      expect(result.current.hasCapability('view:costs')).toBe(true);
      expect(result.current.hasCapability('view:pay_rates')).toBe(true);
      expect(result.current.hasCapability('view:employee_pii')).toBe(true);
    });
  });

  // ============================================================
  // 2. Custom-role capabilities from embedded areas
  // ============================================================
  describe("a custom role's capabilities come from its embedded areas, not ROLE_CAPABILITIES", () => {
    beforeEach(() => {
      // 'collaborator_custom' has no ROLE_CAPABILITIES entry at all — the
      // legacy lookup table cannot answer for it. Only the embedded
      // role_areas grant can. Post menu-mirror re-cut, inventory_audit is
      // its own AreaKey — no longer implied by granting inventory — so it
      // needs its own grant here too.
      setupMockContext({
        role: 'collaborator_custom',
        loading: false,
        roleRecord: {
          id: 'custom-role-weekend-supervisor',
          name: 'Weekend Supervisor',
          flavor: 'collaborator',
          builtin: false,
          role_areas: [
            { area_key: 'inventory', level: 'manage' },
            { area_key: 'inventory_audit', level: 'manage' },
          ],
          role_flags: [],
        },
      });
    });

    it('is resolved', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isResolved).toBe(true);
    });

    it('grants capabilities from the manage-level inventory area', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:inventory')).toBe(true);
      expect(result.current.hasCapability('edit:inventory')).toBe(true);
      expect(result.current.hasCapability('view:inventory_audit')).toBe(true);
    });

    it('does not grant capabilities from an ungranted area', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:recipes')).toBe(false);
      expect(result.current.hasCapability('edit:recipes')).toBe(false);
    });

    it('does not grant an ungranted sensitive flag', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:costs')).toBe(false);
    });

    it('produces a non-empty capability set despite no ROLE_CAPABILITIES entry existing for this role', () => {
      const { result } = renderHook(() => usePermissions());
      // Proves the result was computed from the embedded grant, not from a
      // (nonexistent) ROLE_CAPABILITIES['collaborator_custom'] lookup that
      // would otherwise silently fall back to an empty array.
      expect(result.current.capabilities.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // 3. Builtin capabilities are unchanged when resolved via embedded areas
  // ============================================================
  describe("a builtin role's capabilities are unchanged when resolved through its embedded areas", () => {
    beforeEach(() => {
      // Transcribed independently from ROLE_CAPABILITIES.chef (definitions.ts)
      // via the area model, the same way tests/unit/areas.test.ts's builtin
      // reconstruction works — chef holds inventory, inventory_audit,
      // recipes, and prep_recipes at 'manage' and
      // dashboard/reports/sales/purchasing/scheduling/settings/reviews at
      // 'view', with no sensitive flags. Post menu-mirror re-cut,
      // inventory_audit and prep_recipes are their own AreaKeys — no longer
      // implied by inventory/recipes — matching the capability grants in
      // 20260805120000_page_areas.sql's user_has_capability CASE. `reviews`
      // was added by the review-funnel migration
      // (20260804100000_reviews_area.sql), which grants chef 'view' on the
      // new area — keep this fixture in lockstep with those seeds and with
      // ROLE_CAPABILITIES.chef.
      setupMockContext({
        role: 'chef',
        loading: false,
        roleRecord: {
          id: 'builtin-chef-id',
          name: 'Chef',
          flavor: 'platform',
          builtin: true,
          role_areas: [
            { area_key: 'dashboard', level: 'view' },
            { area_key: 'reports', level: 'view' },
            { area_key: 'sales', level: 'view' },
            { area_key: 'inventory', level: 'manage' },
            { area_key: 'inventory_audit', level: 'manage' },
            { area_key: 'purchasing', level: 'view' },
            { area_key: 'recipes', level: 'manage' },
            { area_key: 'prep_recipes', level: 'manage' },
            { area_key: 'scheduling', level: 'view' },
            { area_key: 'settings', level: 'view' },
            { area_key: 'reviews', level: 'view' },
          ],
          role_flags: [],
        },
      });
    });

    it('is resolved', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isResolved).toBe(true);
    });

    it('reproduces exactly the legacy ROLE_CAPABILITIES.chef set', () => {
      const { result } = renderHook(() => usePermissions());
      expect(new Set(result.current.capabilities)).toEqual(new Set(ROLE_CAPABILITIES.chef));
    });

    it('still has no financial capabilities, unchanged from today', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:transactions')).toBe(false);
      expect(result.current.hasCapability('view:banking')).toBe(false);
    });

    it('still has recipe capabilities, unchanged from today', () => {
      const { result } = renderHook(() => usePermissions());
      expect(result.current.hasCapability('view:recipes')).toBe(true);
      expect(result.current.hasCapability('edit:recipes')).toBe(true);
    });
  });

  // ============================================================
  // 4. isCollaborator reads flavor, not the role-name prefix
  // ============================================================
  describe("isCollaborator reads flavor off the resolved role, not a 'collaborator_' name prefix", () => {
    it('is true for a role literal that does NOT start with "collaborator_" when flavor is collaborator', () => {
      // Contrived on purpose: proves the check reads `flavor`, not the
      // string, by deliberately mismatching them.
      setupMockContext({
        role: 'owner',
        loading: false,
        roleRecord: {
          id: 'some-role-id',
          name: 'Not Actually An Owner',
          flavor: 'collaborator',
          builtin: false,
          role_areas: [{ area_key: 'inventory', level: 'view' }],
          role_flags: [],
        },
      });
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isResolved).toBe(true);
      expect(result.current.isCollaborator).toBe(true);
    });

    it('is false for a role literal that DOES start with "collaborator_" when flavor is platform', () => {
      setupMockContext({
        role: 'collaborator_accountant',
        loading: false,
        roleRecord: {
          id: 'some-other-role-id',
          name: 'Not Actually A Collaborator',
          flavor: 'platform',
          builtin: false,
          role_areas: [{ area_key: 'books', level: 'view' }],
          role_flags: [],
        },
      });
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isResolved).toBe(true);
      expect(result.current.isCollaborator).toBe(false);
    });

    it('is true for a genuinely user-named custom collaborator role', () => {
      setupMockContext({
        role: 'collaborator_custom',
        loading: false,
        roleRecord: {
          id: 'custom-role-weekend-supervisor',
          name: 'Weekend Supervisor',
          flavor: 'collaborator',
          builtin: false,
          role_areas: [{ area_key: 'scheduling', level: 'manage' }],
          role_flags: [],
        },
      });
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isCollaborator).toBe(true);
    });
  });

  // ============================================================
  // 5. landingPath resolves for a custom role
  // ============================================================
  describe("landingPath resolves for a custom role rather than falling through to '/'", () => {
    it('resolves to the scheduling area path when scheduling is the only granted area', () => {
      setupMockContext({
        role: 'collaborator_custom',
        loading: false,
        roleRecord: {
          id: 'custom-role-scheduler',
          name: 'Weekend Supervisor',
          flavor: 'collaborator',
          builtin: false,
          role_areas: [{ area_key: 'scheduling', level: 'manage' }],
          role_flags: [],
        },
      });
      const { result } = renderHook(() => usePermissions());
      expect(result.current.isResolved).toBe(true);
      // Matches the existing collaborator_operations_manager convention
      // (definitions.ts ROLE_METADATA.collaborator_operations_manager.landingPath).
      expect(result.current.landingPath).toBe('/scheduling');
      expect(result.current.landingPath).not.toBe('/');
    });

    it('resolves to the inventory area path when inventory is the only granted area', () => {
      setupMockContext({
        role: 'collaborator_custom',
        loading: false,
        roleRecord: {
          id: 'custom-role-inventory-only',
          name: 'Stock Clerk',
          flavor: 'collaborator',
          builtin: false,
          role_areas: [{ area_key: 'inventory', level: 'view' }],
          role_flags: [],
        },
      });
      const { result } = renderHook(() => usePermissions());
      // Matches the existing collaborator_inventory convention
      // (definitions.ts ROLE_METADATA.collaborator_inventory.landingPath).
      expect(result.current.landingPath).toBe('/inventory');
      expect(result.current.landingPath).not.toBe('/');
    });

    it('never falls through to "/" for a custom role with at least one granted area', () => {
      setupMockContext({
        role: 'collaborator_custom',
        loading: false,
        roleRecord: {
          id: 'custom-role-recipes-only',
          name: 'Prep Lead',
          flavor: 'collaborator',
          builtin: false,
          role_areas: [{ area_key: 'recipes', level: 'view' }],
          role_flags: [],
        },
      });
      const { result } = renderHook(() => usePermissions());
      expect(result.current.landingPath).not.toBe('/');
    });
  });

  // ============================================================
  // 6. landingPath must not regress for the builtin roles
  // ============================================================
  describe('landingPath for builtin roles stays what ROLE_METADATA says', () => {
    // Deriving the landing from areas is right for a custom role and wrong
    // for a builtin: `collaborator_chef` holds inventory:view alongside
    // recipes:manage, and inventory outranks recipes in AREA_PRIORITY, so a
    // pure derivation moves this role's landing from /recipes to /inventory.
    // The design's regression statement is that the six builtins' nav and
    // landing paths are unchanged, so `builtin` short-circuits the derivation.
    const BUILTIN_LANDINGS: Array<{
      role: string;
      name: string;
      flavor: 'platform' | 'collaborator';
      areas: Array<{ area_key: AreaKey; level: AreaLevel }>;
      expected: string;
    }> = [
      {
        role: 'collaborator_chef',
        name: 'Recipe Consultant',
        flavor: 'collaborator',
        areas: [
          { area_key: 'inventory', level: 'view' },
          { area_key: 'recipes', level: 'manage' },
          { area_key: 'settings', level: 'view' },
        ],
        expected: '/recipes',
      },
      {
        role: 'collaborator_operations_manager',
        name: 'Ops Manager (Collaborator)',
        flavor: 'collaborator',
        areas: [
          { area_key: 'reports', level: 'manage' },
          { area_key: 'inventory', level: 'manage' },
          { area_key: 'scheduling', level: 'manage' },
          { area_key: 'settings', level: 'view' },
        ],
        expected: '/scheduling',
      },
      {
        role: 'collaborator_accountant',
        name: 'Accountant',
        flavor: 'collaborator',
        areas: [
          { area_key: 'books', level: 'manage' },
          { area_key: 'payroll', level: 'view' },
          { area_key: 'settings', level: 'view' },
        ],
        expected: '/transactions',
      },
      {
        role: 'collaborator_inventory',
        name: 'Inventory Helper',
        flavor: 'collaborator',
        areas: [
          { area_key: 'inventory', level: 'manage' },
          { area_key: 'purchasing', level: 'manage' },
          { area_key: 'settings', level: 'view' },
        ],
        expected: '/inventory',
      },
    ];

    for (const builtin of BUILTIN_LANDINGS) {
      it(`keeps ${builtin.role} landing on ${builtin.expected}`, () => {
        setupMockContext({
          role: builtin.role,
          loading: false,
          roleRecord: {
            id: `builtin-${builtin.role}`,
            name: builtin.name,
            flavor: builtin.flavor,
            builtin: true,
            role_areas: builtin.areas,
            role_flags: [],
          },
        });
        const { result } = renderHook(() => usePermissions());
        expect(result.current.landingPath).toBe(builtin.expected);
      });
    }

    it('keeps owner landing on the dashboard its areas would also pick', () => {
      setupMockContext({
        role: 'owner',
        loading: false,
        roleRecord: {
          id: 'builtin-owner',
          name: 'Owner',
          flavor: 'platform',
          builtin: true,
          role_areas: [
            { area_key: 'reports', level: 'manage' },
            { area_key: 'team', level: 'manage' },
          ],
          role_flags: [],
        },
      });
      const { result } = renderHook(() => usePermissions());
      expect(result.current.landingPath).toBe('/');
    });

    it('does not land a custom collaborator role on a page it cannot open', () => {
      // `reports` is the highest-priority area, but `/` and `/reports` are
      // excluded from every collaborator's routes — landing there would bounce
      // the user straight back off it.
      setupMockContext({
        role: 'collaborator_custom',
        loading: false,
        roleRecord: {
          id: 'custom-role-reports-only',
          name: 'Report Reader',
          flavor: 'collaborator',
          builtin: false,
          role_areas: [{ area_key: 'reports', level: 'manage' }],
          role_flags: [],
        },
      });
      const { result } = renderHook(() => usePermissions());
      expect(result.current.landingPath).toBe('/help');
    });
  });
});

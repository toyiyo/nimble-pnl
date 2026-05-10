import { describe, it, expect, vi } from 'vitest';
import { buildEmails } from '../../supabase/functions/send-time-off-notification/buildEmails';

interface UserRestaurantRow { user_id: string }
interface ProfileRow { user_id: string; email: string | null }

interface UserRestaurantsResult {
  data: UserRestaurantRow[] | null;
  error: { message: string } | null;
}
interface ProfilesResult {
  data: ProfileRow[] | null;
  error: { message: string } | null;
}

interface MockResults {
  userRestaurants: UserRestaurantsResult;
  profiles: ProfilesResult;
}

interface MockCalls {
  userRestaurants: { table: string; select: string; eqCol: string; eqVal: string; inCol: string; inVals: string[] };
  profiles: { table: string; select: string; inCol: string; inVals: string[] };
}

function makeSupabaseStub(results: MockResults) {
  const calls: MockCalls = {
    userRestaurants: { table: '', select: '', eqCol: '', eqVal: '', inCol: '', inVals: [] },
    profiles: { table: '', select: '', inCol: '', inVals: [] },
  };

  const userRestaurantsChain = {
    select: (cols: string) => {
      calls.userRestaurants.select = cols;
      return {
        eq: (col: string, val: string) => {
          calls.userRestaurants.eqCol = col;
          calls.userRestaurants.eqVal = val;
          return {
            in: async (col: string, vals: string[]) => {
              calls.userRestaurants.inCol = col;
              calls.userRestaurants.inVals = vals;
              return results.userRestaurants;
            },
          };
        },
      };
    },
  };

  const profilesChain = {
    select: (cols: string) => {
      calls.profiles.select = cols;
      return {
        in: async (col: string, vals: string[]) => {
          calls.profiles.inCol = col;
          calls.profiles.inVals = vals;
          return results.profiles;
        },
      };
    },
  };

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'user_restaurants') {
        calls.userRestaurants.table = table;
        return userRestaurantsChain;
      }
      if (table === 'profiles') {
        calls.profiles.table = table;
        return profilesChain;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { supabase, calls };
}

describe('buildEmails', () => {
  it('CRITICAL: returns only employee when notifyEmployee=true and notifyManagers=false', async () => {
    const { supabase } = makeSupabaseStub({
      userRestaurants: { data: [], error: null },
      profiles: { data: [], error: null },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: 'employee@example.com',
      notifyEmployee: true,
      notifyManagers: false,
    });
    expect(result.emails).toEqual(['employee@example.com']);
    expect(result.employeeIncluded).toBe(true);
    expect(result.managersFound).toBe(0);
    expect(result.managerLookupError).toBeUndefined();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('CRITICAL: queries user_restaurants then profiles separately (no embed) and combines results', async () => {
    const { supabase, calls } = makeSupabaseStub({
      userRestaurants: { data: [{ user_id: 'u1' }, { user_id: 'u2' }], error: null },
      profiles: {
        data: [
          { user_id: 'u1', email: 'owner@example.com' },
          { user_id: 'u2', email: 'manager@example.com' },
        ],
        error: null,
      },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    // First call must hit user_restaurants with the role filter.
    expect(calls.userRestaurants.table).toBe('user_restaurants');
    expect(calls.userRestaurants.select).toBe('user_id');
    expect(calls.userRestaurants.eqCol).toBe('restaurant_id');
    expect(calls.userRestaurants.eqVal).toBe('rest-1');
    expect(calls.userRestaurants.inCol).toBe('role');
    expect(calls.userRestaurants.inVals).toEqual(['owner', 'manager']);
    // Second call must hit profiles with the user_ids from step 1.
    expect(calls.profiles.table).toBe('profiles');
    expect(calls.profiles.select).toContain('email');
    expect(calls.profiles.inCol).toBe('user_id');
    expect(calls.profiles.inVals.sort()).toEqual(['u1', 'u2']);
    // Result merges both.
    expect(result.emails.sort()).toEqual(['manager@example.com', 'owner@example.com']);
    expect(result.managersFound).toBe(2);
    expect(result.employeeIncluded).toBe(false);
  });

  it('CRITICAL: skips profiles call when no users match the role filter', async () => {
    const { supabase, calls } = makeSupabaseStub({
      userRestaurants: { data: [], error: null },
      profiles: { data: [], error: null },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    expect(calls.userRestaurants.table).toBe('user_restaurants');
    expect(calls.profiles.table).toBe(''); // never called
    expect(result.emails).toEqual([]);
    expect(result.managersFound).toBe(0);
  });

  it('CRITICAL: de-duplicates when employee email is also a manager email', async () => {
    const { supabase } = makeSupabaseStub({
      userRestaurants: { data: [{ user_id: 'u1' }, { user_id: 'u2' }], error: null },
      profiles: {
        data: [
          { user_id: 'u1', email: 'shared@example.com' },
          { user_id: 'u2', email: 'other@example.com' },
        ],
        error: null,
      },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: 'shared@example.com',
      notifyEmployee: true,
      notifyManagers: true,
    });
    expect(result.emails.sort()).toEqual(['other@example.com', 'shared@example.com']);
    expect(result.employeeIncluded).toBe(true);
    expect(result.managersFound).toBe(2);
  });

  it('CRITICAL: captures managerLookupError when user_restaurants query errors', async () => {
    const { supabase } = makeSupabaseStub({
      userRestaurants: { data: null, error: { message: 'permission denied' } },
      profiles: { data: [], error: null },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    expect(result.emails).toEqual([]);
    expect(result.managersFound).toBe(0);
    expect(result.managerLookupError).toBe('permission denied');
  });

  it('CRITICAL: captures managerLookupError when profiles query errors', async () => {
    const { supabase } = makeSupabaseStub({
      userRestaurants: { data: [{ user_id: 'u1' }], error: null },
      profiles: { data: null, error: { message: 'profiles unreachable' } },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    expect(result.emails).toEqual([]);
    expect(result.managersFound).toBe(0);
    expect(result.managerLookupError).toBe('profiles unreachable');
  });

  it('CRITICAL: returns empty list when both flags are false', async () => {
    const { supabase } = makeSupabaseStub({
      userRestaurants: { data: [], error: null },
      profiles: { data: [], error: null },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: 'employee@example.com',
      notifyEmployee: false,
      notifyManagers: false,
    });
    expect(result.emails).toEqual([]);
    expect(result.employeeIncluded).toBe(false);
    expect(result.managersFound).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('CRITICAL: skips profile rows with null email', async () => {
    const { supabase } = makeSupabaseStub({
      userRestaurants: { data: [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' }], error: null },
      profiles: {
        data: [
          { user_id: 'u1', email: null },
          { user_id: 'u2', email: null },
          { user_id: 'u3', email: 'real@example.com' },
        ],
        error: null,
      },
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    expect(result.emails).toEqual(['real@example.com']);
    expect(result.managersFound).toBe(1);
  });
});

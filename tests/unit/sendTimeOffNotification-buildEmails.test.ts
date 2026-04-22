import { describe, it, expect, vi } from 'vitest';
import { buildEmails } from '../../supabase/functions/send-time-off-notification/buildEmails';

type ManagerRow = {
  user_id: string;
  profiles: { email?: string | null } | null;
};

interface MockResult {
  data: ManagerRow[] | null;
  error: { message: string } | null;
}

/**
 * Builds a supabase-like stub that captures the call chain for assertions
 * and returns whatever MockResult the test supplies.
 */
function makeSupabaseStub(result: MockResult) {
  const calls = {
    table: '' as string,
    select: '' as string,
    eqCol: '' as string,
    eqVal: '' as string,
    inCol: '' as string,
    inVals: [] as string[],
  };
  const chain = {
    select: (cols: string) => {
      calls.select = cols;
      return {
        eq: (col: string, val: string) => {
          calls.eqCol = col;
          calls.eqVal = val;
          return {
            in: async (col: string, vals: string[]) => {
              calls.inCol = col;
              calls.inVals = vals;
              return result;
            },
          };
        },
      };
    },
  };
  const supabase = {
    from: vi.fn((table: string) => {
      calls.table = table;
      return chain;
    }),
  };
  return { supabase, calls };
}

describe('buildEmails', () => {
  it('CRITICAL: returns only employee when notifyEmployee=true and notifyManagers=false', async () => {
    const { supabase } = makeSupabaseStub({ data: [], error: null });
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

  it('CRITICAL: queries user_restaurants joined to profiles for managers', async () => {
    const { supabase, calls } = makeSupabaseStub({
      data: [
        { user_id: 'u1', profiles: { email: 'owner@example.com' } },
        { user_id: 'u2', profiles: { email: 'manager@example.com' } },
      ],
      error: null,
    });
    const result = await buildEmails({
      supabase: supabase as never,
      restaurantId: 'rest-1',
      employeeEmail: null,
      notifyEmployee: false,
      notifyManagers: true,
    });
    expect(calls.table).toBe('user_restaurants');
    expect(calls.select).toContain('profiles:user_id');
    expect(calls.eqCol).toBe('restaurant_id');
    expect(calls.eqVal).toBe('rest-1');
    expect(calls.inCol).toBe('role');
    expect(calls.inVals).toEqual(['owner', 'manager']);
    expect(result.emails.sort()).toEqual(['manager@example.com', 'owner@example.com']);
    expect(result.managersFound).toBe(2);
    expect(result.employeeIncluded).toBe(false);
  });

  it('CRITICAL: de-duplicates when employee is also a manager', async () => {
    const { supabase } = makeSupabaseStub({
      data: [
        { user_id: 'u1', profiles: { email: 'shared@example.com' } },
        { user_id: 'u2', profiles: { email: 'other@example.com' } },
      ],
      error: null,
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

  it('CRITICAL: captures managerLookupError when the query errors', async () => {
    const { supabase } = makeSupabaseStub({
      data: null,
      error: { message: 'relation profiles does not exist' },
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
    expect(result.managerLookupError).toBe('relation profiles does not exist');
  });

  it('CRITICAL: returns empty list when both flags are false', async () => {
    const { supabase } = makeSupabaseStub({ data: [], error: null });
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

  it('CRITICAL: skips manager rows with null profiles or null email', async () => {
    const { supabase } = makeSupabaseStub({
      data: [
        { user_id: 'u1', profiles: null },
        { user_id: 'u2', profiles: { email: null } },
        { user_id: 'u3', profiles: { email: 'real@example.com' } },
      ],
      error: null,
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

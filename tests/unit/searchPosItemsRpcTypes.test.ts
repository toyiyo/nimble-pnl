import { describe, expectTypeOf, it } from 'vitest';
import type { Database } from '@/integrations/supabase/types';

// search_pos_items is a SQL RPC (supabase/migrations/20260728140000_search_pos_items.sql)
// that Task 2 (usePOSItems rewrite) calls via `supabase.rpc('search_pos_items', ...)`.
// supabase-js only type-checks the RPC name and payload when the generated
// `Database['public']['Functions']` map includes the function -- this test pins
// the exact Args/Returns shape so a stale `src/integrations/supabase/types.ts`
// (regenerated types not yet committed, or a schema drift later) fails loudly
// at typecheck time instead of surfacing as an `any`-typed RPC call in the hook.
type SearchPosItemsFn = Database['public']['Functions']['search_pos_items'];

describe('search_pos_items RPC types', () => {
  it('types p_restaurant_id/p_search/p_limit args exactly as the migration defines them', () => {
    expectTypeOf<SearchPosItemsFn['Args']>().toEqualTypeOf<{
      p_restaurant_id: string;
      p_search?: string;
      p_limit?: number;
    }>();
  });

  it('types the returned rows to match the POSItem shape the hook consumes', () => {
    expectTypeOf<SearchPosItemsFn['Returns']>().toEqualTypeOf<
      {
        item_name: string;
        item_id: string;
        source: string;
        sales_count: number;
        last_sold: string;
      }[]
    >();
  });
});

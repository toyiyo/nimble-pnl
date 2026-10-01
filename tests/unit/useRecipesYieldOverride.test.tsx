import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// `updateRecipeIngredients` must send `yield_pct_override` on insert, and
// `fetchRecipeIngredients` must read it back -- the recipe-level override
// stored on `recipe_ingredients` (design doc: recipe yield and waste
// allowance). Both paths go through `useRecipes`, so this test drives the
// hook directly instead of re-implementing the Supabase call shape.

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/useAuth', () => {
  const user = { id: 'user-1' };
  return { useAuth: () => ({ user }) };
});

let insertedRows: unknown[] | null = null;
let ingredientsResponse: { data: unknown[] | null; error: unknown };

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'recipe_ingredients') {
        return {
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(() => Promise.resolve({ error: null })),
          }),
          insert: vi.fn().mockImplementation((rows: unknown[]) => {
            insertedRows = rows;
            return Promise.resolve({ error: null });
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockImplementation(() => Promise.resolve(ingredientsResponse)),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    }),
  },
}));

// `useRecipes` also runs the recipe-list query on mount when a restaurantId
// is supplied. Passing null keeps that query disabled so this test stays
// scoped to the two ingredient functions under test.
import { useRecipes } from '@/hooks/useRecipes';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useRecipes -- yield_pct_override persistence', () => {
  beforeEach(() => {
    insertedRows = null;
    ingredientsResponse = { data: [], error: null };
  });

  it('sends yield_pct_override on updateRecipeIngredients', async () => {
    const { result } = renderHook(() => useRecipes(null), { wrapper });

    const ok = await result.current.updateRecipeIngredients('recipe-1', [
      {
        product_id: 'product-1',
        quantity: 2,
        unit: 'oz' as never,
        yield_pct_override: 80,
      } as never,
    ]);

    expect(ok).toBe(true);
    expect(insertedRows).not.toBeNull();
    expect((insertedRows as { yield_pct_override?: number }[])[0].yield_pct_override).toBe(80);
  });

  it('reads yield_pct_override back in fetchRecipeIngredients', async () => {
    ingredientsResponse = {
      data: [
        {
          id: 'ri-1',
          recipe_id: 'recipe-1',
          product_id: 'product-1',
          quantity: 2,
          unit: 'oz',
          yield_pct_override: 75,
          created_at: '',
          updated_at: '',
        },
      ],
      error: null,
    };

    const { result } = renderHook(() => useRecipes(null), { wrapper });

    const ingredients = await result.current.fetchRecipeIngredients('recipe-1');

    expect(ingredients).toHaveLength(1);
    expect(ingredients[0].yield_pct_override).toBe(75);
  });
});

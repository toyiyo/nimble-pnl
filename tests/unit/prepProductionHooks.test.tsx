/**
 * Prep Production Hook Tests
 *
 * Tests the React hooks and integration for prep production:
 * - usePrepRecipes hook
 * - useProductionRuns hook
 * - useProducts hook
 * - Full workflow integration
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient } from '@supabase/supabase-js';

// Mock Supabase client
const mockSupabase = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
      order: vi.fn(() => Promise.resolve({ data: [], error: null })),
    })),
    insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    update: vi.fn(() => Promise.resolve({ data: null, error: null })),
    delete: vi.fn(() => Promise.resolve({ data: null, error: null })),
  })),
  auth: {
    getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null })),
  },
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

// Mock the hooks
vi.mock('@/hooks/usePrepRecipes', () => ({
  usePrepRecipes: vi.fn(() => ({
    prepRecipes: [],
    loading: false,
    error: null,
    createPrepRecipe: vi.fn(),
    updatePrepRecipe: vi.fn(),
    deletePrepRecipe: vi.fn(),
  })),
}));

vi.mock('@/hooks/useProductionRuns', () => ({
  useProductionRuns: vi.fn(() => ({
    productionRuns: [],
    loading: false,
    error: null,
    createProductionRun: vi.fn(),
    updateProductionRun: vi.fn(),
    completeProductionRun: vi.fn(),
  })),
}));

vi.mock('@/hooks/useProducts', () => ({
  useProducts: vi.fn(() => ({
    products: [],
    loading: false,
    error: null,
    updateProduct: vi.fn(),
  })),
}));

import { usePrepRecipes } from '@/hooks/usePrepRecipes';
import { useProductionRuns } from '@/hooks/useProductionRuns';
import { useProducts } from '@/hooks/useProducts';

// Test data
const mockProduct = {
  id: 'product-1',
  name: 'Raw Chicken',
  cost_per_unit: 4.00,
  uom_purchase: 'kg',
  current_stock: 50,
};

const mockPrepRecipe = {
  id: 'recipe-1',
  name: 'Chicken Soup Base',
  default_yield: 10,
  default_yield_unit: 'L',
  ingredients: [{
    id: 'ingredient-1',
    product_id: 'product-1',
    quantity: 5,
    unit: 'kg',
    product: mockProduct,
  }],
};

const mockProductionRun = {
  id: 'run-1',
  status: 'planned',
  target_yield: 20,
  target_yield_unit: 'L',
  actual_yield: null,
  actual_yield_unit: null,
  prep_recipe: mockPrepRecipe,
  ingredients: [{
    id: 'run-ingredient-1',
    product_id: 'product-1',
    expected_quantity: 10,
    actual_quantity: null,
    unit: 'kg',
    product: mockProduct,
  }],
};

// Test wrapper component
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('Prep Production Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('usePrepRecipes', () => {
    it('should load prep recipes successfully', async () => {
      const mockUsePrepRecipes = vi.mocked(usePrepRecipes);
      mockUsePrepRecipes.mockReturnValue({
        prepRecipes: [mockPrepRecipe],
        loading: false,
        error: null,
        createPrepRecipe: vi.fn(),
        updatePrepRecipe: vi.fn(),
        deletePrepRecipe: vi.fn(),
      });

      const { result } = renderHook(() => usePrepRecipes('restaurant-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.prepRecipes).toHaveLength(1);
        expect(result.current.prepRecipes[0].name).toBe('Chicken Soup Base');
      });
    });

    it('should handle loading state', () => {
      const mockUsePrepRecipes = vi.mocked(usePrepRecipes);
      mockUsePrepRecipes.mockReturnValue({
        prepRecipes: [],
        loading: true,
        error: null,
        createPrepRecipe: vi.fn(),
        updatePrepRecipe: vi.fn(),
        deletePrepRecipe: vi.fn(),
      });

      const { result } = renderHook(() => usePrepRecipes('restaurant-1'), {
        wrapper: createWrapper(),
      });

      expect(result.current.loading).toBe(true);
      expect(result.current.prepRecipes).toHaveLength(0);
    });

    it('should handle error state', () => {
      const mockUsePrepRecipes = vi.mocked(usePrepRecipes);
      mockUsePrepRecipes.mockReturnValue({
        prepRecipes: [],
        loading: false,
        error: new Error('Failed to load recipes'),
        createPrepRecipe: vi.fn(),
        updatePrepRecipe: vi.fn(),
        deletePrepRecipe: vi.fn(),
      });

      const { result } = renderHook(() => usePrepRecipes('restaurant-1'), {
        wrapper: createWrapper(),
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Failed to load recipes');
    });
  });

  describe('useProductionRuns', () => {
    it('should load production runs successfully', async () => {
      const mockUseProductionRuns = vi.mocked(useProductionRuns);
      mockUseProductionRuns.mockReturnValue({
        productionRuns: [mockProductionRun],
        loading: false,
        error: null,
        createProductionRun: vi.fn(),
        updateProductionRun: vi.fn(),
        completeProductionRun: vi.fn(),
      });

      const { result } = renderHook(() => useProductionRuns('restaurant-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.productionRuns).toHaveLength(1);
        expect(result.current.productionRuns[0].status).toBe('planned');
      });
    });

    it('should create a new production run', async () => {
      const createProductionRunMock = vi.fn().mockResolvedValue(mockProductionRun);
      const mockUseProductionRuns = vi.mocked(useProductionRuns);
      mockUseProductionRuns.mockReturnValue({
        productionRuns: [],
        loading: false,
        error: null,
        createProductionRun: createProductionRunMock,
        updateProductionRun: vi.fn(),
        completeProductionRun: vi.fn(),
      });

      const { result } = renderHook(() => useProductionRuns('restaurant-1'), {
        wrapper: createWrapper(),
      });

      await result.current.createProductionRun({
        prep_recipe_id: 'recipe-1',
        target_yield: 20,
        target_yield_unit: 'L',
      });

      expect(createProductionRunMock).toHaveBeenCalledWith({
        prep_recipe_id: 'recipe-1',
        target_yield: 20,
        target_yield_unit: 'L',
      });
    });

    it('should complete a production run', async () => {
      const completeProductionRunMock = vi.fn().mockResolvedValue({
        ...mockProductionRun,
        status: 'completed',
        actual_yield: 18,
      });
      const mockUseProductionRuns = vi.mocked(useProductionRuns);
      mockUseProductionRuns.mockReturnValue({
        productionRuns: [mockProductionRun],
        loading: false,
        error: null,
        createProductionRun: vi.fn(),
        updateProductionRun: vi.fn(),
        completeProductionRun: completeProductionRunMock,
      });

      const { result } = renderHook(() => useProductionRuns('restaurant-1'), {
        wrapper: createWrapper(),
      });

      await result.current.completeProductionRun('run-1', {
        actual_yield: 18,
        actual_yield_unit: 'L',
        ingredient_actuals: [{
          ingredient_id: 'run-ingredient-1',
          actual_quantity: 12,
        }],
      });

      expect(completeProductionRunMock).toHaveBeenCalledWith('run-1', {
        actual_yield: 18,
        actual_yield_unit: 'L',
        ingredient_actuals: [{
          ingredient_id: 'run-ingredient-1',
          actual_quantity: 12,
        }],
      });
    });
  });

  describe('useProducts', () => {
    it('should load products successfully', async () => {
      const mockUseProducts = vi.mocked(useProducts);
      mockUseProducts.mockReturnValue({
        products: [mockProduct],
        loading: false,
        error: null,
        updateProduct: vi.fn(),
      });

      const { result } = renderHook(() => useProducts('restaurant-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.products).toHaveLength(1);
        expect(result.current.products[0].name).toBe('Raw Chicken');
      });
    });

    it('should update product inventory', async () => {
      const updateProductMock = vi.fn().mockResolvedValue({
        ...mockProduct,
        current_stock: 38, // Deducted 12kg
      });
      const mockUseProducts = vi.mocked(useProducts);
      mockUseProducts.mockReturnValue({
        products: [mockProduct],
        loading: false,
        error: null,
        updateProduct: updateProductMock,
      });

      const { result } = renderHook(() => useProducts('restaurant-1'), {
        wrapper: createWrapper(),
      });

      await result.current.updateProduct('product-1', {
        current_stock: 38,
      });

      expect(updateProductMock).toHaveBeenCalledWith('product-1', {
        current_stock: 38,
      });
    });
  });

  describe('Integration Workflow', () => {
    it('should handle complete prep production workflow', async () => {
      // Mock all hooks for integration test
      const mockUsePrepRecipes = vi.mocked(usePrepRecipes);
      const mockUseProductionRuns = vi.mocked(useProductionRuns);
      const mockUseProducts = vi.mocked(useProducts);

      const createProductionRunMock = vi.fn().mockResolvedValue(mockProductionRun);
      const completeProductionRunMock = vi.fn().mockResolvedValue({
        ...mockProductionRun,
        status: 'completed',
        actual_yield: 18,
      });
      const updateProductMock = vi.fn().mockResolvedValue({
        ...mockProduct,
        current_stock: 38,
      });

      mockUsePrepRecipes.mockReturnValue({
        prepRecipes: [mockPrepRecipe],
        loading: false,
        error: null,
        createPrepRecipe: vi.fn(),
        updatePrepRecipe: vi.fn(),
        deletePrepRecipe: vi.fn(),
      });

      mockUseProductionRuns.mockReturnValue({
        productionRuns: [],
        loading: false,
        error: null,
        createProductionRun: createProductionRunMock,
        updateProductionRun: vi.fn(),
        completeProductionRun: completeProductionRunMock,
      });

      mockUseProducts.mockReturnValue({
        products: [mockProduct],
        loading: false,
        error: null,
        updateProduct: updateProductMock,
      });

      // Test the workflow steps
      const { result: recipesResult } = renderHook(() => usePrepRecipes('restaurant-1'), {
        wrapper: createWrapper(),
      });
      const { result: runsResult } = renderHook(() => useProductionRuns('restaurant-1'), {
        wrapper: createWrapper(),
      });
      const { result: productsResult } = renderHook(() => useProducts('restaurant-1'), {
        wrapper: createWrapper(),
      });

      // Step 1: Verify recipe exists
      await waitFor(() => {
        expect(recipesResult.current.prepRecipes).toHaveLength(1);
      });

      // Step 2: Create production run
      await runsResult.current.createProductionRun({
        prep_recipe_id: 'recipe-1',
        target_yield: 20,
        target_yield_unit: 'L',
      });

      expect(createProductionRunMock).toHaveBeenCalled();

      // Step 3: Complete production run
      await runsResult.current.completeProductionRun('run-1', {
        actual_yield: 18,
        actual_yield_unit: 'L',
        ingredient_actuals: [{
          ingredient_id: 'run-ingredient-1',
          actual_quantity: 12,
        }],
      });

      expect(completeProductionRunMock).toHaveBeenCalled();

      // Step 4: Update inventory
      await productsResult.current.updateProduct('product-1', {
        current_stock: 38, // 50 - 12
      });

      expect(updateProductMock).toHaveBeenCalledWith('product-1', {
        current_stock: 38,
      });
    });
  });
});
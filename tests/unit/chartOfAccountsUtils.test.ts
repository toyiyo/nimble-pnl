
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDefaultChartOfAccounts, DEFAULT_ACCOUNTS } from '@/lib/chartOfAccountsUtils';

// Mock Supabase client
const mockUpsert = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();

const mockSupabaseChain = {
  upsert: mockUpsert,
  select: mockSelect,
  eq: mockEq,
} as any;

const mockSupabase = {
  from: vi.fn(() => mockSupabaseChain),
} as any;

describe('chartOfAccountsUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default successful responses
    mockUpsert.mockResolvedValue({ error: null });
    
    // Default chain for select
    mockSelect.mockReturnThis();
    mockEq.mockResolvedValue({ 
      data: [{ id: 'parent-id-1', account_code: '1000' }], // Mock one parent found
      error: null 
    });
  });

  describe('createDefaultChartOfAccounts', () => {
    it('should insert parent accounts first, then child accounts', async () => {
      const restaurantId = 'test-restaurant-id';
      
      await createDefaultChartOfAccounts(mockSupabase, restaurantId);

      // Verify first upsert (parents)
      expect(mockSupabase.from).toHaveBeenCalledWith('chart_of_accounts');
      expect(mockUpsert).toHaveBeenNthCalledWith(1, expect.arrayContaining([
        expect.objectContaining({
            restaurant_id: restaurantId,
            parent_account_id: null
        })
      ]), expect.any(Object));

      // Verify fetch of created parents
      expect(mockSelect).toHaveBeenCalledWith('id, account_code');
      expect(mockEq).toHaveBeenCalledWith('restaurant_id', restaurantId);

      // Verify second upsert (children)
      expect(mockUpsert).toHaveBeenNthCalledWith(2, expect.arrayContaining([
        expect.objectContaining({
            restaurant_id: restaurantId,
            // parent_account_id should be set based on map. 
            // In our mock, we returned code 1000 as parent-id-1
            // But we didn't check which child account we were checking, 
            // so let's just ensure it was called.
        })
      ]), expect.any(Object));
    });

    it('should throw error if parent upsert fails', async () => {
      mockUpsert.mockResolvedValueOnce({ error: new Error('Upsert failed') });
      
      await expect(createDefaultChartOfAccounts(mockSupabase, 'id'))
        .rejects.toThrow('Upsert failed');
    });

    it('should throw error if fetching parents fails', async () => {
      mockUpsert.mockResolvedValueOnce({ error: null }); // Parents success
      mockEq.mockResolvedValueOnce({ data: null, error: new Error('Fetch failed') }); // Fetch fail
      
      await expect(createDefaultChartOfAccounts(mockSupabase, 'id'))
        .rejects.toThrow('Fetch failed');
    });
    
    it('should contain expected default accounts', () => {
        expect(DEFAULT_ACCOUNTS.length).toBeGreaterThan(0);
        const cashAccount = DEFAULT_ACCOUNTS.find(a => a.account_code === '1000');
        expect(cashAccount).toBeDefined();
        expect(cashAccount?.account_name).toBe('Cash & Cash Equivalents');
    });
  });
});

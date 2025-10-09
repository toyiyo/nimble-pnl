import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface PricePoint {
  date: string;
  price: number;
  supplier_name: string;
  quantity: number;
}

interface ProductPricing {
  product_id: string;
  product_name: string;
  category: string;
  current_price: number;
  price_history: PricePoint[];
  price_change_30d: number;
  price_change_90d: number;
  volatility: number;
  supplier_count: number;
  cheapest_supplier: string;
  most_expensive_supplier: string;
  potential_savings: number;
}

interface SupplierMetrics {
  supplier_id: string;
  supplier_name: string;
  product_count: number;
  avg_price_change: number;
  reliability_score: number;
  total_purchases: number;
}

export function useSupplierPriceAnalytics(restaurantId: string | null) {
  const [productPricing, setProductPricing] = useState<ProductPricing[]>([]);
  const [supplierMetrics, setSupplierMetrics] = useState<SupplierMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!restaurantId) return;
    fetchPriceAnalytics();
  }, [restaurantId]);

  const fetchPriceAnalytics = async () => {
    if (!restaurantId) return;

    // Increment request ID and capture it for this request
    requestIdRef.current += 1;
    const currentRequestId = requestIdRef.current;

    try {
      setLoading(true);

      // Fetch products with their suppliers
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select(`
          id,
          name,
          category,
          cost_per_unit,
          product_suppliers (
            id,
            supplier_id,
            last_unit_cost,
            average_unit_cost,
            suppliers (
              id,
              name
            )
          )
        `)
        .eq('restaurant_id', restaurantId);

      if (productsError) throw productsError;

      // Fetch historical pricing from inventory transactions
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const { data: transactions, error: transError } = await supabase
        .from('inventory_transactions')
        .select(`
          product_id,
          unit_cost,
          quantity,
          created_at,
          supplier_id,
          suppliers (
            id,
            name
          )
        `)
        .eq('restaurant_id', restaurantId)
        .eq('transaction_type', 'purchase')
        .gte('created_at', ninetyDaysAgo.toISOString())
        .order('created_at', { ascending: true });

      if (transError) throw transError;

      // Process data for each product
      const pricingData: ProductPricing[] = products?.map(product => {
        const productTransactions = transactions?.filter(t => t.product_id === product.id) || [];
        
        // Build price history
        const priceHistory: PricePoint[] = productTransactions.map(t => ({
          date: t.created_at,
          price: t.unit_cost || 0,
          supplier_name: t.suppliers?.name || 'Unknown',
          quantity: t.quantity || 0,
        }));

        // Calculate price changes
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const recent30d = priceHistory.filter(p => new Date(p.date) >= thirtyDaysAgo);
        const recent90d = priceHistory;

        const currentPrice = product.cost_per_unit || 0;
        const price30dAgo = recent30d[0]?.price || currentPrice;
        const price90dAgo = recent90d[0]?.price || currentPrice;

        const priceChange30d = price30dAgo > 0 ? ((currentPrice - price30dAgo) / price30dAgo) * 100 : 0;
        const priceChange90d = price90dAgo > 0 ? ((currentPrice - price90dAgo) / price90dAgo) * 100 : 0;

        // Calculate volatility (standard deviation of price changes)
        const prices = priceHistory.map(p => p.price);
        const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length || currentPrice;
        const variance = prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length;
        const volatility = avgPrice > 0 ? (Math.sqrt(variance) / avgPrice) * 100 : 0;

        // Supplier comparison
        const suppliers = product.product_suppliers || [];
        const supplierPrices = suppliers
          .map(ps => ({
            name: ps.suppliers?.name || 'Unknown',
            price: ps.last_unit_cost || ps.average_unit_cost || 0,
          }))
          .filter(s => s.price > 0);

        const cheapestSupplier = supplierPrices.reduce((min, s) => 
          s.price < min.price ? s : min, 
          supplierPrices[0] || { name: 'N/A', price: currentPrice }
        );

        const mostExpensiveSupplier = supplierPrices.reduce((max, s) => 
          s.price > max.price ? s : max,
          supplierPrices[0] || { name: 'N/A', price: currentPrice }
        );

        const potentialSavings = mostExpensiveSupplier.price - cheapestSupplier.price;

        return {
          product_id: product.id,
          product_name: product.name,
          category: product.category || 'Uncategorized',
          current_price: currentPrice,
          price_history: priceHistory,
          price_change_30d: priceChange30d,
          price_change_90d: priceChange90d,
          volatility,
          supplier_count: suppliers.length,
          cheapest_supplier: cheapestSupplier.name,
          most_expensive_supplier: mostExpensiveSupplier.name,
          potential_savings: potentialSavings,
        };
      }) || [];

      // Calculate supplier metrics
      const supplierMap = new Map<string, {
        name: string;
        products: Set<string>;
        priceChanges: number[];
        purchases: number;
      }>();

      transactions?.forEach(t => {
        if (!t.supplier_id) return;
        
        if (!supplierMap.has(t.supplier_id)) {
          supplierMap.set(t.supplier_id, {
            name: t.suppliers?.name || 'Unknown',
            products: new Set(),
            priceChanges: [],
            purchases: 0,
          });
        }

        const supplier = supplierMap.get(t.supplier_id)!;
        supplier.products.add(t.product_id);
        supplier.purchases++;
      });

      const supplierData: SupplierMetrics[] = Array.from(supplierMap.entries()).map(([id, data]) => {
        // Calculate avg price change for this supplier's products
        const supplierProducts = pricingData.filter(p => 
          p.price_history.some(ph => ph.supplier_name === data.name)
        );
        const avgPriceChange = supplierProducts.reduce((sum, p) => sum + p.price_change_30d, 0) / supplierProducts.length || 0;

        // Simple reliability score based on number of transactions and product variety
        const reliabilityScore = Math.min(100, (data.purchases * 10 + data.products.size * 5));

        return {
          supplier_id: id,
          supplier_name: data.name,
          product_count: data.products.size,
          avg_price_change: avgPriceChange,
          reliability_score: reliabilityScore,
          total_purchases: data.purchases,
        };
      });

      // Only update state if this is still the latest request
      if (currentRequestId === requestIdRef.current) {
        setProductPricing(pricingData);
        setSupplierMetrics(supplierData);
      }
    } catch (error) {
      // Only handle error if this is still the latest request
      if (currentRequestId === requestIdRef.current) {
        console.error('Error fetching price analytics:', error);
        toast({
          title: 'Error loading price analytics',
          description: 'Failed to fetch supplier pricing data',
          variant: 'destructive',
        });
      }
    } finally {
      // Only clear loading if this is still the latest request
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  };

  return {
    productPricing,
    supplierMetrics,
    loading,
    refetch: fetchPriceAnalytics,
  };
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface VarianceTrend {
  date: string;
  total_items: number;
  items_with_variance: number;
  shrinkage_value: number;
  variance_rate: number;
}

export interface CategoryVariance {
  category: string;
  items_count: number;
  total_variance_value: number;
  avg_variance_percentage: number;
  top_offenders: {
    product_name: string;
    variance: number;
    variance_value: number;
  }[];
}

export interface ProductVarianceHistory {
  product_id: string;
  product_name: string;
  category: string;
  reconciliations: {
    date: string;
    expected: number;
    actual: number;
    variance: number;
    variance_value: number;
  }[];
  avg_variance: number;
  trend: 'improving' | 'stable' | 'worsening';
}

export interface VarianceInsight {
  type: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  affected_items: number;
  estimated_impact: number;
  recommendation: string;
}

export interface ReconciliationVarianceData {
  trends: VarianceTrend[];
  categoryBreakdown: CategoryVariance[];
  topVariances: ProductVarianceHistory[];
  insights: VarianceInsight[];
  summary: {
    total_reconciliations: number;
    avg_shrinkage_per_count: number;
    total_shrinkage: number;
    most_problematic_category: string;
    improvement_rate: number;
  };
}

async function fetchVarianceData(
  restaurantId: string | null,
  dateFrom?: Date,
  dateTo?: Date
): Promise<ReconciliationVarianceData | null> {
  if (!restaurantId) return null;

  try {

    // Fetch completed reconciliations from the specified period or last 90 days
    const endDate = dateTo || new Date();
    const startDate = dateFrom || (() => {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      return d;
    })();

    const { data: reconciliations, error: recsError } = await supabase
      .from('inventory_reconciliations')
      .select(`
        id,
        reconciliation_date,
        total_items_counted,
        items_with_variance,
        total_shrinkage_value,
        reconciliation_items!inner(
          id,
          product_id,
          expected_quantity,
          actual_quantity,
          variance,
          variance_value,
          product:products(
            name,
            category
          )
        )
      `)
      .eq('restaurant_id', restaurantId)
      .eq('status', 'submitted')
      .gte('reconciliation_date', startDate.toISOString().split('T')[0])
      .lte('reconciliation_date', endDate.toISOString().split('T')[0])
      .order('reconciliation_date', { ascending: true });

    if (recsError) throw recsError;
    if (!reconciliations || reconciliations.length === 0) {
      return {
        trends: [],
        categoryBreakdown: [],
        topVariances: [],
        insights: [],
        summary: {
          total_reconciliations: 0,
          avg_shrinkage_per_count: 0,
          total_shrinkage: 0,
          most_problematic_category: '',
          improvement_rate: 0,
        },
      };
    }

      // Calculate trends
      const trends: VarianceTrend[] = reconciliations.map((rec: any) => ({
        date: rec.reconciliation_date,
        total_items: rec.total_items_counted,
        items_with_variance: rec.items_with_variance,
        shrinkage_value: Math.abs(rec.total_shrinkage_value),
        variance_rate: rec.total_items_counted > 0 
          ? (rec.items_with_variance / rec.total_items_counted) * 100 
          : 0,
      }));

      // Aggregate by category
      const categoryMap = new Map<string, {
        count: number;
        total_variance_value: number;
        items: { product_name: string; variance: number; variance_value: number }[];
      }>();

      reconciliations.forEach((rec: any) => {
        rec.reconciliation_items.forEach((item: any) => {
          if (!item.variance || item.variance === 0) return;
          
          const category = item.product?.category || 'Uncategorized';
          if (!categoryMap.has(category)) {
            categoryMap.set(category, { count: 0, total_variance_value: 0, items: [] });
          }
          
          const catData = categoryMap.get(category)!;
          catData.count++;
          catData.total_variance_value += Math.abs(item.variance_value || 0);
          catData.items.push({
            product_name: item.product?.name || 'Unknown',
            variance: item.variance,
            variance_value: item.variance_value || 0,
          });
        });
      });

      const categoryBreakdown: CategoryVariance[] = Array.from(categoryMap.entries())
        .map(([category, data]) => ({
          category,
          items_count: data.count,
          total_variance_value: data.total_variance_value,
          avg_variance_percentage: 0, // TODO: Calculate properly
          top_offenders: data.items
            .sort((a, b) => Math.abs(b.variance_value) - Math.abs(a.variance_value))
            .slice(0, 3),
        }))
        .sort((a, b) => b.total_variance_value - a.total_variance_value);

      // Track product variance history
      const productMap = new Map<string, {
        product_name: string;
        category: string;
        reconciliations: any[];
      }>();

      reconciliations.forEach((rec: any) => {
        rec.reconciliation_items.forEach((item: any) => {
          if (!item.variance || item.variance === 0) return;
          
          const key = item.product_id;
          if (!productMap.has(key)) {
            productMap.set(key, {
              product_name: item.product?.name || 'Unknown',
              category: item.product?.category || 'Uncategorized',
              reconciliations: [],
            });
          }
          
          productMap.get(key)!.reconciliations.push({
            date: rec.reconciliation_date,
            expected: item.expected_quantity,
            actual: item.actual_quantity || 0,
            variance: item.variance,
            variance_value: item.variance_value || 0,
          });
        });
      });

      const topVariances: ProductVarianceHistory[] = Array.from(productMap.entries())
        .map(([product_id, data]) => {
          const avg_variance = data.reconciliations.reduce((sum, r) => sum + Math.abs(r.variance), 0) / data.reconciliations.length;
          
          // Determine trend (comparing first half to second half)
          const midpoint = Math.floor(data.reconciliations.length / 2);
          const firstHalfAvg = data.reconciliations.slice(0, midpoint).reduce((sum, r) => sum + Math.abs(r.variance), 0) / midpoint;
          const secondHalfAvg = data.reconciliations.slice(midpoint).reduce((sum, r) => sum + Math.abs(r.variance), 0) / (data.reconciliations.length - midpoint);
          
          let trend: 'improving' | 'stable' | 'worsening' = 'stable';
          if (secondHalfAvg < firstHalfAvg * 0.8) trend = 'improving';
          else if (secondHalfAvg > firstHalfAvg * 1.2) trend = 'worsening';
          
          return {
            product_id,
            product_name: data.product_name,
            category: data.category,
            reconciliations: data.reconciliations,
            avg_variance,
            trend,
          };
        })
        .sort((a, b) => b.avg_variance - a.avg_variance)
        .slice(0, 20);

      // Generate insights
      const insights: VarianceInsight[] = [];

      // Critical insight: High shrinkage items
      const highShrinkageItems = topVariances.filter(item => 
        item.avg_variance > 5 && item.trend === 'worsening'
      );
      if (highShrinkageItems.length > 0) {
        const totalImpact = highShrinkageItems.reduce((sum, item) => 
          sum + item.reconciliations.reduce((s, r) => s + Math.abs(r.variance_value), 0), 0
        );
        insights.push({
          type: 'critical',
          title: 'Worsening Shrinkage Trend',
          description: `${highShrinkageItems.length} products show increasing variance over time`,
          affected_items: highShrinkageItems.length,
          estimated_impact: totalImpact,
          recommendation: 'Review portion control, storage procedures, and staff training for these items',
        });
      }

      // Warning: Category with high variance
      if (categoryBreakdown.length > 0 && categoryBreakdown[0].total_variance_value > 100) {
        insights.push({
          type: 'warning',
          title: `High Variance in ${categoryBreakdown[0].category}`,
          description: `${categoryBreakdown[0].category} category shows significant inventory discrepancies`,
          affected_items: categoryBreakdown[0].items_count,
          estimated_impact: categoryBreakdown[0].total_variance_value,
          recommendation: 'Audit storage and handling procedures for this category',
        });
      }

      // Info: Improvement detected
      const improvingItems = topVariances.filter(item => item.trend === 'improving');
      if (improvingItems.length > 0) {
        insights.push({
          type: 'info',
          title: 'Variance Improvement Detected',
          description: `${improvingItems.length} products showing better inventory accuracy`,
          affected_items: improvingItems.length,
          estimated_impact: 0,
          recommendation: 'Document and replicate successful procedures for other products',
        });
      }

      // Calculate summary
      const total_shrinkage = trends.reduce((sum, t) => sum + t.shrinkage_value, 0);
      const total_reconciliations = reconciliations.length;
      const avg_shrinkage_per_count = total_shrinkage / total_reconciliations;
      
      // Calculate improvement rate (comparing last 3 to previous 3)
      let improvement_rate = 0;
      if (trends.length >= 6) {
        const recentAvg = trends.slice(-3).reduce((sum, t) => sum + t.variance_rate, 0) / 3;
        const previousAvg = trends.slice(-6, -3).reduce((sum, t) => sum + t.variance_rate, 0) / 3;
      improvement_rate = previousAvg > 0 ? ((previousAvg - recentAvg) / previousAvg) * 100 : 0;
    }

    return {
      trends,
      categoryBreakdown,
      topVariances,
      insights,
      summary: {
        total_reconciliations,
        avg_shrinkage_per_count,
        total_shrinkage,
        most_problematic_category: categoryBreakdown[0]?.category || '',
        improvement_rate,
      },
    };

  } catch (error: any) {
    if (import.meta.env.DEV) {
      console.error('Error fetching variance data:', error);
    }
    throw error;
  }
}

export function useReconciliationVariance(
  restaurantId: string | null,
  dateFrom?: Date,
  dateTo?: Date
) {
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['reconciliation-variance', restaurantId, dateFrom, dateTo],
    queryFn: () => fetchVarianceData(restaurantId, dateFrom, dateTo),
    enabled: !!restaurantId,
    staleTime: 60000, // 60 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Handle errors with toast
  if (query.error) {
    toast({
      title: 'Error loading variance analysis',
      description: (query.error as Error).message,
      variant: 'destructive',
    });
  }

  return {
    data: query.data || null,
    loading: query.isLoading,
    refetch: query.refetch,
  };
}

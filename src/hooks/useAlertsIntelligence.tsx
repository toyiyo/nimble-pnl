import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, subDays } from 'date-fns';

export interface AlertItem {
  id: string;
  name: string;
  category: string;
  current_stock: number;
  reorder_point: number;
  par_level_min: number;
  par_level_max: number;
  uom_purchase: string;
  cost_per_unit: number;
  supplier_name: string;
  days_until_stockout: number;
  stockout_risk: 'critical' | 'high' | 'medium' | 'low';
  reorder_frequency: number;
  avg_consumption_rate: number;
}

export interface StockoutHistory {
  product_name: string;
  stockout_count: number;
  total_days_out: number;
  last_stockout: string;
  estimated_lost_sales: number;
}

export interface SupplierPerformance {
  supplier_name: string;
  total_items: number;
  critical_items: number;
  avg_days_until_stockout: number;
  reliability_score: number;
}

export interface AlertInsight {
  id: string;
  type: 'critical' | 'warning' | 'success' | 'info';
  title: string;
  description: string;
  affected_items: string[];
  estimated_impact: number;
  recommendation: string;
  priority: number;
}

export interface AlertBenchmark {
  metric: string;
  current_value: number;
  target_value: number;
  performance: 'above' | 'below' | 'at';
  gap: number;
}

export interface AlertsIntelligenceData {
  summary: {
    total_alerts: number;
    critical_alerts: number;
    stockout_items: number;
    total_value_at_risk: number;
    avg_days_until_stockout: number;
    par_level_efficiency: number;
  };
  alert_items: AlertItem[];
  stockout_history: StockoutHistory[];
  supplier_performance: SupplierPerformance[];
  insights: AlertInsight[];
  benchmarks: AlertBenchmark[];
  predictions: {
    items_at_risk_this_week: string[];
    estimated_reorder_cost: number;
    optimal_reorder_timing: Record<string, string>;
    confidence: number;
  };
}

export const useAlertsIntelligence = (restaurantId: string | null) => {
  const [data, setData] = useState<AlertsIntelligenceData | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchIntelligence = async () => {
    if (!restaurantId) return;

    try {
      setLoading(true);

      // Fetch current inventory with alert thresholds
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('current_stock', { ascending: true });

      if (productsError) throw productsError;

      // Fetch inventory transactions for consumption analysis
      const { data: transactions, error: transactionsError } = await supabase
        .from('inventory_transactions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .in('transaction_type', ['usage', 'waste', 'purchase'])
        .gte('created_at', subDays(new Date(), 60).toISOString())
        .order('created_at', { ascending: false });

      if (transactionsError) throw transactionsError;

      // Process alert items with consumption rates
      const alertItems: AlertItem[] = [];
      const stockoutHistoryMap = new Map<string, StockoutHistory>();
      const supplierMap = new Map<string, SupplierPerformance>();

      products?.forEach(product => {
        // Calculate consumption rate from last 30 days
        const productTransactions = transactions?.filter(
          t => t.product_id === product.id && 
          t.transaction_type === 'usage' &&
          new Date(t.created_at) >= subDays(new Date(), 30)
        ) || [];

        const totalUsage = productTransactions.reduce((sum, t) => sum + Math.abs(t.quantity || 0), 0);
        const avgDailyConsumption = totalUsage / 30;

        // Calculate days until stockout
        let daysUntilStockout = 999;
        if (avgDailyConsumption > 0) {
          daysUntilStockout = Math.floor(product.current_stock / avgDailyConsumption);
        }

        // Determine stockout risk
        let stockoutRisk: 'critical' | 'high' | 'medium' | 'low' = 'low';
        if (product.current_stock === 0) stockoutRisk = 'critical';
        else if (daysUntilStockout <= 2) stockoutRisk = 'critical';
        else if (daysUntilStockout <= 5) stockoutRisk = 'high';
        else if (daysUntilStockout <= 10) stockoutRisk = 'medium';

        // Calculate reorder frequency (times below reorder point in last 60 days)
        const reorderEvents = transactions?.filter(
          t => t.product_id === product.id && 
          t.transaction_type === 'purchase'
        ).length || 0;

        // Track stockout history for products currently at 0 stock
        if (product.current_stock === 0) {
          // Find the most recent transaction for this product to estimate when it went to 0
          const lastTransaction = transactions?.filter(
            t => t.product_id === product.id
          ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

          // Count how many times this product has been replenished (indicating previous stockouts)
          const restockCount = transactions?.filter(
            t => t.product_id === product.id && 
            t.transaction_type === 'purchase'
          ).length || 0;

          stockoutHistoryMap.set(product.name, {
            product_name: product.name,
            stockout_count: restockCount + 1, // Current stockout plus previous restocks
            total_days_out: 1, // Currently out of stock
            last_stockout: lastTransaction ? format(new Date(lastTransaction.created_at), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
            estimated_lost_sales: (restockCount + 1) * (product.cost_per_unit || 0) * 10 // Assume 10x markup
          });
        }

        // Track supplier performance
        const supplierName = product.supplier_name || 'Unknown';
        if (!supplierMap.has(supplierName)) {
          supplierMap.set(supplierName, {
            supplier_name: supplierName,
            total_items: 0,
            critical_items: 0,
            avg_days_until_stockout: 0,
            reliability_score: 100
          });
        }
        const supplierPerf = supplierMap.get(supplierName)!;
        supplierPerf.total_items++;
        if (stockoutRisk === 'critical' || stockoutRisk === 'high') {
          supplierPerf.critical_items++;
        }
        supplierPerf.avg_days_until_stockout += daysUntilStockout;

        // Add to alert items if below reorder point or at risk
        if (product.current_stock <= product.reorder_point || stockoutRisk !== 'low') {
          alertItems.push({
            id: product.id,
            name: product.name,
            category: product.category || 'Other',
            current_stock: product.current_stock || 0,
            reorder_point: product.reorder_point || 0,
            par_level_min: product.par_level_min || 0,
            par_level_max: product.par_level_max || 0,
            uom_purchase: product.uom_purchase || 'unit',
            cost_per_unit: product.cost_per_unit || 0,
            supplier_name: supplierName,
            days_until_stockout: daysUntilStockout,
            stockout_risk: stockoutRisk,
            reorder_frequency: reorderEvents,
            avg_consumption_rate: avgDailyConsumption
          });
        }
      });

      // Calculate supplier scores
      supplierMap.forEach(supplier => {
        supplier.avg_days_until_stockout = supplier.avg_days_until_stockout / supplier.total_items;
        const criticalRatio = supplier.critical_items / supplier.total_items;
        supplier.reliability_score = Math.max(0, 100 - (criticalRatio * 50) - Math.max(0, (10 - supplier.avg_days_until_stockout) * 5));
      });

      const supplierPerformance = Array.from(supplierMap.values())
        .sort((a, b) => b.reliability_score - a.reliability_score);

      const stockoutHistory = Array.from(stockoutHistoryMap.values())
        .sort((a, b) => b.estimated_lost_sales - a.estimated_lost_sales);

      // Generate insights
      const insights: AlertInsight[] = [];
      let insightId = 1;

      const criticalItems = alertItems.filter(i => i.stockout_risk === 'critical');
      if (criticalItems.length > 0) {
        insights.push({
          id: `insight-${insightId++}`,
          type: 'critical',
          title: 'Immediate Stockout Risk',
          description: `${criticalItems.length} items are at critical risk of stockout within 2 days or already out of stock.`,
          affected_items: criticalItems.map(i => i.name),
          estimated_impact: criticalItems.reduce((sum, i) => sum + (i.cost_per_unit * i.par_level_min * 10), 0),
          recommendation: 'Place emergency orders immediately. Contact suppliers for expedited delivery. Consider substitute products for immediate use.',
          priority: 1
        });
      }

      const highFrequencyReorders = alertItems.filter(i => i.reorder_frequency > 4);
      if (highFrequencyReorders.length > 0) {
        insights.push({
          id: `insight-${insightId++}`,
          type: 'warning',
          title: 'Frequent Reordering Required',
          description: `${highFrequencyReorders.length} items require frequent reordering (>4 times in 60 days).`,
          affected_items: highFrequencyReorders.map(i => i.name),
          estimated_impact: highFrequencyReorders.reduce((sum, i) => sum + (i.cost_per_unit * 20), 0),
          recommendation: 'Increase par levels to reduce ordering frequency. Negotiate bulk pricing with suppliers. Consider storage capacity upgrades.',
          priority: 2
        });
      }

      const inefficientParLevels = alertItems.filter(i => 
        i.par_level_min > 0 && 
        i.days_until_stockout < 7 && 
        i.current_stock < i.par_level_min * 0.5
      );
      if (inefficientParLevels.length > 0) {
        insights.push({
          id: `insight-${insightId++}`,
          type: 'warning',
          title: 'Par Levels Need Adjustment',
          description: `${inefficientParLevels.length} items consistently fall below optimal par levels.`,
          affected_items: inefficientParLevels.map(i => i.name),
          estimated_impact: inefficientParLevels.length * 50,
          recommendation: 'Review and adjust par levels based on actual consumption patterns. Current levels are too low for operational needs.',
          priority: 2
        });
      }

      const unreliableSuppliers = supplierPerformance.filter(s => s.reliability_score < 70);
      if (unreliableSuppliers.length > 0) {
        insights.push({
          id: `insight-${insightId++}`,
          type: 'warning',
          title: 'Supplier Reliability Issues',
          description: `${unreliableSuppliers.length} suppliers have reliability scores below 70%.`,
          affected_items: unreliableSuppliers.map(s => s.supplier_name),
          estimated_impact: unreliableSuppliers.reduce((sum, s) => sum + (s.total_items * 100), 0),
          recommendation: 'Evaluate alternative suppliers for these items. Consider dual-sourcing critical ingredients to reduce dependency risk.',
          priority: 2
        });
      }

      const wellStockedItems = alertItems.filter(i => 
        i.days_until_stockout > 14 && 
        i.current_stock >= i.par_level_min
      );
      if (wellStockedItems.length > 0) {
        insights.push({
          id: `insight-${insightId++}`,
          type: 'success',
          title: 'Well-Maintained Stock Levels',
          description: `${wellStockedItems.length} items maintain healthy stock levels with sufficient runway.`,
          affected_items: wellStockedItems.map(i => i.name),
          estimated_impact: 0,
          recommendation: 'Continue current ordering practices for these items. Use as templates for optimizing other products.',
          priority: 3
        });
      }

      // Calculate benchmarks with safe division
      const avgDaysUntilStockout = alertItems.length 
        ? alertItems.reduce((sum, i) => sum + i.days_until_stockout, 0) / alertItems.length 
        : 0;
      
      const stockoutItems = alertItems.filter(i => i.current_stock === 0).length;
      
      const parLevelEfficiency = products?.filter(p => 
        p.current_stock >= p.par_level_min && p.current_stock <= p.par_level_max
      ).length || 0;
      const parLevelEfficiencyPercent = (products?.length ?? 0) > 0
        ? (parLevelEfficiency / products.length) * 100
        : 0;

      const stockAvailabilityPercent = (products?.length ?? 0) > 0
        ? ((products.length - stockoutItems) / products.length) * 100
        : 0;

      const supplierReliabilityAvg = supplierPerformance.length
        ? supplierPerformance.reduce((sum, s) => sum + s.reliability_score, 0) / supplierPerformance.length
        : 0;

      const benchmarks: AlertBenchmark[] = [
        {
          metric: 'Avg Days Until Stockout',
          current_value: avgDaysUntilStockout,
          target_value: 14,
          performance: avgDaysUntilStockout >= 14 ? 'above' : avgDaysUntilStockout >= 10 ? 'at' : 'below',
          gap: avgDaysUntilStockout - 14
        },
        {
          metric: 'Par Level Efficiency',
          current_value: parLevelEfficiencyPercent,
          target_value: 80,
          performance: parLevelEfficiencyPercent >= 80 ? 'above' : parLevelEfficiencyPercent >= 70 ? 'at' : 'below',
          gap: parLevelEfficiencyPercent - 80
        },
        {
          metric: 'Stock Availability',
          current_value: stockAvailabilityPercent,
          target_value: 98,
          performance: stockAvailabilityPercent >= 98 ? 'above' : 'below',
          gap: stockAvailabilityPercent - 98
        },
        {
          metric: 'Supplier Reliability',
          current_value: supplierReliabilityAvg,
          target_value: 85,
          performance: supplierReliabilityAvg >= 85 ? 'above' : 'at',
          gap: supplierReliabilityAvg - 85
        }
      ];

      // Generate predictions
      const itemsAtRiskThisWeek = alertItems
        .filter(i => i.days_until_stockout <= 7 && i.days_until_stockout > 0)
        .sort((a, b) => a.days_until_stockout - b.days_until_stockout)
        .map(i => i.name);

      const estimatedReorderCost = alertItems
        .filter(i => i.days_until_stockout <= 7)
        .reduce((sum, i) => sum + (i.par_level_max * i.cost_per_unit), 0);

      const optimalReorderTiming: Record<string, string> = {};
      alertItems.forEach(item => {
        if (item.days_until_stockout <= 14) {
          const reorderDate = new Date();
          reorderDate.setDate(reorderDate.getDate() + Math.max(0, item.days_until_stockout - 3)); // Reorder 3 days before stockout
          optimalReorderTiming[item.name] = format(reorderDate, 'MMM dd, yyyy');
        }
      });

      const predictions = {
        items_at_risk_this_week: itemsAtRiskThisWeek,
        estimated_reorder_cost: estimatedReorderCost,
        optimal_reorder_timing: optimalReorderTiming,
        confidence: 0.85
      };

      // Calculate summary
      const totalValueAtRisk = criticalItems.reduce((sum, i) => sum + (i.cost_per_unit * i.par_level_min), 0);

      const summary = {
        total_alerts: alertItems.length,
        critical_alerts: criticalItems.length,
        stockout_items: stockoutItems,
        total_value_at_risk: totalValueAtRisk,
        avg_days_until_stockout: avgDaysUntilStockout,
        par_level_efficiency: parLevelEfficiencyPercent
      };

      setData({
        summary,
        alert_items: alertItems,
        stockout_history: stockoutHistory,
        supplier_performance: supplierPerformance,
        insights: insights.sort((a, b) => a.priority - b.priority),
        benchmarks,
        predictions
      });

    } catch (error: any) {
      console.error('Error fetching alerts intelligence:', error);
      toast({
        title: "Error loading alerts intelligence",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (restaurantId) {
      fetchIntelligence();
    }
  }, [restaurantId]);

  return { data, loading, refetch: fetchIntelligence };
};

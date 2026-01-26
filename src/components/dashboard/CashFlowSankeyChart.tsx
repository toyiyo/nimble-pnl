import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sankey, ResponsiveContainer, Layer, Rectangle } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useMonthlyExpenses, MonthlyExpenseCategory } from '@/hooks/useMonthlyExpenses';
import { usePeriodMetrics } from '@/hooks/usePeriodMetrics';
import { useRevenueBreakdown } from '@/hooks/useRevenueBreakdown';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { Period } from '@/components/PeriodSelector';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, ArrowRightLeft } from 'lucide-react';

interface CashFlowSankeyChartProps {
  selectedPeriod: Period;
}

interface SankeyNodeData {
  name: string;
  color?: string;
  categoryIds?: string[]; // For expense nodes to enable click-through
}

interface SankeyLinkData {
  source: number;
  target: number;
  value: number;
  color?: string;
  sourceName?: string;
  targetName?: string;
  percentage?: number;
}

interface SankeyData {
  nodes: SankeyNodeData[];
  links: SankeyLinkData[];
}

// Color palette for income sources (green-based) - more variety for multiple categories
const INCOME_COLORS: Record<string, string> = {
  'Sales - Food': 'hsl(142, 71%, 45%)',           // Green
  'Sales - Beverages': 'hsl(172, 66%, 50%)',      // Teal
  'Sales - Alcohol': 'hsl(262, 52%, 56%)',        // Purple
  'Sales - Merchandise': 'hsl(38, 92%, 50%)',     // Amber
  'Sales - Catering': 'hsl(199, 89%, 48%)',       // Sky blue
  'Sales - Delivery': 'hsl(326, 78%, 60%)',       // Pink
  'Other Revenue': 'hsl(152, 60%, 50%)',          // Light green
  'Uncategorized Revenue': 'hsl(0, 0%, 55%)',     // Gray
  'default': 'hsl(var(--chart-2))',               // Primary green
};

// Dynamic color palette for expense categories - generates consistent colors based on name
const EXPENSE_COLOR_HUES = [
  220, // Blue
  25,  // Orange
  280, // Purple
  200, // Cyan
  45,  // Yellow
  330, // Pink
  180, // Teal
  350, // Red
  260, // Violet
  30,  // Brown
  160, // Green
  300, // Magenta
];

// Cache for consistent color assignment per category name
const expenseColorCache = new Map<string, string>();

const getExpenseColor = (categoryName: string): string => {
  if (expenseColorCache.has(categoryName)) {
    return expenseColorCache.get(categoryName)!;
  }
  
  // Generate a consistent hash from the category name
  let hash = 0;
  for (let i = 0; i < categoryName.length; i++) {
    hash = ((hash << 5) - hash) + categoryName.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  
  const hueIndex = Math.abs(hash) % EXPENSE_COLOR_HUES.length;
  const hue = EXPENSE_COLOR_HUES[hueIndex];
  const color = `hsl(${hue}, 65%, 55%)`;
  
  expenseColorCache.set(categoryName, color);
  return color;
};

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

// Custom node component factory for the Sankey chart
// Recharts doesn't pass custom props through, so we use a factory pattern
const createCustomNode = (onNodeClick: (name: string, categoryIds: string[]) => void) => {
  return (props: any) => {
    const { x, y, width, height, index, payload } = props;
    const isMiddle = payload.name === 'Cash Flow';
    const isClickable = payload.categoryIds && payload.categoryIds.length > 0;
    
    const handleClick = () => {
      if (isClickable) {
        onNodeClick(payload.name, payload.categoryIds);
      }
    };
    
    return (
      <Layer key={`node-${index}`}>
        <Rectangle
          x={x}
          y={y}
          width={width}
          height={height}
          fill={payload.color || 'hsl(var(--primary))'}
          fillOpacity={isMiddle ? 1 : 0.9}
          rx={4}
          ry={4}
          style={{ cursor: isClickable ? 'pointer' : 'default' }}
          onClick={handleClick}
        />
        <text
          x={isMiddle ? x + width / 2 : x < 100 ? x - 6 : x + width + 6}
          y={y + height / 2}
          textAnchor={isMiddle ? 'middle' : x < 100 ? 'end' : 'start'}
          dominantBaseline="middle"
          className="fill-foreground text-xs font-medium"
          style={{ cursor: isClickable ? 'pointer' : 'default' }}
          onClick={handleClick}
        >
          {payload.name}
        </text>
        <text
          x={isMiddle ? x + width / 2 : x < 100 ? x - 6 : x + width + 6}
          y={y + height / 2 + 14}
          textAnchor={isMiddle ? 'middle' : x < 100 ? 'end' : 'start'}
          dominantBaseline="middle"
          className="fill-muted-foreground text-[10px]"
          style={{ cursor: isClickable ? 'pointer' : 'default' }}
          onClick={handleClick}
        >
          {formatCurrency(payload.value || 0)}
        </text>
      </Layer>
    );
  };
};

// Custom link component with gradient coloring and hover tooltip
const CustomLink = ({ 
  sourceX, 
  sourceY, 
  sourceControlX, 
  targetX, 
  targetY, 
  targetControlX, 
  linkWidth = 0,
  payload, 
  index,
  onMouseEnter,
  onMouseLeave,
}: any) => {
  // Guard against invalid values - use typeof checks to allow 0 as valid coordinate
  if (typeof sourceX !== 'number' || typeof targetX !== 'number' || typeof linkWidth !== 'number' || linkWidth <= 0) {
    return null;
  }
  
  const gradientId = `gradient-${index}`;
  const sourceColor = payload?.color || 'hsl(var(--chart-2))';
  const targetColor = payload?.targetColor || sourceColor;
  
  // Calculate the half-width offset for centering the path
  const halfWidth = linkWidth / 2;
  
  const handleMouseEnter = (e: React.MouseEvent) => {
    if (onMouseEnter && payload) {
      onMouseEnter(e, payload);
    }
  };
  
  return (
    <Layer key={`link-${index}`}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={sourceColor} stopOpacity={0.5} />
          <stop offset="100%" stopColor={targetColor} stopOpacity={0.3} />
        </linearGradient>
      </defs>
      <path
        d={`
          M${sourceX},${sourceY - halfWidth}
          C${sourceControlX},${sourceY - halfWidth} ${targetControlX},${targetY - halfWidth} ${targetX},${targetY - halfWidth}
          L${targetX},${targetY + halfWidth}
          C${targetControlX},${targetY + halfWidth} ${sourceControlX},${sourceY + halfWidth} ${sourceX},${sourceY + halfWidth}
          Z
        `}
        fill={`url(#${gradientId})`}
        stroke="none"
        className="transition-opacity hover:opacity-80 cursor-pointer"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    </Layer>
  );
};

// Tooltip data interface
interface TooltipData {
  x: number;
  y: number;
  sourceName: string;
  targetName: string;
  value: number;
  percentage?: number;
}

// Tooltip component rendered outside the chart
const ChartTooltip = ({ data }: { data: TooltipData | null }) => {
  if (!data) return null;
  
  return (
    <div 
      className="absolute pointer-events-none z-50 bg-popover border border-border rounded-lg shadow-lg p-3"
      style={{ 
        left: data.x + 10, 
        top: data.y,
        transform: 'translateY(-50%)'
      }}
    >
      <p className="font-medium text-sm">{data.sourceName} → {data.targetName}</p>
      <p className="text-lg font-bold text-primary">{formatCurrency(data.value)}</p>
      {data.percentage !== undefined && !isNaN(data.percentage) && (
        <p className="text-xs text-muted-foreground">{data.percentage.toFixed(1)}% of income</p>
      )}
    </div>
  );
};

export const CashFlowSankeyChart = ({ selectedPeriod }: CashFlowSankeyChartProps) => {
  const { selectedRestaurant } = useRestaurantContext();
  const navigate = useNavigate();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);

  // Handler for clicking on expense nodes
  const handleExpenseNodeClick = (categoryName: string, categoryIds: string[]) => {
    if (categoryIds.length > 0) {
      navigate('/banking', { 
        state: { 
          categoryId: categoryIds[0],
          categoryName: categoryName,
          tab: 'categorized' 
        } 
      });
    }
  };

  const handleLinkMouseEnter = (e: React.MouseEvent, payload: any) => {
    const rect = (e.currentTarget as SVGElement).closest('.recharts-wrapper')?.getBoundingClientRect();
    if (rect) {
      setTooltipData({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        sourceName: payload.sourceName || 'Source',
        targetName: payload.targetName || 'Target',
        value: payload.value || 0,
        percentage: payload.percentage,
      });
    }
  };

  const handleLinkMouseLeave = () => {
    setTooltipData(null);
  };

  // Get period metrics for income data
  const { data: periodMetrics, isLoading: metricsLoading } = usePeriodMetrics(
    restaurantId,
    selectedPeriod.from,
    selectedPeriod.to
  );

  // Get revenue breakdown for detailed income categories
  const { data: revenueBreakdown, isLoading: revenueLoading } = useRevenueBreakdown(
    restaurantId,
    selectedPeriod.from,
    selectedPeriod.to
  );

  // Get expense categories for outflow data
  const { data: expenseData, isLoading: expenseLoading } = useMonthlyExpenses(
    restaurantId,
    selectedPeriod.from,
    selectedPeriod.to
  );

  const isLoading = metricsLoading || expenseLoading || revenueLoading;

  // Build Sankey data from period metrics and expenses
  const sankeyData = useMemo((): SankeyData | null => {
    if (!periodMetrics) return null;

    const nodes: SankeyNodeData[] = [];
    const links: SankeyLinkData[] = [];

    // Income sources (left side) - from revenue breakdown categories
    const netRevenue = periodMetrics.netRevenue || 0;
    
    // Build revenue categories from the breakdown
    interface RevenueSource {
      name: string;
      amount: number;
      color: string;
    }
    
    const revenueSources: RevenueSource[] = [];
    
    if (revenueBreakdown?.revenue_categories && revenueBreakdown.revenue_categories.length > 0) {
      // Use revenue categories from breakdown
      revenueBreakdown.revenue_categories
        .filter(cat => cat.total_amount > 0)
        .sort((a, b) => b.total_amount - a.total_amount)
        .forEach(cat => {
          // Map account names to friendly display names
          const displayName = cat.account_name;
          const color = INCOME_COLORS[displayName] || INCOME_COLORS['default'];
          revenueSources.push({
            name: displayName,
            amount: cat.total_amount,
            color,
          });
        });
    }
    
    // Add uncategorized revenue if present
    if (revenueBreakdown?.uncategorized_revenue && revenueBreakdown.uncategorized_revenue > 0) {
      revenueSources.push({
        name: 'Uncategorized Revenue',
        amount: revenueBreakdown.uncategorized_revenue,
        color: INCOME_COLORS['Uncategorized Revenue'],
      });
    }
    
    // Fallback if no revenue categories found
    if (revenueSources.length === 0 && netRevenue > 0) {
      revenueSources.push({
        name: 'Sales Revenue',
        amount: netRevenue,
        color: INCOME_COLORS['default'],
      });
    }
    
    // Add revenue source nodes
    revenueSources.forEach(source => {
      nodes.push({ name: source.name, color: source.color });
    });
    
    // Cash Flow node (center)
    const cashFlowIndex = nodes.length;
    const totalIncome = revenueSources.reduce((sum, s) => sum + s.amount, 0);
    nodes.push({ name: 'Cash Flow', color: 'hsl(var(--primary))' });

    // Expense categories (right side) from monthly expenses data
    let expenseCategories: MonthlyExpenseCategory[] = [];
    
    if (expenseData && expenseData.length > 0) {
      // Combine all months' expenses
      const categoryTotals = new Map<string, { amount: number; count: number; categoryIds: Set<string> }>();
      
      expenseData.forEach(month => {
        month.categories.forEach(cat => {
          const existing = categoryTotals.get(cat.category) || { amount: 0, count: 0, categoryIds: new Set<string>() };
          cat.categoryIds?.forEach(id => existing.categoryIds.add(id));
          categoryTotals.set(cat.category, {
            amount: existing.amount + cat.amount,
            count: existing.count + cat.transactionCount,
            categoryIds: existing.categoryIds,
          });
        });
      });

      expenseCategories = Array.from(categoryTotals.entries())
        .map(([category, data]) => ({
          category,
          amount: data.amount,
          transactionCount: data.count,
          categoryIds: Array.from(data.categoryIds),
        }))
        .filter(cat => cat.amount > 0)
        .sort((a, b) => b.amount - a.amount);
    }

    // If no expense data from bank transactions, use cost data from period metrics
    if (expenseCategories.length === 0 && (periodMetrics.foodCost > 0 || periodMetrics.laborCost > 0)) {
      if (periodMetrics.foodCost > 0) {
        expenseCategories.push({
          category: 'Inventory/Food Purchases',
          amount: periodMetrics.foodCost,
          transactionCount: 0,
          categoryIds: [],
        });
      }
      if (periodMetrics.laborCost > 0) {
        expenseCategories.push({
          category: 'Labor/Payroll',
          amount: periodMetrics.laborCost,
          transactionCount: 0,
          categoryIds: [],
        });
      }
    }

    const totalExpenses = expenseCategories.reduce((sum, cat) => sum + cat.amount, 0);

    // Add expense nodes
    const expenseStartIndex = nodes.length;
    expenseCategories.forEach(cat => {
      nodes.push({ 
        name: cat.category, 
        color: getExpenseColor(cat.category),
        categoryIds: cat.categoryIds, // Pass categoryIds for click-through navigation
      });
    });

    // Create links from each income source to cash flow
    revenueSources.forEach((source, index) => {
      const percentage = totalIncome > 0 ? (source.amount / totalIncome) * 100 : 0;
      links.push({
        source: index,
        target: cashFlowIndex,
        value: source.amount,
        color: source.color,
        sourceName: source.name,
        targetName: 'Cash Flow',
        percentage,
      });
    });

    // Create links from cash flow to expenses
    expenseCategories.forEach((cat, index) => {
      const percentage = totalIncome > 0 ? (cat.amount / totalIncome) * 100 : 0;
      links.push({
        source: cashFlowIndex,
        target: expenseStartIndex + index,
        value: cat.amount,
        color: getExpenseColor(cat.category),
        sourceName: 'Cash Flow',
        targetName: cat.category,
        percentage,
      });
    });

    // Only return data if we have meaningful flows
    if (links.length === 0) return null;

    return { nodes, links };
  }, [periodMetrics, expenseData, revenueBreakdown]);

  // Calculate summary metrics
  const totalIncome = periodMetrics?.netRevenue || 0;
  const totalExpenses = useMemo(() => {
    if (!expenseData || expenseData.length === 0) {
      return (periodMetrics?.foodCost || 0) + (periodMetrics?.laborCost || 0);
    }
    return expenseData.reduce((sum, month) => sum + month.totalExpenses, 0);
  }, [expenseData, periodMetrics]);
  
  const netCashFlow = totalIncome - totalExpenses;

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-teal-50/50 via-background to-teal-50/30 dark:from-teal-950/20 dark:via-background dark:to-teal-950/10 border-teal-200 dark:border-teal-900">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center">
              <ArrowRightLeft className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <CardTitle>Cashflow Visualization</CardTitle>
              <CardDescription>{selectedPeriod.label}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!sankeyData || sankeyData.links.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-teal-50/50 via-background to-teal-50/30 dark:from-teal-950/20 dark:via-background dark:to-teal-950/10 border-teal-200 dark:border-teal-900">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center">
              <ArrowRightLeft className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <CardTitle>Cashflow Visualization</CardTitle>
              <CardDescription>{selectedPeriod.label}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              No cashflow data available for this period.
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Connect your bank account and categorize transactions to see the flow of money.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-teal-50/50 via-background to-teal-50/30 dark:from-teal-950/20 dark:via-background dark:to-teal-950/10 border-teal-200 dark:border-teal-900">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center">
              <ArrowRightLeft className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <CardTitle>Cashflow Visualization</CardTitle>
              <CardDescription>Money in → Cash Flow → Money out • {selectedPeriod.label}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right">
              <p className="text-muted-foreground text-xs">Income</p>
              <p className="font-semibold text-emerald-600">{formatCurrency(totalIncome)}</p>
            </div>
            <div className="text-right">
              <p className="text-muted-foreground text-xs">Expenses</p>
              <p className="font-semibold text-rose-600">{formatCurrency(totalExpenses)}</p>
            </div>
            <div className="text-right border-l pl-4">
              <p className="text-muted-foreground text-xs">Net</p>
              <p className={`font-bold ${netCashFlow >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatCurrency(netCashFlow)}
              </p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[350px] relative">
          <ChartTooltip data={tooltipData} />
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={sankeyData}
              nodeWidth={10}
              nodePadding={24}
              margin={{ top: 20, right: 160, bottom: 20, left: 160 }}
              link={<CustomLink onMouseEnter={handleLinkMouseEnter} onMouseLeave={handleLinkMouseLeave} />}
              node={createCustomNode(handleExpenseNodeClick)}
            >
            </Sankey>
          </ResponsiveContainer>
        </div>
        
        {/* Legend */}
        <div className="mt-4 pt-4 border-t flex flex-wrap gap-4 justify-center">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: INCOME_COLORS['Sales - Food'] }} />
            <span className="text-xs text-muted-foreground">Food Sales</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: INCOME_COLORS['Sales - Beverages'] }} />
            <span className="text-xs text-muted-foreground">Beverage Sales</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span className="text-xs text-muted-foreground">Cash Flow</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(220, 65%, 55%)' }} />
            <span className="text-xs text-muted-foreground">Labor</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(25, 65%, 55%)' }} />
            <span className="text-xs text-muted-foreground">Food Cost</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(0, 0%, 55%)' }} />
            <span className="text-xs text-muted-foreground">Other</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

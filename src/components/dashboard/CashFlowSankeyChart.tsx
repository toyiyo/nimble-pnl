import { useMemo } from 'react';
import { Sankey, Tooltip, ResponsiveContainer, Layer, Rectangle } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useMonthlyExpenses, MonthlyExpenseCategory } from '@/hooks/useMonthlyExpenses';
import { usePeriodMetrics } from '@/hooks/usePeriodMetrics';
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

// Color palette for income sources (green-based)
const INCOME_COLORS = [
  'hsl(var(--chart-2))', // primary green
  'hsl(142, 71%, 45%)',
  'hsl(152, 60%, 50%)',
  'hsl(162, 55%, 45%)',
];

// Color palette for expense categories (varied)
const EXPENSE_COLORS: Record<string, string> = {
  'Labor/Payroll': 'hsl(220, 70%, 60%)',       // Blue
  'Inventory/Food Purchases': 'hsl(25, 95%, 53%)', // Orange
  'Rent & CAM': 'hsl(280, 65%, 60%)',          // Purple
  'Utilities': 'hsl(200, 70%, 50%)',           // Cyan
  'Supplies & Packaging': 'hsl(45, 85%, 55%)', // Yellow
  'Marketing/Ads': 'hsl(330, 70%, 55%)',       // Pink
  'Equipment & Maintenance': 'hsl(180, 50%, 45%)', // Teal
  'Processing/Bank Fees': 'hsl(0, 0%, 50%)',   // Gray
  'Loan/Lease Payments': 'hsl(260, 50%, 50%)', // Violet
  'Taxes & Licenses': 'hsl(350, 70%, 55%)',    // Red
  'Waste/Adjustments': 'hsl(30, 70%, 45%)',    // Brown
  'Other/Uncategorized': 'hsl(0, 0%, 60%)',    // Light Gray
};

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

// Custom node component for the Sankey chart
const CustomNode = (props: any) => {
  const { x, y, width, height, index, payload } = props;
  const isMiddle = payload.name === 'Cash Flow';
  
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
      />
      <text
        x={isMiddle ? x + width / 2 : x < 100 ? x - 6 : x + width + 6}
        y={y + height / 2}
        textAnchor={isMiddle ? 'middle' : x < 100 ? 'end' : 'start'}
        dominantBaseline="middle"
        className="fill-foreground text-xs font-medium"
      >
        {payload.name}
      </text>
      <text
        x={isMiddle ? x + width / 2 : x < 100 ? x - 6 : x + width + 6}
        y={y + height / 2 + 14}
        textAnchor={isMiddle ? 'middle' : x < 100 ? 'end' : 'start'}
        dominantBaseline="middle"
        className="fill-muted-foreground text-[10px]"
      >
        {formatCurrency(payload.value || 0)}
      </text>
    </Layer>
  );
};

// Custom link component with gradient coloring
const CustomLink = (props: any) => {
  const { sourceX, sourceY, sourceControlX, targetX, targetY, targetControlX, linkWidth, payload, index } = props;
  
  const gradientId = `gradient-${index}`;
  const sourceColor = payload.color || 'hsl(var(--chart-2))';
  const targetColor = payload.targetColor || sourceColor;
  
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
          M${sourceX},${sourceY}
          C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}
          L${targetX},${targetY + linkWidth}
          C${targetControlX},${targetY + linkWidth} ${sourceControlX},${sourceY + linkWidth} ${sourceX},${sourceY + linkWidth}
          Z
        `}
        fill={`url(#${gradientId})`}
        stroke="none"
        className="transition-opacity hover:opacity-80"
      />
    </Layer>
  );
};

// Custom tooltip
const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload || payload.length === 0) return null;
  
  const data = payload[0]?.payload;
  if (!data) return null;
  
  // Check if it's a link (has source and target as numbers)
  const isLink = typeof data.source === 'number' && typeof data.target === 'number';
  const value = data.value;
  
  // Guard against NaN or undefined values
  if (value === undefined || value === null || isNaN(value)) return null;
  
  if (isLink) {
    const sourceName = data.sourceName || 'Source';
    const targetName = data.targetName || 'Target';
    const percentage = data.percentage;
    
    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3">
        <p className="font-medium text-sm">{sourceName} → {targetName}</p>
        <p className="text-lg font-bold text-primary">{formatCurrency(value)}</p>
        {percentage !== undefined && !isNaN(percentage) && (
          <p className="text-xs text-muted-foreground">{percentage.toFixed(1)}% of income</p>
        )}
      </div>
    );
  }
  
  // It's a node
  const name = data.name || 'Unknown';
  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg p-3">
      <p className="font-medium text-sm">{name}</p>
      <p className="text-lg font-bold text-primary">{formatCurrency(value)}</p>
    </div>
  );
};

export const CashFlowSankeyChart = ({ selectedPeriod }: CashFlowSankeyChartProps) => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  // Get period metrics for income data
  const { data: periodMetrics, isLoading: metricsLoading } = usePeriodMetrics(
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

  const isLoading = metricsLoading || expenseLoading;

  // Build Sankey data from period metrics and expenses
  const sankeyData = useMemo((): SankeyData | null => {
    if (!periodMetrics) return null;

    const nodes: SankeyNodeData[] = [];
    const links: SankeyLinkData[] = [];

    // Income sources (left side)
    // For restaurant income, we have net revenue as the main source
    const netRevenue = periodMetrics.netRevenue || 0;
    
    // We'll show different income sources based on what we have
    // For now, categorize as "Sales Revenue" as primary income
    if (netRevenue > 0) {
      nodes.push({ name: 'Sales Revenue', color: INCOME_COLORS[0] });
    }

    // Add other potential income (could be from bank transactions showing deposits)
    // For simplicity, we'll use net revenue as the main income source
    
    // Cash Flow node (center)
    const cashFlowIndex = nodes.length;
    const totalIncome = netRevenue;
    nodes.push({ name: 'Cash Flow', color: 'hsl(var(--primary))' });

    // Expense categories (right side) from monthly expenses data
    let expenseCategories: MonthlyExpenseCategory[] = [];
    
    if (expenseData && expenseData.length > 0) {
      // Combine all months' expenses
      const categoryTotals = new Map<string, { amount: number; count: number }>();
      
      expenseData.forEach(month => {
        month.categories.forEach(cat => {
          const existing = categoryTotals.get(cat.category) || { amount: 0, count: 0 };
          categoryTotals.set(cat.category, {
            amount: existing.amount + cat.amount,
            count: existing.count + cat.transactionCount,
          });
        });
      });

      expenseCategories = Array.from(categoryTotals.entries())
        .map(([category, data]) => ({
          category,
          amount: data.amount,
          transactionCount: data.count,
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
        });
      }
      if (periodMetrics.laborCost > 0) {
        expenseCategories.push({
          category: 'Labor/Payroll',
          amount: periodMetrics.laborCost,
          transactionCount: 0,
        });
      }
    }

    const totalExpenses = expenseCategories.reduce((sum, cat) => sum + cat.amount, 0);

    // Add expense nodes
    const expenseStartIndex = nodes.length;
    expenseCategories.forEach(cat => {
      nodes.push({ 
        name: cat.category, 
        color: EXPENSE_COLORS[cat.category] || 'hsl(0, 0%, 60%)',
      });
    });

    // Create links from income to cash flow
    if (netRevenue > 0) {
      links.push({
        source: 0, // Sales Revenue
        target: cashFlowIndex,
        value: netRevenue,
        color: INCOME_COLORS[0],
        sourceName: 'Sales Revenue',
        targetName: 'Cash Flow',
        percentage: 100,
      });
    }

    // Create links from cash flow to expenses
    expenseCategories.forEach((cat, index) => {
      const percentage = totalIncome > 0 ? (cat.amount / totalIncome) * 100 : 0;
      links.push({
        source: cashFlowIndex,
        target: expenseStartIndex + index,
        value: cat.amount,
        color: EXPENSE_COLORS[cat.category] || 'hsl(0, 0%, 60%)',
        sourceName: 'Cash Flow',
        targetName: cat.category,
        percentage,
      });
    });

    // Only return data if we have meaningful flows
    if (links.length === 0) return null;

    return { nodes, links };
  }, [periodMetrics, expenseData]);

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
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={sankeyData}
              nodeWidth={10}
              nodePadding={24}
              margin={{ top: 20, right: 160, bottom: 20, left: 160 }}
              link={<CustomLink />}
              node={<CustomNode />}
            >
              <Tooltip content={<CustomTooltip />} />
            </Sankey>
          </ResponsiveContainer>
        </div>
        
        {/* Legend */}
        <div className="mt-4 pt-4 border-t flex flex-wrap gap-4 justify-center">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: INCOME_COLORS[0] }} />
            <span className="text-xs text-muted-foreground">Income</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span className="text-xs text-muted-foreground">Cash Flow</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: EXPENSE_COLORS['Labor/Payroll'] }} />
            <span className="text-xs text-muted-foreground">Labor</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: EXPENSE_COLORS['Inventory/Food Purchases'] }} />
            <span className="text-xs text-muted-foreground">Food Cost</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: EXPENSE_COLORS['Other/Uncategorized'] }} />
            <span className="text-xs text-muted-foreground">Other Expenses</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

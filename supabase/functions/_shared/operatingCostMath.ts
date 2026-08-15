// supabase/functions/_shared/operatingCostMath.ts
// Spec §13.2. monthly_value is cents and is 0 for percentage rows;
// percentage rows carry percentage_value instead.
// percentage_value is a fraction of net sales (0.27 = 27%).

export interface CostRow { cost_type: string; entry_type: string; monthly_value: number; percentage_value: number | null; }
export interface OperatingCostTotals {
  fixedTotal: number; semiVariableTotal: number;
  variableFlatTotal: number; variablePercentTotal: number; variableTotal: number;
  totalMonthlyCosts: number; variableCostPercentage: number;
  contributionMargin: number; breakEvenRevenue: number;
}

export function computeOperatingCostTotals(rows: CostRow[], netSales: number): OperatingCostTotals {
  const by = (t: string) => rows.filter((r) => r.cost_type === t);
  const flat = (rs: CostRow[]) => rs.filter((r) => r.entry_type !== 'percentage')
    .reduce((s, r) => s + (r.monthly_value ?? 0) / 100, 0);
  const pct = (rs: CostRow[]) => rs.filter((r) => r.entry_type === 'percentage')
    .reduce((s, r) => s + (r.percentage_value ?? 0), 0);

  const fixedTotal = flat(by('fixed'));
  const semiVariableTotal = flat(by('semi_variable'));
  const variableRows = by('variable');
  const variableFlatTotal = flat(variableRows);
  const variablePctSum = pct(variableRows);
  const variablePercentTotal = variablePctSum * netSales;
  const variableTotal = variableFlatTotal + variablePercentTotal;

  let variableCostPercentage: number;
  if (variableRows.length === 0) {
    variableCostPercentage = 25; // keep the historical fallback estimate
  } else {
    variableCostPercentage = variablePctSum * 100 + (netSales > 0 ? (variableFlatTotal / netSales) * 100 : 0);
  }
  const contributionMargin = 100 - variableCostPercentage;
  const totalFixedCosts = fixedTotal + semiVariableTotal;
  const breakEvenRevenue = contributionMargin > 0 ? totalFixedCosts / (contributionMargin / 100) : 0;

  return {
    fixedTotal, semiVariableTotal, variableFlatTotal, variablePercentTotal, variableTotal,
    totalMonthlyCosts: fixedTotal + semiVariableTotal + variableTotal,
    variableCostPercentage, contributionMargin, breakEvenRevenue,
  };
}

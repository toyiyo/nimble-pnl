// Gusto Prepare Payroll Edge Function
// Prepares payroll with comprehensive compensation data from EasyShiftHQ:
// - Hours from time tracking (synced separately via time_sheets)
// - Tips from tip distribution calculations
// - Daily rates for employees with fixed daily pay
// - Contractor payments

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createGustoClient, getGustoConfig, GustoApiError } from '../_shared/gustoClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PreparePayrollRequest {
  restaurantId: string;
  payrollUuid?: string; // Optional - if not provided, uses next unprocessed payroll
  includeTips?: boolean; // Default true - include tip distributions
  includeDailyRates?: boolean; // Default true - include daily rate earnings
  dryRun?: boolean; // Default false - if true, returns what would be synced without updating
}

interface EmployeeCompensationData {
  employeeUuid: string;
  employeeName: string;
  jobUuid: string;
  tips: {
    paycheckTips: number; // Tips to be paid (not yet received)
    cashTips: number; // Tips already received (for tax calculation only)
  };
  dailyRate: {
    daysWorked: number;
    dailyRateAmount: number;
    totalDailyPay: number;
  } | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      throw new Error('Invalid authentication');
    }

    const body: PreparePayrollRequest = await req.json();
    const {
      restaurantId,
      payrollUuid,
      includeTips = true,
      includeDailyRates = true,
      dryRun = false,
    } = body;

    if (!restaurantId) {
      throw new Error('Restaurant ID is required');
    }

    // Verify user has access to restaurant (owner or manager)
    const { data: userRestaurant, error: accessError } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .in('role', ['owner', 'manager'])
      .single();

    if (accessError || !userRestaurant) {
      throw new Error('Access denied to restaurant');
    }

    // Get Gusto connection
    const { data: connection, error: connectionError } = await supabase
      .from('gusto_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connectionError || !connection) {
      throw new Error('Restaurant is not connected to Gusto');
    }

    const origin = req.headers.get('origin') || req.headers.get('referer')?.split('/').slice(0, 3).join('/');
    const gustoConfig = getGustoConfig(origin || undefined);
    const gustoClient = await createGustoClient(connection.access_token, gustoConfig.baseUrl);

    // Get the target payroll
    let targetPayrollUuid = payrollUuid;

    if (!targetPayrollUuid) {
      // Get the next unprocessed payroll
      const unprocessedPayrolls = await gustoClient.getUnprocessedPayrolls(connection.company_uuid);

      if (unprocessedPayrolls.length === 0) {
        throw new Error('No unprocessed payrolls found. Create a payroll in Gusto first.');
      }

      // Use the next upcoming payroll (sorted by check_date)
      const sorted = unprocessedPayrolls.sort((a, b) =>
        new Date(a.check_date).getTime() - new Date(b.check_date).getTime()
      );
      targetPayrollUuid = sorted[0].uuid;
    }

    console.log(`[GUSTO-PAYROLL] Preparing payroll ${targetPayrollUuid}`);

    // Prepare the payroll (get current state and version)
    const preparedPayroll = await gustoClient.preparePayroll(
      connection.company_uuid,
      targetPayrollUuid
    );

    const payPeriodStart = preparedPayroll.pay_period.start_date;
    const payPeriodEnd = preparedPayroll.pay_period.end_date;

    console.log(`[GUSTO-PAYROLL] Pay period: ${payPeriodStart} to ${payPeriodEnd}`);

    // Get Gusto employees with job info
    const gustoEmployees = await gustoClient.getEmployees(connection.company_uuid);
    const employeeMap = new Map<string, { name: string; jobUuid: string }>();

    for (const ge of gustoEmployees) {
      const primaryJob = ge.jobs?.find(j => j.primary) || ge.jobs?.[0];
      if (primaryJob) {
        employeeMap.set(ge.uuid, {
          name: `${ge.first_name} ${ge.last_name}`,
          jobUuid: primaryJob.uuid,
        });
      }
    }

    // Get local employees with Gusto UUIDs
    const { data: localEmployees } = await supabase
      .from('employees')
      .select('id, name, gusto_employee_uuid, daily_rate_amount, compensation_type')
      .eq('restaurant_id', restaurantId)
      .not('gusto_employee_uuid', 'is', null);

    const localEmployeeMap = new Map<string, {
      id: string;
      name: string;
      dailyRateAmount: number | null;
      compensationType: string;
    }>();

    for (const emp of localEmployees || []) {
      if (emp.gusto_employee_uuid) {
        localEmployeeMap.set(emp.gusto_employee_uuid, {
          id: emp.id,
          name: emp.name,
          dailyRateAmount: emp.daily_rate_amount,
          compensationType: emp.compensation_type,
        });
      }
    }

    // Collect compensation data for each employee
    const compensationData: EmployeeCompensationData[] = [];

    // Get tips for the pay period
    let tipsByEmployee = new Map<string, { paycheckTips: number; cashTips: number }>();

    if (includeTips) {
      // Query tip_splits for the pay period
      const { data: tipSplits } = await supabase
        .from('tip_splits')
        .select(`
          employee_id,
          amount,
          payment_method,
          employees!inner (gusto_employee_uuid)
        `)
        .eq('restaurant_id', restaurantId)
        .gte('work_date', payPeriodStart)
        .lte('work_date', payPeriodEnd)
        .not('employees.gusto_employee_uuid', 'is', null);

      for (const split of tipSplits || []) {
        const gustoUuid = (split.employees as { gusto_employee_uuid: string }).gusto_employee_uuid;
        if (!gustoUuid) continue;

        if (!tipsByEmployee.has(gustoUuid)) {
          tipsByEmployee.set(gustoUuid, { paycheckTips: 0, cashTips: 0 });
        }

        const tips = tipsByEmployee.get(gustoUuid)!;
        const amount = Number(split.amount) || 0;

        // Determine if cash tips (already paid) or paycheck tips (to be paid)
        if (split.payment_method === 'cash') {
          tips.cashTips += amount;
        } else {
          tips.paycheckTips += amount;
        }
      }

      console.log(`[GUSTO-PAYROLL] Found tips for ${tipsByEmployee.size} employees`);
    }

    // Get daily rate earnings for the pay period
    let dailyRatesByEmployee = new Map<string, { daysWorked: number; dailyRate: number }>();

    if (includeDailyRates) {
      // Count distinct work days from shifts table for employees with daily rates
      const { data: shifts } = await supabase
        .from('shifts')
        .select(`
          employee_id,
          date,
          employees!inner (gusto_employee_uuid, daily_rate_amount, compensation_type)
        `)
        .eq('restaurant_id', restaurantId)
        .gte('date', payPeriodStart)
        .lte('date', payPeriodEnd)
        .not('employees.gusto_employee_uuid', 'is', null)
        .eq('employees.compensation_type', 'daily_rate');

      // Group shifts by employee and count unique dates
      const shiftsByEmployee = new Map<string, Set<string>>();

      for (const shift of shifts || []) {
        const emp = shift.employees as { gusto_employee_uuid: string; daily_rate_amount: number };
        const gustoUuid = emp.gusto_employee_uuid;
        if (!gustoUuid) continue;

        if (!shiftsByEmployee.has(gustoUuid)) {
          shiftsByEmployee.set(gustoUuid, new Set());
        }
        shiftsByEmployee.get(gustoUuid)!.add(shift.date);
      }

      // Calculate daily rate totals
      for (const [gustoUuid, dates] of shiftsByEmployee) {
        const localEmp = localEmployeeMap.get(gustoUuid);
        if (localEmp?.dailyRateAmount && localEmp.dailyRateAmount > 0) {
          dailyRatesByEmployee.set(gustoUuid, {
            daysWorked: dates.size,
            dailyRate: localEmp.dailyRateAmount,
          });
        }
      }

      console.log(`[GUSTO-PAYROLL] Found daily rate data for ${dailyRatesByEmployee.size} employees`);
    }

    // Build compensation data for each employee in the payroll
    for (const empComp of preparedPayroll.employee_compensations) {
      const gustoInfo = employeeMap.get(empComp.employee_uuid);
      const tips = tipsByEmployee.get(empComp.employee_uuid) || { paycheckTips: 0, cashTips: 0 };
      const dailyRate = dailyRatesByEmployee.get(empComp.employee_uuid);

      // Only include if there's data to add
      if (tips.paycheckTips > 0 || tips.cashTips > 0 || dailyRate) {
        compensationData.push({
          employeeUuid: empComp.employee_uuid,
          employeeName: gustoInfo?.name || 'Unknown',
          jobUuid: gustoInfo?.jobUuid || empComp.fixed_compensations[0]?.job_uuid || '',
          tips,
          dailyRate: dailyRate ? {
            daysWorked: dailyRate.daysWorked,
            dailyRateAmount: dailyRate.dailyRate,
            totalDailyPay: dailyRate.daysWorked * dailyRate.dailyRate,
          } : null,
        });
      }
    }

    // If dry run, return what would be synced
    if (dryRun) {
      return new Response(JSON.stringify({
        success: true,
        dryRun: true,
        payrollUuid: targetPayrollUuid,
        payPeriod: {
          start: payPeriodStart,
          end: payPeriodEnd,
        },
        checkDate: preparedPayroll.check_date,
        compensationData,
        summary: {
          employeesWithData: compensationData.length,
          totalPaycheckTips: compensationData.reduce((sum, c) => sum + c.tips.paycheckTips, 0),
          totalCashTips: compensationData.reduce((sum, c) => sum + c.tips.cashTips, 0),
          totalDailyRatePay: compensationData.reduce((sum, c) => sum + (c.dailyRate?.totalDailyPay || 0), 0),
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build the payroll update
    const employeeCompensationUpdates = compensationData.map(comp => {
      const fixedCompensations: Array<{ name: string; amount: string; job_uuid: string }> = [];

      // Add paycheck tips (to be paid)
      if (comp.tips.paycheckTips > 0) {
        fixedCompensations.push({
          name: 'Paycheck Tips',
          amount: comp.tips.paycheckTips.toFixed(2),
          job_uuid: comp.jobUuid,
        });
      }

      // Add cash tips (for tax purposes)
      if (comp.tips.cashTips > 0) {
        fixedCompensations.push({
          name: 'Cash Tips',
          amount: comp.tips.cashTips.toFixed(2),
          job_uuid: comp.jobUuid,
        });
      }

      // Add daily rate pay
      if (comp.dailyRate && comp.dailyRate.totalDailyPay > 0) {
        fixedCompensations.push({
          name: 'Daily Rate',
          amount: comp.dailyRate.totalDailyPay.toFixed(2),
          job_uuid: comp.jobUuid,
        });
      }

      return {
        employee_uuid: comp.employeeUuid,
        fixed_compensations: fixedCompensations,
      };
    }).filter(u => u.fixed_compensations.length > 0);

    if (employeeCompensationUpdates.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No compensation data to sync for this pay period',
        payrollUuid: targetPayrollUuid,
        payPeriod: {
          start: payPeriodStart,
          end: payPeriodEnd,
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update the payroll with compensations
    console.log(`[GUSTO-PAYROLL] Updating payroll with ${employeeCompensationUpdates.length} employee compensations`);

    try {
      const updatedPayroll = await gustoClient.updatePayroll(
        connection.company_uuid,
        targetPayrollUuid,
        {
          version: preparedPayroll.version,
          employee_compensations: employeeCompensationUpdates,
        }
      );

      // Calculate the payroll to update totals
      const calculatedPayroll = await gustoClient.calculatePayroll(
        connection.company_uuid,
        targetPayrollUuid
      );

      console.log(`[GUSTO-PAYROLL] Payroll updated successfully`);

      return new Response(JSON.stringify({
        success: true,
        message: `Updated payroll with compensations for ${employeeCompensationUpdates.length} employees`,
        payrollUuid: targetPayrollUuid,
        payPeriod: {
          start: payPeriodStart,
          end: payPeriodEnd,
        },
        checkDate: preparedPayroll.check_date,
        summary: {
          employeesUpdated: employeeCompensationUpdates.length,
          totalPaycheckTips: compensationData.reduce((sum, c) => sum + c.tips.paycheckTips, 0),
          totalCashTips: compensationData.reduce((sum, c) => sum + c.tips.cashTips, 0),
          totalDailyRatePay: compensationData.reduce((sum, c) => sum + (c.dailyRate?.totalDailyPay || 0), 0),
        },
        totals: calculatedPayroll.totals,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error) {
      if (error instanceof GustoApiError && error.status === 409) {
        throw new Error('Payroll was modified by another user. Please try again.');
      }
      throw error;
    }

  } catch (error: unknown) {
    console.error('[GUSTO-PAYROLL] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    return new Response(JSON.stringify({
      error: errorMessage,
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

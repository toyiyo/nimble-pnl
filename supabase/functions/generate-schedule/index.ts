import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callModel, type ModelConfig } from "../_shared/ai-caller.ts";
import {
  buildSchedulePrompt,
  type ScheduleContext,
  type ScheduleEmployee,
  type ScheduleTemplate,
  type AvailabilityDay,
  type PriorPattern,
  type HourlySales,
  type LockedShift,
} from "../_shared/schedule-prompt-builder.ts";
import {
  validateGeneratedShifts,
  type GeneratedShift,
  type ValidationContext,
  type AvailabilitySlot,
} from "../_shared/schedule-validator.ts";

// Custom model chain for schedule generation (higher-capability models first)
const SCHEDULE_MODELS: ModelConfig[] = [
  { name: "Gemini 2.5 Flash", id: "google/gemini-2.5-flash", maxRetries: 2 },
  { name: "Gemini 2.5 Flash Lite", id: "google/gemini-2.5-flash-lite", maxRetries: 2 },
  { name: "Llama 4 Maverick", id: "meta-llama/llama-4-maverick", maxRetries: 2 },
  { name: "Gemma 3 27B", id: "google/gemma-3-27b-it", maxRetries: 2 },
  { name: "Claude Sonnet 4.5", id: "anthropic/claude-sonnet-4-5", maxRetries: 1 },
];

interface RequestPayload {
  restaurant_id: string;
  week_start: string;         // YYYY-MM-DD
  locked_shift_ids: string[];
  excluded_employee_ids: string[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse request ────────────────────────────────────────────────────────
    const payload: RequestPayload = await req.json();
    const { restaurant_id, week_start, locked_shift_ids = [], excluded_employee_ids = [] } = payload;

    if (!restaurant_id || !week_start) {
      return new Response(JSON.stringify({ error: "restaurant_id and week_start are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Permission check: owner or manager ───────────────────────────────────
    const { data: userRestaurant, error: permError } = await supabase
      .from("user_restaurants")
      .select("role")
      .eq("user_id", user.id)
      .eq("restaurant_id", restaurant_id)
      .single();

    if (permError || !userRestaurant || !["owner", "manager"].includes(userRestaurant.role)) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Calculate date range for prior shifts / sales ────────────────────────
    const weekStartDate = new Date(week_start);
    const fourWeeksAgo = new Date(weekStartDate);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekEndDate.getDate() + 7);

    const fourWeeksAgoStr = fourWeeksAgo.toISOString().split("T")[0];
    const weekEndStr = weekEndDate.toISOString().split("T")[0];

    // ── Fetch all scheduling data in parallel (9 queries) ──────────────────
    const [
      employeesResult,
      templatesResult,
      recurringAvailResult,
      availExceptionsResult,
      staffingSettingsResult,
      priorShiftsResult,
      salesResult,
      operatingCostsResult,
      existingShiftsResult,
    ] = await Promise.all([
      // 1. Active employees
      supabase
        .from("employees")
        .select("id, name, position, hourly_rate, salary_amount, compensation_type")
        .eq("restaurant_id", restaurant_id)
        .eq("status", "active"),

      // 2. Active shift templates
      supabase
        .from("shift_templates")
        .select("id, name, days, start_time, end_time, position")
        .eq("restaurant_id", restaurant_id)
        .eq("is_active", true),

      // 3. Recurring availability
      supabase
        .from("employee_availability")
        .select("employee_id, day_of_week, is_available, start_time, end_time")
        .eq("restaurant_id", restaurant_id),

      // 4. Availability exceptions for the target week
      supabase
        .from("availability_exceptions")
        .select("employee_id, date, is_available, start_time, end_time")
        .eq("restaurant_id", restaurant_id)
        .gte("date", week_start)
        .lt("date", weekEndStr),

      // 5. Staffing settings
      supabase
        .from("staffing_settings")
        .select("*")
        .eq("restaurant_id", restaurant_id)
        .maybeSingle(),

      // 6. Prior 4 weeks of shifts (not cancelled)
      supabase
        .from("shifts")
        .select("employee_id, start_time, end_time, position")
        .eq("restaurant_id", restaurant_id)
        .neq("status", "cancelled")
        .gte("start_time", `${fourWeeksAgoStr}T00:00:00`)
        .lt("start_time", `${week_start}T00:00:00`),

      // 7. Sales data: 4-week lookback
      supabase
        .from("unified_sales")
        .select("sale_date, sale_time, total_price")
        .eq("restaurant_id", restaurant_id)
        .eq("item_type", "sale")
        .gte("sale_date", fourWeeksAgoStr)
        .lt("sale_date", week_start),

      // 8. Operating costs (labor category)
      supabase
        .from("restaurant_operating_costs")
        .select("entry_type, monthly_value")
        .eq("restaurant_id", restaurant_id)
        .eq("category", "labor")
        .maybeSingle(),

      // 9. Existing shifts this week (for locked shift identification)
      supabase
        .from("shifts")
        .select("id, employee_id, start_time, end_time, position, locked, employees(name)")
        .eq("restaurant_id", restaurant_id)
        .gte("start_time", `${week_start}T00:00:00`)
        .lt("start_time", `${weekEndStr}T00:00:00`)
        .neq("status", "cancelled"),
    ]);

    // ── Validate fetched data ────────────────────────────────────────────────
    if (employeesResult.error) throw new Error(`Failed to fetch employees: ${employeesResult.error.message}`);
    if (templatesResult.error) throw new Error(`Failed to fetch templates: ${templatesResult.error.message}`);

    const rawEmployees = employeesResult.data ?? [];
    const rawTemplates = templatesResult.data ?? [];

    // Early returns for missing critical data
    if (rawTemplates.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active shift templates found. Please create shift templates before generating a schedule." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const activeEmployees = rawEmployees.filter(
      (e) => !excluded_employee_ids.includes(e.id)
    );

    if (activeEmployees.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active employees found after exclusions. Please add employees before generating a schedule." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Build ScheduleEmployee[] ─────────────────────────────────────────────
    const employees: ScheduleEmployee[] = activeEmployees.map((e) => ({
      id: e.id,
      name: e.name,
      position: e.position ?? "Staff",
      // hourly_rate stored in cents; salary employees get 0
      hourly_rate: e.compensation_type === "salary" ? 0 : (e.hourly_rate ?? 0),
    }));

    // ── Build ScheduleTemplate[] ─────────────────────────────────────────────
    const templates: ScheduleTemplate[] = rawTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      days: t.days ?? [],
      start_time: t.start_time,
      end_time: t.end_time,
      position: t.position ?? "Staff",
    }));

    // ── Build availability map ───────────────────────────────────────────────
    // Start with recurring availability
    const availability: Record<string, Record<number, AvailabilityDay>> = {};

    for (const row of (recurringAvailResult.data ?? [])) {
      if (!availability[row.employee_id]) availability[row.employee_id] = {};
      availability[row.employee_id][row.day_of_week] = {
        available: row.is_available,
        start: row.start_time ?? undefined,
        end: row.end_time ?? undefined,
      };
    }

    // Override with availability exceptions for this week
    for (const exc of (availExceptionsResult.data ?? [])) {
      const [ey, em, ed] = exc.date.split('-').map(Number);
      const dayOfWeek = new Date(ey, em - 1, ed).getDay();
      if (!availability[exc.employee_id]) availability[exc.employee_id] = {};
      availability[exc.employee_id][dayOfWeek] = {
        available: exc.is_available,
        start: exc.start_time ?? undefined,
        end: exc.end_time ?? undefined,
      };
    }

    // Employees with no availability records are assumed available all days
    for (const emp of employees) {
      if (!availability[emp.id]) {
        availability[emp.id] = {};
        for (let d = 0; d < 7; d++) {
          availability[emp.id][d] = { available: true };
        }
      }
    }

    // ── Build prior schedule patterns ────────────────────────────────────────
    // Group prior shifts by day_of_week + position, count per week, then average
    const priorShifts = priorShiftsResult.data ?? [];
    const patternMap: Record<string, { totalCount: number }> = {};
    const weekTracker: Record<string, Set<string>> = {};

    for (const shift of priorShifts) {
      if (!shift.start_time) continue;
      const shiftDate = new Date(shift.start_time);
      const dayOfWeek = shiftDate.getDay();
      const position = shift.position ?? "Staff";
      const key = `${dayOfWeek}:${position}`;
      // Track which weeks contributed to each pattern key
      const weekKey = new Date(shiftDate);
      weekKey.setDate(weekKey.getDate() - weekKey.getDay()); // start of that week
      const weekStr = weekKey.toISOString().split("T")[0];
      const trackerKey = `${key}:${weekStr}`;

      if (!patternMap[key]) patternMap[key] = { totalCount: 0 };
      patternMap[key].totalCount += 1;

      if (!weekTracker[key]) weekTracker[key] = new Set();
      if (!weekTracker[key].has(trackerKey)) {
        weekTracker[key].add(trackerKey);
      }
    }

    const priorSchedulePatterns: PriorPattern[] = Object.entries(patternMap).map(([key, counts]) => {
      const [dayStr, position] = key.split(":");
      const numWeeks = weekTracker[key]?.size || 1;
      return {
        day_of_week: parseInt(dayStr, 10),
        position,
        avg_count: counts.totalCount / numWeeks,
      };
    });

    // ── Build hourly sales patterns ──────────────────────────────────────────
    const salesRows = salesResult.data ?? [];
    const salesAggMap: Record<string, { totalSales: number; weekCount: number }> = {};
    const salesWeekTracker: Record<string, Set<string>> = {};

    for (const sale of salesRows) {
      if (!sale.sale_date) continue;
      const saleDate = new Date(sale.sale_date);
      const dayOfWeek = saleDate.getDay();
      // Use sale_time for hour if available, otherwise skip hourly breakdown
      let hour = -1;
      if (sale.sale_time) {
        const timePart = typeof sale.sale_time === "string" ? sale.sale_time : String(sale.sale_time);
        hour = parseInt(timePart.split(":")[0], 10);
      }
      if (hour < 0 || hour > 23) continue;

      const key = `${dayOfWeek}:${hour}`;
      const weekStart_ = new Date(saleDate);
      weekStart_.setDate(weekStart_.getDate() - weekStart_.getDay());
      const weekStr = weekStart_.toISOString().split("T")[0];

      if (!salesAggMap[key]) salesAggMap[key] = { totalSales: 0, weekCount: 0 };
      salesAggMap[key].totalSales += sale.total_price ?? 0;

      if (!salesWeekTracker[key]) salesWeekTracker[key] = new Set();
      salesWeekTracker[key].add(weekStr);
    }

    const hourlySalesPatterns: HourlySales[] = Object.entries(salesAggMap).map(([key, agg]) => {
      const [dayStr, hourStr] = key.split(":");
      const numWeeks = salesWeekTracker[key]?.size || 1;
      return {
        day_of_week: parseInt(dayStr, 10),
        hour: parseInt(hourStr, 10),
        avg_sales: agg.totalSales / numWeeks,
      };
    });

    // ── Calculate weekly budget target ───────────────────────────────────────
    let weeklyBudgetTarget: number | null = null;
    const costRow = operatingCostsResult.data;
    if (costRow && costRow.entry_type === "value" && costRow.monthly_value != null) {
      // entry_type='value' means monthly dollar value (stored in cents)
      // weeklyBudgetTarget = (monthlyValue / 100) / 30 * 7
      const monthlyValueCents = costRow.monthly_value;
      weeklyBudgetTarget = Math.round((monthlyValueCents / 30) * 7);
    }

    // ── Build locked shifts ───────────────────────────────────────────────────
    const existingShifts = existingShiftsResult.data ?? [];
    const lockedShiftIdSet = new Set(locked_shift_ids);

    const lockedShifts: LockedShift[] = existingShifts
      .filter((s) => s.locked || lockedShiftIdSet.has(s.id))
      .map((s) => {
        const startDt = new Date(s.start_time);
        const day = startDt.toISOString().split("T")[0];
        // start_time and end_time in DB are full timestamps; extract time portion
        const startTime = s.start_time.includes("T")
          ? s.start_time.split("T")[1].substring(0, 8)
          : s.start_time;
        const endTime = s.end_time?.includes("T")
          ? s.end_time.split("T")[1].substring(0, 8)
          : (s.end_time ?? "00:00:00");
        const empName = (s.employees as { name: string } | null)?.name ?? "Unknown";
        return {
          id: s.id,
          employee_name: empName,
          day,
          start_time: startTime,
          end_time: endTime,
          position: s.position ?? "Staff",
        };
      });

    // ── Build staffing settings map ───────────────────────────────────────────
    let staffingSettings: Record<string, { min: number }> | null = null;
    const settingsRow = staffingSettingsResult.data;
    if (settingsRow) {
      // staffing_settings columns are typically per-position minimums stored as JSONB
      // or individual columns. Attempt to extract a generic map.
      // Common pattern: { min_servers: 2, min_cooks: 1, ... } or { requirements: {...} }
      const { id: _id, restaurant_id: _rid, created_at: _ca, updated_at: _ua, ...rest } = settingsRow as Record<string, unknown>;
      const result: Record<string, { min: number }> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (k.startsWith("min_") && typeof v === "number") {
          const position = k.replace(/^min_/, "").replace(/_/g, " ");
          result[position] = { min: v };
        }
      }
      if (Object.keys(result).length > 0) {
        staffingSettings = result;
      }
    }

    // ── Build the prompt ──────────────────────────────────────────────────────
    const scheduleContext: ScheduleContext = {
      weekStart: week_start,
      employees,
      templates,
      availability,
      staffingSettings,
      priorSchedulePatterns,
      hourlySalesPatterns,
      weeklyBudgetTarget,
      lockedShifts,
    };

    const promptResult = buildSchedulePrompt(scheduleContext);

    const requestBody = {
      ...promptResult,
      temperature: 0.3,
      max_tokens: 8192,
    };

    // ── Call AI with custom model chain ───────────────────────────────────────
    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterApiKey) {
      throw new Error("OPENROUTER_API_KEY environment variable is not set");
    }

    let aiResult: { data: { shifts: GeneratedShift[]; metadata: { estimated_cost: number; budget_variance_pct: number; notes: string } }; model: string } | null = null;

    for (const modelConfig of SCHEDULE_MODELS) {
      console.log(`Trying model: ${modelConfig.name}`);
      const response = await callModel(modelConfig, requestBody, openRouterApiKey, "generate-schedule", restaurant_id);
      if (!response || !response.ok) continue;

      try {
        const data = await response.json();
        if (!data.choices?.[0]?.message?.content) continue;
        const content = data.choices[0].message.content;
        const cleaned = content
          .replace(/^```(?:json)?\s*\n?/i, "")
          .replace(/\n?```\s*$/i, "")
          .trim();
        aiResult = { data: JSON.parse(cleaned), model: modelConfig.name };
        break;
      } catch {
        continue;
      }
    }

    if (!aiResult) {
      return new Response(
        JSON.stringify({ error: "All AI models failed to generate a schedule. Please try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Validate AI response ──────────────────────────────────────────────────
    const generatedShifts: GeneratedShift[] = Array.isArray(aiResult.data.shifts)
      ? aiResult.data.shifts
      : [];

    // Build validation context
    const employeeIds = new Set(employees.map((e) => e.id));
    const employeePositions = new Map(employees.map((e) => [e.id, e.position]));
    const templateIds = new Set(templates.map((t) => t.id));

    // Build availability Map for validator
    const availabilityMap = new Map<string, AvailabilitySlot>();
    for (const [empId, days] of Object.entries(availability)) {
      for (const [dayStr, avail] of Object.entries(days)) {
        const key = `${empId}:${dayStr}`;
        availabilityMap.set(key, {
          isAvailable: avail.available,
          startTime: avail.start ?? null,
          endTime: avail.end ?? null,
        });
      }
    }

    // Build existing shifts as GeneratedShift format for overlap checking
    const existingAsGenerated: GeneratedShift[] = existingShifts.map((s) => {
      const [y, m, d] = s.start_time.split('T')[0].split('-').map(Number);
      const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const startTime = s.start_time.includes('T') ? s.start_time.split('T')[1].substring(0, 8) : s.start_time;
      const endTime = s.end_time?.includes('T') ? s.end_time.split('T')[1].substring(0, 8) : (s.end_time ?? '00:00:00');
      return {
        employee_id: s.employee_id,
        template_id: '',
        day,
        start_time: startTime,
        end_time: endTime,
        position: s.position ?? 'Staff',
      };
    });

    const validationCtx: ValidationContext = {
      employeeIds,
      employeePositions,
      templateIds,
      availability: availabilityMap,
      excludedEmployeeIds: new Set(excluded_employee_ids),
      existingShifts: existingAsGenerated,
    };

    const { valid: validShifts, dropped: droppedShifts } = validateGeneratedShifts(
      generatedShifts,
      validationCtx
    );

    const droppedReasons = droppedShifts.map((d) => d.reason);

    // ── Build response ────────────────────────────────────────────────────────
    const aiMetadata = aiResult.data.metadata ?? {};

    return new Response(
      JSON.stringify({
        shifts: validShifts,
        metadata: {
          estimated_cost: aiMetadata.estimated_cost ?? 0,
          budget_variance_pct: aiMetadata.budget_variance_pct ?? 0,
          notes: aiMetadata.notes ?? "",
          model_used: aiResult.model,
          total_generated: generatedShifts.length,
          total_valid: validShifts.length,
          total_dropped: droppedShifts.length,
          dropped_reasons: droppedReasons,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in generate-schedule:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An unexpected error occurred",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

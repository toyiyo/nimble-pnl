import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  computeHourBudget,
  type ScheduleEmployee,
  type ScheduleTemplate,
  type AvailabilityDay,
  type PriorPattern,
  type HourlySales,
} from "../_shared/schedule-prompt-builder.ts";
import {
  validateGeneratedShifts,
  type GeneratedShift,
  type ValidationContext,
  type AvailabilitySlot,
} from "../_shared/schedule-validator.ts";
import {
  convertRecurringToLocal,
  convertExceptionsToLocal,
  type LocalAvail,
} from "../_shared/availability-tz.ts";
import { computeRequiredStaff } from "../_shared/staffing-requirements.ts";
import { solveSchedule, type ScheduleContext as SolverScheduleContext } from "../_shared/schedule-solver.ts";
import type { UnfilledSlot, FairnessSummary } from "../_shared/schedule-solver.ts";
import { applyPreferences, PREFERENCE_MODELS } from "../_shared/schedule-preference-llm.ts";

export type ClientSafeUnfilledSlot = Omit<UnfilledSlot, 'template_id'> & { template_name: string };
export type ClientSafeFairnessSummary = Omit<FairnessSummary, 'employee_id'> & { employee_name: string };

/** Splits a full ISO timestamp (or bare HH:MM:SS) into a YYYY-MM-DD date and
 *  HH:MM:SS time components. Used wherever a DB timestamp must be projected
 *  into the solver's day/start_time/end_time shape. */
function splitTimestamp(iso: string): { day: string; time: string } {
  if (iso.includes('T')) {
    return { day: iso.split('T')[0], time: iso.split('T')[1].substring(0, 8) };
  }
  return { day: '', time: iso };
}

interface RequestPayload {
  restaurant_id: string;
  week_start: string;         // YYYY-MM-DD
  locked_shift_ids: string[];
  excluded_employee_ids: string[];
  preferences_text?: string;
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

    // ── Fetch all scheduling data in parallel (9 queries) ───────────────────
    const [
      employeesResult,
      templatesResult,
      recurringAvailResult,
      availExceptionsResult,
      staffingSettingsResult,
      priorShiftsResult,
      salesResult,
      existingShiftsResult,
      restaurantResult,
    ] = await Promise.all([
      // 1. Active employees
      supabase
        .from("employees")
        .select("id, name, position, area, hourly_rate, salary_amount, compensation_type, employment_type, date_of_birth")
        .eq("restaurant_id", restaurant_id)
        .eq("status", "active"),

      // 2. Active shift templates
      supabase
        .from("shift_templates")
        .select("id, name, days, start_time, end_time, position, area, capacity")
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

      // 5. Staffing settings — only the two fields read downstream.
      supabase
        .from("staffing_settings")
        .select("min_crew, min_staff")
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

      // 8. Existing shifts this week (for locked shift identification)
      supabase
        .from("shifts")
        .select("id, employee_id, start_time, end_time, position, locked, shift_template_id, employees(name)")
        .eq("restaurant_id", restaurant_id)
        .gte("start_time", `${week_start}T00:00:00`)
        .lt("start_time", `${weekEndStr}T00:00:00`)
        .neq("status", "cancelled"),

      // 9. Restaurant timezone (null-safe — defaults to UTC below)
      supabase
        .from("restaurants")
        .select("timezone")
        .eq("id", restaurant_id)
        .maybeSingle(),
    ]);

    // ── Resolve restaurant timezone ──────────────────────────────────────────
    const restaurantTimezone: string =
      restaurantResult.data?.timezone && typeof restaurantResult.data.timezone === "string"
        ? restaurantResult.data.timezone
        : "UTC";
    if (!restaurantResult.data?.timezone) {
      console.warn(
        `[generate-schedule] No timezone for restaurant ${restaurant_id}; defaulting to UTC. ` +
          `Availability conversion is a no-op for this run.`,
      );
    }

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
    const employees: ScheduleEmployee[] = activeEmployees.map((e) => {
      // Bug I: derive the per-employee weekly hour cap from DOB so the
      // prompt's Employee Hour Budgets table and the validator backstop
      // share one anchor. Defaults to adult 40h when DOB is null/bad.
      const budget = computeHourBudget(e.date_of_birth, week_start);
      return {
        id: e.id,
        name: e.name,
        position: e.position ?? "Staff",
        area: e.area ?? null,
        // hourly_rate stored in cents; salary employees get 0
        hourly_rate: e.compensation_type === "salary" ? 0 : (e.hourly_rate ?? 0),
        employment_type: e.employment_type ?? "full_time",
        date_of_birth: e.date_of_birth ?? '',
        is_minor: budget.is_minor,
        max_weekly_hours: budget.max_weekly_hours,
      };
    });

    // ── Build ScheduleTemplate[] ─────────────────────────────────────────────
    const templates: ScheduleTemplate[] = rawTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      days: t.days ?? [],
      start_time: t.start_time,
      end_time: t.end_time,
      position: t.position ?? "Staff",
      area: t.area ?? null,
      // DB constraint guarantees capacity >= 1 in real rows; coerce here so
      // the prompt and the staffing floor never disagree. `?? 1` alone leaves
      // 0/NaN intact and the LLM would see a different capacity than
      // computeRequiredStaff uses downstream.
      capacity:
        typeof t.capacity === "number" && Number.isFinite(t.capacity) && t.capacity >= 1
          ? t.capacity
          : 1,
    }));

    // ── Build availability map (TZ-converted to restaurant local) ────────────
    const recurringLocal: LocalAvail[] = convertRecurringToLocal(
      (recurringAvailResult.data ?? []).map((r) => ({
        employee_id: r.employee_id,
        day_of_week: r.day_of_week,
        is_available: r.is_available,
        start_time: r.start_time ?? null,
        end_time: r.end_time ?? null,
      })),
      restaurantTimezone,
      week_start,
    );

    const exceptionsLocal: LocalAvail[] = convertExceptionsToLocal(
      (availExceptionsResult.data ?? []).map((e) => ({
        employee_id: e.employee_id,
        date: e.date,
        is_available: e.is_available,
        start_time: e.start_time ?? null,
        end_time: e.end_time ?? null,
      })),
      restaurantTimezone,
    );

    const availability: Record<string, Record<number, AvailabilityDay>> = {};
    const setSlot = (a: LocalAvail) => {
      if (!availability[a.employee_id]) availability[a.employee_id] = {};
      availability[a.employee_id][a.day_of_week] = {
        available: a.is_available,
        start: a.start_time ?? undefined,
        end: a.end_time ?? undefined,
      };
    };
    for (const a of recurringLocal) setSlot(a);
    // Exceptions override recurring on the same (employee, day)
    for (const a of exceptionsLocal) setSlot(a);

    // Bug 4: complete every employee's 7-day map.
    // - Zero records → assume available every day (legacy behavior).
    // - Some records → missing days are UNAVAILABLE (was silently dropped before).
    for (const emp of employees) {
      const empMap = availability[emp.id];
      if (!empMap) {
        availability[emp.id] = {};
        for (let d = 0; d < 7; d++) {
          availability[emp.id][d] = { available: true };
        }
      } else {
        for (let d = 0; d < 7; d++) {
          if (!(d in empMap)) {
            empMap[d] = { available: false };
          }
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

      if (!patternMap[key]) patternMap[key] = { totalCount: 0 };
      patternMap[key].totalCount += 1;

      if (!weekTracker[key]) weekTracker[key] = new Set();
      weekTracker[key].add(weekStr);
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
    const salesAggMap: Record<string, { totalSales: number }> = {};
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

      if (!salesAggMap[key]) salesAggMap[key] = { totalSales: 0 };
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

    // ── Build locked shifts ───────────────────────────────────────────────────
    const existingShifts = existingShiftsResult.data ?? [];
    const lockedShiftIdSet = new Set(locked_shift_ids);

    // ── Build staffing settings map ───────────────────────────────────────────
    // staffing_settings.min_crew is a JSONB column keyed by user-facing
    // position strings (e.g., {"Server": 2, "Line Cook": 1}). min_staff is a
    // separate integer column treated as a per-slot floor (passed to
    // computeRequiredStaff). The legacy "iterate min_* columns" approach
    // (Bug 6) treated min_staff as a phantom "staff" position.
    let staffingSettings: Record<string, { min: number }> | null = null;
    let minStaffFloor: number | null = null;
    const settingsRow = staffingSettingsResult.data as
      | { min_crew?: unknown; min_staff?: unknown }
      | null;
    if (settingsRow) {
      const result: Record<string, { min: number }> = {};
      if (settingsRow.min_crew && typeof settingsRow.min_crew === "object") {
        for (const [position, count] of Object.entries(
          settingsRow.min_crew as Record<string, unknown>,
        )) {
          if (typeof count === "number" && count > 0) {
            result[position] = { min: count };
          }
        }
      }
      if (Object.keys(result).length > 0) staffingSettings = result;
      if (typeof settingsRow.min_staff === "number" && settingsRow.min_staff > 0) {
        minStaffFloor = settingsRow.min_staff;
      }
    }

    // ── Compute per-slot required headcount (Bug 5 wiring) ───────────────────
    const minCrewForCompute: Record<string, number> | null = staffingSettings
      ? Object.fromEntries(
          Object.entries(staffingSettings).map(([k, v]) => [k, v.min]),
        )
      : null;
    const requiredStaff = computeRequiredStaff({
      templates,
      minCrew: minCrewForCompute,
      minStaff: minStaffFloor,
      priorPatterns: priorSchedulePatterns,
      hourlySales: hourlySalesPatterns,
    });
    let totalRequiredSlots = 0;
    for (const perDay of requiredStaff.values()) {
      for (const count of perDay.values()) totalRequiredSlots += count;
    }

    // ── Build solver context (separate from the prompt-builder's ScheduleContext) ──
    // Hoisted once per request — the requiredStaff Map-conversion loop needs this
    // to compute YYYY-MM-DD dates; constructing it inside the loop (one per
    // template-DOW pair) was wasteful.
    const solverWeekStart = new Date(`${week_start}T00:00:00Z`);
    const solverCtx: SolverScheduleContext = {
      restaurantId: restaurant_id,
      weekStart: week_start,
      employees: employees.map((e) => ({
        id: e.id,
        name: e.name,
        position: e.position,
        area: e.area,
        max_weekly_hours: e.max_weekly_hours,
        date_of_birth: e.date_of_birth,
        is_minor: e.is_minor,
      })),
      templates: rawTemplates.map((t) => ({
        id: t.id,
        name: t.name,
        days_of_week: t.days ?? [],
        start_time: t.start_time,
        end_time: t.end_time,
        position: t.position ?? 'Staff',
        area: t.area ?? null,
      })),
      availability: Object.fromEntries(
        Object.entries(availability).map(([empId, days]) => [
          empId,
          Object.fromEntries(
            Object.entries(days).map(([dow, a]) => [
              dow,
              { isAvailable: a.available, startTime: a.start ?? null, endTime: a.end ?? null },
            ]),
          ),
        ]),
      ),
      requiredStaff: new Map(
        Array.from(requiredStaff.entries()).flatMap(([templateId, perDay]) => {
          const out: [string, { template_id: string; day: string; count: number }][] = [];
          for (const [dowStr, count] of perDay.entries()) {
            const dow = typeof dowStr === 'number' ? dowStr : parseInt(String(dowStr), 10);
            if (count <= 0) continue;
            // Compute the YYYY-MM-DD date for this day-of-week within the target week.
            // week_start is Monday-anchored; iterate offsets 0..6 picking matching UTCDay.
            for (let i = 0; i < 7; i++) {
              const d = new Date(solverWeekStart);
              d.setUTCDate(solverWeekStart.getUTCDate() + i);
              if (d.getUTCDay() === dow) {
                const day = d.toISOString().slice(0, 10);
                out.push([`${templateId}:${day}`, { template_id: templateId, day, count }]);
                break;
              }
            }
          }
          return out;
        }),
      ),
      lockedShifts: existingShifts
        .filter((s) => s.locked || lockedShiftIdSet.has(s.id))
        .map((s) => {
          const { day, time: startTime } = splitTimestamp(s.start_time);
          const endTime = s.end_time ? splitTimestamp(s.end_time).time : '00:00:00';
          return {
            employee_id: s.employee_id,
            template_id: s.shift_template_id ?? '',
            day,
            start_time: startTime,
            end_time: endTime,
            position: s.position ?? 'Staff',
          };
        }),
      excludedEmployeeIds: new Set(excluded_employee_ids),
      priorPatterns: priorSchedulePatterns.map((p) => ({
        day_of_week: p.day_of_week,
        position: p.position,
        avg_count: p.avg_count,
      })),
      weeklySalesHistory: [],
      hourlySalesHistory: hourlySalesPatterns.map((h) => ({
        day_of_week: h.day_of_week,
        hour: h.hour,
        avg_sales: h.avg_sales,
      })),
      targetLaborPercentage: 0.30,
      minimumWageCents: 725,
    };

    // ── Run deterministic solver + optional preference LLM second pass ────────
    console.log(`[generate-schedule] solver starting: employees=${activeEmployees.length}, templates=${rawTemplates.length}, requiredSlots=${totalRequiredSlots}, tz=${restaurantTimezone}`);

    const solveStartedAt = performance.now();
    const solverResult = solveSchedule(solverCtx);
    const solverDurationMs = performance.now() - solveStartedAt;

    // Attach synthetic ids so the preference layer can reference each shift
    const shiftsWithIds = solverResult.shifts.map((s, i) => ({ ...s, id: `sft_${i}` }));

    const preferencesText = (payload.preferences_text as string | undefined) ?? '';
    const prefStartedAt = performance.now();
    const prefResult = await applyPreferences(shiftsWithIds, solverCtx, preferencesText, PREFERENCE_MODELS);
    const preferenceDurationMs = performance.now() - prefStartedAt;

    // Strip the synthetic id before persistence/response
    const finalShifts: GeneratedShift[] = prefResult.shifts.map(({ id: _id, ...s }) => s);

    console.log('[generate-schedule] duration', JSON.stringify({
      solver_duration_ms: Math.round(solverDurationMs),
      preference_duration_ms: Math.round(preferenceDurationMs),
      total_required_slots: totalRequiredSlots,
      total_generated: finalShifts.length,
      applied_swaps: prefResult.appliedSwaps.length,
      rejected_swaps: prefResult.rejectedSwaps.length,
    }));

    // Build validation context
    // Bug I: validator now carries is_minor + max_weekly_hours per
    // employee (one Map instead of Set + parallel position Map) so the
    // new hour-cap step can dispatch on max_weekly_hours and the
    // POSITION_MISMATCH check still reads `.position` via one lookup.
    const employeeMeta = new Map(
      employees.map((e) => [e.id, {
        position: e.position,
        is_minor: e.is_minor,
        max_weekly_hours: e.max_weekly_hours,
      }] as const),
    );
    // Validator needs template days-of-week and required position so it can
    // drop shifts placed on a wrong day (Bug C) or a wrong position (Bug E
    // — Manager onto Server template).
    const templateDays = new Map(
      templates.map((t) => [t.id, { days: t.days, position: t.position }] as const),
    );

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
      const { day, time: startTime } = splitTimestamp(s.start_time);
      const endTime = s.end_time ? splitTimestamp(s.end_time).time : '00:00:00';
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
      employees: employeeMeta,
      templates: templateDays,
      availability: availabilityMap,
      excludedEmployeeIds: new Set(excluded_employee_ids),
      existingShifts: existingAsGenerated,
    };

    const { valid: validShifts, dropped: droppedShifts } = validateGeneratedShifts(
      finalShifts,
      validationCtx
    );

    // ── Aggregate drop reasons by structured code (Bug 8 / no UUID leak) ─────
    const dropReasonSummary: Record<string, number> = {};
    for (const d of droppedShifts) {
      dropReasonSummary[d.code] = (dropReasonSummary[d.code] ?? 0) + 1;
    }
    // Server-side log: full counts AND the human messages (UUIDs allowed in logs).
    // Defense-in-depth: solver should produce zero drops; any drop = solver bug.
    console.log(
      `[generate-schedule] Generated=${finalShifts.length}, ` +
        `valid=${validShifts.length}, dropped=${droppedShifts.length}, ` +
        `requiredSlots=${totalRequiredSlots}`,
    );
    console.log(
      `[generate-schedule] Drop reason summary: ${JSON.stringify(dropReasonSummary)}`,
    );

    // ── Zero-shift guardrail ──────────────────────────────────────────────────
    if (finalShifts.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Solver generated no valid shifts. Check employee positions, availability, and templates.",
          diagnostic: {
            total_employees: employees.length,
            total_templates: templates.length,
            total_required_slots: totalRequiredSlots,
            total_generated: finalShifts.length,
            total_dropped: droppedShifts.length,
            drop_reason_summary: dropReasonSummary,
            model_used: prefResult.modelUsed ?? null,
          },
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Project UUIDs → human names at the response boundary ────────────────
    // Per lesson [2026-05-17]: API responses must not leak internal UUIDs.
    const templateNameById = new Map(templates.map((t) => [t.id, t.name]));
    const employeeNameById = new Map(employees.map((e) => [e.id, e.name]));

    const safeUnfilled: ClientSafeUnfilledSlot[] = solverResult.unfilled.map(({ template_id, ...rest }) => ({
      ...rest,
      template_name: templateNameById.get(template_id) ?? 'Unknown template',
    }));
    const safeFairness: ClientSafeFairnessSummary[] = solverResult.fairness.map(({ employee_id, ...rest }) => ({
      ...rest,
      employee_name: employeeNameById.get(employee_id) ?? 'Unknown',
    }));

    // ── Build success response ───────────────────────────────────────────────
    // dropped_reasons is UUID-free — derived from code + day + position only.
    // d.message MAY contain employee/template UUIDs (per validator JSDoc) so
    // we never ship it to the client.
    const droppedReasons: string[] = droppedShifts.map((d) => {
      switch (d.code) {
        case "POSITION_MISMATCH":
          return `Position mismatch (${d.shift.position}) on ${d.shift.day}`;
        case "UNAVAILABLE_DAY":
          return `Employee unavailable on ${d.shift.day}`;
        case "OUTSIDE_WINDOW":
          return `Outside availability window on ${d.shift.day}`;
        case "DOUBLE_BOOKING":
          return `Double-booking on ${d.shift.day} at ${d.shift.start_time}`;
        case "EXCLUDED":
          return `Excluded employee on ${d.shift.day}`;
        case "UNKNOWN_EMPLOYEE":
          return `Unknown employee on ${d.shift.day}`;
        case "UNKNOWN_TEMPLATE":
          return `Unknown template on ${d.shift.day}`;
        case "DAY_NOT_IN_TEMPLATE":
          return `Template not active on ${d.shift.day}`;
        case "HOURS_EXCEED_WEEKLY_CAP":
          return `Weekly hour cap exceeded on ${d.shift.day}`;
        case "MINOR_HOURS_EXCEEDED":
          return `Minor weekly hour cap exceeded on ${d.shift.day}`;
        case "CONSECUTIVE_DAYS_EXCEEDED":
          return `More than 5 consecutive days on ${d.shift.day}`;
        default:
          return `Unknown drop reason on ${d.shift.day}`;
      }
    });

    return new Response(
      JSON.stringify({
        shifts: validShifts,
        metadata: {
          estimated_cost: 0,
          budget_variance_pct: 0,
          notes: "",
          model_used: prefResult.modelUsed ?? '',
          total_generated: finalShifts.length,
          total_valid: validShifts.length,
          total_dropped: droppedShifts.length,
          total_required_slots: totalRequiredSlots,
          drop_reason_summary: dropReasonSummary,
          dropped_reasons: droppedReasons,
          unfilled: safeUnfilled,
          fairness_summary: safeFairness,
          applied_swaps_count: prefResult.appliedSwaps.length,
          rejected_swaps_count: prefResult.rejectedSwaps.length,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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

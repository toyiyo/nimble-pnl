import { generateHeader } from '../_shared/emailTemplates.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fromZonedTime } from "https://esm.sh/date-fns-tz@3.2.0";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmailResult, sendPaced } from "../_shared/emailQueue.ts";
import { sendWebPushToUser } from "../_shared/webPushHelper.ts";
import { notifySchedulePublishedPush } from "../_shared/schedulePublishedPush.ts";
import { resolveChannels, type SupabaseLike } from "../_shared/resolveChannels.ts";
import { safeTz } from "../_shared/timezone.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

interface NotificationPayload {
  publicationId: string;
  restaurantId: string;
  weekStart: string;
  weekEnd: string;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    // Parse request body
    const payload: NotificationPayload = await req.json();
    const { publicationId, restaurantId, weekStart, weekEnd } = payload;

    // Verify user has permission for this restaurant
    const { data: userRestaurant, error: permError } = await supabase
      .from("user_restaurants")
      .select("role")
      .eq("user_id", user.id)
      .eq("restaurant_id", restaurantId)
      .single();

    if (permError || !userRestaurant || !["owner", "manager"].includes(userRestaurant.role)) {
      throw new Error("Access denied");
    }

    // Get restaurant details
    const { data: restaurant, error: restError } = await supabase
      .from("restaurants")
      .select("name, timezone")
      .eq("id", restaurantId)
      .single();

    if (restError || !restaurant) {
      throw new Error("Restaurant not found");
    }

    // Service-role client for the resolver read + push sends (created here so
    // it's available for the independent email/push gating below).
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const ch = await resolveChannels(
      serviceClient as unknown as SupabaseLike,
      restaurantId,
      "schedule_published"
    );

    // Get all employees for this restaurant
    const { data: employees, error: empError } = await supabase
      .from("employees")
      .select("id, name, email, user_id")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active");

    if (empError) {
      throw new Error("Failed to fetch employees");
    }

    // The payload carries restaurant-local calendar days. Splicing them into
    // hardcoded `Z` literals would compare local dates against UTC instants and
    // drop Sunday-evening shifts (already Monday in UTC for US restaurants),
    // silently excluding those employees from the notification.
    //
    // An invalid/legacy IANA string makes date-fns-tz throw, so validate via
    // the shared `safeTz` (same fallback used by the Revel sync path) before
    // it reaches `fromZonedTime`.
    const tz = safeTz(restaurant.timezone);
    if (tz !== restaurant.timezone) {
      console.warn(`Invalid timezone "${restaurant.timezone}" for restaurant ${restaurantId}; falling back to ${tz}`);
    }

    const weekStartInstant = fromZonedTime(`${weekStart}T00:00:00`, tz).toISOString();
    const weekEndInstant = fromZonedTime(`${weekEnd}T23:59:59.999`, tz).toISOString();

    // Get shifts for this publication to determine which employees are scheduled
    const { data: shifts, error: shiftsError } = await supabase
      .from("shifts")
      .select("employee_id")
      .eq("restaurant_id", restaurantId)
      .gte("start_time", weekStartInstant)
      .lte("start_time", weekEndInstant)
      .eq("is_published", true);

    if (shiftsError) {
      throw new Error("Failed to fetch shifts");
    }

    // Get unique employee IDs who have shifts this week
    const scheduledEmployeeIds = new Set(shifts.map((s) => s.employee_id));
    const scheduledEmployees = employees.filter((emp) =>
      scheduledEmployeeIds.has(emp.id)
    );

    // Format dates
    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    };

    const weekStartFormatted = formatDate(weekStart);
    const weekEndFormatted = formatDate(weekEnd);

    // Is this the first announcement for the week, or a revision of one people
    // have already read? Identical copy for both is what leaves an employee
    // unsure whether the email they just got supersedes the shifts they wrote
    // on the fridge. Excluding the current row matters: publish_schedule has
    // already inserted it, and this function is about to mark it notified.
    //
    // Keyed on week_start_date alone, deliberately: week_end_date is not a
    // stable key, because older rows in production carry an 8-day Sunday-Sunday
    // span while current ones carry a 7-day Monday-start span. Matching on it
    // would classify a genuine republish of such a week as a first publish.
    // unpublish_schedule()'s own lookup keys the same way.
    const { data: priorPublication } = await serviceClient
      .from("schedule_publications")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("week_start_date", weekStart)
      .eq("notification_sent", true)
      .neq("id", publicationId)
      .limit(1)
      .maybeSingle();

    const isRepublish = !!priorPublication;

    // App URL for the button
    const appUrl = "https://app.easyshifthq.com/employee/schedule";

    // Send email notifications using Resend
    const emailRecipients = (ch.email ? scheduledEmployees : []).filter(
      (emp) => emp.email
    );

    const buildEmailHtml = (employeeName: string) => `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
              ${generateHeader()}
              
              <!-- Content -->
              <div style="padding: 40px 32px; background-color: #ffffff;">
                <h1 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0; line-height: 1.3;">${isRepublish ? "Updated Schedule" : "New Schedule Published"}</h1>

                <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
                  Hi <strong style="color: #1f2937;">${employeeName}</strong>,
                </p>

                <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
                  Your schedule for <strong style="color: #1f2937;">${weekStartFormatted} - ${weekEndFormatted}</strong> has been published at <strong style="color: #1f2937;">${restaurant.name}</strong>.
                </p>
                ${
                  isRepublish
                    ? `<p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
                  This is an updated version — some shifts changed since your manager's earlier schedule for this week. Please review your shifts below before your next scheduled shift.
                </p>`
                    : ""
                }

                <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); padding: 24px; border-radius: 12px; margin: 24px 0; border-left: 4px solid #10b981;">
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 6px 0; color: #4b5563; font-size: 14px; font-weight: 600;">Restaurant:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${restaurant.name}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #4b5563; font-size: 14px; font-weight: 600;">Schedule Period:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${weekStartFormatted} - ${weekEndFormatted}</td>
                    </tr>
                  </table>
                </div>
                
                <div style="text-align: center; margin: 32px 0;">
                  <a href="${appUrl}" 
                     style="background-color: #059669; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); mso-padding-alt: 14px 32px; border: 2px solid #059669;">
                    <span style="color: #ffffff !important;">View My Schedule</span>
                  </a>
                </div>
                
                <p style="color: #6b7280; font-size: 14px; margin: 32px 0 0 0; line-height: 1.6;">
                  If you have any questions or concerns about your schedule, please contact your manager.
                </p>
              </div>
              
              <!-- Footer -->
              <div style="background-color: #f9fafb; padding: 24px 32px; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 13px; text-align: center; margin: 0; line-height: 1.5;">
                  <strong style="color: #4b5563;">EasyShiftHQ</strong><br>
                  Restaurant Operations Management System
                </p>
                <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 12px 0 0 0;">
                  © ${new Date().getFullYear()} EasyShiftHQ. All rights reserved.
                </p>
                <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 8px 0 0 0;">
                  This is an automated notification. Please do not reply to this email.
                </p>
              </div>
            </div>
          `;

    // Paced rather than fanned out. Resend allows 2 requests/second and this
    // used to fire every recipient at once through Promise.allSettled, so any
    // roster past a handful started collecting 429s that nothing looked at.
    const emailResults = await sendPaced(
      emailRecipients,
      (employee) =>
        sendEmailResult(
          RESEND_API_KEY ?? "",
          "EasyShiftHQ <notifications@easyshifthq.com>",
          employee.email,
          isRepublish
            ? `Updated Schedule: ${weekStartFormatted} - ${weekEndFormatted} at ${restaurant.name} — changes made`
            : `New Schedule Published: ${weekStartFormatted} - ${weekEndFormatted}`,
          buildEmailHtml(employee.name)
        ),
      { label: `schedule-published ${publicationId}` }
    );

    for (const result of emailResults) {
      if (!result.ok) {
        // Employee id, not address: function logs are readable well outside the
        // tenant, and a bounce log is not a reason to spill a roster's email
        // addresses into them. The id joins back to the row anyway.
        console.error(
          `Failed to send email to employee ${result.recipient.id} after ${result.attempts} attempt(s) [${result.status}]:`,
          result.error
        );
      }
    }

    const successCount = emailResults.filter((r) => r.ok).length;
    const failureCount = emailResults.length - successCount;

    // Send web push notifications to all scheduled employees. Deliveries are
    // counted, not just attempted: push is the only channel for a restaurant
    // with email off, and it reaches nobody when VAPID keys are unset or no one
    // has subscribed.
    let pushSentCount = 0;

    if (ch.push) {
      await notifySchedulePublishedPush(scheduledEmployees, async (userId) => {
        const result = await sendWebPushToUser(serviceClient, userId, restaurantId, {
          title: isRepublish ? "Schedule Updated Again" : "Schedule Updated",
          body: isRepublish
            ? `${weekStartFormatted}–${weekEndFormatted} was revised and republished — check what changed.`
            : "A new schedule has been published",
          url: "/employee/schedule",
          // Deliberately the same tag as a first publish, so a republish
          // replaces an earlier notification still sitting in the tray instead
          // of stacking a second one next to copy it contradicts.
          tag: "schedule-published",
        });
        pushSentCount += result.sent;
        return result;
      });
    }

    // Marked notified only if somebody was actually reached, on either channel.
    // `ch.push` on its own is not proof of delivery — an email-disabled
    // restaurant with no push subscriptions would otherwise record a schedule
    // as announced to an audience that heard nothing, and the retraction
    // notifier's gate would later mail them about withdrawing it. Leaving the
    // row unmarked also lets the manager's failure toast prompt a republish,
    // which writes a fresh row anyway.
    const announced = successCount > 0 || pushSentCount > 0;

    if (announced) {
      // serviceClient, not `supabase`. This write used to go through the
      // user-scoped client, and schedule_publications has no UPDATE policy, so
      // RLS filtered it to zero rows -- silently, because a filtered-out UPDATE
      // is not an error. Every publication row in production still reads
      // notification_sent = false as a result, including ones that demonstrably
      // delivered. The .select() is what makes the row count observable.
      const { data: marked, error: markError } = await serviceClient
        .from("schedule_publications")
        .update({ notification_sent: true })
        .eq("id", publicationId)
        .select("id");

      if (markError) {
        console.error(
          `Failed to mark publication ${publicationId} as notified:`,
          markError
        );
      } else if (!marked?.length) {
        console.error(
          `Marked 0 rows notified for publication ${publicationId} -- the id does not exist.`
        );
      }
    }

    // Log notification activity
    console.log(
      `Sent ${successCount} emails and ${pushSentCount} pushes, ${failureCount} emails failed for publication ${publicationId}`
    );

    // A 200 here is what hid defect B: the caller could not tell a clean
    // fan-out from one where every recipient bounced. The body is unchanged so
    // the client can still report exactly how many got through.
    return new Response(
      JSON.stringify({
        success: failureCount === 0,
        sent: successCount,
        failed: failureCount,
        pushSent: pushSentCount,
        totalEmployees: scheduledEmployees.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: failureCount > 0 ? 502 : 200,
      }
    );
  } catch (error: unknown) {
    console.error("Error in notify-schedule-published:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An error occurred",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
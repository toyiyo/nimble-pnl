// Announce that a published week has been pulled back for revision.
//
// Retracting a live schedule used to tell nobody. Employees who had already
// been emailed "New Schedule Published" kept believing a schedule that no
// longer existed, and only found out when they turned up for a shift that had
// been moved -- exactly the confusion this whole change set exists to remove.
//
// Everything is derived from persisted state given only {restaurantId,
// weekStart}. The caller supplies no recipient list: a notification function
// that mails whichever employee_ids arrive in the request body is a mail relay
// for any authenticated user. The audience comes from the schedule_retractions
// row that `unpublish_schedule` wrote inside its own transaction, which is the
// only place it still exists -- the unpublish itself cleared is_published on
// every shift that would otherwise identify it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateHeader } from "../_shared/emailTemplates.ts";
import {
  APP_URL,
  NOTIFICATION_FROM,
  authenticateRequest,
  corsHeaders,
  errorResponse,
  handleCorsPreflightRequest,
  sendEmailResult,
  sendPaced,
  verifyRestaurantPermission,
} from "../_shared/notificationHelpers.ts";
import { resolveChannels, type SupabaseLike } from "../_shared/resolveChannels.ts";
import { sendWebPushToUsers } from "../_shared/webPushHelper.ts";
import { runBounded } from "../_shared/webPushFanout.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

interface UnpublishNotificationPayload {
  restaurantId: string;
  weekStart: string;
}

interface RetractionEmployee {
  id: string;
  name: string;
  email: string | null;
  user_id: string | null;
}

const formatDate = (dateStr: string) =>
  new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const buildEmailHtml = (
  employeeName: string,
  restaurantName: string,
  weekRange: string,
  scheduleUrl: string,
) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    ${generateHeader()}

    <div style="padding: 40px 32px; background-color: #ffffff;">
      <h1 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0; line-height: 1.3;">Your Schedule Is Being Revised</h1>

      <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
        Hi <strong style="color: #1f2937;">${employeeName}</strong>,
      </p>

      <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
        Your schedule for <strong style="color: #1f2937;">${weekRange}</strong> at
        <strong style="color: #1f2937;">${restaurantName}</strong> is being revised by your manager.
        The version you may have seen is no longer final &mdash; please don't rely on it yet.
      </p>

      <div style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); padding: 24px; border-radius: 12px; margin: 24px 0; border-left: 4px solid #f59e0b;">
        <p style="color: #92400e; line-height: 1.6; font-size: 15px; margin: 0;">
          You'll get another notification as soon as the updated schedule is published. If you have
          questions in the meantime, contact your manager.
        </p>
      </div>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${scheduleUrl}"
           style="background-color: #4b5563; color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; mso-padding-alt: 14px 32px; border: 2px solid #4b5563;">
          <span style="color: #ffffff !important;">View My Schedule</span>
        </a>
      </div>
    </div>

    <div style="background-color: #f9fafb; padding: 24px 32px; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
      <p style="color: #6b7280; font-size: 13px; text-align: center; margin: 0; line-height: 1.5;">
        <strong style="color: #4b5563;">EasyShiftHQ</strong><br>
        Restaurant Operations Management System
      </p>
      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 12px 0 0 0;">
        &copy; ${new Date().getFullYear()} EasyShiftHQ. All rights reserved.
      </p>
      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 8px 0 0 0;">
        This is an automated notification. Please do not reply to this email.
      </p>
    </div>
  </div>
`;

/** Nothing to announce. A 200 keeps this off the caller's error path. */
const noop = (reason: string) => {
  console.log(`notify-schedule-unpublished: ${reason}`);
  return new Response(
    JSON.stringify({ success: true, sent: 0, failed: 0, totalEmployees: 0, skipped: reason }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreflightRequest();
  }

  try {
    const { user, supabase } = await authenticateRequest(req);

    const { restaurantId, weekStart }: UnpublishNotificationPayload = await req.json();
    if (!restaurantId || !weekStart) {
      return errorResponse("restaurantId and weekStart are required", 400);
    }

    await verifyRestaurantPermission(supabase, user.id, restaurantId);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Newest unnotified retraction for the week. A week can be published and
    // retracted several times, and only the most recent retraction describes
    // the version employees are currently holding.
    const { data: retraction, error: retractionError } = await serviceClient
      .from("schedule_retractions")
      .select("id, publication_id, week_start_date, week_end_date, employee_ids")
      .eq("restaurant_id", restaurantId)
      .eq("week_start_date", weekStart)
      .is("notified_at", null)
      .order("retracted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (retractionError) {
      throw new Error(`Failed to read retraction: ${retractionError.message}`);
    }
    if (!retraction) {
      return noop(`no unnotified retraction for ${restaurantId} week ${weekStart}`);
    }

    // Decision 2: don't announce the withdrawal of something nobody was told
    // about. A missing publication_id means the same thing as an unnotified
    // one -- there is no announcement to walk back -- so the null is handled
    // explicitly rather than left to a join that would quietly drop the row.
    if (!retraction.publication_id) {
      return noop(`retraction ${retraction.id} has no publication to walk back`);
    }

    const { data: publication, error: publicationError } = await serviceClient
      .from("schedule_publications")
      .select("notification_sent")
      .eq("id", retraction.publication_id)
      .maybeSingle();

    if (publicationError) {
      throw new Error(`Failed to read publication: ${publicationError.message}`);
    }
    if (!publication?.notification_sent) {
      return noop(`publication ${retraction.publication_id} was never announced`);
    }

    // Claim before sending, not after. Two managers unpublishing in quick
    // succession, or a client retry, would otherwise each read notified_at as
    // NULL and mail the same roster twice. Whoever wins this UPDATE sends; the
    // loser sees zero rows and stops.
    const { data: claimed, error: claimError } = await serviceClient
      .from("schedule_retractions")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", retraction.id)
      .is("notified_at", null)
      .select("id");

    if (claimError) {
      throw new Error(`Failed to claim retraction: ${claimError.message}`);
    }
    if (!claimed?.length) {
      return noop(`retraction ${retraction.id} was already claimed by another run`);
    }

    // From here on the latch is held, so any early return must release it.
    const release = async () => {
      const { error } = await serviceClient
        .from("schedule_retractions")
        .update({ notified_at: null })
        .eq("id", retraction.id);
      if (error) {
        console.error(`Failed to release retraction ${retraction.id}:`, error);
      }
    };

    try {
      const { data: restaurant, error: restError } = await serviceClient
        .from("restaurants")
        .select("name")
        .eq("id", restaurantId)
        .maybeSingle();

      if (restError || !restaurant) {
        throw new Error("Restaurant not found");
      }

      const employeeIds: string[] = retraction.employee_ids ?? [];
      if (employeeIds.length === 0) {
        await release();
        return noop(`retraction ${retraction.id} has an empty audience`);
      }

      const { data: employees, error: empError } = await serviceClient
        .from("employees")
        .select("id, name, email, user_id")
        .in("id", employeeIds)
        .eq("status", "active");

      if (empError) {
        throw new Error(`Failed to fetch employees: ${empError.message}`);
      }

      const audience = (employees ?? []) as RetractionEmployee[];
      const ch = await resolveChannels(
        serviceClient as unknown as SupabaseLike,
        restaurantId,
        // Retractions ride the schedule_published gate rather than a channel
        // type of their own: a restaurant that turned schedule notifications
        // off does not want half of the pair to keep arriving.
        "schedule_published",
      );

      const weekRange = `${formatDate(retraction.week_start_date)} - ${formatDate(retraction.week_end_date)}`;
      const scheduleUrl = `${APP_URL}/employee/schedule`;

      const emailRecipients = (ch.email ? audience : []).filter((emp) => emp.email);
      const emailResults = await sendPaced(
        emailRecipients,
        (employee) =>
          sendEmailResult(
            RESEND_API_KEY ?? "",
            NOTIFICATION_FROM,
            employee.email as string,
            `Schedule update: ${weekRange} at ${restaurant.name} is being revised`,
            buildEmailHtml(employee.name, restaurant.name, weekRange, scheduleUrl),
          ),
        { label: `schedule-unpublished ${retraction.id}` },
      );

      for (const result of emailResults) {
        if (!result.ok) {
          console.error(
            `Failed to send retraction email to ${result.recipient.email} after ${result.attempts} attempt(s) [${result.status}]:`,
            result.error,
          );
        }
      }

      const successCount = emailResults.filter((r) => r.ok).length;
      const failureCount = emailResults.length - successCount;

      const pushTitle = "Schedule Being Revised";
      const pushBody = `${weekRange} is no longer final — your manager is making changes.`;
      const pushUserIds = audience
        .map((emp) => emp.user_id)
        .filter((id): id is string => !!id);

      if (ch.push && pushUserIds.length > 0) {
        // A distinct tag from "schedule-published" so a retraction never
        // silently replaces the publish notice still sitting in the tray.
        await sendWebPushToUsers(serviceClient, pushUserIds, restaurantId, {
          title: pushTitle,
          body: pushBody,
          url: "/employee/schedule",
          tag: "schedule-unpublished",
        });

        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        await runBounded(pushUserIds, async (userId) => {
          try {
            await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                user_id: userId,
                title: pushTitle,
                body: pushBody,
                data: { route: "/employee/schedule" },
              }),
            });
          } catch (e) {
            console.error(`Native push failed for ${userId}:`, e);
          }
        });
      }

      // Nobody was reached, so the announcement did not happen. Release the
      // latch rather than leaving the retraction permanently marked notified.
      if (emailResults.length > 0 && successCount === 0) {
        await release();
      }

      console.log(
        `Sent ${successCount} retraction notifications, ${failureCount} failed for retraction ${retraction.id}`,
      );

      return new Response(
        JSON.stringify({
          success: failureCount === 0,
          sent: successCount,
          failed: failureCount,
          totalEmployees: audience.length,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: failureCount > 0 ? 502 : 200,
        },
      );
    } catch (error) {
      await release();
      throw error;
    }
  } catch (error: unknown) {
    console.error("Error in notify-schedule-unpublished:", error);
    const message = error instanceof Error ? error.message : "An error occurred";
    return errorResponse(message, message === "Access denied" ? 403 : 500);
  }
});

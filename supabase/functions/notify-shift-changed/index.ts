// Tell an employee that a published shift they hold changed after the fact.
//
// Design: docs/superpowers/specs/2026-08-15-quiet-publish-live-edit-design.md,
// "Change: the notification". The request body carries only {changeLogId} —
// no decision fields (lesson 2026-07-20). Everything sent is derived from the
// schedule_change_logs row the trigger wrote in the same transaction as the
// shift change, so a malicious or buggy caller can only cause a notification
// that matches what actually happened, to the people it happened to.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authenticateRequest,
  corsHeaders,
  errorResponse,
  handleCorsPreflightRequest,
  NOTIFICATION_FROM,
  sendEmailResult,
} from "../_shared/notificationHelpers.ts";
import { sendWebPushToUser } from "../_shared/webPushHelper.ts";
import { escapeHtml } from "../_shared/emailTemplates.ts";
import { safeTz } from "../_shared/timezone.ts";
import { scheduleThreadHeaders, shiftBusinessDay } from "../_shared/scheduleEmailThread.ts";
import {
  checkShiftChangeValidity,
  deriveShiftChangeRecipients,
  buildShiftChangeMessage,
  type ShiftChangeLogRow,
} from "../_shared/shiftChangedNotification.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

/** Where both the email link and the push point. */
const SCHEDULE_PATH = "/employee/schedule";

interface NotifyShiftChangedPayload {
  changeLogId: string;
}

interface RecipientEmployee {
  id: string;
  name: string | null;
  email: string | null;
  user_id: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreflightRequest();
  }

  try {
    // Step 1: authenticate the caller. `supabase` here forwards the caller's
    // JWT — the capability check in step 3 needs auth.uid() to resolve, so
    // this client (not a service-role one) is what carries that check.
    const { supabase } = await authenticateRequest(req);

    const { changeLogId }: NotifyShiftChangedPayload = await req.json();
    if (!changeLogId) {
      return errorResponse("changeLogId is required", 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Step 2: read the row with the service-role client. Refuse when absent.
    const { data: row, error: rowError } = await serviceClient
      .from("schedule_change_logs")
      .select("id, restaurant_id, shift_id, change_type, changed_at, before_data, after_data")
      .eq("id", changeLogId)
      .maybeSingle();

    if (rowError) {
      throw new Error(`Failed to read change log: ${rowError.message}`);
    }
    if (!row) {
      return errorResponse("Change log not found", 404);
    }

    // Step 3: the caller must be able to edit this restaurant's schedule —
    // the same gate as the shifts UPDATE RLS policy
    // (20260730150000_rewrite_collaborator_policies.sql:140-144).
    // restaurant_id is only known after step 2, so nothing sends before this
    // check passes.
    const { data: canEdit, error: capError } = await supabase.rpc("user_has_capability", {
      p_restaurant_id: row.restaurant_id,
      p_capability: "edit:scheduling",
    });
    if (capError) {
      console.error("notify-shift-changed: capability check failed", capError);
    }
    if (!canEdit) {
      return errorResponse("Access denied", 403);
    }

    // Step 4: validity checks (age, change_type, shift_id).
    const validity = checkShiftChangeValidity(row as ShiftChangeLogRow);
    if (!validity.valid) {
      return errorResponse(`Change log is not a valid notify target: ${validity.reason}`, 409);
    }

    // Step 5: claim the notified_at latch. Zero rows back means another
    // call already sent this — a double-click or client retry cannot send
    // twice.
    const { data: claimed, error: claimError } = await serviceClient
      .from("schedule_change_logs")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", changeLogId)
      .is("notified_at", null)
      .select("id");

    if (claimError) {
      throw new Error(`Failed to claim change log: ${claimError.message}`);
    }
    if (!claimed?.length) {
      return new Response(JSON.stringify({ sent: 0, alreadyNotified: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // The claim above is a lock. From here on, a failure must release it,
    // or a real change log can never be retried and its notification is
    // lost for good. `release` clears `notified_at` back to null; only a
    // send that reaches at least one recipient leaves the claim in place.
    const release = async () => {
      const { error } = await serviceClient
        .from("schedule_change_logs")
        .update({ notified_at: null })
        .eq("id", changeLogId);
      if (error) {
        console.error(`Failed to release change log ${changeLogId}:`, error);
      }
    };

    try {
      // Steps 6-7: derive everything else from the row alone, not the request.
      const recipients = deriveShiftChangeRecipients(row as ShiftChangeLogRow);
      if (recipients.length === 0) {
        // An open shift (both sides null) — nothing to tell anyone. Not a
        // failure, so the claim stands; a retry would find the same result.
        return new Response(JSON.stringify({ sent: 0, failed: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      const employeeIds = recipients.map((r) => r.employeeId);
      const [{ data: employees, error: empError }, { data: restaurant, error: restError }] =
        await Promise.all([
          serviceClient
            .from("employees")
            .select("id, name, email, user_id")
            .eq("restaurant_id", row.restaurant_id)
            .in("id", employeeIds),
          serviceClient
            .from("restaurants")
            .select("name, timezone")
            .eq("id", row.restaurant_id)
            .maybeSingle(),
        ]);

      if (empError) {
        throw new Error(`Failed to fetch employees: ${empError.message}`);
      }
      if (restError) {
        throw new Error(`Failed to fetch restaurant: ${restError.message}`);
      }

      // safeTz guards an invalid stored value, not just an empty one — a bad
      // IANA string here used to throw inside buildShiftChangeMessage and
      // kill the whole invocation (design doc, "Timezone safety").
      const timezone = safeTz(restaurant?.timezone);
      const restaurantName = restaurant?.name ?? "EasyShiftHQ";
      const employeeById = new Map(
        ((employees ?? []) as RecipientEmployee[]).map((e) => [e.id, e]),
      );

      // Thread this email into the same conversation as the publish/unpublish
      // emails for its week. The change log has no week column, so resolve
      // the shift's business day, then find the publication that covers it.
      // A missing business day or a missing publication both mean no header
      // — never throw for either (design doc, "Gap 2 — Thread schedule
      // email"). Resolved per recipient, not once per row: a reassignment
      // across a week boundary sends a "removed" email to the old employee
      // and an "assigned" email to the new one, and each belongs in the
      // thread for its own week — "removed" uses before_data's business
      // day, "assigned"/"updated" use after_data's (falling back to
      // before_data when after_data carries no start_time).
      const resolveEmailThreadHeaders = async (
        startTime: string | null | undefined,
      ): Promise<Record<string, string> | undefined> => {
        const businessDay = shiftBusinessDay(startTime, timezone);
        if (!businessDay) {
          return undefined;
        }
        const minWeekStart = new Date(`${businessDay}T00:00:00Z`);
        minWeekStart.setUTCDate(minWeekStart.getUTCDate() - 6);
        const minWeekStartStr = minWeekStart.toISOString().slice(0, 10);

        const { data: publication, error: pubError } = await serviceClient
          .from("schedule_publications")
          .select("week_start_date")
          .eq("restaurant_id", row.restaurant_id)
          .gte("week_start_date", minWeekStartStr)
          .lte("week_start_date", businessDay)
          .gte("week_end_date", businessDay)
          .order("published_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (pubError) {
          console.error("notify-shift-changed: covering publication lookup failed", pubError);
          return undefined;
        }
        return publication
          ? scheduleThreadHeaders(row.restaurant_id, publication.week_start_date)
          : undefined;
      };

      let sent = 0;
      let failed = 0;

      // Step 8: send one email + push per recipient with the concrete change.
      for (const recipient of recipients) {
        const employee = employeeById.get(recipient.employeeId);
        if (!employee) {
          failed++;
          continue;
        }

        const message = buildShiftChangeMessage(recipient, row as ShiftChangeLogRow, timezone);
        const beforeStartTime = (row.before_data as Record<string, unknown> | null)?.start_time as
          | string
          | undefined;
        const afterStartTime = (row.after_data as Record<string, unknown> | null)?.start_time as
          | string
          | undefined;
        const recipientStartTime =
          recipient.role === "removed" ? beforeStartTime : afterStartTime ?? beforeStartTime;
        const emailThreadHeaders = await resolveEmailThreadHeaders(recipientStartTime);
        let recipientReached = false;

        if (employee.email && RESEND_API_KEY) {
          const emailResult = await sendEmailResult(
            RESEND_API_KEY,
            NOTIFICATION_FROM,
            employee.email,
            `${message.title} - ${restaurantName}`,
            `<p>Hi ${escapeHtml(employee.name ?? "there")},</p><p>${escapeHtml(message.body)}</p>`,
            emailThreadHeaders,
          );
          if (emailResult.ok) {
            recipientReached = true;
          } else {
            console.error(
              `notify-shift-changed: email failed for employee ${employee.id}`,
              emailResult.error,
            );
          }
        }

        if (employee.user_id) {
          const push = await sendWebPushToUser(serviceClient, employee.user_id, row.restaurant_id, {
            title: message.title,
            body: message.body,
            url: SCHEDULE_PATH,
            tag: `shift-changed-${row.shift_id}-${employee.id}`,
          });
          if (push.sent > 0) {
            recipientReached = true;
          }
        }

        if (recipientReached) {
          sent++;
        } else {
          failed++;
        }
      }

      // Reached nobody: release the claim so a retry can try again, and
      // signal the caller this attempt did not actually deliver anything.
      if (sent === 0) {
        await release();
        return new Response(JSON.stringify({ sent, failed }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 502,
        });
      }

      // Step 9.
      return new Response(JSON.stringify({ sent, failed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    } catch (error) {
      await release();
      throw error;
    }
  } catch (error: unknown) {
    console.error("Error in notify-shift-changed:", error);
    const message = error instanceof Error ? error.message : "An error occurred";
    return errorResponse(message, message === "Access denied" ? 403 : 500);
  }
});

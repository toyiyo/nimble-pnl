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

    // Steps 6-7: derive everything else from the row alone, not the request.
    const recipients = deriveShiftChangeRecipients(row as ShiftChangeLogRow);
    if (recipients.length === 0) {
      // An open shift (both sides null) — nothing to tell anyone.
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

    const timezone = restaurant?.timezone || "UTC";
    const restaurantName = restaurant?.name ?? "EasyShiftHQ";
    const employeeById = new Map(
      ((employees ?? []) as RecipientEmployee[]).map((e) => [e.id, e]),
    );

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
      let recipientReached = false;

      if (employee.email && RESEND_API_KEY) {
        const emailResult = await sendEmailResult(
          RESEND_API_KEY,
          NOTIFICATION_FROM,
          employee.email,
          `${message.title} - ${restaurantName}`,
          `<p>Hi ${escapeHtml(employee.name ?? "there")},</p><p>${escapeHtml(message.body)}</p>`,
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

    // Step 9.
    return new Response(JSON.stringify({ sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: unknown) {
    console.error("Error in notify-shift-changed:", error);
    const message = error instanceof Error ? error.message : "An error occurred";
    return errorResponse(message, message === "Access denied" ? 403 : 500);
  }
});

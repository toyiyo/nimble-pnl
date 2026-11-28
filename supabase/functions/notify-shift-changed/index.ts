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
} from "../_shared/notificationHelpers.ts";
import { safeTz } from "../_shared/timezone.ts";
import { checkShiftChangeValidity, type ShiftChangeLogRow } from "../_shared/shiftChangedNotification.ts";
import { claimNotifications, deliverClaimed, type RpcClient } from "../_shared/scheduleNotificationDelivery.ts";
import { makeDeliverDeps } from "../_shared/scheduleNotificationSenders.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

interface NotifyShiftChangedPayload {
  changeLogId: string;
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

    // Step 5: claim (change, employee) pairs. This is the only latch: the
    // UNIQUE (change_log_id, employee_id) link means a double-click, a client
    // retry, or a publish notifier that already took the pair cannot send it
    // twice (TLA+ NoDuplicateDelivery). A recipient that a partial send missed
    // keeps a 'failed' row, and a retry takes it back.
    // Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
    const rpcClient = serviceClient as unknown as RpcClient;
    const claims = await claimNotifications(rpcClient, {
      restaurantId: row.restaurant_id,
      from: null,
      to: null,
      source: "shift_change",
      changeLogId,
    });

    if (claims.length === 0) {
      // Already sent, or an open shift with nobody to tell.
      return new Response(JSON.stringify({ sent: 0, failed: 0, alreadyNotified: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const { data: restaurant, error: restError } = await serviceClient
      .from("restaurants")
      .select("name, timezone")
      .eq("id", row.restaurant_id)
      .maybeSingle();
    if (restError) {
      throw new Error(`Failed to fetch restaurant: ${restError.message}`);
    }

    // Steps 6-8: derive the message from the claimed rows alone, then send.
    // safeTz guards an invalid stored value, not just an empty one.
    const outcomes = await deliverClaimed(
      claims,
      makeDeliverDeps({
        serviceClient,
        restaurantId: row.restaurant_id,
        restaurantName: restaurant?.name ?? "EasyShiftHQ",
        timeZone: safeTz(restaurant?.timezone),
        resendApiKey: RESEND_API_KEY,
        channels: { email: true, push: true },
      }),
    );

    const sent = outcomes.filter((o) => o.status === "sent").length;
    const failed = outcomes.length - sent;

    // notified_at is a record now, not the latch: the first send that reached
    // somebody stamps it.
    if (sent > 0) {
      const { error: stampError } = await serviceClient
        .from("schedule_change_logs")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", changeLogId)
        .is("notified_at", null);
      if (stampError) {
        console.error(`notify-shift-changed: failed to stamp notified_at on ${changeLogId}`, stampError);
      }
    }

    // Step 9. Reached nobody: 502, and the failed rows stay pending.
    return new Response(JSON.stringify({ sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: sent === 0 && failed > 0 ? 502 : 200,
    });
  } catch (error: unknown) {
    console.error("Error in notify-shift-changed:", error);
    const message = error instanceof Error ? error.message : "An error occurred";
    return errorResponse(message, message === "Access denied" ? 403 : 500);
  }
});

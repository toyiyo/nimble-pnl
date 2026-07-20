import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, NOTIFICATION_FROM } from "../_shared/notificationHelpers.ts";
import { sendWebPushToUser } from "../_shared/webPushHelper.ts";
import { resolveChannels, type SupabaseLike } from "../_shared/resolveChannels.ts";
import { buildClaimNotificationContent, type ClaimAction } from "../_shared/openShiftClaimNotify.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMPLOYEE_SHIFTS_ROUTE = "/employee/shifts";

interface RequestBody {
  claimId: string;
  action: ClaimAction;
}

// Format a DATE ('2026-07-25') as a local long date without any timezone cast.
const formatLocalDate = (isoDate: string): string => {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); // UTC constructor + UTC getters = no tz shift
  return dt.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // JWT client only for auth.getUser(); admin client for all data + push reads.
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { claimId, action }: RequestBody = await req.json();
    if (!claimId || (action !== "approved" && action !== "rejected")) {
      return new Response(JSON.stringify({ error: "claimId and action ('approved'|'rejected') are required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
    }

    // Fetch the claim + joins via admin (RLS would zero out the employee's own row for a manager caller).
    const { data: claim, error: claimError } = await admin
      .from("open_shift_claims")
      .select(`
        id, restaurant_id, shift_date, reviewer_note,
        shift_template:shift_templates(name, start_time, end_time, position),
        employee:employees!claimed_by_employee_id(name, email, user_id),
        restaurant:restaurants(name)
      `)
      .eq("id", claimId)
      .single();

    if (claimError || !claim) {
      return new Response(JSON.stringify({ error: "Claim not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 });
    }

    // Caller must be an owner/manager of this claim's restaurant.
    const { data: membership } = await admin
      .from("user_restaurants")
      .select("role")
      .eq("user_id", user.id)
      .eq("restaurant_id", claim.restaurant_id)
      .maybeSingle();
    if (!membership || !["owner", "manager"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 });
    }

    const tmpl = claim.shift_template as unknown as { name: string; start_time: string; end_time: string; position: string } | null;
    const emp = claim.employee as unknown as { name: string; email: string | null; user_id: string | null } | null;
    const rest = claim.restaurant as unknown as { name: string } | null;

    const content = buildClaimNotificationContent({
      action,
      employeeName: emp?.name ?? "there",
      templateName: tmpl?.name ?? "your shift",
      position: tmpl?.position ?? "—",
      shiftDateLocal: formatLocalDate(claim.shift_date),
      startTime: tmpl?.start_time ?? "",
      endTime: tmpl?.end_time ?? "",
      restaurantName: rest?.name ?? "Your Restaurant",
      reviewerNote: claim.reviewer_note ?? null,
    });

    const ch = await resolveChannels(admin as unknown as SupabaseLike, claim.restaurant_id, "open_shift_claim_reviewed");

    let emailSent = false;
    let pushSent = 0;

    if (ch.email && RESEND_API_KEY && emp?.email) {
      try {
        emailSent = await sendEmail(RESEND_API_KEY, NOTIFICATION_FROM, emp.email, content.subject, content.emailHtml);
      } catch (e) {
        console.error("Claim notify email failed:", e);
      }
    }

    if (ch.push && emp?.user_id) {
      try {
        const r = await sendWebPushToUser(admin, emp.user_id, claim.restaurant_id, {
          title: content.heading,
          body: content.pushBody,
          url: EMPLOYEE_SHIFTS_ROUTE,
          tag: `claim-${action}-${claimId}`,
        });
        pushSent = r.sent;
      } catch (e) {
        console.error("Claim notify push failed:", e);
      }
    }

    return new Response(JSON.stringify({ success: true, emailSent, pushSent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
  } catch (error: unknown) {
    console.error("Error in notify-open-shift-claim:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "An error occurred" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});

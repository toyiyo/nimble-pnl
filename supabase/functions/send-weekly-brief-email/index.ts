import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface BriefRow {
  id: string;
  restaurant_id: string;
  brief_week_end: string;
  email_sent_at: string | null;
  metrics_json: Record<string, number>;
  variances_json: Array<{
    metric: string;
    value: number;
    direction: string;
    flag: string | null;
    delta_pct_vs_prior: number | null;
  }>;
  inbox_summary_json: {
    open_count?: number;
    critical_count?: number;
  };
  narrative: string | null;
  recommendations_json: Array<{
    title: string;
    body: string;
    impact: string;
    effort: string;
  }>;
}

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth guard: only allow calls with the service role key
    const authHeader = req.headers.get("Authorization");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (authHeader !== `Bearer ${serviceRoleKey}`) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceRoleKey
    );

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY is not configured");
    }

    const { restaurant_id, brief_week_end } = await req.json();
    if (!restaurant_id || !brief_week_end) {
      return jsonResponse({ success: false, error: "restaurant_id and brief_week_end required" }, 400);
    }

    // Fetch the brief
    const { data: brief, error: briefError } = await supabase
      .from("weekly_brief")
      .select("*")
      .eq("restaurant_id", restaurant_id)
      .eq("brief_week_end", brief_week_end)
      .maybeSingle();

    if (briefError) throw new Error(`Failed to fetch brief: ${briefError.message}`);
    if (!brief) {
      return jsonResponse({ success: false, error: "No brief found for this week" }, 404);
    }

    const typedBrief = brief as BriefRow;

    // Already sent?
    if (typedBrief.email_sent_at) {
      return jsonResponse({ success: true, message: "Email already sent" });
    }

    // Fetch opted-in users
    const { data: prefs, error: prefError } = await supabase
      .from("notification_preferences")
      .select("user_id")
      .eq("restaurant_id", restaurant_id)
      .eq("weekly_brief_email", true);

    if (prefError) throw new Error(`Failed to fetch prefs: ${prefError.message}`);
    if (!prefs || prefs.length === 0) {
      return jsonResponse({ success: true, message: "No opted-in users" });
    }

    // Fetch user emails from profiles
    const userIds = prefs.map((p: { user_id: string }) => p.user_id);
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("user_id, email, full_name")
      .in("user_id", userIds);

    if (profileError) throw new Error(`Failed to fetch profiles: ${profileError.message}`);
    if (!profiles || profiles.length === 0) {
      return jsonResponse({ success: true, message: "No user profiles found" });
    }

    // Fetch restaurant name
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("name")
      .eq("id", restaurant_id)
      .single();

    const restaurantName = restaurant?.name || "Your Restaurant";

    // Build email HTML
    const emailHtml = buildEmailHtml(typedBrief, restaurantName);

    // Build final HTML and subject once (not per-user)
    const appUrl = Deno.env.get("APP_URL") || "https://app.easyshifthq.com";
    const viewBriefUrl = `${appUrl}/weekly-brief?date=${typedBrief.brief_week_end}`;
    const finalHtml = emailHtml.replace("{{VIEW_BRIEF_URL}}", viewBriefUrl);
    const subject = `Weekly Brief — ${restaurantName} — ${formatWeekRange(typedBrief.brief_week_end)}`;

    // Build email payloads for all valid recipients
    const emailPayloads = profiles
      .filter((p: { email?: string }) => !!p.email)
      .map((p: { email: string }) => ({
        from: "EasyShiftHQ <briefs@easyshifthq.com>",
        to: [p.email],
        subject,
        html: finalHtml,
      }));

    if (emailPayloads.length === 0) {
      return jsonResponse({ success: true, message: "No valid email addresses", sentCount: 0 });
    }

    // Send in batches of 100 using Resend's batch API
    const BATCH_SIZE = 100;
    let sentCount = 0;

    for (let i = 0; i < emailPayloads.length; i += BATCH_SIZE) {
      const batch = emailPayloads.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(batch),
        });

        if (res.ok) {
          sentCount += batch.length;
          console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: sent ${batch.length} emails`);
        } else {
          const errText = await res.text();
          console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, errText);
        }
      } catch (batchErr) {
        console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, batchErr);
      }
    }

    // Update email_sent_at
    if (sentCount > 0) {
      const { error: updateError } = await supabase
        .from("weekly_brief")
        .update({ email_sent_at: new Date().toISOString() })
        .eq("id", typedBrief.id);
      if (updateError) {
        console.error(`Failed to update email_sent_at for brief ${typedBrief.id}:`, updateError.message);
      }
    }

    return jsonResponse({ success: true, sentCount, totalRecipients: profiles.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Fatal error in send-weekly-brief-email:", message);
    return jsonResponse({ success: false, error: "Internal server error" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Email HTML builder
// ---------------------------------------------------------------------------

function formatWeekRange(weekEndStr: string): string {
  const [year, month, day] = weekEndStr.split("-").map(Number);
  const weekEnd = new Date(year, month - 1, day);
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 6);
  const startStr = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr = weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${startStr} – ${endStr}`;
}

function fmtCurrency(val: number | undefined): string {
  if (val === undefined || val === null) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
}

function fmtPct(val: number | undefined): string {
  if (val === undefined || val === null) return "0%";
  return `${Number(val).toFixed(1)}%`;
}

function deltaColor(direction: string, metric: string): string {
  const upIsGood = metric === "net_revenue" || metric === "gross_profit";
  if (direction === "flat") return "#6b7280";
  if (direction === "up") return upIsGood ? "#059669" : "#dc2626";
  return upIsGood ? "#dc2626" : "#059669";
}

function deltaArrow(direction: string): string {
  if (direction === "up") return "&#9650;";
  if (direction === "down") return "&#9660;";
  return "&#8212;";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildEmailHtml(brief: BriefRow, restaurantName: string): string {
  const m = brief.metrics_json;
  const variances = brief.variances_json || [];

  // Hero metrics
  const heroKeys = [
    { key: "net_revenue", label: "Revenue", format: "currency" },
    { key: "food_cost_pct", label: "Food Cost %", format: "pct" },
    { key: "labor_cost_pct", label: "Labor Cost %", format: "pct" },
    { key: "prime_cost_pct", label: "Prime Cost %", format: "pct" },
  ];

  const metricCells = heroKeys
    .map((h) => {
      const val = m[h.key];
      const formatted = h.format === "currency" ? fmtCurrency(val) : fmtPct(val);
      const variance = variances.find((v) => v.metric === h.key);
      const dir = variance?.direction || "flat";
      const dPct = variance?.delta_pct_vs_prior;
      const color = deltaColor(dir, variance?.metric || h.key);
      const arrow = deltaArrow(dir);
      const deltaStr = dPct != null ? `${dPct > 0 ? "+" : ""}${Number(dPct).toFixed(1)}%` : "";

      return `<td style="padding:12px 8px;text-align:center;width:25%;vertical-align:top;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:4px;">${h.label}</div>
        <div style="font-size:22px;font-weight:600;color:#111827;">${formatted}</div>
        ${deltaStr ? `<div style="font-size:11px;color:${color};margin-top:2px;">${arrow} ${deltaStr}</div>` : ""}
      </td>`;
    })
    .join("");

  // Inbox items
  const inbox = brief.inbox_summary_json;
  const inboxLine =
    (inbox?.open_count ?? 0) > 0
      ? `<p style="font-size:13px;color:#6b7280;margin-top:16px;">${inbox!.open_count} open items${
          (inbox!.critical_count ?? 0) > 0 ? ` (${inbox!.critical_count} critical)` : ""
        }</p>`
      : "";

  // Recommendations
  const recs = (brief.recommendations_json || []).slice(0, 3);
  const recsHtml =
    recs.length > 0
      ? `<div style="margin-top:24px;">
          <div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:8px;">Top Actions</div>
          <ul style="padding-left:20px;margin:0;">
            ${recs.map((r) => `<li style="font-size:13px;color:#374151;margin-bottom:6px;"><strong>${escapeHtml(r.title)}</strong> — ${escapeHtml(r.body)}</li>`).join("")}
          </ul>
        </div>`
      : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <!-- Header -->
        <tr><td style="padding:24px 24px 16px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">Weekly Brief</div>
          <div style="font-size:17px;font-weight:600;color:#111827;margin-top:4px;">${restaurantName}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:2px;">${formatWeekRange(brief.brief_week_end)}</div>
        </td></tr>
        <!-- Metrics -->
        <tr><td style="padding:0 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <tr>${metricCells}</tr>
          </table>
        </td></tr>
        <!-- Narrative -->
        ${
          brief.narrative
            ? `<tr><td style="padding:20px 24px 0;">
                <div style="font-size:14px;line-height:1.6;color:#374151;background:#f9fafb;border-radius:8px;padding:16px;">
                  ${escapeHtml(brief.narrative)}
                </div>
              </td></tr>`
            : ""
        }
        <!-- Recommendations + Inbox -->
        <tr><td style="padding:0 24px;">
          ${recsHtml}
          ${inboxLine}
        </td></tr>
        <!-- CTA -->
        <tr><td style="padding:24px;text-align:center;">
          <a href="{{VIEW_BRIEF_URL}}" style="display:inline-block;background:#111827;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:500;">
            View Full Brief
          </a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;">
          <div style="font-size:11px;color:#9ca3af;text-align:center;">
            Sent by EasyShiftHQ. Manage preferences in Settings.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

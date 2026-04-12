import { generateHeader } from '../_shared/emailTemplates.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, NOTIFICATION_FROM, APP_URL } from "../_shared/notificationHelpers.ts";
import { sendWebPushToUser } from "../_shared/webPushHelper.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

interface BroadcastPayload {
  restaurant_id: string;
  publication_id: string;
}

serve(async (req) => {
  // Handle CORS preflight
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
    const payload: BroadcastPayload = await req.json();
    const { restaurant_id, publication_id } = payload;

    if (!restaurant_id || !publication_id) {
      return new Response(
        JSON.stringify({ error: "restaurant_id and publication_id are required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Verify caller is owner/manager
    const { data: userRestaurant, error: permError } = await supabase
      .from("user_restaurants")
      .select("role")
      .eq("user_id", user.id)
      .eq("restaurant_id", restaurant_id)
      .single();

    if (permError || !userRestaurant || !["owner", "manager"].includes(userRestaurant.role)) {
      throw new Error("Access denied");
    }

    // Create service role client for subsequent operations
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Fetch the publication
    const { data: publication, error: pubError } = await serviceClient
      .from("schedule_publications")
      .select("id, restaurant_id, week_start_date, week_end_date")
      .eq("id", publication_id)
      .eq("restaurant_id", restaurant_id)
      .single();

    if (pubError || !publication) {
      return new Response(
        JSON.stringify({ error: "Publication not found" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        }
      );
    }

    // Call get_open_shifts RPC to check for open shifts
    const { data: openShifts, error: openShiftsError } = await serviceClient
      .rpc("get_open_shifts", {
        p_restaurant_id: restaurant_id,
        p_week_start: publication.week_start_date,
        p_week_end: publication.week_end_date,
      });

    if (openShiftsError) {
      console.error("Error fetching open shifts:", openShiftsError);
      throw new Error("Failed to fetch open shifts");
    }

    // Sum up open spots across all shifts
    const totalOpenSpots = (openShifts || []).reduce(
      (sum: number, shift: { open_spots: number }) => sum + Number(shift.open_spots),
      0
    );

    if (totalOpenSpots === 0) {
      return new Response(
        JSON.stringify({ error: "No open shifts available for this week" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Format dates for notification body
    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr + "T00:00:00");
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    };

    const weekStartFormatted = formatDate(publication.week_start_date);
    const weekEndFormatted = formatDate(publication.week_end_date);
    const dateRange = `${weekStartFormatted} - ${weekEndFormatted}`;

    const shiftWord = totalOpenSpots === 1 ? "shift is" : "shifts are";
    const notificationBody = `${totalOpenSpots} ${shiftWord} open for the week of ${dateRange}. Claim a spot!`;

    // Fetch all active employees for the restaurant
    const { data: employees, error: empError } = await serviceClient
      .from("employees")
      .select("id, name, email, user_id")
      .eq("restaurant_id", restaurant_id)
      .eq("status", "active");

    if (empError) {
      console.error("Error fetching employees:", empError);
      throw new Error("Failed to fetch employees");
    }

    const allEmployees = employees || [];
    let pushSentCount = 0;
    let pushFailCount = 0;
    let emailSentCount = 0;
    let emailFailCount = 0;

    // Send web push notifications to employees with user_id
    const pushEmployees = allEmployees.filter((emp) => emp.user_id);
    for (const employee of pushEmployees) {
      try {
        const result = await sendWebPushToUser(serviceClient, employee.user_id!, restaurant_id, {
          title: "Shifts Available",
          body: notificationBody,
          url: "/employee/shifts",
        });
        pushSentCount += result.sent;
      } catch (err) {
        pushFailCount++;
        console.error(`Push notification failed for employee ${employee.id}:`, err);
      }
    }

    // Send email notifications to employees with email
    if (RESEND_API_KEY) {
      const emailEmployees = allEmployees.filter((emp) => emp.email);
      const appUrl = `${APP_URL}/employee/shifts`;

      for (const employee of emailEmployees) {
        try {
          const subject = `${totalOpenSpots} Open Shift${totalOpenSpots === 1 ? "" : "s"} Available — ${dateRange}`;
          const html = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
              ${generateHeader()}

              <!-- Content -->
              <div style="padding: 40px 32px; background-color: #ffffff;">
                <h1 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0; line-height: 1.3;">Shifts Available</h1>

                <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
                  Hi <strong style="color: #1f2937;">${employee.name}</strong>,
                </p>

                <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
                  <strong style="color: #1f2937;">${totalOpenSpots} ${shiftWord}</strong> open for the week of <strong style="color: #1f2937;">${dateRange}</strong>. Claim a spot before they fill up!
                </p>

                <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); padding: 24px; border-radius: 12px; margin: 24px 0; border-left: 4px solid #3b82f6;">
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 6px 0; color: #4b5563; font-size: 14px; font-weight: 600;">Open Shifts:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${totalOpenSpots}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; color: #4b5563; font-size: 14px; font-weight: 600;">Week:</td>
                      <td style="padding: 6px 0; color: #1f2937; font-size: 14px; text-align: right;">${dateRange}</td>
                    </tr>
                  </table>
                </div>

                <div style="text-align: center; margin: 32px 0;">
                  <a href="${appUrl}"
                     style="background-color: #2563eb; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3); mso-padding-alt: 14px 32px; border: 2px solid #2563eb;">
                    <span style="color: #ffffff !important;">View Open Shifts</span>
                  </a>
                </div>

                <p style="color: #6b7280; font-size: 14px; margin: 32px 0 0 0; line-height: 1.6;">
                  Open shifts are available on a first-come, first-served basis. Claim yours before they're taken!
                </p>
              </div>

              <!-- Footer -->
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

          const success = await sendEmail(RESEND_API_KEY, NOTIFICATION_FROM, employee.email!, subject, html);
          if (success) {
            emailSentCount++;
          } else {
            emailFailCount++;
          }
        } catch (err) {
          emailFailCount++;
          console.error(`Email failed for employee ${employee.id}:`, err);
        }
      }
    }

    // Stamp the publication with broadcast timestamp and user
    const { error: updateError } = await serviceClient
      .from("schedule_publications")
      .update({
        open_shifts_broadcast_at: new Date().toISOString(),
        open_shifts_broadcast_by: user.id,
      })
      .eq("id", publication_id);

    if (updateError) {
      console.error("Error updating publication broadcast timestamp:", updateError);
    }

    console.log(
      `Broadcast open shifts: ${pushSentCount} push, ${emailSentCount} email sent for publication ${publication_id}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        open_shifts: totalOpenSpots,
        push_sent: pushSentCount,
        push_failed: pushFailCount,
        email_sent: emailSentCount,
        email_failed: emailFailCount,
        total_employees: allEmployees.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: unknown) {
    console.error("Error in broadcast-open-shifts:", error);
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

import { generateHeader } from '../_shared/emailTemplates.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

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
      .select("name")
      .eq("id", restaurantId)
      .single();

    if (restError || !restaurant) {
      throw new Error("Restaurant not found");
    }

    // Get all employees for this restaurant
    const { data: employees, error: empError } = await supabase
      .from("employees")
      .select("id, name, email, user_id")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active");

    if (empError) {
      throw new Error("Failed to fetch employees");
    }

    // Get shifts for this publication to determine which employees are scheduled
    const { data: shifts, error: shiftsError } = await supabase
      .from("shifts")
      .select("employee_id")
      .eq("restaurant_id", restaurantId)
      .gte("start_time", `${weekStart}T00:00:00Z`)
      .lte("start_time", `${weekEnd}T23:59:59Z`)
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

    // App URL for the button
    const appUrl = "https://app.easyshifthq.com/employee/schedule";

    // Send email notifications using Resend
    const emailPromises = scheduledEmployees
      .filter((emp) => emp.email) // Only send to employees with email
      .map(async (employee) => {
        const emailPayload = {
          from: "EasyShiftHQ <notifications@easyshifthq.com>",
          to: employee.email,
          subject: `New Schedule Published: ${weekStartFormatted} - ${weekEndFormatted}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
              ${generateHeader()}
              
              <!-- Content -->
              <div style="padding: 40px 32px; background-color: #ffffff;">
                <h1 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 16px 0; line-height: 1.3;">New Schedule Published</h1>
                
                <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
                  Hi <strong style="color: #1f2937;">${employee.name}</strong>,
                </p>
                
                <p style="color: #4b5563; line-height: 1.6; font-size: 16px; margin: 0 0 24px 0;">
                  Your schedule for <strong style="color: #1f2937;">${weekStartFormatted} - ${weekEndFormatted}</strong> has been published at <strong style="color: #1f2937;">${restaurant.name}</strong>.
                </p>
                
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
          `,
        };

        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify(emailPayload),
        });

        if (!response.ok) {
          const error = await response.text();
          console.error(`Failed to send email to ${employee.email}:`, error);
          return { success: false, email: employee.email, error };
        }

        return { success: true, email: employee.email };
      });

    // Wait for all emails to be sent
    const results = await Promise.allSettled(emailPromises);

    // Count successes and failures
    const successCount = results.filter(
      (r) => r.status === "fulfilled" && r.value.success
    ).length;
    const failureCount = results.length - successCount;

    // Send push notifications to all scheduled employees
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const pushPromises = scheduledEmployees
      .filter((emp) => emp.user_id)
      .map((employee) =>
        fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            user_id: employee.user_id,
            title: "Schedule Updated",
            body: "A new schedule has been published",
            data: { route: "/employee/schedule" },
          }),
        }).catch((e) => console.error(`Push notification failed for employee ${employee.id}:`, e))
      );
    await Promise.allSettled(pushPromises);

    // Update the publication record to mark notifications as sent
    await supabase
      .from("schedule_publications")
      .update({ notification_sent: true })
      .eq("id", publicationId);

    // Log notification activity
    console.log(
      `Sent ${successCount} notifications, ${failureCount} failed for publication ${publicationId}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        sent: successCount,
        failed: failureCount,
        totalEmployees: scheduledEmployees.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
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
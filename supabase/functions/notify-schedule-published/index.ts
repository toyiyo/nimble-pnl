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
      .select("id, name, email")
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
      .gte("start_time", weekStart)
      .lte("start_time", weekEnd)
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

    // Send email notifications using Resend
    const emailPromises = scheduledEmployees
      .filter((emp) => emp.email) // Only send to employees with email
      .map(async (employee) => {
        const emailPayload = {
          from: "EasyShiftHQ <notifications@easyshifthq.com>",
          to: employee.email,
          subject: `New Schedule Published: ${weekStartFormatted} - ${weekEndFormatted}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2563eb;">New Schedule Published</h2>
              <p>Hi ${employee.name},</p>
              <p>Your schedule for <strong>${weekStartFormatted} - ${weekEndFormatted}</strong> has been published at ${restaurant.name}.</p>
              <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; font-size: 14px; color: #6b7280;">
                  Log in to EasyShiftHQ to view your complete schedule and shift details.
                </p>
              </div>
              <p style="font-size: 14px; color: #6b7280;">
                If you have any questions or concerns about your schedule, please contact your manager.
              </p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;" />
              <p style="font-size: 12px; color: #9ca3af;">
                This is an automated notification from EasyShiftHQ. Please do not reply to this email.
              </p>
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
  } catch (error) {
    console.error("Error in notify-schedule-published:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "An error occurred",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

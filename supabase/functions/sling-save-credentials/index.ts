import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from "../_shared/encryption.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { restaurantId, email, password } = await req.json();

    if (!restaurantId || !email || !password) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: restaurantId, email, password" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify user has permission (owner/manager only)
    const { data: userRestaurant } = await supabase
      .from("user_restaurants")
      .select("role")
      .eq("user_id", user.id)
      .eq("restaurant_id", restaurantId)
      .single();

    if (
      !userRestaurant ||
      !["owner", "manager"].includes(userRestaurant.role)
    ) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Encrypt the password
    const encryption = await getEncryptionService();
    const encryptedPassword = await encryption.encrypt(password);

    // Upsert connection
    const { data: connection, error: upsertError } = await supabase
      .from("sling_connections")
      .upsert(
        {
          restaurant_id: restaurantId,
          email,
          password_encrypted: encryptedPassword,
          is_active: true,
          connection_status: "pending",
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "restaurant_id",
        }
      )
      .select()
      .single();

    if (upsertError) {
      throw new Error(
        `Failed to save credentials: ${upsertError.message}`
      );
    }

    await logSecurityEvent(
      supabase,
      "SLING_CREDENTIALS_SAVED",
      user.id,
      restaurantId,
      { email }
    );

    return new Response(JSON.stringify({ success: true, connection }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error saving Sling credentials:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

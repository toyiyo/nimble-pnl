import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from "../_shared/encryption.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";
import { corsHeaders } from "../_shared/cors.ts";

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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // User client for auth verification (anon key + user JWT)
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service client for privileged data operations (bypasses RLS)
    const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
    } = await userSupabase.auth.getUser();
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
    const { data: userRestaurant } = await userSupabase
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

    // Upsert connection (using service role for privileged write)
    const { data: connection, error: upsertError } = await serviceSupabase
      .from("sling_connections")
      .upsert(
        {
          restaurant_id: restaurantId,
          email,
          password_encrypted: encryptedPassword,
          auth_token: null,
          token_fetched_at: null,
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
      serviceSupabase,
      "SLING_CREDENTIALS_SAVED",
      user.id,
      restaurantId,
      { email }
    );

    return new Response(
      JSON.stringify({
        success: true,
        connection: {
          id: connection.id,
          restaurant_id: connection.restaurant_id,
          email: connection.email,
          is_active: connection.is_active,
          connection_status: connection.connection_status,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error saving Sling credentials:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

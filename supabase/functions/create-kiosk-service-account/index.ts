import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RequestBody = {
  restaurantId?: string;
  rotate?: boolean;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const generatePassword = () => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 18);
};

const generateEmail = (restaurantId: string) => {
  const slug = restaurantId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "location";
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `kiosk+${slug}-${suffix}@easyshifthq.com`;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: authUser, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authUser?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as RequestBody;
    const restaurantId = body.restaurantId;
    const rotate = body.rotate ?? true;

    if (!restaurantId) {
      return new Response(JSON.stringify({ error: "restaurantId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Confirm caller is owner/manager on this restaurant
    const { data: membership, error: membershipError } = await supabase
      .from("user_restaurants")
      .select("role")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", authUser.user.id)
      .maybeSingle();

    if (membershipError || !membership || !["owner", "manager"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If a kiosk account exists, optionally rotate credentials by deleting it
    const { data: existingAccount } = await supabase
      .from("kiosk_service_accounts")
      .select("user_id, email")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (existingAccount) {
      if (!rotate) {
        return new Response(
          JSON.stringify({
            error: "Service account already exists. Pass rotate=true to regenerate new credentials.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      await supabase.auth.admin.deleteUser(existingAccount.user_id);
      await supabase.from("kiosk_service_accounts").delete().eq("restaurant_id", restaurantId);
    }

    const email = generateEmail(restaurantId);
    const password = generatePassword();

    const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        role: "kiosk",
        restaurant_id: restaurantId,
        kind: "kiosk-service",
      },
      user_metadata: {
        restaurant_id: restaurantId,
        created_by: authUser.user.id,
        type: "kiosk-service-account",
      },
    });

    if (createError || !createdUser?.user) {
      return new Response(JSON.stringify({ error: createError?.message || "Failed to create user" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: linkError } = await supabase.from("user_restaurants").upsert(
      {
        user_id: createdUser.user.id,
        restaurant_id: restaurantId,
        role: "kiosk",
      },
      { onConflict: "user_id,restaurant_id" },
    );
    if (linkError) {
      await supabase.auth.admin.deleteUser(createdUser.user.id);
      return new Response(JSON.stringify({ error: linkError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: recordError } = await supabase.from("kiosk_service_accounts").upsert(
      {
        restaurant_id: restaurantId,
        user_id: createdUser.user.id,
        email,
        created_by: authUser.user.id,
      },
      { onConflict: "restaurant_id" },
    );
    if (recordError) {
      await supabase.auth.admin.deleteUser(createdUser.user.id);
      return new Response(JSON.stringify({ error: recordError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ email, password }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("create-kiosk-service-account error", error);
    return new Response(JSON.stringify({ error: "Unexpected error creating kiosk service account" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

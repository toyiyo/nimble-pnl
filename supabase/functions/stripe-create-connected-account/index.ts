import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@20.1.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { handleCreateConnectedAccount } from "../_shared/createConnectedAccountHandler.ts";
import { toErrorResponse } from "../_shared/httpError.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    console.error("[CREATE-CONNECTED-ACCOUNT] Error: Stripe secret key not configured");
    const { status, body } = toErrorResponse(new Error("Stripe secret key not configured"));
    return new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });
  }

  // Auth client with the anon key. It only looks up the caller.
  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  // Service-role client. It verifies access and manages data.
  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const stripe = new Stripe(stripeKey, {
    apiVersion: "2025-08-27.basil" as any,
  });

  return handleCreateConnectedAccount(req, {
    stripe,
    db,
    getUser: (token) => supabaseClient.auth.getUser(token),
    allowedOriginsEnv: Deno.env.get("OAUTH_ALLOWED_ORIGINS"),
    corsHeaders,
  });
});

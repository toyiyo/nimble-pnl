import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from "../_shared/encryption.ts";
import {
  slingLogin,
  slingApiGet,
  fetchSlingUsers,
} from "../_shared/slingApiClient.ts";

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

    // User JWT client for auth checks
    const userSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service role client for data operations (bypasses RLS)
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

    const { restaurantId, slingOrgId } = await req.json();

    if (!restaurantId) {
      return new Response(
        JSON.stringify({ error: "Missing restaurantId" }),
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

    // Get connection using service role (to read encrypted password)
    const { data: connection, error: connectionError } = await serviceSupabase
      .from("sling_connections")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .single();

    if (connectionError || !connection) {
      return new Response(
        JSON.stringify({ error: "No Sling connection found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Decrypt password and login to Sling
    const encryption = await getEncryptionService();
    const password = await encryption.decrypt(connection.password_encrypted);
    const token = await slingLogin(connection.email, password);

    // If no org selected yet, fetch session to get org list
    if (!slingOrgId) {
      const sessionData = await slingApiGet(token, "/account/session");

      // Extract orgs from session response
      // Session response includes the user object with their orgs
      const orgs: Array<{ id: number; name: string }> = [];

      if (sessionData?.orgs && Array.isArray(sessionData.orgs)) {
        for (const org of sessionData.orgs) {
          orgs.push({ id: org.id, name: org.name || `Org ${org.id}` });
        }
      } else if (sessionData?.org) {
        // Single org format
        orgs.push({
          id: sessionData.org.id,
          name: sessionData.org.name || `Org ${sessionData.org.id}`,
        });
      }

      if (orgs.length === 0) {
        throw new Error(
          "No Sling organizations found for this account"
        );
      }

      // If multiple orgs, ask frontend to pick
      if (orgs.length > 1) {
        // Save token while we wait for org selection
        await serviceSupabase
          .from("sling_connections")
          .update({
            auth_token: token,
            token_fetched_at: new Date().toISOString(),
          })
          .eq("id", connection.id);

        return new Response(
          JSON.stringify({ needsOrgSelection: true, orgs }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      // Auto-select the single org — fall through with its ID
      return await completeConnection(
        serviceSupabase,
        connection,
        token,
        orgs[0].id,
        orgs[0].name
      );
    }

    // Org already selected — complete connection setup
    // Fetch org name from session if we don't have it
    let orgName = connection.sling_org_name || "";
    if (!orgName) {
      try {
        const sessionData = await slingApiGet(token, "/account/session");
        const matchedOrg = sessionData?.orgs?.find(
          (o: any) => o.id === slingOrgId
        );
        orgName = matchedOrg?.name || sessionData?.org?.name || `Org ${slingOrgId}`;
      } catch {
        orgName = `Org ${slingOrgId}`;
      }
    }

    return await completeConnection(
      serviceSupabase,
      connection,
      token,
      slingOrgId,
      orgName
    );
  } catch (error: any) {
    console.error("Error testing Sling connection:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function completeConnection(
  serviceSupabase: any,
  connection: any,
  token: string,
  orgId: number,
  orgName: string
): Promise<Response> {
  // Fetch all users from Sling
  const slingUsers = await fetchSlingUsers(token);

  // Upsert users into sling_users table
  if (slingUsers.length > 0) {
    const userRows = slingUsers.map((u: any) => ({
      restaurant_id: connection.restaurant_id,
      sling_user_id: u.id,
      name: u.name || u.legalName || "",
      lastname: u.lastname || "",
      email: u.email || "",
      position: "",
      is_active: u.active !== false,
      raw_json: u,
      updated_at: new Date().toISOString(),
    }));

    const { error: usersError } = await serviceSupabase
      .from("sling_users")
      .upsert(userRows, {
        onConflict: "restaurant_id,sling_user_id",
      });

    if (usersError) {
      console.error("Error upserting Sling users:", usersError);
    }
  }

  // Update connection with token, org info, and connected status
  const { error: updateError } = await serviceSupabase
    .from("sling_connections")
    .update({
      auth_token: token,
      token_fetched_at: new Date().toISOString(),
      sling_org_id: orgId,
      sling_org_name: orgName,
      connection_status: "connected",
      last_error: null,
      last_error_at: null,
    })
    .eq("id", connection.id);

  if (updateError) {
    console.error("Error updating Sling connection:", updateError);
  }

  return new Response(
    JSON.stringify({
      success: true,
      orgName,
      usersCount: slingUsers.length,
    }),
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
        "Content-Type": "application/json",
      },
    }
  );
}

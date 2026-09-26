// Remote MCP server for the Claude connector. The logic is in
// ../_shared/mcpHandler.ts. This file connects the handler to Supabase and fetch.
//
// JWT verification is off in config.toml because the handler must answer
// 401 with a WWW-Authenticate header (MCP clients use it to find the OAuth
// server) and must serve the protected resource metadata without auth. The
// handler checks every JSON-RPC call with auth.getUser, and all data reads
// run under the caller's JWT, so RLS applies.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleMcpRequest, type McpDeps, type Membership } from '../_shared/mcpHandler.ts';

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`mcp: missing required env ${name}`);
  return value;
}

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_ANON_KEY = requireEnv('SUPABASE_ANON_KEY');
// The edge runtime can see an internal SUPABASE_URL (local dev). The public
// URLs that Claude uses can be set explicitly.
const PUBLIC_BASE_URL = (Deno.env.get('MCP_PUBLIC_SUPABASE_URL') ?? SUPABASE_URL).replace(/\/+$/, '');
const RESOURCE_URL = Deno.env.get('MCP_PUBLIC_URL') ?? `${PUBLIC_BASE_URL}/functions/v1/mcp`;
const AUTH_ISSUER = Deno.env.get('MCP_AUTH_ISSUER') ?? `${PUBLIC_BASE_URL}/auth/v1`;
const FORWARD_TIMEOUT_MS = 25_000;
// A larger forward body is not parsed. The handler cuts tool text to 40 KB.
const MAX_FORWARD_BODY_CHARS = 2_000_000;
const EXECUTE_TOOL_URL = `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/ai-execute-tool`;

// auth.getUser(token) sends the token itself, so one shared client is enough.
const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function userClient(token: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const deps: McpDeps = {
  resourceUrl: RESOURCE_URL,
  authIssuer: AUTH_ISSUER,

  async getUser(token) {
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id };
  },

  async listMemberships(token, userId) {
    const { data, error } = await userClient(token)
      .from('user_restaurants')
      .select('restaurant_id, role, restaurant:restaurants(name)')
      .eq('user_id', userId);
    if (error) throw new Error(`user_restaurants read failed: ${error.message}`);
    // The generated client types a to-one embed as an array; PostgREST
    // returns an object. Accept both.
    return (data ?? []).map((row): Membership => {
      const restaurant = Array.isArray(row.restaurant) ? row.restaurant[0] : row.restaurant;
      return {
        restaurant_id: row.restaurant_id,
        role: row.role,
        name: (restaurant as { name?: string | null } | null | undefined)?.name ?? null,
      };
    });
  },

  async executeTool(token, request) {
    const response = await fetch(EXECUTE_TOOL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      // Stay inside the edge function wall-clock limit. A timeout throws, and
      // the handler returns a tool error.
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    const text = await response.text();
    if (text.length > MAX_FORWARD_BODY_CHARS) {
      return {
        status: 413,
        body: { ok: false, error: { message: 'The result is too large. Ask for a shorter period or a narrower filter.' } },
      };
    }
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body };
  },
};

Deno.serve((req) => handleMcpRequest(req, deps));

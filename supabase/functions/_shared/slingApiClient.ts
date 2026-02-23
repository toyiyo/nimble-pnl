import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from "./encryption.ts";

const SLING_API_BASE = "https://api.getsling.com";
const FETCH_TIMEOUT_MS = 20000;

// Type for the connection row from sling_connections table
export interface SlingConnection {
  id: string;
  restaurant_id: string;
  email: string;
  password_encrypted: string;
  auth_token: string | null;
  token_fetched_at: string | null;
  sling_org_id: number | null;
  sling_org_name: string | null;
  initial_sync_done: boolean;
  sync_cursor: number;
  is_active: boolean;
  connection_status: string;
}

function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(id)
  );
}

export async function slingLogin(
  email: string,
  password: string
): Promise<string> {
  const response = await fetchWithTimeout(`${SLING_API_BASE}/account/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "*/*",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Sling login failed (${response.status}): ${errorText}`);
  }

  const authToken = response.headers.get("Authorization");
  if (!authToken) {
    throw new Error(
      "Sling login succeeded but no Authorization token in response headers"
    );
  }

  return authToken;
}

export async function slingApiGet(
  token: string,
  path: string,
  params?: Record<string, string>
): Promise<any> {
  const url = new URL(`${SLING_API_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) =>
      url.searchParams.set(key, value)
    );
  }

  const response = await fetchWithTimeout(url.toString(), {
    method: "GET",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401) {
    throw new Error("SLING_TOKEN_EXPIRED");
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Sling API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function getValidSlingToken(
  connection: SlingConnection,
  supabase: SupabaseClient
): Promise<string> {
  const encryption = await getEncryptionService();

  // If we have a token fetched less than 1 hour ago, decrypt and reuse it
  if (connection.auth_token && connection.token_fetched_at) {
    const tokenAge =
      Date.now() - new Date(connection.token_fetched_at).getTime();
    if (tokenAge < 3600000) {
      return await encryption.decrypt(connection.auth_token);
    }
  }

  // Re-login to get fresh token (only works with password-based auth)
  if (!connection.password_encrypted) {
    throw new Error("Auth token expired. Please re-enter your Sling auth token in settings.");
  }
  const password = await encryption.decrypt(connection.password_encrypted);
  const token = await slingLogin(connection.email, password);

  // Encrypt and save the new token
  const encryptedToken = await encryption.encrypt(token);
  await supabase
    .from("sling_connections")
    .update({
      auth_token: encryptedToken,
      token_fetched_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  return token;
}

export function formatDateInterval(
  startDate: string,
  endDate: string
): string {
  return `${startDate}T00:00:00/${endDate}T23:59:59`;
}

export async function fetchSlingUsers(token: string): Promise<any[]> {
  const users = await slingApiGet(token, "/users/concise");
  return Array.isArray(users) ? users : [];
}

export async function fetchSlingCalendar(
  token: string,
  orgId: number,
  userId: number,
  startDate: string,
  endDate: string
): Promise<any[]> {
  const dates = formatDateInterval(startDate, endDate);
  const events = await slingApiGet(token, `/${orgId}/calendar/${userId}`, {
    dates,
  });
  return Array.isArray(events) ? events : [];
}

export async function fetchSlingTimesheets(
  token: string,
  startDate: string,
  endDate: string
): Promise<any> {
  const dates = formatDateInterval(startDate, endDate);
  return slingApiGet(token, "/reports/timesheets", { dates });
}

// Parse shift events from calendar response (filter out non-shift events)
export function parseSlingShiftEvents(
  events: any[]
): Array<{
  sling_shift_id: number;
  sling_user_id: number | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  break_duration: number;
  position: string;
  location: string;
  status: string;
  raw_json: any;
}> {
  return events
    .filter((e: any) => e.type === "shift" && e.id != null)
    .map((event: any) => ({
      sling_shift_id: event.id,
      sling_user_id: event.user?.id ?? null,
      shift_date: event.dtstart?.split("T")[0] ?? "",
      start_time: event.dtstart,
      end_time: event.dtend,
      break_duration: event.breakDuration ?? 0,
      position: event.position?.name ?? "",
      location: event.location?.name ?? "",
      status: event.status ?? "published",
      raw_json: event,
    }));
}

// Parse timesheet entries to our schema
export function parseSlingTimesheetEntries(
  entries: any[]
): Array<{
  sling_timesheet_id: number;
  sling_shift_id: number | null;
  sling_user_id: number;
  punch_type: string;
  punch_time: string;
  raw_json: any;
}> {
  const results: Array<{
    sling_timesheet_id: number;
    sling_shift_id: number | null;
    sling_user_id: number;
    punch_type: string;
    punch_time: string;
    raw_json: any;
  }> = [];

  for (const entry of entries) {
    if (!entry.id || !entry.user?.id) continue;
    const type = entry.type as string;
    if (!["clock_in", "clock_out", "break_start", "break_end"].includes(type))
      continue;
    results.push({
      sling_timesheet_id: entry.id,
      sling_shift_id: entry.event?.id ?? null,
      sling_user_id: entry.user.id,
      punch_type: type,
      punch_time: entry.timestamp,
      raw_json: entry,
    });
  }

  return results;
}

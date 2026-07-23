import { resolveChannels, type SupabaseLike } from './resolveChannels.ts';

type CreateClientFn = (authHeader: string | null) => {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  from: (table: string) => {
    select: (cols?: string) => {
      eq: (col: string, val: unknown) => {
        eq?: (col: string, val: unknown) => unknown;
        in?: (col: string, vals: unknown[]) => Promise<{ data: unknown; error: unknown }>;
        single: () => Promise<{ data: unknown; error: unknown }>;
        maybeSingle?: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
};

export type SendEmailFn = (
  resendApiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
) => Promise<boolean>;

export interface ReminderDeps {
  createClient: CreateClientFn;
  sendEmail: SendEmailFn;
  appUrl: string;
  resendApiKey: string;
  fromEmail: string;
}

type EmployeeRow = { id: string; name: string; email: string | null; restaurant_id: string };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

export function buildDeps(args: {
  env: Record<string, string | undefined>;
  createClient?: CreateClientFn;
  sendEmail?: SendEmailFn;
}): ReminderDeps {
  const appUrl = args.env.APP_URL;
  const resendApiKey = args.env.RESEND_API_KEY;
  if (!appUrl) throw new Error('APP_URL is not configured');
  if (!resendApiKey) throw new Error('RESEND_API_KEY is not configured');
  return {
    appUrl,
    resendApiKey,
    fromEmail: args.env.NOTIFICATION_FROM ?? 'EasyShiftHQ <notifications@easyshifthq.com>',
    createClient:
      args.createClient ??
      (() => {
        throw new Error('createClient not provided');
      }),
    sendEmail:
      args.sendEmail ??
      (() => {
        throw new Error('sendEmail not provided');
      }),
  };
}

export async function processAvailabilityReminder(
  req: Request,
  deps: ReminderDeps,
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

    const supabase = deps.createClient(authHeader);
    const { data: userRes, error: authErr } = await supabase.auth.getUser();
    if (authErr || !userRes?.user) return json({ error: 'Unauthorized' }, 401);

    const body = (await req.json().catch(() => null)) as
      | { restaurant_id?: string; employee_ids?: string[] }
      | null;
    const restaurantId = body?.restaurant_id;
    const employeeIds = body?.employee_ids ?? [];
    if (!restaurantId || employeeIds.length === 0) {
      return json({ error: 'restaurant_id and employee_ids are required' }, 400);
    }

    const userRes2 = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', userRes.user.id)
      .eq('restaurant_id', restaurantId)
      .single();
    if (userRes2.error) return json({ error: 'Failed to verify access' }, 500);
    const role = (userRes2.data as { role?: string } | null)?.role;
    if (!role || !['owner', 'manager'].includes(role)) {
      return json({ error: 'Access denied' }, 403);
    }

    const restRes = await supabase
      .from('restaurants')
      .select('name')
      .eq('id', restaurantId)
      .single();
    if (restRes.error) return json({ error: 'Failed to load restaurant' }, 500);
    const restaurantName = (restRes.data as { name?: string } | null)?.name ?? 'Your restaurant';

    // `availability_reminder` is email-only in the catalog (see
    // src/lib/notificationTypes.ts) — there is no push variant to gate here.
    const ch = await resolveChannels(supabase as unknown as SupabaseLike, restaurantId, 'availability_reminder');
    if (!ch.email) {
      return json({ sent: 0, skipped_no_email: 0, errors: 0, channel_disabled: true }, 200);
    }

    const empRes = await supabase
      .from('employees')
      .select('id, name, email, restaurant_id')
      .eq('restaurant_id', restaurantId)
      .in('id', employeeIds);
    if (empRes.error) return json({ error: 'Failed to load employees' }, 500);
    const employees = (empRes.data ?? []) as EmployeeRow[];

    let sent = 0;
    let skipped_no_email = 0;
    let errors = 0;

    const results = await Promise.allSettled(
      employees.map(async (emp) => {
        if (!emp.email) {
          skipped_no_email++;
          return;
        }
        const subject = `Set your availability — ${restaurantName}`;
        const html = `
          <p>Hi ${emp.name},</p>
          <p>Your manager is preparing next week's schedule and you don't have availability set in EasyShift yet. Setting your availability helps you get scheduled for the shifts you can actually work.</p>
          <p><a href="${deps.appUrl}/employee/portal">Set yours now</a></p>
          <p>— The ${restaurantName} team</p>
        `;
        const ok = await deps.sendEmail(deps.resendApiKey, deps.fromEmail, emp.email, subject, html);
        if (ok) sent++;
        else errors++;
      }),
    );
    for (const r of results) {
      if (r.status === 'rejected') errors++;
    }

    return json({ sent, skipped_no_email, errors }, 200);
  } catch {
    return json({ error: 'Internal server error' }, 500);
  }
}

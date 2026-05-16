import { generateHeader, escapeHtml } from '../_shared/emailTemplates.ts';
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'https://esm.sh/resend@4.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  restaurantId: string;
  employeeId: string;
  action: 'created' | 'reset';
  actor: 'manager' | 'self';
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    if (!body.restaurantId || !body.employeeId || !body.action || !body.actor) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!['manager', 'self'].includes(body.actor) || !['created', 'reset'].includes(body.action)) {
      return new Response(
        JSON.stringify({ error: 'Invalid actor or action value' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Employees don't need a notification when they reset their own PIN.
    if (body.actor === 'self') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: employee, error: empErr } = await supabase
      .from('employees')
      .select('id, name, email, user_id, restaurant_id')
      .eq('id', body.employeeId)
      .eq('restaurant_id', body.restaurantId)
      .maybeSingle();

    if (empErr || !employee) {
      console.warn('notify-pin-changed: employee not found', {
        empErr,
        employeeId: body.employeeId,
      });
      return new Response(
        JSON.stringify({ ok: true, skipped: 'employee_not_found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('name')
      .eq('id', body.restaurantId)
      .maybeSingle();
    const restaurantName = restaurant?.name ?? 'your restaurant';

    // Push notification (no-op if no device tokens; never throw).
    // send-push-notification verifies the Authorization header equals
    // "Bearer ${SUPABASE_SERVICE_ROLE_KEY}" verbatim, so supabase.functions.invoke
    // (which sends the caller's user JWT) would silently 401. Use raw fetch.
    if (employee.user_id) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            user_id: employee.user_id,
            title: 'Kiosk PIN updated',
            body: `Your manager updated your kiosk PIN at ${restaurantName}.`,
            data: { type: 'pin_changed', restaurant_id: body.restaurantId },
          }),
        });
      } catch (pushErr) {
        console.warn('notify-pin-changed: push failed', pushErr);
      }
    }

    // Email — PIN value is NEVER included
    if (employee.email) {
      const resendKey = Deno.env.get('RESEND_API_KEY');
      if (resendKey) {
        try {
          const resend = new Resend(resendKey);
          const safeName = escapeHtml(employee.name ?? 'there');
          // safeRestaurant is HTML-escaped for the body; subjectRestaurant is plain
          // text (CR/LF stripped) so entities like "&amp;" don't leak into the header.
          const safeRestaurant = escapeHtml(restaurantName).replace(/[\r\n]/g, ' ');
          const subjectRestaurant = restaurantName.replace(/[\r\n]/g, ' ');
          await resend.emails.send({
            from: 'EasyShiftHQ <notifications@easyshifthq.com>',
            to: [employee.email],
            subject: `Your kiosk PIN was updated at ${subjectRestaurant}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
                ${generateHeader()}
                <div style="padding: 40px 32px;">
                  <h1 style="color: #1f2937; font-size: 22px; margin: 0 0 16px;">Your kiosk PIN was updated</h1>
                  <p style="color: #6b7280; line-height: 1.6; font-size: 16px; margin: 0 0 16px;">
                    Hi ${safeName},
                  </p>
                  <p style="color: #6b7280; line-height: 1.6; font-size: 16px; margin: 0 0 16px;">
                    Your manager just updated your kiosk PIN at
                    <strong style="color: #1f2937;">${safeRestaurant}</strong>.
                  </p>
                  <p style="color: #6b7280; line-height: 1.6; font-size: 16px; margin: 0 0 16px;">
                    For security, we don't email PIN values. Ask your manager for the new PIN, or generate a new one yourself:
                  </p>
                  <div style="text-align: center; margin: 24px 0;">
                    <a href="https://app.easyshifthq.com/employee/pin"
                       style="background: #059669; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">
                      Set my own PIN
                    </a>
                  </div>
                  <p style="color: #9ca3af; font-size: 13px; margin-top: 32px;">
                    If you didn't expect this, contact your manager right away.
                  </p>
                </div>
              </div>
            `,
          });
        } catch (mailErr) {
          console.warn('notify-pin-changed: email failed', mailErr);
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('notify-pin-changed error', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

serve(handler);

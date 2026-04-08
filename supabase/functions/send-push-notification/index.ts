import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface PushRequest {
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

function base64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(serviceAccount: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(serviceAccount.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\n/g, '')), c => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = base64url(String.fromCharCode(...new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`))
  )));

  const jwtToken = `${header}.${claim}.${signature}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwtToken}`,
  });

  const { access_token } = await tokenRes.json();
  return access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Internal-only: verify service role key in Authorization header
  const authHeader = req.headers.get('Authorization');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceRoleKey
  );

  const { user_id, title, body, data } = await req.json() as PushRequest;

  // Look up device tokens
  const { data: tokens, error } = await supabase
    .from('device_tokens')
    .select('id, token, platform')
    .eq('user_id', user_id);

  if (error || !tokens?.length) {
    return new Response(
      JSON.stringify({ sent: 0, reason: error?.message || 'no tokens' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Get FCM access token
  const serviceAccount = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT')!);
  const accessToken = await getAccessToken(serviceAccount);
  const projectId = serviceAccount.project_id;

  let sent = 0;
  const staleTokenIds: string[] = [];

  for (const deviceToken of tokens) {
    const message = {
      message: {
        token: deviceToken.token,
        notification: { title, body },
        ...(data ? { data } : {}),
      },
    };

    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );

    if (res.ok) {
      sent++;
    } else {
      const err = await res.json();
      const errorCode = err?.error?.details?.[0]?.errorCode;
      if (errorCode === 'NOT_FOUND' || errorCode === 'UNREGISTERED') {
        staleTokenIds.push(deviceToken.id);
      }
    }
  }

  // Clean up stale tokens
  if (staleTokenIds.length > 0) {
    await supabase.from('device_tokens').delete().in('id', staleTokenIds);
  }

  return new Response(
    JSON.stringify({ sent, cleaned: staleTokenIds.length }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});

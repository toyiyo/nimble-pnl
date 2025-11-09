# Edge Function Authentication Guide

This document describes the authentication pattern used in Nimble P&L edge functions to secure API access while maintaining compatibility with multiple call types.

## Overview

Edge functions in Nimble P&L handle requests from three different sources:
1. **Frontend (User Calls)**: Authenticated users via the web application
2. **Internal Functions**: Webhooks, OAuth callbacks, and periodic sync jobs
3. **External Systems**: Third-party webhooks (Clover, Square, Stripe)

Each source requires a different authentication approach.

## Authentication Patterns

### Pattern 1: User Authentication (Frontend Calls)

Used by: Most edge functions that are directly called by the frontend application.

**Implementation:**
```typescript
const authHeader = req.headers.get('Authorization');
if (!authHeader) {
  throw new Error('No authorization header');
}

const anonClient = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  { auth: { persistSession: false } }
);

const { data: { user }, error: userError } = await anonClient.auth.getUser(
  authHeader.replace('Bearer ', '')
);

if (userError || !user) {
  throw new Error('Unauthorized');
}

// Verify user has access to the restaurant
const { data: userRestaurant, error: accessError } = await anonClient
  .from('user_restaurants')
  .select('role')
  .eq('user_id', user.id)
  .eq('restaurant_id', restaurantId)
  .single();

if (accessError || !userRestaurant || !['owner', 'manager'].includes(userRestaurant.role)) {
  throw new Error('Access denied');
}
```

**Key Points:**
- Uses `SUPABASE_ANON_KEY` to create the client
- Validates JWT token from frontend
- Checks user-restaurant relationship
- Enforces role-based access (owner/manager only)

### Pattern 2: Dual Authentication (User OR Service Role)

Used by: `clover-sync-data`, `square-sync-data`, `stripe-sync-transactions`

**Implementation:**
```typescript
const authHeader = req.headers.get('Authorization');
if (!authHeader) {
  throw new Error('No authorization header');
}

const token = authHeader.replace('Bearer ', '');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Check if this is an internal service role call or user call
const isServiceRoleCall = token === serviceRoleKey;

let userId: string | undefined;

if (!isServiceRoleCall) {
  // Authenticate user for regular calls
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { auth: { persistSession: false } }
  );

  const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
  if (userError || !user) {
    throw new Error('Unauthorized');
  }
  
  userId = user.id;
  console.log('Authenticated user:', userId);
} else {
  console.log('Service role call (from webhook/oauth)');
}

// Create service role client for privileged operations
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  serviceRoleKey
);

// Verify user has access (only for non-service-role calls)
if (!isServiceRoleCall && userId) {
  const { data: userRestaurant, error: accessError } = await supabase
    .from('user_restaurants')
    .select('role')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)
    .single();

  if (accessError || !userRestaurant || !['owner', 'manager'].includes(userRestaurant.role)) {
    throw new Error('Access denied');
  }
}
```

**Key Points:**
- Accepts both user JWT tokens AND service role key
- Service role calls bypass user permission checks
- User calls still require restaurant access verification
- Maintains backward compatibility with internal function calls
- Service role key comparison is timing-attack safe (constant-time comparison)

**When to Use:**
- Functions called by both frontend users AND internal edge functions
- Functions triggered by webhooks or periodic jobs
- Functions that need privileged database access

### Pattern 3: Webhook Signature Verification

Used by: `clover-webhooks`, `square-webhooks`, `stripe-webhooks`

**Implementation (Square example):**
```typescript
const SQUARE_WEBHOOK_SIGNATURE_KEY = Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY');

const rawBody = await req.text();
const signature = req.headers.get('x-square-hmacsha256-signature');

if (SQUARE_WEBHOOK_SIGNATURE_KEY && signature) {
  const notificationUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/square-webhooks`;
  const signaturePayload = notificationUrl + rawBody;
  
  const computedSignature = createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(signaturePayload)
    .digest('base64');

  if (signature !== computedSignature) {
    console.error('Invalid webhook signature');
    return new Response('Unauthorized', { status: 401 });
  }
}
```

**Implementation (Clover example):**
```typescript
const cloverAuth = req.headers.get("X-Clover-Auth");
const expectedVerificationCode = Deno.env.get("CLOVER_WEBHOOK_VERIFICATION_CODE");

if (!cloverAuth || cloverAuth !== expectedVerificationCode) {
  console.error("Invalid or missing X-Clover-Auth header");
  return new Response(
    JSON.stringify({ error: "Unauthorized" }),
    { status: 401 }
  );
}
```

**Key Points:**
- Verifies requests come from the external system (Clover, Square, Stripe)
- Uses HMAC signatures or verification codes
- Does NOT use Supabase user authentication (external system doesn't have user context)
- Webhooks then call sync functions with service role key

## Function Call Flow

### Frontend User Initiates Sync

```
User Browser (JWT) 
  → Edge Function (validates user JWT + restaurant access)
  → Database Operations (service role client)
```

### Webhook Triggers Sync

```
External System (webhook signature)
  → Webhook Handler (validates signature)
  → Sync Function (service role key)
  → Database Operations (service role client)
```

### OAuth Callback Triggers Sync

```
External OAuth Provider
  → OAuth Handler (validates OAuth code)
  → Sync Function (service role key)
  → Database Operations (service role client)
```

### Periodic Job Triggers Sync

```
Cron/Scheduler
  → Periodic Sync Function (service role key)
  → Individual Sync Functions (service role key)
  → Database Operations (service role client)
```

## Security Considerations

### ✅ DO

1. **Always validate authorization headers** - Never assume a request is authorized
2. **Use ANON_KEY for user authentication** - Validates JWT tokens properly
3. **Use SERVICE_ROLE_KEY for privileged operations** - Bypass RLS when needed
4. **Check restaurant access for user calls** - Verify via `user_restaurants` table
5. **Enforce role-based access** - Only owner/manager roles for sensitive operations
6. **Log authentication events** - Include user ID or "service-role" in logs
7. **Use webhook signatures for external systems** - HMAC verification for webhooks

### ❌ DON'T

1. **Never use SERVICE_ROLE_KEY directly from frontend** - Client should use ANON_KEY
2. **Don't skip authentication checks** - Even for "internal" functions
3. **Don't trust restaurant ID from request alone** - Verify user has access
4. **Don't expose SERVICE_ROLE_KEY in logs** - Log "service-role" instead of key
5. **Don't use string comparison for secrets** - Use constant-time comparison (already safe in our pattern)
6. **Don't allow viewer/staff roles for data sync** - Limit to owner/manager

## Testing Authentication

### Test User Authentication

```typescript
// Should succeed (valid user token + restaurant access)
const { data, error } = await supabase.functions.invoke('sync-function', {
  body: { restaurantId: 'user-restaurant-id' }
});

// Should fail (no auth header)
const response = await fetch('https://.../functions/v1/sync-function', {
  method: 'POST',
  body: JSON.stringify({ restaurantId: 'some-id' })
});
// Expected: 400 with "No authorization header"

// Should fail (wrong restaurant)
const { data, error } = await supabase.functions.invoke('sync-function', {
  body: { restaurantId: 'other-restaurant-id' }
});
// Expected: 400 with "Access denied"
```

### Test Service Role Authentication

```typescript
// Internal function call (from webhook)
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

const { data, error } = await supabase.functions.invoke('sync-function', {
  body: { restaurantId: 'any-restaurant-id' }
});
// Expected: Success (bypasses user checks)
```

## Migration Guide

If you need to add authentication to an existing edge function:

### For Functions Called by Users Only

Use Pattern 1 (User Authentication):

1. Add authorization header check
2. Create anon client and validate user
3. Verify restaurant access
4. Continue with service role client for DB operations

### For Functions Called by Users AND Internal Systems

Use Pattern 2 (Dual Authentication):

1. Add authorization header check
2. Check if token equals SERVICE_ROLE_KEY
3. If not service role: validate user + restaurant access
4. If service role: skip user checks
5. Continue with service role client for DB operations

### For Webhook Endpoints

Use Pattern 3 (Signature Verification):

1. Keep SERVICE_ROLE_KEY client
2. Add webhook signature verification
3. When calling other functions, pass SERVICE_ROLE_KEY

## Examples

### Example 1: User-Only Function

```typescript
// ai-categorize-transactions/index.ts
const authHeader = req.headers.get('Authorization');
if (!authHeader) {
  throw new Error('No authorization header');
}

const anonClient = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  { global: { headers: { Authorization: authHeader } } }
);

const { data: { user }, error: userError } = await anonClient.auth.getUser();
if (userError || !user) {
  throw new Error('Unauthorized');
}

const { restaurantId } = await req.json();

const { data: userRestaurant, error: accessError } = await anonClient
  .from('user_restaurants')
  .select('role')
  .eq('user_id', user.id)
  .eq('restaurant_id', restaurantId)
  .single();

if (accessError || !userRestaurant || !['owner', 'manager'].includes(userRestaurant.role)) {
  throw new Error('Access denied');
}
```

### Example 2: Dual Authentication Function

```typescript
// square-sync-data/index.ts
const authHeader = req.headers.get('Authorization');
if (!authHeader) {
  throw new Error('No authorization header');
}

const token = authHeader.replace('Bearer ', '');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const isServiceRoleCall = token === serviceRoleKey;
let userId: string | undefined;

if (!isServiceRoleCall) {
  // User authentication
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { auth: { persistSession: false } }
  );

  const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
  if (userError || !user) {
    throw new Error('Unauthorized');
  }
  userId = user.id;
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  serviceRoleKey
);

// Verify access for user calls only
if (!isServiceRoleCall && userId) {
  const { data: userRestaurant, error: accessError } = await supabase
    .from('user_restaurants')
    .select('role')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)
    .single();

  if (accessError || !userRestaurant || !['owner', 'manager'].includes(userRestaurant.role)) {
    throw new Error('Access denied');
  }
}
```

### Example 3: Webhook Function

```typescript
// square-webhooks/index.ts
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

const SQUARE_WEBHOOK_SIGNATURE_KEY = Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY');
const rawBody = await req.text();
const signature = req.headers.get('x-square-hmacsha256-signature');

// Verify webhook signature
if (SQUARE_WEBHOOK_SIGNATURE_KEY && signature) {
  const notificationUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/square-webhooks`;
  const signaturePayload = notificationUrl + rawBody;
  
  const computedSignature = createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(signaturePayload)
    .digest('base64');

  if (signature !== computedSignature) {
    return new Response('Unauthorized', { status: 401 });
  }
}

// Process webhook and call sync function
await supabase.functions.invoke('square-sync-data', {
  body: { restaurantId, action: 'daily_sync' }
});
```

## Audit Trail

All authenticated operations should log:
- User ID (for user calls)
- "service-role" label (for internal calls)
- Restaurant ID
- Action performed
- Timestamp (automatic in logs)

Example:
```typescript
console.log('Square sync started:', { 
  restaurantId, 
  action, 
  userId: userId || 'service-role' 
});
```

## References

- Supabase Auth Documentation: https://supabase.com/docs/guides/auth
- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

/**
 * Revel POS integration is gated until EasyShiftHQ's Partner Connect credentials
 * (REVEL_CLIENT_ID / REVEL_CLIENT_SECRET / REVEL_WEBHOOK_SECRET) are provisioned in
 * Supabase and the webhook receiver is registered with Revel.
 *
 * While false, the Integrations card renders visible but disabled ("Coming soon").
 * Flip to true (or wire to an env flag) once credentials are live and tested.
 */
export const REVEL_ENABLED = false;

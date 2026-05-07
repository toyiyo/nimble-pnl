// Server-side PostHog capture helper for Supabase edge functions.
//
// Telemetry must never break the calling webhook — every path swallows errors.
// The default implementation lazily imports `npm:posthog-node` so that callers
// without env vars (and tests) never trigger a network/npm fetch.

export interface ServerEventInput {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

type CaptureFn = (input: ServerEventInput) => Promise<void>;

let _captureImpl: CaptureFn | null = null;

async function defaultCapture(input: ServerEventInput): Promise<void> {
  const key = Deno.env.get("POSTHOG_PROJECT_KEY");
  const host = Deno.env.get("POSTHOG_HOST");

  if (!key || !host) {
    console.warn(
      "[posthogServer] POSTHOG_PROJECT_KEY or POSTHOG_HOST is not set — skipping",
      input.event,
    );
    return;
  }

  // Lazy dynamic import keeps tests and unconfigured environments from
  // pulling the npm package over the network on every cold start.
  const { PostHog } = await import("npm:posthog-node@4.18.0");
  const client = new PostHog(key, { host, flushAt: 1, flushInterval: 0 });

  try {
    client.capture({
      distinctId: input.distinctId,
      event: input.event,
      properties: input.properties,
    });
    await client.shutdown();
  } catch (err) {
    // Best-effort flush before re-raising for the outer catch in captureServerEvent.
    try {
      await client.shutdown();
    } catch {
      // Ignore double-shutdown errors.
    }
    throw err;
  }
}

export async function captureServerEvent(input: ServerEventInput): Promise<void> {
  try {
    const impl = _captureImpl ?? defaultCapture;
    await impl(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[posthogServer] capture failed for "${input.event}":`, msg);
  }
}

// Test seam — production code must never touch this.
export function _setCaptureFnForTesting(fn: CaptureFn | null): void {
  _captureImpl = fn;
}

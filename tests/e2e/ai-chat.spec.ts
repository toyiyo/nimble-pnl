import { test, expect, type Route } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant } from '../helpers/e2e-supabase';

/**
 * E2E: the AI chat runs a turn with tool rounds, shows it, saves it, and
 * loads it again after a page reload.
 *
 * CI serves no edge functions, so the spec mocks `ai-chat-stream` and
 * `ai-execute-tool`. The stream mock picks its answer by call count. The
 * spec records each request body and checks the history shape: an
 * assistant row with `tool_calls` comes before each matching `tool` row.
 */

const STREAM_GLOB = '**/functions/v1/ai-chat-stream';
const TOOL_GLOB = '**/functions/v1/ai-execute-tool';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const QUESTION = 'How are sales today?';
const ANSWER = 'Sales today are $1,234 across 56 orders.';
const FOLLOW_UP = 'And yesterday?';
const FOLLOW_UP_ANSWER = 'Yesterday sales were $987.';

/** Builds an SSE body. Each event ends with a blank line. */
function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

// The client builds the request bodies. No typed contract covers them.
type StreamMessage = {
  role: string;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
};

function answerFor(call: number): string {
  if (call === 1) {
    return sse([
      { type: 'message_start', id: 'm1' },
      { type: 'tool_call', id: 'call_kpis', tool: { name: 'get_kpis', arguments: { period: 'today' } } },
      { type: 'tool_call', id: 'call_nav', tool: { name: 'navigate', arguments: { section: 'pos-sales' } } },
      { type: 'message_end', id: 'm1' },
    ]);
  }
  if (call === 2) {
    return sse([
      { type: 'message_start', id: 'm2' },
      { type: 'message_delta', delta: ANSWER },
      { type: 'message_end', id: 'm2' },
    ]);
  }
  return sse([
    { type: 'message_start', id: `m${call}` },
    { type: 'message_delta', delta: FOLLOW_UP_ANSWER },
    { type: 'message_end', id: `m${call}` },
  ]);
}

test.describe('AI chat', () => {
  test('runs a 2-round turn, shows the navigate button, and reloads the saved conversation', async ({ page }) => {
    const streamBodies: Array<{ messages: StreamMessage[] }> = [];
    const toolBodies: Array<{ tool_name: string; arguments: Record<string, unknown> }> = [];

    await page.route(STREAM_GLOB, async (route: Route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: CORS_HEADERS });
      }
      streamBodies.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
        body: answerFor(streamBodies.length),
      });
    });

    await page.route(TOOL_GLOB, async (route: Route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: CORS_HEADERS });
      }
      const body = route.request().postDataJSON();
      toolBodies.push(body);
      const data =
        body.tool_name === 'navigate'
          ? { ok: true, data: { section: 'pos-sales', path: '/pos-sales' } }
          : { ok: true, data: { revenue: 1234, orders: 56 } };
      return route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    });

    const user = generateTestUser('ai-chat');
    await signUpAndCreateRestaurant(page, user);

    await page.getByRole('button', { name: 'Open Chef Assistant' }).click();
    const input = page.getByRole('textbox', { name: 'Chat message input' });
    await expect(input).toBeVisible({ timeout: 10000 });

    // Wait for the batch save of the turn before the reload.
    const saved = page.waitForResponse(
      (r) => r.url().includes('/rest/v1/ai_chat_messages') && r.request().method() === 'POST',
      { timeout: 20000 }
    );

    await input.fill(QUESTION);
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Go to POS Sales' })).toBeVisible();
    await expect(page.getByText('Using tools: get_kpis, navigate')).toBeVisible();
    await expect(page.getByText('Processing...')).toHaveCount(0);

    // Round 1 sends the user message only.
    expect(streamBodies).toHaveLength(2);
    expect(streamBodies[0].messages).toEqual([{ role: 'user', content: QUESTION }]);

    // Round 2 sends the assistant tool_calls before the matching tool rows.
    const round2 = streamBodies[1].messages;
    expect(round2.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
    expect(round2[1].tool_calls?.map((tc) => tc.id)).toEqual(['call_kpis', 'call_nav']);
    expect(round2[2]).toMatchObject({ tool_call_id: 'call_kpis', name: 'get_kpis' });
    expect(round2[3]).toMatchObject({ tool_call_id: 'call_nav', name: 'navigate' });
    expect(toolBodies.map((b) => b.tool_name)).toEqual(['get_kpis', 'navigate']);

    expect((await saved).ok()).toBe(true);

    // The panel stays open after a reload and loads the session from the database.
    await page.reload();
    await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 20000 });

    // The onboarding drawer opens again after the reload. Close it, as the signup helper does.
    const onboardingDrawer = page.getByRole('dialog').filter({ hasText: /getting started/i });
    const drawerOpen = await onboardingDrawer
      .waitFor({ state: 'visible', timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (drawerOpen) {
      await onboardingDrawer.getByRole('button', { name: /close/i }).click();
      await expect(onboardingDrawer).toBeHidden();
    }
    await expect(page.getByRole('button', { name: 'Go to POS Sales' })).toBeVisible();
    await expect(page.getByText('Processing...')).toHaveCount(0);

    // A new turn on the loaded session sends every saved row in order.
    const input2 = page.getByRole('textbox', { name: 'Chat message input' });
    await input2.fill(FOLLOW_UP);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText(FOLLOW_UP_ANSWER)).toBeVisible({ timeout: 20000 });

    expect(streamBodies).toHaveLength(3);
    const round3 = streamBodies[2].messages;
    expect(round3.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant', 'user']);
    expect(round3[1].tool_calls?.map((tc) => tc.id)).toEqual(['call_kpis', 'call_nav']);
    expect(round3[2].tool_call_id).toBe('call_kpis');
    expect(round3[3].tool_call_id).toBe('call_nav');
    expect(round3[4]).toEqual({ role: 'assistant', content: ANSWER });
    expect(round3[5]).toEqual({ role: 'user', content: FOLLOW_UP });

    // The navigate button goes to the POS Sales page.
    await page.getByRole('button', { name: 'Go to POS Sales' }).click();
    await expect(page).toHaveURL(/\/pos-sales$/);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  processAvailabilityReminder,
  buildDeps,
} from '../../supabase/functions/_shared/availabilityReminderHandler';

type FakeClient = {
  auth: { getUser: ReturnType<typeof vi.fn> };
  from: ReturnType<typeof vi.fn>;
};

function makeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  const builder = (rows: unknown, error: unknown = null) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: rows, error }),
    then: undefined as never,
  });
  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === 'user_restaurants') return builder({ role: 'owner' });
      if (table === 'employees') {
        const fluent = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: [
              { id: 'e1', name: 'Alice', email: 'alice@test.com', restaurant_id: 'r1' },
              { id: 'e2', name: 'Bob', email: null, restaurant_id: 'r1' },
            ],
            error: null,
          }),
        };
        return fluent;
      }
      if (table === 'restaurants') return builder({ name: "Wetzel's" });
      throw new Error(`unexpected table ${table}`);
    }),
    ...overrides,
  };
}

describe('processAvailabilityReminder', () => {
  it('returns 401 when no authorization header is supplied', async () => {
    const res = await processAvailabilityReminder(
      new Request('https://x', {
        method: 'POST',
        body: JSON.stringify({ restaurant_id: 'r1', employee_ids: ['e1'] }),
      }),
      {
        createClient: () => makeClient() as never,
        sendEmail: vi.fn(),
        appUrl: 'https://app',
        resendApiKey: 'k',
        fromEmail: 'from@x',
      },
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when the caller is not a manager', async () => {
    const client = makeClient();
    client.from = vi.fn((table: string) => {
      if (table === 'user_restaurants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: 'staff' }, error: null }),
        };
      }
      return makeClient().from(table);
    });
    const res = await processAvailabilityReminder(
      new Request('https://x', {
        method: 'POST',
        headers: { Authorization: 'Bearer x' },
        body: JSON.stringify({ restaurant_id: 'r1', employee_ids: ['e1'] }),
      }),
      {
        createClient: () => client as never,
        sendEmail: vi.fn(),
        appUrl: 'https://app',
        resendApiKey: 'k',
        fromEmail: 'from@x',
      },
    );
    expect(res.status).toBe(403);
  });

  it('skips employees with null email and counts them as skipped_no_email', async () => {
    const sendEmail = vi.fn().mockResolvedValue(true);
    const res = await processAvailabilityReminder(
      new Request('https://x', {
        method: 'POST',
        headers: { Authorization: 'Bearer x' },
        body: JSON.stringify({ restaurant_id: 'r1', employee_ids: ['e1', 'e2'] }),
      }),
      {
        createClient: () => makeClient() as never,
        sendEmail,
        appUrl: 'https://app',
        resendApiKey: 'k',
        fromEmail: 'from@x',
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ sent: 1, skipped_no_email: 1, errors: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][2]).toBe('alice@test.com'); // to
  });

  it('counts sendEmail failures in errors', async () => {
    const sendEmail = vi.fn().mockResolvedValue(false);
    const res = await processAvailabilityReminder(
      new Request('https://x', {
        method: 'POST',
        headers: { Authorization: 'Bearer x' },
        body: JSON.stringify({ restaurant_id: 'r1', employee_ids: ['e1', 'e2'] }),
      }),
      {
        createClient: () => makeClient() as never,
        sendEmail,
        appUrl: 'https://app',
        resendApiKey: 'k',
        fromEmail: 'from@x',
      },
    );
    const body = await res.json();
    expect(body).toEqual({ sent: 0, skipped_no_email: 1, errors: 1 });
  });

  it('CTA links to /employee/portal, not /availability', async () => {
    const sendEmail = vi.fn().mockResolvedValue(true);
    await processAvailabilityReminder(
      new Request('https://x', {
        method: 'POST',
        headers: { Authorization: 'Bearer x' },
        body: JSON.stringify({ restaurant_id: 'r1', employee_ids: ['e1'] }),
      }),
      {
        createClient: () => makeClient() as never,
        sendEmail,
        appUrl: 'https://app',
        resendApiKey: 'k',
        fromEmail: 'from@x',
      },
    );
    const html = sendEmail.mock.calls[0][4] as string;
    expect(html).toContain('https://app/employee/portal');
    expect(html).not.toContain('https://app/availability"');
  });

  it('returns 500 when user_restaurants query errors', async () => {
    const client = makeClient();
    client.from = vi.fn((table: string) => {
      if (table === 'user_restaurants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }),
        };
      }
      return makeClient().from(table);
    });
    const res = await processAvailabilityReminder(
      new Request('https://x', {
        method: 'POST',
        headers: { Authorization: 'Bearer x' },
        body: JSON.stringify({ restaurant_id: 'r1', employee_ids: ['e1'] }),
      }),
      {
        createClient: () => client as never,
        sendEmail: vi.fn(),
        appUrl: 'https://app',
        resendApiKey: 'k',
        fromEmail: 'from@x',
      },
    );
    expect(res.status).toBe(500);
  });

  it('returns 500 when restaurants query errors', async () => {
    const client = makeClient();
    client.from = vi.fn((table: string) => {
      if (table === 'user_restaurants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: 'owner' }, error: null }),
        };
      }
      if (table === 'restaurants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }),
        };
      }
      return makeClient().from(table);
    });
    const res = await processAvailabilityReminder(
      new Request('https://x', {
        method: 'POST',
        headers: { Authorization: 'Bearer x' },
        body: JSON.stringify({ restaurant_id: 'r1', employee_ids: ['e1'] }),
      }),
      {
        createClient: () => client as never,
        sendEmail: vi.fn(),
        appUrl: 'https://app',
        resendApiKey: 'k',
        fromEmail: 'from@x',
      },
    );
    expect(res.status).toBe(500);
  });

  it('returns 500 when employees query errors', async () => {
    const client = makeClient();
    client.from = vi.fn((table: string) => {
      if (table === 'user_restaurants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: 'owner' }, error: null }),
        };
      }
      if (table === 'restaurants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { name: "Wetzel's" }, error: null }),
        };
      }
      if (table === 'employees') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const res = await processAvailabilityReminder(
      new Request('https://x', {
        method: 'POST',
        headers: { Authorization: 'Bearer x' },
        body: JSON.stringify({ restaurant_id: 'r1', employee_ids: ['e1'] }),
      }),
      {
        createClient: () => client as never,
        sendEmail: vi.fn(),
        appUrl: 'https://app',
        resendApiKey: 'k',
        fromEmail: 'from@x',
      },
    );
    expect(res.status).toBe(500);
  });

  it('returns 500 when an unexpected exception is thrown', async () => {
    const res = await processAvailabilityReminder(
      new Request('https://x', {
        method: 'POST',
        headers: { Authorization: 'Bearer x' },
        body: JSON.stringify({ restaurant_id: 'r1', employee_ids: ['e1'] }),
      }),
      {
        createClient: () => {
          throw new Error('boom');
        },
        sendEmail: vi.fn(),
        appUrl: 'https://app',
        resendApiKey: 'k',
        fromEmail: 'from@x',
      },
    );
    expect(res.status).toBe(500);
  });
});

describe('buildDeps', () => {
  const ENV_BACKUP = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it('throws when APP_URL is missing', () => {
    delete process.env.APP_URL;
    process.env.RESEND_API_KEY = 'k';
    expect(() =>
      buildDeps({ env: process.env as Record<string, string> }),
    ).toThrow(/APP_URL/);
  });

  it('throws when RESEND_API_KEY is missing', () => {
    process.env.APP_URL = 'https://app';
    delete process.env.RESEND_API_KEY;
    expect(() =>
      buildDeps({ env: process.env as Record<string, string> }),
    ).toThrow(/RESEND_API_KEY/);
  });
});

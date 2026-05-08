import { describe, it, expect, beforeEach } from 'vitest';
import {
  processUnsubscribe,
  type UnsubInsertFn,
} from '../../supabase/functions/_shared/unsubscribeHandler';
import { signUnsubscribe } from '../../supabase/functions/_shared/unsubscribeToken';

const SECRET = 'test-secret';

interface InsertCall {
  user_id: string;
  list: string;
  source?: string | null;
}

function makeInsert(): { calls: InsertCall[]; fn: UnsubInsertFn } {
  const calls: InsertCall[] = [];
  const fn: UnsubInsertFn = async (row) => {
    calls.push(row);
    return { error: null };
  };
  return { calls, fn };
}

describe('processUnsubscribe', () => {
  let insert: ReturnType<typeof makeInsert>;

  beforeEach(() => {
    insert = makeInsert();
  });

  it('rejects missing token', async () => {
    const res = await processUnsubscribe(
      { token: '', list: 'trial_lifecycle' },
      { secret: SECRET, insert: insert.fn }
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
    expect(insert.calls).toHaveLength(0);
  });

  it('rejects missing list', async () => {
    const res = await processUnsubscribe(
      { token: 'whatever', list: '' as 'trial_lifecycle' },
      { secret: SECRET, insert: insert.fn }
    );
    expect(res.status).toBe(400);
    expect(insert.calls).toHaveLength(0);
  });

  it('rejects unknown list values', async () => {
    const res = await processUnsubscribe(
      { token: 'whatever', list: 'newsletter' as 'trial_lifecycle' },
      { secret: SECRET, insert: insert.fn }
    );
    expect(res.status).toBe(400);
    expect(insert.calls).toHaveLength(0);
  });

  it('rejects an invalid token (bad signature)', async () => {
    const res = await processUnsubscribe(
      { token: 'aaa.bbb', list: 'trial_lifecycle' },
      { secret: SECRET, insert: insert.fn }
    );
    expect(res.status).toBe(401);
    expect(insert.calls).toHaveLength(0);
  });

  it('rejects when token list does not match request list', async () => {
    const token = await signUnsubscribe(
      { user_id: 'u1', list: 'marketing' },
      SECRET
    );
    const res = await processUnsubscribe(
      { token, list: 'trial_lifecycle' },
      { secret: SECRET, insert: insert.fn }
    );
    expect(res.status).toBe(400);
    expect(insert.calls).toHaveLength(0);
  });

  it('inserts a row when the token is valid and the list matches', async () => {
    const token = await signUnsubscribe(
      { user_id: 'u1', list: 'trial_lifecycle' },
      SECRET
    );
    const res = await processUnsubscribe(
      { token, list: 'trial_lifecycle' },
      { secret: SECRET, insert: insert.fn }
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(insert.calls).toEqual([
      { user_id: 'u1', list: 'trial_lifecycle', source: 'email_link' },
    ]);
  });

  it('returns 200 on duplicate insert (ON CONFLICT DO NOTHING semantics)', async () => {
    // Caller treats null error as success regardless of whether the row was inserted.
    const token = await signUnsubscribe(
      { user_id: 'u1', list: 'trial_lifecycle' },
      SECRET
    );
    const res = await processUnsubscribe(
      { token, list: 'trial_lifecycle' },
      { secret: SECRET, insert: insert.fn }
    );
    expect(res.status).toBe(200);
  });

  it('returns 500 when the insert function reports an error', async () => {
    const failingInsert: UnsubInsertFn = async () => ({
      error: { message: 'database is on fire' },
    });
    const token = await signUnsubscribe(
      { user_id: 'u1', list: 'trial_lifecycle' },
      SECRET
    );
    const res = await processUnsubscribe(
      { token, list: 'trial_lifecycle' },
      { secret: SECRET, insert: failingInsert }
    );
    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });

  it('accepts list "marketing" when token agrees', async () => {
    const token = await signUnsubscribe(
      { user_id: 'u2', list: 'marketing' },
      SECRET
    );
    const res = await processUnsubscribe(
      { token, list: 'marketing' },
      { secret: SECRET, insert: insert.fn }
    );
    expect(res.status).toBe(200);
    expect(insert.calls[0]).toMatchObject({ user_id: 'u2', list: 'marketing' });
  });

  it('accepts list "all" when token agrees', async () => {
    const token = await signUnsubscribe(
      { user_id: 'u3', list: 'all' },
      SECRET
    );
    const res = await processUnsubscribe(
      { token, list: 'all' },
      { secret: SECRET, insert: insert.fn }
    );
    expect(res.status).toBe(200);
    expect(insert.calls[0]).toMatchObject({ user_id: 'u3', list: 'all' });
  });

  it('returns 500 when no secret is configured (defensive)', async () => {
    const token = await signUnsubscribe(
      { user_id: 'u1', list: 'trial_lifecycle' },
      SECRET
    );
    const res = await processUnsubscribe(
      { token, list: 'trial_lifecycle' },
      { secret: '', insert: insert.fn }
    );
    expect(res.status).toBe(500);
    expect(insert.calls).toHaveLength(0);
  });
});

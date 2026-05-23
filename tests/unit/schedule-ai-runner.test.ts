import { describe, it, expect, vi } from 'vitest';
import {
  runScheduleModelChain,
  type ScheduleModelChainCallStreaming,
} from '../../supabase/functions/_shared/schedule-ai-runner';
import type { ModelConfig } from '../../supabase/functions/_shared/ai-caller';

const M1: ModelConfig = { name: 'M1', id: 'm/1', maxRetries: 1 };
const M2: ModelConfig = { name: 'M2', id: 'm/2', maxRetries: 1 };
const M3: ModelConfig = { name: 'M3', id: 'm/3', maxRetries: 1 };

const validShifts = JSON.stringify({
  shifts: [{ employee_id: 'e1', template_id: 't1', date: '2026-05-26', start: '11:00', end: '15:00' }],
  metadata: { estimated_cost: 100, budget_variance_pct: 0, notes: 'ok' },
});

describe('runScheduleModelChain', () => {
  it('returns parsed JSON + model name on first successful model', async () => {
    const callStreaming: ScheduleModelChainCallStreaming = vi.fn(async (model) => {
      expect(model.id).toBe('m/1');
      return validShifts;
    });

    const result = await runScheduleModelChain({
      models: [M1, M2, M3],
      requestBody: { messages: [] },
      openRouterApiKey: 'sk-test',
      edgeFunction: 'generate-schedule',
      callStreaming,
    });

    expect(result).not.toBeNull();
    expect(result?.model).toBe('M1');
    expect(result?.data).toEqual(JSON.parse(validShifts));
    expect(callStreaming).toHaveBeenCalledTimes(1);
  });

  it('falls back to next model when first returns null content', async () => {
    const callStreaming: ScheduleModelChainCallStreaming = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(validShifts);

    const result = await runScheduleModelChain({
      models: [M1, M2],
      requestBody: { messages: [] },
      openRouterApiKey: 'sk-test',
      edgeFunction: 'generate-schedule',
      callStreaming,
    });

    expect(result?.model).toBe('M2');
    expect(callStreaming).toHaveBeenCalledTimes(2);
  });

  it('falls back to next model when first returns unparseable content', async () => {
    const callStreaming: ScheduleModelChainCallStreaming = vi
      .fn()
      .mockResolvedValueOnce('this is not json {{{')
      .mockResolvedValueOnce(validShifts);

    const result = await runScheduleModelChain({
      models: [M1, M2],
      requestBody: { messages: [] },
      openRouterApiKey: 'sk-test',
      edgeFunction: 'generate-schedule',
      callStreaming,
    });

    expect(result?.model).toBe('M2');
    expect(callStreaming).toHaveBeenCalledTimes(2);
  });

  it('strips markdown code fences before parsing', async () => {
    const fenced = '```json\n' + validShifts + '\n```';
    const callStreaming: ScheduleModelChainCallStreaming = vi.fn().mockResolvedValueOnce(fenced);

    const result = await runScheduleModelChain({
      models: [M1],
      requestBody: { messages: [] },
      openRouterApiKey: 'sk-test',
      edgeFunction: 'generate-schedule',
      callStreaming,
    });

    expect(result?.model).toBe('M1');
    expect(result?.data).toEqual(JSON.parse(validShifts));
  });

  it('returns null when every model fails', async () => {
    const callStreaming: ScheduleModelChainCallStreaming = vi.fn().mockResolvedValue(null);

    const result = await runScheduleModelChain({
      models: [M1, M2, M3],
      requestBody: { messages: [] },
      openRouterApiKey: 'sk-test',
      edgeFunction: 'generate-schedule',
      callStreaming,
    });

    expect(result).toBeNull();
    expect(callStreaming).toHaveBeenCalledTimes(3);
  });

  it('stops iterating models once wall-clock budget is exhausted', async () => {
    let nowMs = 1_000_000;
    const callStreaming: ScheduleModelChainCallStreaming = vi.fn(async () => {
      nowMs += 50_000;
      return null;
    });

    const result = await runScheduleModelChain({
      models: [M1, M2, M3],
      requestBody: { messages: [] },
      openRouterApiKey: 'sk-test',
      edgeFunction: 'generate-schedule',
      callStreaming,
      budgetMs: 90_000,
      now: () => nowMs,
    });

    expect(result).toBeNull();
    expect(callStreaming).toHaveBeenCalledTimes(2);
  });

  it('calls callStreaming exactly once per model (no extra retries at this layer)', async () => {
    const callStreaming: ScheduleModelChainCallStreaming = vi.fn().mockResolvedValue(null);

    await runScheduleModelChain({
      models: [M1, M2],
      requestBody: { messages: [] },
      openRouterApiKey: 'sk-test',
      edgeFunction: 'generate-schedule',
      callStreaming,
    });

    expect(callStreaming).toHaveBeenCalledTimes(2);
    expect(callStreaming).toHaveBeenNthCalledWith(1, M1, expect.any(Object), 'sk-test', 'generate-schedule', undefined);
    expect(callStreaming).toHaveBeenNthCalledWith(2, M2, expect.any(Object), 'sk-test', 'generate-schedule', undefined);
  });

  it('passes restaurantId through to callStreaming when provided', async () => {
    const callStreaming: ScheduleModelChainCallStreaming = vi.fn().mockResolvedValueOnce(validShifts);

    await runScheduleModelChain({
      models: [M1],
      requestBody: { messages: [] },
      openRouterApiKey: 'sk-test',
      edgeFunction: 'generate-schedule',
      restaurantId: 'rest-123',
      callStreaming,
    });

    expect(callStreaming).toHaveBeenCalledWith(M1, expect.any(Object), 'sk-test', 'generate-schedule', 'rest-123');
  });
});

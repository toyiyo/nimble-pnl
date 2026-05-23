// Pure helper that iterates an AI model chain via an injected streaming caller,
// strips markdown fences, and returns the first successfully parsed JSON payload.
// Kept free of Deno-only imports so it can be unit-tested from Vitest.
import type { ModelConfig } from "./ai-caller.ts";

export type ScheduleModelChainCallStreaming = (
  model: ModelConfig,
  requestBody: unknown,
  openRouterApiKey: string,
  edgeFunction: string,
  restaurantId?: string,
) => Promise<string | null>;

export interface RunScheduleModelChainArgs {
  models: ModelConfig[];
  requestBody: unknown;
  openRouterApiKey: string;
  edgeFunction: string;
  restaurantId?: string;
  callStreaming: ScheduleModelChainCallStreaming;
  /** Override for time source. Defaults to Date.now. */
  now?: () => number;
  /** Wall-clock budget for the entire chain. Defaults to 130_000ms. */
  budgetMs?: number;
}

export interface ScheduleModelChainResult<T = unknown> {
  data: T;
  model: string;
}

const DEFAULT_BUDGET_MS = 130_000;

function stripMarkdownFences(content: string): string {
  return content
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

export async function runScheduleModelChain<T = unknown>(
  args: RunScheduleModelChainArgs,
): Promise<ScheduleModelChainResult<T> | null> {
  const {
    models,
    requestBody,
    openRouterApiKey,
    edgeFunction,
    restaurantId,
    callStreaming,
    now = Date.now,
    budgetMs = DEFAULT_BUDGET_MS,
  } = args;

  const start = now();

  for (const model of models) {
    const elapsed = now() - start;
    if (elapsed > budgetMs) {
      console.warn(
        `[${edgeFunction}] Model chain wall-clock budget exhausted (${elapsed}ms > ${budgetMs}ms). Stopping early.`,
      );
      break;
    }

    console.log(`[${edgeFunction}] Trying model: ${model.name} (streaming)`);
    let content: string | null;
    try {
      content = await callStreaming(model, requestBody, openRouterApiKey, edgeFunction, restaurantId);
    } catch (err) {
      console.warn(
        `[${edgeFunction}] Model ${model.name} streaming threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (!content) continue;

    const cleaned = stripMarkdownFences(content);
    try {
      const data = JSON.parse(cleaned) as T;
      return { data, model: model.name };
    } catch (err) {
      console.warn(
        `[${edgeFunction}] Model ${model.name} parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
  }

  return null;
}

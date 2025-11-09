# Braintrust Telemetry Integration

## Overview

This application integrates [Braintrust](https://www.braintrust.dev/) for comprehensive AI observability and telemetry. Braintrust provides detailed insights into AI model performance, token usage, costs, and error tracking across all AI call paths in the application.

## Features

### 🎯 Comprehensive Tracing
- **Multi-model fallback tracking** - Tracks which models were attempted and which succeeded
- **Token usage monitoring** - Captures prompt tokens, completion tokens, and total usage
- **Cost tracking** - Monitors AI API costs when available from OpenRouter
- **Performance metrics** - Tracks latency, time to first token, and total duration
- **Error tracking** - Captures failures, timeouts, and rate limits with full context

### 🔄 Graceful Degradation
- **Zero overhead when disabled** - Tracing gracefully disabled without BRAINTRUST_API_KEY
- **Never blocks AI calls** - Tracing errors are logged but never fail the AI request
- **Production-ready** - Safe to deploy without configuration

### 📊 Rich Metadata
All AI calls are logged with:
- `model` - OpenRouter model ID
- `provider` - Always "openrouter"
- `restaurant_id` - For filtering by customer
- `edge_function` - Which function made the call
- `temperature` - Model temperature setting
- `max_tokens` - Maximum tokens configured
- `stream` - Whether streaming was used
- `attempt` - Retry/fallback attempt number
- `success` - Whether the call succeeded
- `error` - Error message if failed
- `status_code` - HTTP status code

## Setup

### 1. Get Braintrust API Key

1. Sign up at [https://www.braintrust.dev/](https://www.braintrust.dev/)
2. Create a new project or use an existing one
3. Generate an API key from the project settings

### 2. Add Secret to Supabase

Add the `BRAINTRUST_API_KEY` secret to your Supabase project:

```bash
# Using Supabase CLI
supabase secrets set BRAINTRUST_API_KEY=your_api_key_here

# Or via Supabase Dashboard
# Navigate to: Project Settings > Edge Functions > Secrets
# Add: BRAINTRUST_API_KEY = your_api_key_here
```

### 3. Verify Integration

Once the API key is added, the integration will automatically:
- Initialize the Braintrust logger on first AI call
- Start tracing all AI operations
- Log metrics to your Braintrust project

Check the logs for confirmation:
```
[Braintrust] Logger initialized successfully
```

If the API key is not configured, you'll see:
```
[Braintrust] API key not configured - tracing disabled
```

## Architecture

### Core Components

#### 1. `_shared/braintrust.ts`
Central telemetry module providing:

```typescript
// Initialize logger (lazy, cached)
getBraintrustLogger(): BraintrustLogger | null

// Trace an AI call with automatic metadata capture
traceAICall<T>(
  spanName: string,
  metadata: AICallMetadata,
  fn: () => Promise<T>
): Promise<T>

// Log AI call results with full context
logAICall(
  spanName: string,
  input: any,
  output: any,
  metadata: AICallMetadata,
  tokenUsage?: TokenUsage
): void

// Extract token usage from OpenRouter response
extractTokenUsage(responseData: any): TokenUsage | null

// Track streaming operations
startStreamingSpan(
  spanName: string,
  metadata: AICallMetadata
): (content: string, tokenUsage?: TokenUsage) => void
```

#### 2. `_shared/ai-caller.ts`
Core AI calling with tracing:
- `callModel()` - Single model call with retries and tracing
- `callAIWithFallback()` - Non-streaming multi-model fallback with tracing
- `callAIWithFallbackStreaming()` - Streaming multi-model fallback with tracing

#### 3. `_shared/streaming.ts`
Streaming utilities with telemetry:
- `callModelWithStreaming()` - Streaming calls with content accumulation
- `processStreamedResponse()` - SSE stream parsing

### Instrumented Edge Functions

All AI-powered edge functions are instrumented:

| Function | Purpose | Traced Operations |
|----------|---------|-------------------|
| `ai-chat-stream` | AI chat assistant | Stream start, model fallback, tool calls |
| `ai-categorize-transactions` | Bank transaction categorization | Full categorization pipeline |
| `ai-categorize-pos-sales` | POS sales categorization | Sales categorization with chart of accounts |
| `process-receipt` | Receipt OCR parsing | Receipt processing with multi-model fallback |
| `ai-execute-tool` | Tool execution with AI | AI insights generation |

## Usage Patterns

### Basic AI Call Tracing

```typescript
import { traceAICall, logAICall, type AICallMetadata } from "../_shared/braintrust.ts";

const metadata: AICallMetadata = {
  model: "google/gemini-2.5-flash-lite",
  provider: "openrouter",
  restaurant_id: restaurantId,
  edge_function: "my-function",
  temperature: 0.7,
  max_tokens: 4096,
  stream: false,
  attempt: 1,
  success: false,
};

const result = await traceAICall(
  "my-function:operation",
  metadata,
  async () => {
    // Your AI call here
    return await callAI();
  }
);
```

### Logging with Token Usage

```typescript
import { logAICall, extractTokenUsage } from "../_shared/braintrust.ts";

const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {...});
const data = await response.json();
const tokenUsage = extractTokenUsage(data);

logAICall(
  "my-function:success",
  { messages: requestMessages },
  { result: data },
  { ...metadata, success: true, status_code: 200 },
  tokenUsage
);
```

### Streaming Operations

```typescript
import { startStreamingSpan } from "../_shared/braintrust.ts";

const endSpan = startStreamingSpan("my-function:streaming", metadata);

// ... perform streaming operation ...

if (endSpan) {
  endSpan(completeContent, tokenUsage);
}
```

## Braintrust Dashboard

### Viewing Traces

1. Log in to [Braintrust](https://www.braintrust.dev/)
2. Select your project: **"EasyShiftHQ AI"**
3. Navigate to "Traces" to view all AI calls

### Filtering Data

Filter traces by:
- **Model** - See which models are being used
- **Restaurant ID** - Filter by customer
- **Edge Function** - See calls from specific functions
- **Success/Failure** - Identify error patterns
- **Token Count** - Find expensive operations

### Analyzing Performance

View metrics like:
- **Average latency** per model
- **Success rate** per model
- **Token consumption** trends
- **Cost per request** (when available)
- **Error rates** by type

### Example Queries

**Find expensive operations:**
```
total_tokens > 10000
```

**Find failed calls for a specific restaurant:**
```
restaurant_id = "abc-123" AND success = false
```

**Find all streaming operations:**
```
stream = true
```

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Success Rate** - Should be >95%
   - Check for patterns in failures
   - Identify problematic models
   - Alert if drops below threshold

2. **Latency** - Track P50, P90, P99
   - Identify slow operations
   - Compare models
   - Optimize for common use cases

3. **Token Usage** - Monitor costs
   - Track daily/monthly consumption
   - Identify high-usage customers
   - Optimize prompts to reduce tokens

4. **Error Patterns**
   - Rate limits (429)
   - Timeouts
   - Moderation errors (403)
   - Model failures

### Setting Up Alerts

In Braintrust, configure alerts for:
- Success rate drops below 95%
- Latency exceeds 30s for non-streaming calls
- Daily token usage exceeds budget
- Specific error rates increase

## Best Practices

### 1. Always Pass Restaurant ID
```typescript
// ✅ Good - Enables per-customer filtering
await callAIWithFallback(request, apiKey, 'my-function', restaurantId);

// ❌ Bad - Missing restaurant context
await callAIWithFallback(request, apiKey, 'my-function');
```

### 2. Use Descriptive Span Names
```typescript
// ✅ Good - Clear hierarchy
await traceAICall('ai-categorize-transactions:batch', ...)

// ❌ Bad - Generic
await traceAICall('ai-call', ...)
```

### 3. Log Both Success and Failure
```typescript
try {
  const result = await callAI();
  logAICall('success', input, result, {...metadata, success: true}, tokens);
  return result;
} catch (error) {
  logAICall('error', input, null, {...metadata, success: false, error: error.message}, null);
  throw error;
}
```

### 4. Extract Token Usage When Available
```typescript
const data = await response.json();
const tokenUsage = extractTokenUsage(data); // Always try to extract
logAICall(spanName, input, output, metadata, tokenUsage);
```

## Troubleshooting

### Traces Not Appearing

**Check API Key:**
```bash
# Verify secret is set
supabase secrets list | grep BRAINTRUST_API_KEY
```

**Check Logs:**
Look for initialization messages:
```
[Braintrust] Logger initialized successfully
```

Or warnings:
```
[Braintrust] API key not configured - tracing disabled
[Braintrust] Failed to initialize logger: <error>
```

### Tracing Errors

If you see errors like:
```
[Braintrust] Tracing error: <error>
```

The AI call will still succeed, but tracing failed. Common causes:
- Network issues connecting to Braintrust API
- Invalid API key
- Project doesn't exist
- Rate limiting

### Missing Token Usage

Token usage may not be available:
- Some OpenRouter models don't return usage data
- Streaming responses don't include usage in SSE
- Error responses don't have usage information

This is expected - the integration handles missing token data gracefully.

## Performance Impact

### Overhead
- **Minimal** when enabled - Async logging doesn't block AI calls
- **Zero** when disabled - No-op functions when API key not set
- **Resilient** - Tracing errors never fail AI operations

### Best Practices
- Tracing is non-blocking and asynchronous
- No impact on AI call latency
- Minimal memory overhead for metadata
- Safe for production use

## Security

### API Key Storage
- ✅ Stored as Supabase secret (encrypted at rest)
- ✅ Never logged or exposed in responses
- ✅ Not accessible to client-side code

### Data Privacy
- ✅ Restaurant IDs used for filtering (no PII)
- ✅ Model inputs/outputs logged for debugging
- ⚠️ Avoid logging sensitive customer data in prompts
- ⚠️ Review Braintrust's data retention policies

### Access Control
- Only authorized team members should have Braintrust dashboard access
- Rotate API keys periodically
- Use separate projects for staging/production

## Future Enhancements

Potential improvements:
1. **A/B Testing** - Compare different prompts or models
2. **Automated Prompt Optimization** - Use Braintrust to optimize prompts
3. **Custom Metrics** - Track business-specific KPIs
4. **Anomaly Detection** - Alert on unusual patterns
5. **Cost Optimization** - Automatically switch to cheaper models when appropriate

## References

- [Braintrust Documentation](https://www.braintrust.dev/docs)
- [OpenRouter API](https://openrouter.ai/docs)
- [Deno npm: specifier](https://deno.land/manual/node/npm_specifiers)

## Support

For questions or issues:
1. Check this documentation
2. Review Braintrust logs in dashboard
3. Check edge function logs in Supabase
4. Contact team lead or file issue in repository

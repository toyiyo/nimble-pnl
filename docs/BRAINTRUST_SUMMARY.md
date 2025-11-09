# Braintrust Integration Summary

## What Was Implemented

A comprehensive AI observability and telemetry system using [Braintrust](https://www.braintrust.dev/) that tracks all AI operations across the EasyShiftHQ application.

## Key Components

### 1. Core Telemetry Module
**File:** `supabase/functions/_shared/braintrust.ts`

Provides centralized telemetry utilities:
- Logger initialization with lazy loading
- AI call tracing wrappers
- Token usage extraction from OpenRouter
- Streaming operation tracking
- Graceful degradation when disabled

### 2. Instrumented Shared Utilities
**Files:**
- `_shared/ai-caller.ts` - Multi-model fallback with tracing
- `_shared/streaming.ts` - Streaming operations with telemetry

### 3. Instrumented Edge Functions
All AI-powered edge functions now include telemetry:
- `ai-chat-stream` - Chat assistant
- `ai-categorize-transactions` - Bank transaction categorization
- `ai-categorize-pos-sales` - POS sales categorization
- `process-receipt` - Receipt OCR parsing
- `ai-execute-tool` - AI insights generation
- `enhance-product-ai` - Product enhancement

## What Gets Tracked

For every AI call:
- ✅ Model name and provider
- ✅ Restaurant ID (for customer filtering)
- ✅ Edge function name
- ✅ Parameters (temperature, max_tokens, etc.)
- ✅ Success/failure status
- ✅ Error messages and status codes
- ✅ Token usage (prompt, completion, total)
- ✅ Latency and duration
- ✅ Retry/fallback attempts
- ✅ Streaming vs non-streaming mode

## Setup Required

**1. Get Braintrust API Key**
- Sign up at https://www.braintrust.dev/
- Create project: "EasyShiftHQ AI"
- Generate API key

**2. Add to Supabase**
```bash
supabase secrets set BRAINTRUST_API_KEY=your_api_key_here
```

**3. Verify**
Check logs for:
```
[Braintrust] Logger initialized successfully
```

## Benefits

### For Development
- Debug AI issues faster with full trace history
- Compare model performance side-by-side
- Identify slow operations and optimize
- Track which models are actually being used
- Understand fallback patterns

### For Operations
- Monitor AI service health and availability
- Set alerts for error rate spikes
- Track token usage and costs per customer
- Identify high-cost operations
- Plan capacity based on usage trends

### For Business
- Per-customer usage analytics
- Cost attribution and billing
- Quality metrics (success rates, latency)
- Identify areas for prompt optimization
- ROI tracking for AI features

## Integration Features

### Graceful Degradation
- **Zero overhead** when API key not configured
- **Never blocks** AI calls if tracing fails
- **Production-safe** - can deploy without configuration
- **No dependencies** on Braintrust for core functionality

### Comprehensive Coverage
- All AI call paths instrumented
- Both streaming and non-streaming operations
- Multi-model fallback chains tracked
- Error cases fully logged
- Token usage captured when available

### Performance
- Async logging (non-blocking)
- Minimal memory overhead
- No impact on AI call latency
- Efficient metadata capture
- Safe for production use

## Documentation

### Main Documentation
- **`docs/BRAINTRUST_TELEMETRY.md`** - Complete guide
  - Setup instructions
  - Architecture overview
  - Usage patterns
  - Dashboard guide
  - Monitoring and alerts
  - Best practices
  - Troubleshooting

### Testing Guide
- **`docs/TESTING_BRAINTRUST.md`** - Validation guide
  - Quick test checklist
  - Detailed testing scenarios
  - Common issues and solutions
  - Performance validation
  - Load testing

## Files Modified

### New Files
```
supabase/functions/_shared/braintrust.ts
docs/BRAINTRUST_TELEMETRY.md
docs/TESTING_BRAINTRUST.md
```

### Modified Files
```
supabase/functions/_shared/ai-caller.ts
supabase/functions/_shared/streaming.ts
supabase/functions/ai-categorize-transactions/index.ts
supabase/functions/ai-categorize-pos-sales/index.ts
supabase/functions/process-receipt/index.ts
supabase/functions/ai-chat-stream/index.ts
supabase/functions/ai-execute-tool/index.ts
supabase/functions/enhance-product-ai/index.ts
supabase/functions/enhanced-ocr/index.ts
supabase/functions/grok-ocr/index.ts
supabase/functions/grok-recipe-enhance/index.ts
README.md
```

## Usage Examples

### Viewing Traces in Braintrust

**Filter by customer:**
```
restaurant_id = "abc-123"
```

**Find expensive operations:**
```
total_tokens > 10000
```

**Find failures:**
```
success = false
```

**Find streaming operations:**
```
stream = true
```

**Find multi-model fallbacks:**
```
attempt > 1
```

### Monitoring Metrics

**Key Dashboards to Create:**
1. Success Rate by Model
2. Average Latency P50/P90/P99
3. Token Usage Trends
4. Daily Cost by Customer
5. Error Rate by Type

**Alerts to Set:**
- Success rate < 95%
- Latency > 30s (non-streaming)
- Daily tokens > budget
- Error rate spike

## Next Steps

### Immediate
1. Add `BRAINTRUST_API_KEY` to Supabase
2. Test with a few AI operations
3. Verify traces in dashboard
4. Check token usage is captured

### Short Term
1. Set up monitoring dashboards
2. Configure alerts for key metrics
3. Review error patterns weekly
4. Optimize based on insights

### Long Term
1. A/B test prompts and models
2. Automated prompt optimization
3. Cost-based model routing
4. Custom business metrics
5. Anomaly detection

## Technical Notes

### Deno Compatibility
- Uses `npm:braintrust@0.0.163` import specifier
- Compatible with Deno runtime in Supabase Edge Functions
- No additional dependencies required

### OpenRouter Integration
- Extracts token usage from response
- Handles missing usage data gracefully
- Tracks all OpenRouter-specific features
- Logs moderation errors (403)

### Security
- API key stored as encrypted Supabase secret
- Never exposed in logs or responses
- Restaurant ID used for filtering (no PII)
- Complies with data privacy best practices

## Support

**Documentation:**
- Main guide: `docs/BRAINTRUST_TELEMETRY.md`
- Testing guide: `docs/TESTING_BRAINTRUST.md`
- Integration patterns: `INTEGRATIONS.md`

**Resources:**
- Braintrust Docs: https://www.braintrust.dev/docs
- OpenRouter Docs: https://openrouter.ai/docs

**Questions?**
- Check documentation first
- Review Braintrust dashboard
- Check Supabase edge function logs
- File issue in repository if needed

---

**Implementation Complete** ✅

All AI call paths are now instrumented with comprehensive telemetry. Add the `BRAINTRUST_API_KEY` to start collecting insights!

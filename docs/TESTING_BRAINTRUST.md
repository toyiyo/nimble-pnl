# Testing Braintrust Integration

This guide helps you verify the Braintrust telemetry integration is working correctly.

## Quick Test Checklist

### 1. Add the API Key (Required)

```bash
# Get your API key from https://www.braintrust.dev/
# Add it as a Supabase secret

supabase secrets set BRAINTRUST_API_KEY=your_api_key_here
```

### 2. Trigger an AI Operation

Choose any of these operations to test:

**Option A: Categorize Bank Transactions**
- Go to Banking > Transactions
- Click "AI Categorize" button
- Check logs for Braintrust initialization

**Option B: Chat with AI Assistant**
- Go to Dashboard
- Open AI chat assistant
- Ask: "What are my top selling items?"
- Check for trace logging

**Option C: Process a Receipt**
- Go to Inventory > Receipts
- Upload a receipt image
- Watch OCR processing with AI

### 3. Verify in Logs

Look for these messages in Supabase Edge Function logs:

**Success:**
```
[Braintrust] Logger initialized successfully
🚀 Starting AI call with multi-model fallback...
✅ Gemini 2.5 Flash Lite succeeded
```

**Without API Key (Graceful Degradation):**
```
[Braintrust] API key not configured - tracing disabled
🚀 Starting AI call with multi-model fallback...
✅ Gemini 2.5 Flash Lite succeeded
```

### 4. Check Braintrust Dashboard

1. Log in to https://www.braintrust.dev/
2. Open project: **"EasyShiftHQ AI"**
3. Navigate to "Traces"
4. You should see:
   - Recent AI calls
   - Model names
   - Token usage
   - Success/failure status
   - Latency metrics

## Detailed Testing

### Test Multi-Model Fallback

To test the fallback chain:

1. **Temporarily make the primary model fail** (for testing only):
   - The system will try: Gemini → Llama → Gemma → Claude → Llama Paid
   - You should see traces for each attempt

2. **Check Braintrust**:
   - Filter by `attempt > 1` to see fallback chains
   - Verify each model attempt is logged

### Test Error Handling

**Test 1: Rate Limiting**
- Make many rapid AI calls
- Should see `429` status codes logged
- Verify retry logic in traces

**Test 2: Timeout**
- Process a very large receipt (100+ items)
- If timeout occurs, should be logged with proper error

**Test 3: Invalid Input**
- Send malformed data to AI endpoint
- Should see error logged but app continues

### Test Streaming Operations

**Test streaming with chat:**
1. Open AI chat assistant
2. Ask a complex question requiring long response
3. Observe streaming chunks in logs
4. Verify complete content is logged in Braintrust

### Verify Token Usage Tracking

1. Make several AI calls
2. Check Braintrust dashboard
3. Verify token counts are displayed:
   - Prompt tokens
   - Completion tokens
   - Total tokens

### Test Per-Restaurant Filtering

1. Make AI calls from different restaurants
2. In Braintrust, filter by `restaurant_id`
3. Verify you can isolate calls per customer

## Common Issues & Solutions

### Issue: "Braintrust logger not initializing"

**Check:**
```bash
# Verify secret is set
supabase secrets list | grep BRAINTRUST_API_KEY
```

**Solution:**
- Ensure API key is valid
- Check key has correct project access
- Restart edge functions after adding secret

### Issue: "No traces in dashboard"

**Check:**
1. Verify API key is correct
2. Check project name matches: "EasyShiftHQ AI"
3. Look for initialization errors in logs

**Solution:**
- Regenerate API key if needed
- Ensure project exists in Braintrust
- Check for network connectivity issues

### Issue: "Token usage showing as null"

**Expected:**
- Some models don't return usage data
- Streaming responses may not include tokens
- Error responses won't have usage

**This is normal** - the integration handles missing data gracefully.

## Performance Validation

### Verify Zero Overhead

**Without API Key:**
1. Remove BRAINTRUST_API_KEY
2. Make AI calls
3. Should work normally with message:
   ```
   [Braintrust] API key not configured - tracing disabled
   ```

**With API Key:**
1. Add BRAINTRUST_API_KEY
2. Make AI calls
3. Latency should be nearly identical (< 10ms difference)

### Load Testing

Test with multiple concurrent requests:
1. Categorize 100 transactions
2. Monitor Braintrust for all traces
3. Verify no calls are dropped
4. Check for any performance degradation

## Validation Script

Run this to verify the integration:

```bash
# From repository root
chmod +x /tmp/validate_braintrust.sh

# Check structure
/tmp/validate_braintrust.sh

# Expected output:
# ✓ All required exports present in braintrust.ts
# ✓ ai-caller.ts properly instrumented
# ✓ streaming.ts properly instrumented
# ✓ All edge functions have telemetry integration
```

## Next Steps After Validation

1. **Set up monitoring alerts** in Braintrust
2. **Create custom dashboards** for key metrics
3. **Analyze model performance** to optimize
4. **Track costs** and set budgets
5. **Review error patterns** weekly

## Questions?

See `docs/BRAINTRUST_TELEMETRY.md` for:
- Complete architecture details
- Usage patterns
- Best practices
- Troubleshooting guide

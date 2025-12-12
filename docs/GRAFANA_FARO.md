# Grafana Faro Frontend Observability

This document describes the Grafana Faro integration for frontend observability, error tracking, and performance monitoring.

## Overview

Grafana Faro is a frontend observability solution that provides:
- **Error Tracking**: Automatic capture of JavaScript errors and exceptions
- **Performance Monitoring**: Real User Monitoring (RUM) metrics
- **Distributed Tracing**: End-to-end visibility for HTTP requests
- **Console Logs**: Capture console logs for debugging
- **User Sessions**: Track user behavior and sessions

## Configuration

### Environment Variables

Configure the following environment variables to enable Faro:

```bash
# Required: Grafana Faro collector endpoint
VITE_FARO_COLLECTOR_URL="https://faro-collector-prod-us-east-2.grafana.net/collect/YOUR_COLLECTOR_ID"

# Optional: Application metadata (defaults shown)
VITE_FARO_APP_NAME="easyshifthq"
VITE_FARO_APP_VERSION="1.0.0"
VITE_FARO_ENVIRONMENT="production"

# Optional: Enable source map uploads (may increase build memory usage)
# Set to "true" only when you need source maps uploaded to Grafana
# Disabled by default to prevent memory issues on platforms with limited resources
VITE_FARO_UPLOAD_SOURCEMAPS="true"

# Optional: Stack ID for source map uploads (Grafana Cloud)
VITE_FARO_STACK_ID="your_stack_id"
```

### Current Configuration

The application is configured with:
- **App Name**: `easyshifthq`
- **Domain**: `https://app.easyshifthq.com`
- **Session Type**: Persistent sessions
- **Sampling Rate**: 100% (all sessions tracked)

## Features Enabled

### 1. Web Instrumentation
- Page view tracking
- Page leave tracking
- Error and exception capture
- Console log capture (all levels)

### 2. Distributed Tracing
- HTTP request tracing
- Performance metrics
- End-to-end request visibility

### 3. Source Map Upload (Optional)
- Source maps are always generated for production builds
- Automatic upload to Grafana can be enabled via `VITE_FARO_UPLOAD_SOURCEMAPS=true`
- When enabled: De-obfuscated stack traces and original source code visibility in error reports
- **Note**: Source map upload is disabled by default to prevent memory issues during builds on platforms with limited resources (e.g., Netlify)

## Implementation

### Initialization

Faro is initialized in `src/main.tsx` before the React application renders:

```typescript
import { initFaro } from './lib/faro';

// Initialize Grafana Faro (must be first)
initFaro();
```

### Core Module

The initialization logic is in `src/lib/faro.ts`:

```typescript
import { getWebInstrumentations, initializeFaro } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

export function initFaro(): Faro | null {
  // ... initialization logic
}
```

### Build Configuration

Source map generation and upload is configured in `vite.config.ts`:

```typescript
import { faroRollupPlugin } from "@grafana/faro-rollup-plugin";

// Source map upload only when explicitly enabled
if (
  mode === "production" && 
  process.env.VITE_FARO_COLLECTOR_URL && 
  process.env.VITE_FARO_UPLOAD_SOURCEMAPS === "true"
) {
  plugins.push(faroRollupPlugin({
    appName: process.env.VITE_FARO_APP_NAME || "easyshifthq",
    appVersion: process.env.VITE_FARO_APP_VERSION || "1.0.0",
    endpoint: process.env.VITE_FARO_COLLECTOR_URL,
    stackId: process.env.VITE_FARO_STACK_ID,
  }));
}
```

## Usage

### Automatic Tracking

Faro automatically tracks:
- Page views
- Navigation events
- JavaScript errors
- Unhandled promise rejections
- HTTP requests
- Console logs

### Manual Event Tracking

You can also manually track events using the Faro API:

```typescript
import { getFaro } from '@/lib/faro';

const faro = getFaro();
if (faro) {
  // Track custom events
  faro.api.pushEvent('custom_event', {
    customProperty: 'value',
  });

  // Track custom logs
  faro.api.pushLog(['Custom log message'], {
    level: 'info',
    context: { userId: '123' },
  });
}
```

## Disabling Faro

To disable Faro:
1. Remove or comment out `VITE_FARO_COLLECTOR_URL` in `.env`
2. Faro will not initialize and will log a warning message

## Testing

Unit tests are located in `tests/unit/faro.test.ts` and verify:
- Module exports
- Error handling
- Configuration parsing

Run tests with:
```bash
npm run test -- tests/unit/faro.test.ts
```

## Source Maps

### Production Builds

Source maps are always generated for production builds. To enable automatic upload to Grafana:

1. Set `VITE_FARO_UPLOAD_SOURCEMAPS=true` in your environment
2. Ensure `VITE_FARO_COLLECTOR_URL` is configured
3. Build the application: `npm run build`

**Note**: Source map upload is disabled by default to prevent memory issues during builds on platforms with limited resources (e.g., Netlify). Enable it only when needed and on platforms with sufficient memory.

### Development Builds

Source maps are generated but never uploaded during development builds.

## Privacy & Security

- No PII (Personally Identifiable Information) is tracked by default
- Console logs may contain sensitive data - review before enabling in production
- Source maps are uploaded securely to Grafana Cloud
- All data is sent over HTTPS

## Troubleshooting

### Faro Not Initializing

Check that:
1. `VITE_FARO_COLLECTOR_URL` is set in `.env`
2. The collector URL is valid and accessible
3. Browser console shows "Grafana Faro initialized" message

### Missing Source Maps

Ensure:
1. `VITE_FARO_UPLOAD_SOURCEMAPS=true` is set during build
2. `VITE_FARO_COLLECTOR_URL` is set during build
3. `VITE_FARO_STACK_ID` is configured (if using Grafana Cloud)
4. Build is running in production mode (`npm run build`)

### Build Memory Issues (Netlify/Other Platforms)

If builds fail with "heap out of memory" errors:
1. Keep `VITE_FARO_UPLOAD_SOURCEMAPS` unset or set to `false`
2. Source maps will still be generated locally but not uploaded
3. You can manually upload source maps to Grafana after the build if needed
4. Consider using a platform with more memory for builds with source map uploads enabled

### High Data Volume

If data volume is too high:
1. Reduce sampling rate (requires code changes)
2. Disable console log capture (requires code changes)
3. Filter events in Grafana

## Resources

- [Grafana Faro Documentation](https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/)
- [Faro Web SDK](https://github.com/grafana/faro-web-sdk)
- [Source Map Plugin](https://github.com/grafana/faro-web-sdk/tree/main/packages/rollup-plugin)

## Dependencies

- `@grafana/faro-web-sdk`: Frontend observability SDK
- `@grafana/faro-web-tracing`: Distributed tracing instrumentation
- `@grafana/faro-rollup-plugin`: Build-time source map upload plugin

/**
 * Grafana Faro Frontend Observability Configuration
 * 
 * Initializes Faro for frontend monitoring, error tracking, and tracing.
 * This module is imported and called early in the application lifecycle.
 */

import { getWebInstrumentations, initializeFaro, type Faro } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

let faroInstance: Faro | null = null;

/**
 * Initialize Grafana Faro for frontend observability
 * Should be called as early as possible in the application lifecycle
 */
export function initFaro(): Faro | null {
  // Only initialize once
  if (faroInstance) {
    return faroInstance;
  }

  // Get configuration from environment variables
  const collectorUrl = import.meta.env.VITE_FARO_COLLECTOR_URL;
  const appName = import.meta.env.VITE_FARO_APP_NAME || 'easyshifthq';
  const appVersion = import.meta.env.VITE_FARO_APP_VERSION || '1.0.0';
  const environment = import.meta.env.VITE_FARO_ENVIRONMENT || import.meta.env.MODE || 'production';

  // Skip initialization if collector URL is not configured
  if (!collectorUrl) {
    console.warn('Grafana Faro collector URL not configured. Frontend observability will be disabled.');
    return null;
  }

  try {
    faroInstance = initializeFaro({
      url: collectorUrl,
      app: {
        name: appName,
        version: appVersion,
        environment,
      },
      instrumentations: [
        // Mandatory, omits default instrumentations otherwise.
        ...getWebInstrumentations({
          captureConsole: true,
        }),

        // Tracing package to get end-to-end visibility for HTTP requests.
        new TracingInstrumentation(),
      ],
    });

    console.log(`Grafana Faro initialized for ${appName} (${environment})`);
    return faroInstance;
  } catch (error) {
    console.error('Failed to initialize Grafana Faro:', error);
    return null;
  }
}

/**
 * Get the Faro instance (if initialized)
 */
export function getFaro(): Faro | null {
  return faroInstance;
}

/**
 * Start a user action manually for tracking user journeys.
 * Use this for programmatic actions or when data-faro-user-action-name attribute isn't suitable.
 * 
 * For automatic tracking, add data-faro-user-action-name="action-name" attribute to HTML elements.
 * 
 * @example
 * // Manual tracking
 * startUserAction('checkout', { cartSize: '3', paymentMethod: 'card' });
 * 
 * // Automatic tracking (in JSX)
 * <button data-faro-user-action-name="add-to-cart">Add to cart</button>
 */
export function startUserAction(
  name: string,
  attributes?: Record<string, string>,
  options?: { triggerName?: string; importance?: 'normal' | 'critical' }
): void {
  if (faroInstance?.api?.startUserAction) {
    faroInstance.api.startUserAction(name, attributes, options);
  }
}
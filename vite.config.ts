import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  const plugins: PluginOption[] = [react()];

  const shouldUploadFaroSourcemaps =
    mode === "production" &&
    process.env.VITE_FARO_COLLECTOR_URL &&
    process.env.VITE_FARO_UPLOAD_SOURCEMAPS === "true";

  const enableSourceMaps =
    mode !== "production" ||
    shouldUploadFaroSourcemaps ||
    process.env.VITE_ENABLE_SOURCEMAPS === "true"; // opt-in for production to avoid OOM on constrained builders
  
  // Add development-only plugins
  if (mode === "development") {
    plugins.push(componentTagger() as unknown as import("vite").Plugin);
  }
  
  // Add Faro source map upload plugin for production builds
  // Only when explicitly enabled via VITE_FARO_UPLOAD_SOURCEMAPS=true
  // This prevents memory issues during builds on platforms with limited resources
  if (shouldUploadFaroSourcemaps) {
    try {
      // Dynamic import to handle CommonJS module
      const faroPlugin = await import("@grafana/faro-rollup-plugin");
      const faroRollupPlugin = faroPlugin.default;
      
      if (typeof faroRollupPlugin === 'function') {
        plugins.push(
          faroRollupPlugin({
            appName: process.env.VITE_FARO_APP_NAME || "easyshifthq",
            appId: process.env.VITE_FARO_APP_ID || "easyshifthq",
            endpoint: process.env.VITE_FARO_COLLECTOR_URL!,
            stackId: process.env.VITE_FARO_STACK_ID!,
            apiKey: process.env.VITE_FARO_API_KEY || "",
          }) as unknown as import("vite").Plugin
        );
      }
    } catch (error) {
      console.warn('Failed to load Faro Rollup plugin:', error);
    }
  }

  return {
    server: {
      host: "::",
      port: 8080,
    },
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      // Only enable sourcemaps when explicitly requested to keep memory low on CI builders
      sourcemap: enableSourceMaps,
      rollupOptions: {
        output: {
          manualChunks: {
            // Split vendor chunks to reduce memory usage during build
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-select'],
            'chart-vendor': ['recharts'],
          },
        },
      },
    },
  };
});

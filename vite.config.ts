import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  const plugins = [react()];
  
  // Add development-only plugins
  if (mode === "development") {
    plugins.push(componentTagger());
  }
  
  // Add Faro source map upload plugin for production builds
  // Only when explicitly enabled via VITE_FARO_UPLOAD_SOURCEMAPS=true
  // This prevents memory issues during builds on platforms with limited resources
  if (
    mode === "production" && 
    process.env.VITE_FARO_COLLECTOR_URL && 
    process.env.VITE_FARO_UPLOAD_SOURCEMAPS === "true"
  ) {
    try {
      // Dynamic import to handle CommonJS module
      const faroPlugin = await import("@grafana/faro-rollup-plugin");
      const faroRollupPlugin = faroPlugin.default || faroPlugin.faroRollupPlugin;
      
      if (typeof faroRollupPlugin === 'function') {
        plugins.push(
          faroRollupPlugin({
            appName: process.env.VITE_FARO_APP_NAME || "easyshifthq",
            appVersion: process.env.VITE_FARO_APP_VERSION || "1.0.0",
            endpoint: process.env.VITE_FARO_COLLECTOR_URL,
            stackId: process.env.VITE_FARO_STACK_ID,
          })
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
      sourcemap: true, // Always generate source maps for production debugging
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

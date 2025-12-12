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
  if (mode === "production" && process.env.VITE_FARO_COLLECTOR_URL) {
    // Dynamic import to handle CommonJS module
    const { faroRollupPlugin } = await import("@grafana/faro-rollup-plugin");
    plugins.push(
      faroRollupPlugin({
        appName: process.env.VITE_FARO_APP_NAME || "easyshifthq",
        appVersion: process.env.VITE_FARO_APP_VERSION || "1.0.0",
        endpoint: process.env.VITE_FARO_COLLECTOR_URL,
        stackId: process.env.VITE_FARO_STACK_ID,
      })
    );
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
    },
  };
});

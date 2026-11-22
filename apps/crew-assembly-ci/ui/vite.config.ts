import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Builds `src/App.tsx` into `dist/index.mjs`, the ESM module that `app.json` names as `ui.entry`.
 *
 * The Kiro Crew host resolves `@kirocrew/app-sdk`, `@kirocrew/app-sdk/ui`, `react`, `react-dom`
 * and `react/jsx-runtime` through its import map. They are external here, so the bundle holds only
 * this app's own code and a second copy of React never loads.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    minify: "esbuild",
    lib: {
      entry: "src/App.tsx",
      formats: ["es"],
      fileName: () => "index.mjs",
    },
    rollupOptions: {
      external: ["@kirocrew/app-sdk", "@kirocrew/app-sdk/ui", "react", "react-dom", "react/jsx-runtime"],
    },
  },
});

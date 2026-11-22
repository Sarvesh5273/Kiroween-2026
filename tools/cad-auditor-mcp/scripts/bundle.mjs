/**
 * Bundles `src/server.ts` into one self-contained `dist/server.js`.
 *
 * Why: `@unboltkit/core` and `@unboltkit/sample-kits` are workspace packages whose entry point is
 * TypeScript source with extensionless relative imports. Plain `node` cannot load that, so the
 * `tsc` output alone cannot run. esbuild compiles those sources into the bundle. `three` and
 * `three-mesh-bvh` stay external and load from node_modules, so there is one copy of `three`.
 *
 * This runs after `tsc -p tsconfig.json`, which type-checks everything and emits per-module JS.
 * The bundle then replaces `dist/server.js`.
 */
import { build } from "esbuild";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outfile = `${root}dist/server.js`;

await build({
  absWorkingDir: root,
  entryPoints: ["src/server.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  external: ["three", "three-mesh-bvh"],
  logLevel: "warning",
});
chmodSync(outfile, 0o755);
process.stderr.write(`bundled ${outfile}\n`);

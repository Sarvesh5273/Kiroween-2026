/**
 * Bundles `src/index.ts` into `dist/engine.mjs`, the module `run-audit.mjs` imports.
 *
 * Why a bundle: `@unboltkit/core`, `@unboltkit/sample-kits` and the auditor in
 * `@unboltkit/cad-auditor-mcp` are workspace packages whose entry points are TypeScript with
 * extensionless imports, which plain `node` cannot load. esbuild compiles them into one file.
 * `three` and `three-mesh-bvh` stay external so there is a single copy of `three`.
 *
 * The auditor is bundled from its source, so this app audits with the same code as the MCP
 * server and `tools/cad-auditor-mcp` is not modified.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: ["src/index.ts"],
  outfile: "dist/engine.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  external: ["three", "three-mesh-bvh"],
  logLevel: "warning",
});
process.stderr.write(`bundled ${root}dist/engine.mjs\n`);

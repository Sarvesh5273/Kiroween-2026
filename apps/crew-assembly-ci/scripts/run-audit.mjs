#!/usr/bin/env node
/**
 * CI entry point: audit a CAD assembly and write `disassembly-manifest.json`.
 *
 *   node scripts/run-audit.mjs --kit haunted-clockwork-lockbox
 *   node scripts/run-audit.mjs --glb path/to/assembly.glb
 *   node scripts/run-audit.mjs --baseline <kit|.glb> --candidate <kit|.glb>
 *
 * Exit code 0 means pass, 1 means CI fail (deadlock, regression, oracle clash or audit error),
 * 2 means bad usage. Run `npm run build` once first. The logic is in `src/cli.ts`.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const enginePath = fileURLToPath(new URL("../dist/engine.mjs", import.meta.url));

if (!existsSync(enginePath)) {
  process.stderr.write(
    "dist/engine.mjs is missing. Build it first:\n  npm --workspace=@unboltkit/crew-assembly-ci run build\n",
  );
  process.exit(2);
}

const { runCli } = await import(pathToFileURL(enginePath).href);

const code = runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  now: () => new Date(),
  cwd: process.cwd(),
});
process.exitCode = code;

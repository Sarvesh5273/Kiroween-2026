# UnboltKit Assembly CI

A Kiro Crew app that audits `.glb` CAD assemblies in CI. It finds Tarjan SCC deadlock traps, finds parts that became harder to reach (repairability depth regressions), and writes a `disassembly-manifest.json` report. It runs the same engine as the `cad-assembly-auditor` MCP server (`tools/cad-auditor-mcp`), so CI and the agent give the same answers.

## What is in the app

| Path | Purpose |
| --- | --- |
| `app.json` | Kiro Crew manifest: name, icon, agent, skill, UI page, permissions. |
| `assets/icon.png` | 256x256 RGBA icon, written by `scripts/generate-icon.mjs` with `node:zlib`. |
| `agents/assembly-auditor.json` | Agent that lists changed `.glb` files, calls `inspect_assembly_dbg` and `diff_repairability`, and emits the manifest. |
| `skills/assembly-ci-audit/SKILL.md` | Triage steps for deadlock cycles, depth diffs and manifest generation. |
| `scripts/run-audit.mjs` | CI entry point. Logic is in `src/cli.ts` and `src/manifest.ts`. |
| `ui/` | Dashboard page. `ui/src/App.tsx` builds to `ui/dist/index.mjs`. |
| `test/crew-app.test.ts` | Validates every file above and runs the real audit script. |

## Setup

```sh
npm install                                        # from the workspace root
npm --workspace=@unboltkit/crew-assembly-ci run build
```

`build` does two things:

1. `scripts/build-engine.mjs` bundles `src/index.ts`, including the auditor from `@unboltkit/cad-auditor-mcp`, `@unboltkit/core` and `@unboltkit/sample-kits`, into `dist/engine.mjs`. Those workspace packages ship TypeScript, which plain `node` cannot load. `three` and `three-mesh-bvh` stay external.
2. `vite build` compiles `ui/src/App.tsx` to `ui/dist/index.mjs`.

## Run an audit

From `apps/crew-assembly-ci` (use `--` so npm passes the flags on):

```sh
# A bundled sample kit
npm run audit -- --kit haunted-clockwork-lockbox

# A .glb file
npm run audit -- --glb path/to/assembly.glb

# Candidate against baseline. A value ending in .glb is a file, anything else is a kit name.
npm run audit -- --baseline main.glb --candidate pr.glb
```

Or call the script directly from anywhere: `node apps/crew-assembly-ci/scripts/run-audit.mjs --kit <name>`.

| Option | Meaning |
| --- | --- |
| `--out <path>` | Manifest path. Default: `disassembly-manifest.json` in the current directory. |
| `--fail-on-depth-regression` | Also fail when a part needs more removals before it than in the baseline. |
| `--quiet` | Print only the verdict. |
| `--list-kits` | List the bundled kits. |

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Pass. |
| 1 | CI fail: a deadlock (single audit) or a new deadlock cycle (diff), an oracle clash above 0, an audit error, or a depth regression with `--fail-on-depth-regression`. |
| 2 | Bad usage, a missing `dist/engine.mjs`, or the manifest could not be written. |

Example on `deadlock-cage-dumbbell-ring`:

```
Status:   deadlocked, 2 parts, 1920 triangles
Tarjan SCC deadlock: {dumbbell, captive_ring}
  dumbbell is blocked by captive_ring in 32 directions, e.g. (1.00, 0.00, 0.00)
  captive_ring is blocked by dumbbell in 32 directions, e.g. (1.00, 0.00, 0.00)
CI verdict: FAIL: Deadlock: 1 Tarjan SCC deadlock {dumbbell, captive_ring}.
```

In diff mode a depth regression is a warning by default, which matches `diff_repairability`. A candidate that is deadlocked in exactly the way its baseline was is a warning, not a failure.

## `disassembly-manifest.json`

Schema `unboltkit.disassembly-manifest/v1`, typed in `src/manifestTypes.ts`:

- `generatedAt`, `tool`, `mode` (`audit` or `diff`).
- `assembly`: `source`, `status` (`solved`, `deadlocked`, `error`), part and triangle counts, `clashes` (`oracle`, `naive`, `naiveObstructedParts`, `avoidedByPlan`), `repairability.steps` (1-based depth, part, motion primitive), `deadlock.sccs` with every witness edge, and `error`. In diff mode this is the candidate.
- `diff` (diff mode only): baseline summary, new and resolved SCCs, `depthRegressions`, `depthImprovements`, `addedParts`, `removedParts`.
- `verdict`: `ci` (`pass` or `fail`), `summary`, `reasons`, `warnings`.

## GitHub Actions example

```yaml
- run: npm ci && npm --workspace=@unboltkit/crew-assembly-ci run build
- run: git show origin/main:assets/gearbox.glb > /tmp/base.glb
- run: node apps/crew-assembly-ci/scripts/run-audit.mjs --baseline /tmp/base.glb --candidate assets/gearbox.glb --out disassembly-manifest.json
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: disassembly-manifest, path: disassembly-manifest.json }
```

## Agent and skill

`agents/assembly-auditor.json` registers the `cad-assembly-auditor` MCP server (`node tools/cad-auditor-mcp/dist/server.js`). Build it first with `npm --workspace=@unboltkit/cad-auditor-mcp run build`. A `SessionStart` hook lists `.glb` files that differ from `HEAD`. The agent then audits each one, alerts on new Tarjan SCC cycles and depth regressions, and runs `run-audit.mjs` to write the manifest. It never writes the manifest by hand.

## Dashboard

The Assembly CI page shows the CI verdict, deadlock cycle cards, per-part depth regressions, and naive versus DBG clash counts. It reads `disassembly-manifest.json` from the Kiro Crew host API and reloads on host events. Outside a host, or before a manifest exists, it shows a labeled sample so the page still renders.

`@kirocrew/app-sdk` is intentionally not installed. The Kiro Crew host provides it, `@kirocrew/app-sdk/ui`, `react`, `react-dom` and `react/jsx-runtime` through its import map. `ui/vite.config.ts` marks them external, and `ui/src/kirocrew-app-sdk.d.ts` declares the few SDK calls the page uses. The declarations are written from the app spec, so check them against the SDK version your host ships.

## Test and typecheck

```sh
npm --workspace=@unboltkit/crew-assembly-ci run typecheck
npm --workspace=@unboltkit/crew-assembly-ci test
```

The tests build `dist/` first if it is missing, then check `app.json`, the PNG bytes, the agent, the skill, the UI bundle (SDK kept external), and run `run-audit.mjs` for real: a pass on `haunted-clockwork-lockbox`, a failure with a verified Tarjan SCC witness on `deadlock-cage-dumbbell-ring`, an unknown kit, and two diffs.

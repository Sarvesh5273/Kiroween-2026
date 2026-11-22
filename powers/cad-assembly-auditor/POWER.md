---
name: cad-assembly-auditor
displayName: CAD Assembly Auditor
description: Audit 3D assemblies (.glb or bundled sample kits) with the UnboltKit disassembly engine. Reports solved or deadlocked status, ordered removal steps with repairability depth, Tarjan SCC deadlock cycles, and CI diffs between a baseline and a candidate.
keywords: ["cad", "glb", "gltf", "disassembly", "deadlock", "repairability", "tarjan", "unboltkit"]
---

# CAD Assembly Auditor

Runs the UnboltKit pipeline (parse, normalize, build the directional blocking graph, peel, compile motion primitives) on demand, plus an independent clash oracle. It is a local stdio MCP server, `cad-assembly-auditor`.

## Setup

Build the server once from the workspace root. The server runs from `tools/cad-auditor-mcp/dist/server.js`.

```
npm install
npm --workspace=@unboltkit/cad-auditor-mcp run build
```

The workspace config `.kiro/settings/mcp.json` registers it as `cad-assembly-auditor` (`node tools/cad-auditor-mcp/dist/server.js`). This power's `mcp.json` holds the same entry.

## Tools

### `list_sample_kits`

No arguments. Returns the five bundled kits: `mechanical-keyboard-65`, `planetary-gearbox-3-stage`, `haunted-clockwork-lockbox` (showcase), and `deadlock-cage-dumbbell-ring`, `deadlock-cage-ship-in-bottle` (deadlock cages).

### `inspect_assembly_dbg`

Arguments: exactly one of `kitName` or `glbPath`.

```json
{ "kitName": "haunted-clockwork-lockbox" }
{ "glbPath": "assets/gearbox.glb" }
```

Key result fields:

- `status`: `solved`, `deadlocked` or `error`. On `error`, read `error.kind` and `error.message` (for example `MonolithicMeshError` for a one-island mesh).
- `partCount`, `totalTriangles`, `polyBudgetExceeded`.
- `steps`: removal order. `repairabilityDepth` is 1-based, so depth 1 comes out with nothing removed first. Each step has `partId`, `name`, `primitive` and `escapeDistance`.
- `oracleTotalClashes`: collisions found by the independent checker when each step is replayed. Anything above 0 is a solver bug.
- `naiveTotalClashes`, `naiveObstructedParts`: what a plain radial explosion would hit. This is the baseline the plan beats.
- `deadlockWitness`: present only when `status` is `deadlocked`. It lists the SCCs (cycles of parts that block each other) and the `unassigned` parts, which are unremoved parts outside every cycle.

### `diff_repairability`

Arguments: `baseline` and `candidate` (each `{ kitName }` or `{ glbPath }`), and an optional `targetPartFilter` (a name or Part_ID, or an array of them, where `*` is a wildcard).

Key result fields:

- `passed`: `false` on any deadlock regression or audit error. This is the CI verdict.
- `deadlock.newSccs`: cycles the candidate has that the baseline does not.
- `depthRegressions`: parts with `baselineDepth -> candidateDepth` and `delta`. A part stuck in a deadlock has `candidateDepth: null`.
- `clashDeltas`: baseline, candidate and delta for the oracle and naive totals.
- `warnings`: depth regressions and oracle clashes. They do not fail `passed` by themselves.

Parts are matched across the two assemblies by name when the name is unique, otherwise by Part_ID.

## When to use it

- After editing a CAD export or a sample kit, to check the assembly still comes apart.
- In a review, to compare a pull request's `.glb` with the one on the main branch.
- To explain why an assembly cannot be disassembled. See the `cad-audit` skill.

## Limits

- `.glb` only (glTF 2.0 binary with the data in the file). External `.bin` files, sparse accessors and non-triangle primitives are not read.
- Large assemblies take seconds. Total triangles above 150,000 set `polyBudgetExceeded` and the engine samples.
- A single connected mesh (one island) cannot be split into parts and returns `MonolithicMeshError`.

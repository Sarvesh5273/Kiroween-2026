---
name: cad-audit
description: Audit a 3D assembly (.glb or bundled kit) for disassembly deadlocks and repairability depth regressions using the cad-assembly-auditor MCP tools. Use when asked whether an assembly can be taken apart, why it cannot, or whether a change made parts harder to reach.
---

# CAD audit

Use the `cad-assembly-auditor` MCP tools. Do not guess from file names or part counts.

## 1. Audit one assembly

1. Call `inspect_assembly_dbg` with `kitName` or `glbPath`.
2. Branch on `status`.
   - `error`: report `error.kind` and `error.message`, then stop. `MonolithicMeshError` means the file is one connected mesh, so there are no separate parts to remove. Suggest exporting the parts as separate meshes. Do not try to work around it.
   - `solved`: the plan is a valid removal order. Go to step 2.
   - `deadlocked`: some parts block each other. Go to step 3.
3. Check `oracleTotalClashes`. It must be 0. A non-zero value means the plan is unsafe. Report it as a defect in the engine or the input, not as a result.
4. Check `polyBudgetExceeded`. If true, say the engine sampled the triangles and the result is approximate.

## 2. Read a solved plan

- `steps` is the removal order. `repairabilityDepth` 1 is the first part out. A larger depth means more parts must come off first.
- The deepest parts are the hardest to service. List the top few by depth with their `name`.
- `primitive` tells how the part moves: `linear_slide` (pull straight out), `helical_unscrew` (fasteners), `two_step_l_slide` (out, then sideways).
- Compare `naiveTotalClashes` with `oracleTotalClashes` to show what the plan avoids. A plain radial explosion would hit `naiveObstructedParts` parts.

## 3. Interpret a deadlock

A deadlock is a strongly connected component (SCC, found with Tarjan's algorithm) in the blocking graph. Every part in an SCC is blocked by another part of the same SCC in each candidate direction, so none can move first.

1. Read `deadlockWitness.sccs`. Each has `names` and `partIds` (at least two parts) and `edges`.
2. Each edge `from -> to` means `from` cannot move along `dir` because `to` is in the way. List the cycle in plain words, for example "dumbbell is blocked by captive_ring and captive_ring is blocked by dumbbell".
3. `deadlockWitness.unassigned` lists parts that were not removed and are in no cycle. A cycle blocks them, but they are not part of it. Parts in `steps` were removed before the deadlock and are valid.
4. Suggest the smallest geometry change that breaks the cycle: open a gap in one part of the SCC, split one part into two, or add a removable fastener. Say which part and why.

## 4. Compare a change with a baseline

1. Call `diff_repairability` with `baseline` and `candidate`. Use `targetPartFilter` only if the user names specific parts.
2. Read `passed`. It is `false` on a deadlock regression or an audit error. Report `verdict` and every entry of `reasons`.
3. List `deadlock.newSccs`. Each one is a new cycle the change introduced.
4. List `depthRegressions` as `name: baselineDepth -> candidateDepth (delta)`. Sort by `delta`, largest first. A `candidateDepth` of `null` means the part is now stuck in a deadlock, which is the worst case.
5. Flag regressions even when `passed` is true. They are in `warnings`. A part that moved from depth 2 to depth 9 is a servicing regression that CI does not block.
6. Mention `addedParts` and `removedParts`. Depth shifts in other parts can come from an added part, so name that cause.
7. Report `clashDeltas`. A candidate `oracleTotalClashes` above 0 needs a separate warning.

## Report format

Start with the verdict in one line: solved or deadlocked, `passed` or not. Then give only the numbers and part names that support it. Do not paste the full JSON.

## Rules

- Run audits one at a time. Large assemblies take seconds.
- If the server is not available, say the server must be built with `npm --workspace=@unboltkit/cad-auditor-mcp run build`. Do not edit `packages/` or `apps/` to make an audit pass.
- Do not change a result to match an expectation. Report what the tool returned.

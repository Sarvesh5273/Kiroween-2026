---
name: assembly-ci-audit
description: Audit a changed 3D assembly (.glb or bundled sample kit) in CI. Triage Tarjan SCC deadlock cycles, diff per-part repairability depth against a baseline, and generate disassembly-manifest.json. Use when a .glb changes, when asked whether a change broke disassembly, or when a CI manifest is needed.
---
# Assembly CI audit

Use the `cad-assembly-auditor` MCP tools (`inspect_assembly_dbg`, `diff_repairability`) for the analysis and `scripts/run-audit.mjs` for the manifest. Do not guess from file names or part counts.

## Terms

- **Repairability depth**: the 1-based position of a part in the removal order. Depth 1 comes out first. A larger depth means more parts must come off before it.
- **Deadlock**: a strongly connected component (SCC, found with Tarjan's algorithm) in the directional blocking graph. In every candidate direction, each part of the SCC is blocked by another part of the same SCC, so none of them can move first.
- **Oracle clashes**: collisions found by the independent `Clash_Checker` when the plan is replayed. Must be 0.
- **Naive clashes**: collisions a plain radial explode would cause. This is what the plan avoids.

## 1. Deadlock cycle triage

1. Call `inspect_assembly_dbg` with `glbPath` (or `kitName`). Branch on `status`.
   - `error`: report `error.kind` and `error.message`, then stop. `MonolithicMeshError` means one connected mesh, so there are no separate parts. Suggest exporting the parts as separate meshes.
   - `solved`: go to section 2.
   - `deadlocked`: continue below.
2. Read `deadlockWitness.sccs`. Each SCC has `names`, `partIds` (at least two) and `edges`.
3. Each edge `from -> to` means `from` cannot move along `dir` because `to` is in the way. Write the cycle in plain words, for example "dumbbell is blocked by captive_ring, and captive_ring is blocked by dumbbell".
4. `deadlockWitness.unassigned` lists parts that were not removed and are in no cycle. A cycle blocks them, but they are not in it. Parts in `steps` came out before the deadlock and are valid.
5. Suggest the smallest geometry change that breaks the cycle and name the part: open a gap in one part of the SCC, split one part in two, or add a removable fastener.
6. A deadlock in the candidate is a CI failure. In diff mode it fails only if the baseline did not already have that cycle (`deadlock.newSccs` is not empty).
7. If `oracleTotalClashes` is above 0, report the plan as unsafe and a defect in the engine or the input. Do not present it as a result.

## 2. Repairability depth diffing

1. Get the baseline file with `git show <base-ref>:<path> > <temp>.glb`. If the file is new, skip the diff and audit it alone.
2. Call `diff_repairability` with `baseline` and `candidate` (each `{ "glbPath": "..." }` or `{ "kitName": "..." }`). Add `targetPartFilter` only when the user names parts.
3. Read `passed`. It is `false` on a new deadlock or an audit error. Report `verdict` and every entry of `reasons`.
4. List `depthRegressions` as `name: baselineDepth -> candidateDepth (delta)`, largest delta first.
   - `candidateDepth: null` means the part is now stuck in a deadlock. This is the worst case.
   - A part that moved from depth 2 to depth 9 is a servicing regression. It does not fail CI by default, but report it.
5. Mention `addedParts` and `removedParts`. Depth shifts in other parts can come from an added part, so name that cause.
6. Report `clashDeltas`. A candidate `oracleTotalClashes` above 0 fails CI.
7. Parts are matched across the two files by name when the name is unique, otherwise by Part_ID. Renamed parts show up as one removed and one added part.

## 3. Manifest generation

Never write `disassembly-manifest.json` by hand. Run the script from the workspace root so the file matches the schema `unboltkit.disassembly-manifest/v1`.

```
node apps/crew-assembly-ci/scripts/run-audit.mjs --glb <path> --out disassembly-manifest.json
node apps/crew-assembly-ci/scripts/run-audit.mjs --baseline <base.glb> --candidate <head.glb> --out disassembly-manifest.json
node apps/crew-assembly-ci/scripts/run-audit.mjs --kit haunted-clockwork-lockbox
```

- Add `--fail-on-depth-regression` only when the user wants strict mode.
- The manifest holds the timestamp, status, oracle versus naive clash counts, every part's repairability depth, the deadlock SCCs with their edges, the depth diff, and the `verdict`.
- Exit code: 0 pass, 1 CI fail (deadlock, regression, oracle clash or audit error), 2 usage error. If the script says `dist/engine.mjs` is missing, run `npm --workspace=@unboltkit/crew-assembly-ci run build`.
- If the manifest shows a verdict that disagrees with the MCP result, report both and say which tool produced which.

## Report format

Start with one line: the status (`solved` or `deadlocked`) and the CI verdict. Then give only the numbers and part names that support it: new cycles, depth regressions, oracle versus naive clashes, and the manifest path. Do not paste the full JSON.

## Rules

- Run audits one at a time. Large assemblies take seconds.
- Do not edit `packages/` or `apps/` to make an audit pass.
- Do not change a result to match an expectation. Report what the tool returned.

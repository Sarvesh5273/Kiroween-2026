---
inclusion: always
---

# Geometry Invariants

## Core engine purity
- `packages/unbolt-core` (`@unboltkit/core`) must stay 100% pure CPU TypeScript.
- Allowed dependencies: `three` and `three-mesh-bvh`.
- No DOM, WebGL, or `window` imports, directly or transitively.
- The identical engine must run in browser Web Workers, Vitest, and headless Node CI.

## Normalization
- Normalize every loaded assembly to `maxExtent = 1.0` before any DBG raycasting.

## Threading
- Never run BVH or DBG builds on the browser main thread.
- Run them in a Web Worker.

## Sample kits
- Build `packages/sample-kits` procedural kits with clean `ExtrudeGeometry` and `LatheGeometry`, plus PBR materials.
- Avoid deep `three-bvh-csg` boolean chains.

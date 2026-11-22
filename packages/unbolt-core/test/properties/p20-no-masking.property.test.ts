import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { expandAabb } from "../../src/math/aabb";
import { checkClashes } from "../../src/oracle/clashChecker";
import { filterNearest } from "../../src/stage2/hitFilter";
import { castAllHits, createRayHits, SLAB_MARGIN, type RayTarget } from "../../src/stage2/rayCast";
import { buildLayerScene, layerStackArbitrary } from "../arbitraries/layers";
import { domainMessage } from "../helpers/failWith";
import { referenceFaceNormals } from "../helpers/reference/clash";

/**
 * Property 20: discarded hits never mask a farther opposing hit (Req 13.5, 13.6, 20.8, 20.9).
 *
 * For a stack of 1 to 4 triangles along a ray, each coincident, grazing, back-facing or
 * opposing, with any Tau and Clearance_Epsilon, BOTH hit filters must classify the ray as an
 * Opposing_Normal_Collision exactly when some opposing layer lies at least Clearance_Epsilon
 * away, and both must report the triangle index of the nearest such layer:
 *  - the DBG filter (`castAllHits` followed by `filterNearest`), and
 *  - the Clash_Checker (`checkClashes`), whose four rays all see the same stack.
 */
const SEED = 0x20a1f1e;
const NUM_RUNS = 200;

describe("Property 20: discarded hits never mask a farther opposing hit", () => {
  it(`holds for the DBG hit filter and the Clash_Checker (seed ${SEED}, ${NUM_RUNS} runs)`, () => {
    let withOpposing = 0;
    let withoutOpposing = 0;
    let masked = 0;
    fc.assert(
      fc.property(layerStackArbitrary, fc.context(), (stack, ctx) => {
        const scene = buildLayerScene(stack);
        const hasOpposing = scene.expectedTriangle !== -1;
        const domain = {
          microShrink: stack.microShrink,
          clearanceEpsilon: stack.clearanceEpsilon,
          tau: stack.tau,
          rotation: stack.rotation,
          layerKinds: stack.layers.map((layer) => layer.kind),
          layerDistances: stack.layers.map((layer) => layer.distance),
          layerDots: stack.layers.map((layer) => layer.dot),
          permutation: stack.permutation,
          expectedTriangle: scene.expectedTriangle,
        };
        if (hasOpposing) {
          withOpposing++;
        } else {
          withoutOpposing++;
        }
        if (scene.masksOpposing) {
          masked++;
        }

        // DBG filter: every layer is hit, and the nearest surviving hit is the nearest opposing layer.
        const hits = createRayHits();
        const target: RayTarget = { bvh: scene.target.bvh, box: expandAabb(scene.target.aabb, SLAB_MARGIN) };
        castAllHits(target, scene.origin[0], scene.origin[1], scene.origin[2], scene.dir, hits);
        expect(hits.count, domainMessage(ctx, domain, "the ray must meet every layer")).toBe(stack.layers.length);
        const dbgTriangle = filterNearest(
          hits,
          scene.dir,
          referenceFaceNormals(scene.target),
          stack.clearanceEpsilon,
          stack.tau,
        );
        expect(dbgTriangle, domainMessage(ctx, domain, "DBG filter picked the wrong layer")).toBe(scene.expectedTriangle);

        // Clash_Checker: the moving triangle casts three vertex rays and one centroid ray.
        const result = checkClashes(scene.moving, scene.dir, [scene.target], {
          microShrink: stack.microShrink,
          clearanceEpsilon: stack.clearanceEpsilon,
          tau: stack.tau,
        });
        const movingRays = result.collisions.filter((collision) => collision.originSide === "moving");
        expect(
          result.collisions.length - movingRays.length,
          domainMessage(ctx, domain, "no ray of the target may reach the moving triangle"),
        ).toBe(0);
        expect(result.count, domainMessage(ctx, domain, "Clash_Checker collision count")).toBe(hasOpposing ? 4 : 0);
        for (const collision of movingRays) {
          expect(collision.hitPartId).toBe("target");
          expect(
            collision.hitTriangle,
            domainMessage(ctx, { ...domain, origin: `${collision.originKind} ${collision.originIndex}` }, "Clash_Checker picked the wrong layer"),
          ).toBe(scene.expectedTriangle);
        }
        expect(result.movingTriangles).toEqual(hasOpposing ? [0] : []);
        expect(result.staticTriangles).toEqual(hasOpposing ? [{ partId: "target", triangles: [scene.expectedTriangle] }] : []);
        return undefined;
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
    // Guard against a vacuous pass.
    expect(withOpposing).toBeGreaterThanOrEqual(30);
    expect(withoutOpposing).toBeGreaterThanOrEqual(10);
    expect(masked).toBeGreaterThanOrEqual(20);
  }, 300_000);
});

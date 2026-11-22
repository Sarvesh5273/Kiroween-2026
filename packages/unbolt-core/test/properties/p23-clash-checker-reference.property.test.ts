import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkClashes } from "../../src/oracle/clashChecker";
import { stage0ParseScene } from "../../src/stage0/stage0";
import { stage1Prepare } from "../../src/stage1/stage1";
import type { ClashPart, ClashResult, Vec3 } from "../../src/types";
import { assemblyArbitrary } from "../arbitraries/assemblies";
import { directionArbitrary, soupPart, soupSpecArbitrary } from "../arbitraries/soups";
import { domainMessage, type DomainContext } from "../helpers/failWith";
import { isPlainData } from "../helpers/plainData";
import { collisionKey, referenceClash, type ReferenceConfig } from "../helpers/reference/clash";

/**
 * Property 23: the Clash_Checker matches a brute-force reference (Req 20.1 to 20.7, 20.10).
 *
 * The reference enumerates welded vertices and positive-area centroids, computes ray origins on
 * its own, and intersects every ray with every triangle of its targets without a BVH and without
 * any culling. For the same inputs, the oracle must report the same count, the same colliding
 * triangle lists, and the same collisions (origin, hit triangle, and distance within 1e-9).
 *
 * Two generators feed it. Triangle soups add knife-edge vertices (a reversed copy of a
 * triangle), zero-area triangles, weld clusters, empty static sets and far-apart Parts.
 * Watertight assemblies from the shared generator run the full Stage 0 and Stage 1 path.
 */
const SOUP_SEED = 0x23c1a5b;
const ASSEMBLY_SEED = 0x23a55e7;
const SOUP_RUNS = 500;
const ASSEMBLY_RUNS = 100;
const DISTANCE_TOLERANCE = 1e-9;

const configArbitrary = fc.record({
  microShrink: fc.double({ min: 1e-3, max: 5e-2, noNaN: true }),
  clearanceFraction: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
  tau: fc.double({ min: 0, max: 0.9, noNaN: true }),
});

function toConfig(draw: { microShrink: number; clearanceFraction: number; tau: number }): ReferenceConfig {
  return { microShrink: draw.microShrink, clearanceEpsilon: draw.microShrink * draw.clearanceFraction, tau: draw.tau };
}

/** Orders collisions as documented: moving before static, then Part_ID, vertex before centroid, then origin index. */
function documentedOrderKey(collision: ClashResult["collisions"][number]): [number, string, number, number] {
  return [collision.originSide === "moving" ? 0 : 1, collision.originPartId, collision.originKind === "vertex" ? 0 : 1, collision.originIndex];
}

function expectAscendingUnique(values: readonly number[], label: string, message: string): void {
  for (let i = 1; i < values.length; i++) {
    expect(values[i] as number, `${label} must be ascending with no duplicates. ${message}`).toBeGreaterThan(values[i - 1] as number);
  }
}

function expectMatchesReference(
  actual: ClashResult,
  expected: ClashResult,
  ctx: fc.ContextValue,
  domain: DomainContext,
): void {
  const actualText = actual.collisions.map(collisionKey).sort();
  const expectedText = expected.collisions.map(collisionKey).sort();
  const onlyIn = (a: string[], b: string[]): string[] => a.filter((entry) => !b.includes(entry));
  const message = (text: string): string =>
    domainMessage(
      ctx,
      {
        ...domain,
        onlyInOracle: onlyIn(actualText, expectedText),
        onlyInReference: onlyIn(expectedText, actualText),
        oracleStaticTriangles: JSON.stringify(actual.staticTriangles),
        referenceStaticTriangles: JSON.stringify(expected.staticTriangles),
      },
      text,
    );
  expect(actual.count, message("collision count")).toBe(expected.count);
  expect(actual.movingTriangles, message("movingTriangles")).toEqual(expected.movingTriangles);
  expect(actual.staticTriangles, message("staticTriangles")).toEqual(expected.staticTriangles);

  const byKey = (a: ClashResult["collisions"][number], b: ClashResult["collisions"][number]): number => {
    const ka = collisionKey(a);
    const kb = collisionKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
  const actualSorted = actual.collisions.slice().sort(byKey);
  const expectedSorted = expected.collisions.slice().sort(byKey);
  expect(actualSorted.map(collisionKey), message("collision records")).toEqual(expectedSorted.map(collisionKey));
  actualSorted.forEach((collision, i) => {
    const reference = expectedSorted[i];
    expect(Math.abs(collision.distance - (reference?.distance ?? Number.NaN)), message(`distance of ${collisionKey(collision)}`)).toBeLessThanOrEqual(
      DISTANCE_TOLERANCE,
    );
  });

  // Result shape: sorted lists, documented collision order, plain data.
  expectAscendingUnique(actual.movingTriangles, "movingTriangles", message("list order"));
  for (const entry of actual.staticTriangles) {
    expectAscendingUnique(entry.triangles, `staticTriangles ${entry.partId}`, message("list order"));
  }
  const partIds = actual.staticTriangles.map((entry) => entry.partId);
  expect(partIds, message("staticTriangles must be sorted by Part_ID")).toEqual(partIds.slice().sort());
  const orderKeys = actual.collisions.map((collision) => JSON.stringify(documentedOrderKey(collision)));
  const reordered = actual.collisions
    .slice()
    .sort((a, b) => {
      const ka = documentedOrderKey(a);
      const kb = documentedOrderKey(b);
      return ka[0] - kb[0] || (ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0) || ka[2] - kb[2] || ka[3] - kb[3];
    })
    .map((collision) => JSON.stringify(documentedOrderKey(collision)));
  expect(orderKeys, message("collisions must be in documented order")).toEqual(reordered);
  expect(isPlainData(actual), message("the result must be plain data")).toBe(true);
}

function expectRepeatable(first: ClashResult, again: ClashResult, ctx: fc.ContextValue, domain: DomainContext): void {
  // Req 20.14: the same inputs give the same count, lists and records, bit for bit.
  expect(again, domainMessage(ctx, domain, "a second call must return an identical result")).toStrictEqual(first);
}

describe("Property 23: the Clash_Checker matches a brute-force reference", () => {
  it(`agrees on triangle soups with knife-edge, zero-area and empty cases (seed ${SOUP_SEED}, ${SOUP_RUNS} runs)`, () => {
    const seen = { runs: 0, withCollisions: 0, knifeEdgeRuns: 0, knifeEdgeCollisions: 0, zeroAreaRuns: 0, emptyStatics: 0, welded: 0, movingSide: 0, staticSide: 0, vertexRays: 0, centroidRays: 0 };
    fc.assert(
      fc.property(
        fc.record({
          moving: soupSpecArbitrary,
          statics: fc.array(soupSpecArbitrary, { minLength: 0, maxLength: 3 }),
          dir: directionArbitrary,
          config: configArbitrary,
        }),
        fc.context(),
        ({ moving, statics, dir, config }, ctx) => {
          const referenceConfig = toConfig(config);
          const movingPart = soupPart("moving", moving);
          const staticParts = statics.map((spec, i) => soupPart(`static-${i}`, spec));
          const domain: DomainContext = {
            dir,
            config: referenceConfig,
            moving: { positions: moving.positions, triangles: moving.triangles },
            statics: statics.map((spec) => ({ positions: spec.positions, triangles: spec.triangles })),
          };

          const actual = checkClashes(movingPart, dir, staticParts, referenceConfig);
          const expected = referenceClash(movingPart, dir, staticParts, referenceConfig);
          expectMatchesReference(actual, expected, ctx, domain);
          expectRepeatable(actual, checkClashes(movingPart, dir, staticParts, referenceConfig), ctx, domain);

          seen.runs++;
          seen.withCollisions += actual.count > 0 ? 1 : 0;
          seen.emptyStatics += staticParts.length === 0 ? 1 : 0;
          const anySoup = [moving, ...statics];
          seen.zeroAreaRuns += anySoup.some((spec) => spec.zeroArea) ? 1 : 0;
          seen.welded += anySoup.some((spec) => spec.duplicateVertices > 0) ? 1 : 0;
          if (anySoup.some((spec) => spec.knifeEdge)) {
            seen.knifeEdgeRuns++;
            seen.knifeEdgeCollisions += actual.count;
          }
          for (const collision of actual.collisions) {
            seen.movingSide += collision.originSide === "moving" ? 1 : 0;
            seen.staticSide += collision.originSide === "static" ? 1 : 0;
            seen.vertexRays += collision.originKind === "vertex" ? 1 : 0;
            seen.centroidRays += collision.originKind === "centroid" ? 1 : 0;
          }
          return undefined;
        },
      ),
      { seed: SOUP_SEED, numRuns: SOUP_RUNS },
    );
    // Guard against a vacuous pass.
    expect(seen.runs).toBe(SOUP_RUNS);
    expect(seen.withCollisions).toBeGreaterThanOrEqual(40);
    expect(seen.emptyStatics).toBeGreaterThanOrEqual(5);
    expect(seen.knifeEdgeRuns).toBeGreaterThanOrEqual(40);
    expect(seen.knifeEdgeCollisions).toBeGreaterThan(0);
    expect(seen.zeroAreaRuns).toBeGreaterThanOrEqual(40);
    expect(seen.welded).toBeGreaterThanOrEqual(20);
    expect(seen.movingSide).toBeGreaterThan(0);
    expect(seen.staticSide).toBeGreaterThan(0);
    expect(seen.vertexRays).toBeGreaterThan(0);
    expect(seen.centroidRays).toBeGreaterThan(0);
  }, 300_000);

  it(`agrees on watertight assemblies through Stages 0 and 1 (seed ${ASSEMBLY_SEED}, ${ASSEMBLY_RUNS} runs)`, () => {
    const seen = { runs: 0, withCollisions: 0, emptyStatics: 0 };
    fc.assert(
      fc.property(
        fc.record({
          assembly: assemblyArbitrary({ minParts: 2, maxParts: 4 }),
          movingPick: fc.nat(1000),
          staticMask: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
          dir: directionArbitrary,
          tau: fc.double({ min: 0, max: 0.9, noNaN: true }),
        }),
        fc.context(),
        ({ assembly, movingPick, staticMask, dir, tau }, ctx) => {
          const solverConfig = { ...assembly.config, tau };
          const stage0 = stage0ParseScene(assembly.root, solverConfig);
          if (stage0.status !== "ok") {
            throw new Error(`Stage 0 returned ${stage0.error.kind}: ${stage0.error.message}`);
          }
          const stage1 = stage1Prepare(stage0, solverConfig);
          if (stage1.status !== "ok") {
            throw new Error(`Stage 1 returned ${stage1.error.kind}: ${stage1.error.message}`);
          }
          const moving: ClashPart | undefined = stage1.parts[movingPick % stage1.parts.length];
          if (moving === undefined) {
            throw new Error("the Assembly has no Parts");
          }
          const staticParts = stage1.parts.filter((part, i) => part.partId !== moving.partId && staticMask[i % staticMask.length] === true);
          const referenceConfig: ReferenceConfig = {
            microShrink: assembly.config.microShrink,
            clearanceEpsilon: assembly.config.clearanceEpsilon,
            tau,
          };
          const direction: Vec3 = dir;
          const domain: DomainContext = {
            layout: assembly.layout,
            se3: assembly.se3,
            movingPartId: moving.partId,
            staticPartIds: staticParts.map((part) => part.partId),
            dir: direction,
            config: referenceConfig,
          };

          const actual = checkClashes(moving, direction, staticParts, solverConfig);
          const expected = referenceClash(moving, direction, staticParts, referenceConfig);
          expectMatchesReference(actual, expected, ctx, domain);
          expectRepeatable(actual, checkClashes(moving, direction, staticParts, solverConfig), ctx, domain);

          seen.runs++;
          seen.withCollisions += actual.count > 0 ? 1 : 0;
          seen.emptyStatics += staticParts.length === 0 ? 1 : 0;
          return undefined;
        },
      ),
      { seed: ASSEMBLY_SEED, numRuns: ASSEMBLY_RUNS },
    );
    expect(seen.runs).toBe(ASSEMBLY_RUNS);
    expect(seen.withCollisions).toBeGreaterThanOrEqual(10);
  }, 900_000);
});

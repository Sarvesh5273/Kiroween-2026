import { type BufferGeometry, Group, Mesh } from "three";
import { AXIS_Y, setConstructionAxis } from "./shared/constructionAxis";
import {
  alignHolesToPrincipalAxes,
  arcPoints,
  assertFiniteGeometry,
  bisectRoot,
  buildKeyedScrew,
  circlePoints,
  crossMoment2,
  extrudeAlongY,
  gearOutline,
  gearRadii,
  keyedBorePoints,
  type Point2,
  polygonShape,
  signedArea,
  sortTrianglesByHeight,
  toShapeXZ,
  translateExact,
} from "./shared/geometry";
import { createMaterial, type FinishName } from "./shared/materials";
import { indexedName, NameRegistry } from "./shared/naming";
import { integerParam, resolveKitParams } from "./shared/params";

/**
 * 3-Stage Planetary Gearbox (Req 23.2): three planetary sets side by side along X in one flat
 * aluminium housing, closed by a graphite base and cover that four keyed fasteners clamp
 * together. Each stage is a child group `stage_N` with a sun, its planets, a ring gear around
 * them and a carrier plate on top.
 *
 * Layout, in millimetres with +Y up (about 520 × 185 × 33 overall):
 * - `housing_base`: extruded rounded-rectangle plate, 0 to 6.5, with a mounting tab, fastener
 *   holes and a drain hole.
 * - `housing`: extruded rounded-rectangle wall around the three stages, 7.1 to 27.3, with
 *   fastener holes and a sight hole. A 27 mm gutter separates it from the ring gears.
 * - `stage_N`, centred at x = (N − 2) · `STAGE_SPACING`: `sun_gear_N`, `planet_gear_N`s and
 *   `ring_gear_N` (internal teeth, keyed outer flat) from 7.1 to 21.1, and `carrier_N` from 21.7
 *   to 26.7 over the whole stage.
 * - `housing_cover`: extruded plate, 27.9 to 32.9, with a tab, fastener holes and a breather hole.
 * - `housing_fastener_N`: keyed pan-head screws through the cover and the housing wall into the
 *   base, in the long walls halfway between neighbouring stages.
 *
 * Blocking-coverage rules (Req 22.17). The DBG samples 48 points per Part, so every contact must be
 * broad or absent; a contact that only a silhouette vertex reaches cannot be detected. Hence:
 * - The assembly is flat and the gutter is wider than the housing is tall, so a Part moving at
 *   45° to the floor leaves the housing's height before it reaches a wall it is not facing.
 *   Stacked stages failed this rule: across stages, 3D diagonals met thin ring walls edge on.
 * - Stages repeat exactly along X, and `STAGE_SPACING` keeps Parts of different stages apart along
 *   every heading 45° off X.
 * - Teeth never interleave: neighbouring tip circles keep a clearance, so a gear moving across its
 *   neighbour's centre line meets nothing instead of grazing flanks.
 * - Planets sit on slots 22.5° off the Canonical_Directions, so no planet moves exactly along the
 *   ring's inner wall, and the sun–planet distance keeps the tip circles clear along every heading
 *   67.5° off their centre line.
 * - Every Part's principal axes lie on X, Y and Z: extrusion caps are mirror images, gear holes are
 *   turned onto the gear's own axes, and one solved hole balances each housing Part. An axis
 *   tilted by even 0.004 rad would meet a far Part through a sliver.
 */
export function buildPlanetaryGearbox3Stage(params?: { planetsPerStage?: number }): Group {
  const { planetsPerStage } = resolveKitParams<{ planetsPerStage: number }>("buildPlanetaryGearbox3Stage", params, {
    planetsPerStage: integerParam(3, 6, 3),
  });
  assertGearLayout(planetsPerStage);

  const names = new NameRegistry();
  const root = new Group();
  root.name = names.claim("planetary-gearbox");
  const add = (parent: Group, geometry: BufferGeometry, name: string, finish: FinishName, x = 0, z = 0): void => {
    const mesh = new Mesh(geometry, createMaterial(finish));
    mesh.name = names.claim(name);
    assertFiniteGeometry(geometry, mesh.name);
    mesh.position.set(x, 0, z);
    setConstructionAxis(mesh, AXIS_Y);
    parent.add(mesh);
  };

  add(root, buildBase(), "housing_base", "hardAnodizedGraphite");
  add(root, buildHousing(), "housing", "machinedAluminium");
  add(root, buildCover(), "housing_cover", "hardAnodizedGraphite");

  const slots = PLANET_SLOTS[planetsPerStage] ?? [];
  let planetIndex = 0;
  for (let k = 0; k < 3; k++) {
    const stage = new Group();
    stage.name = names.claim(indexedName("stage", k + 1));
    root.add(stage);
    const cx = (k - 1) * STAGE_SPACING;
    const finish = STAGE_FINISHES[k] ?? "groundSteel";
    add(stage, buildSun(k), indexedName("sun_gear", k + 1), finish, cx, 0);
    for (const slot of slots) {
      const [x, z] = polar(CENTRE_DISTANCE, SLOT_OFFSET + (slot * Math.PI) / 4);
      planetIndex++;
      add(stage, buildPlanet(slot, k), indexedName("planet_gear", planetIndex), finish, cx + x, z);
    }
    add(stage, buildCarrier(k), indexedName("carrier", k + 1), "phosphorBronze", cx, 0);
    add(stage, buildRing(k), indexedName("ring_gear", k + 1), "nitridedSteel", cx, 0);
  }

  FASTENERS.forEach(([x, z], k) => {
    add(root, buildFastener(), indexedName("housing_fastener", k + 1), "zincPlated", x, z);
  });
  return root;
}

// ---------------------------------------------------------------------------
// Dimensions (mm)
// ---------------------------------------------------------------------------

const GAP = 0.6;
const MODULE = 1.25;
const BACKLASH = 0.15;
const SUN_TEETH = 28;
const PLANET_TEETH = 18;
const RING_TEETH = 64;
const SUN = gearRadii({ teeth: SUN_TEETH, module: MODULE });
const PLANET = gearRadii({ teeth: PLANET_TEETH, module: MODULE });
/** Planet slots are 22.5° off the Canonical_Directions. */
const SLOT_OFFSET = Math.PI / 8;
/**
 * Sun–planet centre distance. Along a heading 67.5° off a sun–planet centre line, the tip
 * circles clear each other by `SIDE_MARGIN`: `CENTRE_DISTANCE · sin 67.5° = SUN.tip + PLANET.tip + SIDE_MARGIN`.
 */
const SIDE_MARGIN = 0.6;
const CENTRE_DISTANCE = (SUN.tip + PLANET.tip + SIDE_MARGIN) / Math.sin((3 * Math.PI) / 8);

const RING_CLEARANCE = 0.8;
/**
 * The ring's tooth spaces form an external involute outline whose root circle is the ring's tip
 * circle. Its module is solved so that the tips clear the planets by exactly `RING_CLEARANCE`.
 */
const RING_MODULE = (2 * (CENTRE_DISTANCE + PLANET.tip + RING_CLEARANCE)) / (RING_TEETH - 2.5);
const RING_SPACE = gearRadii({ teeth: RING_TEETH, module: RING_MODULE });
const RING_OUTER = RING_SPACE.tip + 4;
const RING_FLAT = RING_OUTER - 1.6;

const BASE_TOP = 6.5;
const FLOOR = BASE_TOP + GAP;
const GEAR_THICKNESS = 14;
const CARRIER_BOTTOM = FLOOR + GEAR_THICKNESS + GAP;
const CARRIER_THICKNESS = 5;
const CARRIER_RADIUS = RING_OUTER;
const CARRIER_TOP = CARRIER_BOTTOM + CARRIER_THICKNESS;
const HOUSING_TOP = CARRIER_TOP + GAP;
const COVER_BOTTOM = HOUSING_TOP + GAP;
const COVER_THICKNESS = 5;
const COVER_TOP = COVER_BOTTOM + COVER_THICKNESS;

/**
 * The housing is a rounded rectangle. A gutter wider than the housing is tall separates its walls
 * from the stages, so a stage Part moving at 45° rises or falls out of the wall's height before it
 * can reach it, and stage Parts meet the wall only face on. A rectangle (not a stadium) keeps that
 * true at the ends: along a corner diagonal each wall closes in at 1 mm per mm of rise.
 */
const GUTTER = 27;
const HOUSING_INNER = RING_OUTER + GUTTER;
const HOUSING_WALL = 9;
const HOUSING_OUTER = HOUSING_INNER + HOUSING_WALL;
/**
 * Distance between stage centres. Two Parts of different stages in one layer must miss each other
 * along a 45° heading: `STAGE_SPACING / √2 ≥ 2 · RING_OUTER + STAGE_MARGIN`.
 */
const STAGE_MARGIN = 4;
const STAGE_SPACING = Math.SQRT2 * (2 * RING_OUTER + STAGE_MARGIN);
const HOUSING_HALF_LENGTH = STAGE_SPACING + HOUSING_INNER;
const HOUSING_CORNER = 6;
const TAB_REACH = 10;
const TAB_HALF_WIDTH = 10;
/** The tab on the +X end sits off the centre line, which breaks the housing's Z mirror symmetry. */
const TAB_OFFSET = 14;

const FASTENER_SHAFT = 1.6;
const FASTENER_HOLE = FASTENER_SHAFT + 0.6;
/**
 * Fasteners run through the cover and the housing wall into the base, across the gutter from
 * every stage Part, so they hold all three housing Parts together.
 */
const FASTENER_TIP = 0.8;
const FASTENER_Z = HOUSING_INNER + HOUSING_WALL / 2;
/** Fasteners in the straight side walls, halfway between neighbouring stages. */
const FASTENERS: readonly Point2[] = [
  [-STAGE_SPACING / 2, -FASTENER_Z],
  [STAGE_SPACING / 2, -FASTENER_Z],
  [STAGE_SPACING / 2, FASTENER_Z],
  [-STAGE_SPACING / 2, FASTENER_Z],
];

/** Planet slots k at 22.5° + 45°·k (counter-clockwise seen from above), for 3 to 6 planets. */
const PLANET_SLOTS: Readonly<Record<number, readonly number[]>> = {
  3: [0, 3, 5],
  4: [0, 2, 4, 6],
  5: [0, 2, 3, 5, 6],
  6: [0, 1, 3, 4, 5, 7],
};
const STAGE_FINISHES: readonly FinishName[] = ["groundSteel", "titaniumNitride", "heatBluedSteel"];

/** World (x, z) at radius `r` and angle `a` measured counter-clockwise seen from above (+Y). */
const polar = (r: number, a: number): Point2 => [r * Math.cos(a), -r * Math.sin(a)];

/** Checks the clearances the layout relies on, so a dimension change cannot silently make Parts collide. */
function assertGearLayout(planetsPerStage: number): void {
  const fail = (what: string): never => {
    throw new RangeError(`planetary gearbox layout: ${what}`);
  };
  if (!(RING_SPACE.root >= CENTRE_DISTANCE + PLANET.tip + GAP - 1e-9)) fail("the planets reach the ring's teeth");
  if (!(RING_SPACE.tip + 1.5 <= RING_FLAT)) fail("the ring wall behind the teeth is too thin");
  if (!(GUTTER > HOUSING_TOP - FLOOR + 2)) fail("the gutter must be wider than the housing is tall");
  if (!(SUN.root > 9)) fail("the sun is too small for its bore");
  if (!(PLANET.root > 6.2)) fail("the planets are too small for their bores");
  const slots = PLANET_SLOTS[planetsPerStage] ?? fail(`no slots for ${planetsPerStage} planets`);
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const da = (Math.abs((slots[i] ?? 0) - (slots[j] ?? 0)) * Math.PI) / 4;
      if (!(2 * CENTRE_DISTANCE * Math.sin(da / 2) >= 2 * PLANET.tip + 2 * GAP)) fail("two planets overlap");
    }
  }
  if (!(FASTENER_HOLE + 1.5 <= HOUSING_WALL / 2)) fail("the fastener holes do not fit in the housing wall");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extrudes a world (x, z) outline with holes along +Y, every loop made counter-clockwise in the
 * shape plane first (three re-winds holes only together with a reversed outline).
 */
function extrudeXZ(outline: readonly Point2[], holes: readonly (readonly Point2[])[], depth: number, y0: number): BufferGeometry {
  const ccw = (loop: readonly Point2[]): Point2[] => {
    const shaped = toShapeXZ(loop);
    return signedArea(shaped) > 0 ? shaped : shaped.reverse();
  };
  return extrudeAlongY(polygonShape(ccw(outline), holes.map(ccw)), depth, y0);
}

/** Shape-plane (u, v) gear points to world (x, z). */
const fromShape = (points: readonly Point2[]): Point2[] => points.map(([u, v]) => [u, -v] as Point2);

/**
 * Slides a round hole of radius `r` with `n` points along the segment `from -> to` until the
 * cross-moment of `points` plus the hole vanishes, and returns the hole.
 */
function balancingHole(points: readonly Point2[], from: Point2, to: Point2, r: number, n: number, label: string): Point2[] {
  const at = (t: number): Point2[] => circlePoints(from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1]), r, n);
  return at(bisectRoot((t) => crossMoment2([...points, ...at(t)]), 0, 1, label));
}

/**
 * A rectangle of half-extents `hx` × `hz` in (x, z) with corner radius `r`, counter-clockwise.
 * With `tab`, a rectangular mounting tab stands out of the +X end, centred at z = `TAB_OFFSET`.
 */
function roundedBox(hx: number, hz: number, r: number, tab: boolean): Point2[] {
  const corner = (cx: number, cz: number, a0: number): Point2[] => arcPoints(cx, cz, r, a0, a0 + Math.PI / 2, 4);
  const points: Point2[] = [...corner(hx - r, -hz + r, -Math.PI / 2)];
  if (tab) {
    const z0 = TAB_OFFSET - TAB_HALF_WIDTH;
    const z1 = TAB_OFFSET + TAB_HALF_WIDTH;
    const tip = hx + TAB_REACH;
    points.push([hx, z0], [tip - 2, z0], [tip, z0 + 2], [tip, z1 - 2], [tip - 2, z1], [hx, z1]);
  }
  points.push(...corner(hx - r, hz - r, 0), ...corner(-hx + r, hz - r, Math.PI / 2), ...corner(-hx + r, -hz + r, Math.PI));
  return points;
}

const fastenerHoles = (): Point2[][] => FASTENERS.map(([x, z]) => circlePoints(x, z, FASTENER_HOLE, 16));

// ---------------------------------------------------------------------------
// Housing Parts
// ---------------------------------------------------------------------------

/** Base: a tabbed plate with fastener holes; a drain hole on a solved position balances it. */
const outerOutline = (): Point2[] => roundedBox(HOUSING_HALF_LENGTH + HOUSING_WALL, HOUSING_OUTER, HOUSING_CORNER + HOUSING_WALL, true);

function buildBase(): BufferGeometry {
  const outline = outerOutline();
  const holes = fastenerHoles();
  const z = HOUSING_INNER / 2;
  holes.push(balancingHole([...outline, ...holes.flat()], [-STAGE_SPACING, z], [STAGE_SPACING, z], 2.5, 16, "housing_base"));
  return extrudeXZ(outline, holes, BASE_TOP, 0);
}

/** Housing: a tabbed wall with fastener holes; a sight hole in the wall balances it. */
function buildHousing(): BufferGeometry {
  const outline = outerOutline();
  const holes: Point2[][] = [roundedBox(HOUSING_HALF_LENGTH, HOUSING_INNER, HOUSING_CORNER, false), ...fastenerHoles()];
  const z = FASTENER_Z;
  holes.push(balancingHole([...outline, ...holes.flat()], [-STAGE_SPACING / 2 + 8, -z], [STAGE_SPACING / 2 - 8, -z], 1.5, 12, "housing"));
  return extrudeXZ(outline, holes, HOUSING_TOP - FLOOR, FLOOR);
}

/** Cover: a tabbed plate with fastener holes; a breather hole on a solved position balances it. */
function buildCover(): BufferGeometry {
  const outline = outerOutline();
  const holes = fastenerHoles();
  const z = -HOUSING_INNER / 2;
  holes.push(balancingHole([...outline, ...holes.flat()], [-STAGE_SPACING, z], [STAGE_SPACING, z], 3, 16, "housing_cover"));
  return extrudeXZ(outline, holes, COVER_THICKNESS, COVER_BOTTOM);
}

function buildFastener(): BufferGeometry {
  const headBottom = COVER_TOP + GAP;
  const geometry = buildKeyedScrew({
    headRadius: 2.8,
    headHeight: 2.6,
    shaftRadius: FASTENER_SHAFT,
    shaftLength: headBottom - FASTENER_TIP,
    socket: { radius: 1.3, depth: 1.2 },
    flatFraction: 0.045,
    indexFraction: 0.025,
  });
  return sortTrianglesByHeight(translateExact(geometry, 0, headBottom, 0));
}

// ---------------------------------------------------------------------------
// Stage Parts (local frames centred on the stage axis or the planet axis)
// ---------------------------------------------------------------------------

/** Sun: keyed bore and an uneven pair of lightening holes, turned onto the gear's own axes. */
function buildSun(stage: number): BufferGeometry {
  const outline = gearOutline({ teeth: SUN_TEETH, module: MODULE, backlash: BACKLASH, phase: 0 });
  const r = SUN.root;
  const holes: Point2[][] = [keyedBorePoints(4, 2, 1.2, 0.3 + 0.4 * stage, 20)];
  holes.push(circlePoints(0.62 * r, 0.16 * r, 0.16 * r, 12), circlePoints(-0.3 * r, -0.55 * r, 0.11 * r, 12));
  return extrudeAlongY(polygonShape(outline, alignHolesToPrincipalAxes(outline, holes)), GEAR_THICKNESS, FLOOR);
}

/** Planet: keyed bore and two index holes, turned onto the gear's own axes. */
function buildPlanet(slot: number, stage: number): BufferGeometry {
  const outline = gearOutline({ teeth: PLANET_TEETH, module: MODULE, backlash: BACKLASH, phase: 0 });
  const key = 0.5 + 0.7 * slot + 0.3 * stage;
  const r = 0.66 * PLANET.root;
  const holes: Point2[][] = [keyedBorePoints(2.6, 1.2, 0.8, key, 18)];
  holes.push(circlePoints(r * Math.cos(key + 2), r * Math.sin(key + 2), 1.3, 16), circlePoints(r * Math.cos(key - 2.4), r * Math.sin(key - 2.4), 0.8, 12));
  return extrudeAlongY(polygonShape(outline, alignHolesToPrincipalAxes(outline, holes)), GEAR_THICKNESS, FLOOR);
}

/** Carrier: a plate over the whole stage with a keyed bore and two uneven windows. */
function buildCarrier(stage: number): BufferGeometry {
  const outline = circlePoints(0, 0, CARRIER_RADIUS, 96);
  const holes: Point2[][] = [keyedBorePoints(4, 2, 1.2, 1.2 + 0.5 * stage, 20)];
  holes.push(circlePoints(0.4 * CARRIER_RADIUS, 0.18 * CARRIER_RADIUS, 0.09 * CARRIER_RADIUS, 16));
  holes.push(circlePoints(-0.3 * CARRIER_RADIUS, -0.38 * CARRIER_RADIUS, 0.06 * CARRIER_RADIUS, 16));
  return extrudeAlongY(polygonShape(outline, alignHolesToPrincipalAxes(outline, holes)), CARRIER_THICKNESS, CARRIER_BOTTOM);
}

/**
 * Ring gear: an outer circle with a keyed flat on +X around internal teeth (the tooth spaces of
 * an external involute outline), with a timing hole in the solid band on a solved bearing that
 * cancels the cross-moment left by the flat.
 */
function buildRing(stage: number): BufferGeometry {
  const deduped: Point2[] = [];
  for (const [x, z] of circlePoints(0, 0, RING_OUTER, 120)) {
    const p: Point2 = [Math.min(x, RING_FLAT), z];
    const last = deduped[deduped.length - 1];
    if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) deduped.push(p);
  }
  const teeth = fromShape(gearOutline({ teeth: RING_TEETH, module: RING_MODULE, backlash: -BACKLASH, phase: Math.PI / RING_TEETH }));
  const band = (RING_SPACE.tip + RING_FLAT) / 2;
  const centre = Math.PI / 2 + (stage - 1) * 0.15;
  const at = (a: number): Point2[] => {
    const [x, z] = polar(band, a);
    return circlePoints(x, z, 0.8, 12);
  };
  const a = bisectRoot((t) => crossMoment2([...deduped, ...teeth, ...at(t)]), centre - Math.PI / 4, centre + Math.PI / 4, `ring_gear_${stage + 1}`);
  return extrudeXZ(deduped, [teeth, at(a)], GEAR_THICKNESS, FLOOR);
}

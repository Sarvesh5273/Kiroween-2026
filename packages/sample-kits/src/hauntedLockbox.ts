import { type BufferGeometry, Group, Mesh } from "three";
import { AXIS_Y, AXIS_Z, setConstructionAxis } from "./shared/constructionAxis";
import {
  alignHolesToPrincipalAxes,
  arcPoints,
  assertFiniteGeometry,
  buildKeyedScrew,
  buildLathe,
  circlePoints,
  ellipsePoints,
  extrudeAlongY,
  extrudeAlongZ,
  gearOutline,
  gearRadii,
  keyedBorePoints,
  meshingPhase,
  type Point2,
  polygonShape,
  scaleXZ,
  translateExact,
  windowPoints,
} from "./shared/geometry";
import { createMaterial, type FinishName } from "./shared/materials";
import { indexedName, NameRegistry } from "./shared/naming";
import { integerParam, resolveKitParams } from "./shared/params";

/**
 * Haunted Clockwork Lockbox (Req 23.3): an oval blackened-steel tin with a brass gear train
 * inside, a lid held down by two keyed copper screws in standoffs, and a copper clasp on a tab
 * of the lid.
 *
 * Layout, in millimetres with +Y up:
 * - `box_body`: lathe cup (outer radius 70, inner 63.5, floor 0 to 5, rim at 25), stretched
 *   ×1.08 along X so its in-plane variances differ, with a keyed outer flat on +X (under the
 *   latch tab) and a shallower flat on -Z.
 * - `lid`: extruded oval disc from 25.3 to 31.3, flush with both body flats except for a 12 mm
 *   latch tab on +X, with fastener holes, an oil hole over every spindle, and a keyhole placed
 *   so that the lid's principal axes lie exactly on X and Z.
 * - `clock_gear_N`: extruded involute gears standing on 6.1 (the wheel up to 16.6, the pinions
 *   up to 14.6) with keyed bores and asymmetric windows or index holes: a 24-tooth great wheel in
 *   the centre and 16-tooth pinions on its ±X and ±Z sides, phased as a meshing train and run
 *   with 0.6 mm tip clearance. Hole patterns are turned so each gear's principal axes lie on X
 *   and Z.
 * - `gear_spindle_N`: keyed lathe arbor pins standing on the floor and ending inside their
 *   gear's hub.
 * - `screw_standoff_N`: keyed lathe tubes with a blind bore, hanging under the lid on the
 *   diagonals; `lid_fastener_N`: keyed lathe screws through the lid into them.
 * - `latch`: extruded clasp gripping a tab on the lid's +X edge, with a thumb lever.
 *
 * Blocking-coverage rules (Req 22.17):
 * - Every centre-to-centre line between content Parts runs along a Canonical_Direction, and
 *   radii are chosen so that, for every horizontal canonical heading, two Parts either overlap
 *   broadly in projection or clear each other by at least 0.7 mm. Contacts are never slivers.
 * - Gear tips do not interleave, so moving a gear across its neighbour's centre line meets
 *   nothing instead of grazing a few tooth flanks.
 * - All content stays within about 34 mm of the centre, so rays rising at 35° or 45° from any
 *   content Part clear the rim instead of clipping the wall.
 *
 * Gaps are at least 0.3 mm, about 1.8e-3 × maxExtent.
 */
export function buildHauntedClockworkLockbox(params?: { gearCount?: number }): Group {
  const { gearCount } = resolveKitParams<{ gearCount: number }>("buildHauntedClockworkLockbox", params, {
    gearCount: integerParam(2, 5, 3),
  });

  const names = new NameRegistry();
  const root = new Group();
  root.name = names.claim("haunted-clockwork-lockbox");

  const add = (
    geometry: BufferGeometry,
    name: string,
    finish: FinishName,
    axis: readonly [number, number, number],
    x = 0,
    z = 0,
  ): void => {
    const mesh = new Mesh(geometry, createMaterial(finish));
    mesh.name = names.claim(name);
    assertFiniteGeometry(geometry, mesh.name);
    mesh.position.set(x, 0, z);
    setConstructionAxis(mesh, axis);
    root.add(mesh);
  };

  const train = gearTrain(gearCount);

  add(buildBody(), "box_body", "blackenedSteel", AXIS_Y);
  add(buildLid(train), "lid", "smokedSteel", AXIS_Y);
  add(buildLatch(), "latch", "brushedCopper", AXIS_Z);
  train.forEach((gear, k) => {
    add(buildGear(gear), indexedName("clock_gear", k + 1), k === 0 ? "agedBronze" : "antiqueBrass", AXIS_Y, gear.x, gear.z);
  });
  train.forEach((gear, k) => {
    add(buildSpindle(gear.kind), indexedName("gear_spindle", k + 1), "blackenedSteel", AXIS_Y, gear.x, gear.z);
  });
  STANDOFF_POSITIONS.forEach(([x, z], k) => {
    add(buildStandoff(), indexedName("screw_standoff", k + 1), "oxidisedCopper", AXIS_Y, x, z);
  });
  STANDOFF_POSITIONS.forEach(([x, z], k) => {
    add(buildFastener(), indexedName("lid_fastener", k + 1), "brushedCopper", AXIS_Y, x, z);
  });
  return root;
}

// ---------------------------------------------------------------------------
// Dimensions (mm)
// ---------------------------------------------------------------------------

const BODY_OUTER = 70;
const BODY_INNER = 63.5;
const BODY_STRETCH_X = 1.08;
const FLOOR_TOP = 5;
const RIM = 25;
const GAP = 0.3;
const CLEAR = 0.4;
/** The keyed outer flat on +X; the lid edge is flush with it apart from the latch tab. */
const FLAT_X = BODY_OUTER * BODY_STRETCH_X - 3.5;
/** The shallower flat on -Z (world z), shared by body and lid. */
const FLAT_MINUS_Z = -(BODY_OUTER - 2.5);

const LID_BOTTOM = RIM + GAP;
const LID_THICKNESS = 6;
const LID_TOP = LID_BOTTOM + LID_THICKNESS;
/** The lid's latch tab sticks out of the +X flat; the latch clasps it. */
const TAB_END = FLAT_X + 12;
const TAB_HALF_WIDTH = 8;
const LATCH_HALF_WIDTH = 3.5;

const GEAR_BOTTOM = 6.1;
/** Gear thickness by kind: the wheel stands 2 mm taller than the pinions. */
const GEAR_THICKNESS = { wheel: 10.5, pinion: 8.5 } as const;
const GEAR_MODULE = 0.9;
const GEAR_BACKLASH = 0.15;
const GREAT_WHEEL_TEETH = 24;
const PINION_TEETH = 16;
const TIP_CLEARANCE = 0.6;

const SPINDLE_BASE = FLOOR_TOP + GAP;
const SPINDLE_SHAFT = 2;
const BORE = SPINDLE_SHAFT + CLEAR;
/**
 * Spindle tops stop inside their own gear hub. A ray rising at 45° from the bottom edge of a
 * neighbouring gear climbs at least the horizontal gap before it reaches a spindle, so keeping each
 * tip at least 1 mm below that height means no neighbour can clip a spindle top:
 * - wheel spindle: the nearest pinion edge is 10.3 mm away along X or Z, so a 45° ray from the
 *   pinion bottom (6.1) arrives no lower than 16.4, and a 45° ray falling from the pinion top
 *   (14.6) reaches the pin's line at 4.3, below its base at 5.3;
 * - pinion spindle: the wheel tip is 6.7 mm away, so the limit is 6.1 + 6.7 = 12.8.
 */
const SPINDLE_TIPS = { wheel: 15.2, pinion: 11.6 } as const;
const OIL_HOLE = 1.2;

const STANDOFF_FLANGE = 5.2;
const STANDOFF_BOTTOM = 10;
const STANDOFF_TUBE = 4.2;
const SCREW_HEAD = 2.6;
const SCREW_HEAD_HEIGHT = 3;
const SCREW_SHAFT = 1.4;
const SCREW_BORE = SCREW_SHAFT + CLEAR;
const SCREW_TIP = 18;

const WHEEL = gearRadii({ teeth: GREAT_WHEEL_TEETH, module: GEAR_MODULE });
const PINION = gearRadii({ teeth: PINION_TEETH, module: GEAR_MODULE });
/** Centre distance between the great wheel and each pinion. */
const TRAIN_STEP = WHEEL.tip + PINION.tip + TIP_CLEARANCE;
/** Pinion sites, in the order they are added for gearCount 2..5. */
const PINION_SITES: readonly (readonly [number, number])[] = [
  [TRAIN_STEP, 0],
  [0, -TRAIN_STEP],
  [-TRAIN_STEP, 0],
  [0, TRAIN_STEP],
];
/** Standoffs on the diagonals through the great wheel, at the pinion grid corners. */
const STANDOFF_POSITIONS: readonly (readonly [number, number])[] = [
  [TRAIN_STEP, TRAIN_STEP],
  [-TRAIN_STEP, -TRAIN_STEP],
];

interface GearPlacement {
  x: number;
  z: number;
  teeth: number;
  /** Tooth phase in the shape plane (u, v) = (x, -z). */
  phase: number;
  kind: "wheel" | "pinion";
}

function gearTrain(gearCount: number): GearPlacement[] {
  const wheelPhase = 0.11;
  const train: GearPlacement[] = [{ x: 0, z: 0, teeth: GREAT_WHEEL_TEETH, phase: wheelPhase, kind: "wheel" }];
  for (let k = 0; k < gearCount - 1; k++) {
    const [x, z] = PINION_SITES[k] as readonly [number, number];
    const beta = Math.atan2(-z, x);
    train.push({
      x,
      z,
      teeth: PINION_TEETH,
      phase: meshingPhase(wheelPhase, GREAT_WHEEL_TEETH, WHEEL.pitch, PINION_TEETH, PINION.pitch, beta),
      kind: "pinion",
    });
  }
  return train;
}

/** A keyhole outline centred on `(u, v)`: a round ward with a slot toward -v. */
function keyholePoints(u: number, v: number): Point2[] {
  const r = 2.4;
  const half = 0.9;
  const slot = 4.2;
  const a = Math.asin(half / r);
  // Arc from the slot's right edge, counter-clockwise round the top, to its left edge.
  const arc = arcPoints(u, v, r, -Math.PI / 2 + a, 1.5 * Math.PI - a, 18);
  return [...arc, [u - half, v - slot], [u + half, v - slot]];
}

/** Mean-centred cross-moment `mean((u - ū)(v - v̄))` of a 2D point set. */
function crossMoment2(points: readonly Point2[]): number {
  let mu = 0;
  let mv = 0;
  for (const [u, v] of points) {
    mu += u;
    mv += v;
  }
  mu /= points.length;
  mv /= points.length;
  let c = 0;
  for (const [u, v] of points) c += (u - mu) * (v - mv);
  return c / points.length;
}

/** World (x, z) to shape-plane (u, v) for Y-extruded Parts. */
const toShape = (x: number, z: number): Point2 => [x, -z];

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

function buildBody(): BufferGeometry {
  const profile: Point2[] = [
    [0, 0],
    [BODY_OUTER - 1.5, 0],
    [BODY_OUTER, 1.5],
    [BODY_OUTER, RIM - 1.2],
    [BODY_OUTER - 0.8, RIM],
    [BODY_INNER, RIM],
    [BODY_INNER, FLOOR_TOP + 1.2],
    [BODY_INNER - 1.2, FLOOR_TOP],
    [0, FLOOR_TOP],
  ];
  const geometry = buildLathe(profile, { segments: 72 });
  scaleXZ(geometry, BODY_STRETCH_X, 1);
  const position = geometry.getAttribute("position");
  for (let v = 0; v < position.count; v++) {
    if (position.getX(v) > FLAT_X) position.setX(v, FLAT_X);
    if (position.getZ(v) < FLAT_MINUS_Z) position.setZ(v, FLAT_MINUS_Z);
  }
  return geometry;
}

function buildLid(train: readonly GearPlacement[]): BufferGeometry {
  // Shape plane: u = x, v = -z, so the -Z flat is a clamp at v = -FLAT_MINUS_Z.
  // Oval rim clamped to both flats, with the latch tab standing out of the +X flat. The ellipse
  // starts on +X, so the tab's span is removed from both ends of the point list and the tab is
  // appended between them.
  const outline: Point2[] = [];
  for (const [u, v] of ellipsePoints(0, 0, BODY_OUTER * BODY_STRETCH_X + 0.6, BODY_OUTER + 0.6, 120)) {
    const p: Point2 = [Math.min(u, FLAT_X), Math.min(v, -FLAT_MINUS_Z)];
    if (p[0] === FLAT_X && Math.abs(p[1]) <= TAB_HALF_WIDTH + 1) continue;
    const last = outline[outline.length - 1];
    if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) outline.push(p);
  }
  outline.push(
    [FLAT_X, -TAB_HALF_WIDTH],
    ...arcPoints(TAB_END - 2, -TAB_HALF_WIDTH + 2, 2, -Math.PI / 2, 0, 3),
    ...arcPoints(TAB_END - 2, TAB_HALF_WIDTH - 2, 2, 0, Math.PI / 2, 3),
    [FLAT_X, TAB_HALF_WIDTH],
  );
  const holes: Point2[][] = [];
  for (const gear of train) {
    const [u, v] = toShape(gear.x, gear.z);
    holes.push(circlePoints(u, v, OIL_HOLE, 12));
  }
  for (const [x, z] of STANDOFF_POSITIONS) {
    const [u, v] = toShape(x, z);
    holes.push(circlePoints(u, v, SCREW_BORE, 16));
  }
  // The keyhole slides along a fixed bearing until the in-plane cross-moment of the whole vertex
  // set vanishes, so the lid's PCA Candidate_Axes are exactly X and Z (no oblique sweeps).
  // The bearing lies in a quadrant whose (u, v) product opposes the moment without a keyhole.
  const base = crossMoment2([...outline, ...holes.flat()]);
  const bearing = ((base > 0 ? 112 : 22) * Math.PI) / 180;
  const keyholeAt = (t: number): Point2[] => keyholePoints(t * Math.cos(bearing), t * Math.sin(bearing));
  const moment = (t: number): number => crossMoment2([...outline, ...holes.flat(), ...keyholeAt(t)]);
  let lo = 30;
  let hi = 58;
  const signLo = Math.sign(moment(lo));
  if (signLo === Math.sign(moment(hi))) {
    throw new RangeError("lid balance: the keyhole cannot cancel the cross-moment on its bearing");
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(moment(mid)) === signLo) lo = mid;
    else hi = mid;
  }
  holes.push(keyholeAt((lo + hi) / 2));
  return extrudeAlongY(polygonShape(outline, holes), LID_THICKNESS, LID_BOTTOM);
}

/**
 * The latch is a clasp that grips the lid's +X tab: a top hook over the tab, a
 * bottom hook under the tab, a bar across the tab's end and a thumb lever on top. It slides off
 * outward (+X) or sideways. Keeping it on the tab makes it compact, so most of its surface faces
 * the lid and every contact it has is broad.
 *
 * The bottom hook's reach is solved so that the outline's X–Y cross-moment is exactly zero:
 * the latch's principal axes are then the world X and Y axes, so its PCA Candidate_Axes never
 * sweep obliquely across the box.
 */
function buildLatch(): BufferGeometry {
  const inner = TAB_END + CLEAR;
  const outer = inner + 3.5;
  const topBottom = LID_TOP + CLEAR;
  const topTop = topBottom + 3;
  // Both hooks stay outside the body's footprint: the top hook starts 0.5 mm beyond the flat, so
  // the body never rises into it, and the bottom hook starts at least 4.8 mm beyond the flat, so a
  // 45° ray falling from the rim edge drops below the hook's 3 mm depth before it gets there.
  const topReach = FLAT_X + 0.5;
  const thumb = 1.6;
  const lowTop = LID_BOTTOM - CLEAR;
  const lowBottom = lowTop - 3;
  const outline = (lowReach: number): Point2[] => [
    [lowReach, lowBottom + 0.6],
    [lowReach + 0.6, lowBottom],
    ...arcPoints(outer - 1, lowBottom + 1, 1, -Math.PI / 2, 0, 3),
    [outer, topTop],
    [outer + thumb - 1, topTop],
    ...arcPoints(outer + thumb - 1, topTop + 1, 1, -Math.PI / 2, Math.PI / 2, 4),
    [inner + 0.6, topTop + 2],
    [inner, topTop + 1.4],
    [inner, topTop],
    ...arcPoints(topReach + 1, topTop - 1, 1, Math.PI / 2, Math.PI, 3),
    [topReach, topBottom + 0.6],
    [topReach + 0.6, topBottom],
    [inner, topBottom],
    [inner, lowTop],
    [lowReach + 0.6, lowTop],
    [lowReach, lowTop - 0.6],
  ];
  let lo = FLAT_X + 4.8;
  let hi = inner - 2;
  const signLo = Math.sign(crossMoment2(outline(lo)));
  if (signLo === Math.sign(crossMoment2(outline(hi)))) {
    throw new RangeError("latch balance: the bottom hook cannot cancel the cross-moment");
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(crossMoment2(outline(mid))) === signLo) lo = mid;
    else hi = mid;
  }
  return extrudeAlongZ(polygonShape(outline((lo + hi) / 2)), 2 * LATCH_HALF_WIDTH, -LATCH_HALF_WIDTH);
}

function buildGear(gear: GearPlacement): BufferGeometry {
  const outline = gearOutline({ teeth: gear.teeth, module: GEAR_MODULE, backlash: GEAR_BACKLASH, phase: gear.phase });
  const holes: Point2[][] = [];
  if (gear.kind === "wheel") {
    holes.push(keyedBorePoints(BORE, 1.2, 0.8, 0.4, 20));
    // Five crossing windows with uneven spokes, as on a hand-cut clock wheel.
    const spokes = [0, 77, 139, 216, 290].map((d) => (d * Math.PI) / 180);
    const spokeHalf = (12 * Math.PI) / 180;
    spokes.forEach((s, k) => {
      const next = (spokes[(k + 1) % spokes.length] ?? 0) + (k === spokes.length - 1 ? 2 * Math.PI : 0);
      holes.push(windowPoints(4.6, WHEEL.root - 1.3, s + spokeHalf, next - spokeHalf, 6));
    });
  } else {
    holes.push(keyedBorePoints(BORE, 1, 0.6, 0.95, 16));
    for (const [deg, r] of [
      [0, 0.62],
      [115, 0.5],
      [235, 0.5],
    ] as const) {
      const a = (deg * Math.PI) / 180;
      holes.push(circlePoints(4.5 * Math.cos(a), 4.5 * Math.sin(a), r, 10));
    }
  }
  return extrudeAlongY(polygonShape(outline, alignHolesToPrincipalAxes(outline, holes)), GEAR_THICKNESS[gear.kind], GEAR_BOTTOM);
}

function buildSpindle(kind: GearPlacement["kind"]): BufferGeometry {
  const b = SPINDLE_BASE;
  const tip = SPINDLE_TIPS[kind];
  const r = SPINDLE_SHAFT;
  // A plain arbor pin: a small chamfer where it stands on the floor and a long pointed chamfer at
  // the top, which gives the axial skew that fixes the sign of the pin axis. There is no foot: a
  // foot wide enough to matter would poke into the wheel's 45° shadow and be grazed.
  const profile: Point2[] = [
    [0, b],
    [r - 0.4, b],
    [r, b + 0.4],
    [r, tip - 1],
    [r - 1, tip],
    [0, tip],
  ];
  return buildLathe(profile, {
    segments: 32,
    keying: {
      flats: [{ yMin: b, yMax: tip, depth: 0.45 }],
      index: { yMin: b, yMax: b + 0.4, depth: 0.12 },
      balance: { yMin: tip - 1, yMax: tip },
    },
  });
}

/**
 * A screw standoff hanging under the lid: the fastener clamps it against the lid's underside, so
 * it needs no footing on the floor. A washer flange at the top bears on the lid.
 */
function buildStandoff(): BufferGeometry {
  const b = STANDOFF_BOTTOM;
  const top = RIM;
  const flange = top - 1.5;
  const profile: Point2[] = [
    [0, b],
    [STANDOFF_TUBE - 0.4, b],
    [STANDOFF_TUBE, b + 0.4],
    [STANDOFF_TUBE, flange],
    [STANDOFF_FLANGE, flange],
    [STANDOFF_FLANGE, top - 0.3],
    [STANDOFF_FLANGE - 0.3, top],
    [SCREW_BORE, top],
    [SCREW_BORE, SCREW_TIP - 1],
    [0, SCREW_TIP - 1],
  ];
  return buildLathe(profile, {
    segments: 32,
    keying: {
      flats: [{ yMin: b, yMax: top, depth: 0.35, minRadius: STANDOFF_TUBE - 0.5 }],
      index: { yMin: flange, yMax: top, depth: 0.16, minRadius: STANDOFF_FLANGE - 0.4 },
      balance: { yMin: b, yMax: b + 0.4, minRadius: STANDOFF_TUBE - 0.5 },
    },
  });
}

function buildFastener(): BufferGeometry {
  const headBottom = LID_TOP + GAP;
  const geometry = buildKeyedScrew({
    headRadius: SCREW_HEAD,
    headHeight: SCREW_HEAD_HEIGHT,
    shaftRadius: SCREW_SHAFT,
    shaftLength: headBottom - SCREW_TIP,
    socket: { radius: 1.1, depth: 1.4 },
  });
  return translateExact(geometry, 0, headBottom, 0);
}

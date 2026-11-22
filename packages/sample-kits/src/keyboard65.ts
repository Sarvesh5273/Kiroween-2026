import { type BufferGeometry, Group, Mesh } from "three";
import { AXIS_Y, setConstructionAxis } from "./shared/constructionAxis";
import {
  assertFiniteGeometry,
  bisectRoot,
  buildKeyedScrew,
  buildSquareColumn,
  circlePoints,
  type ColumnRing,
  cornerOutline,
  type CornerSpec,
  keyedQuad,
  crossMoment2,
  extrudeAlongY,
  type Point2,
  polygonShape,
  signedArea,
  sortTrianglesByHeight,
  toShapeXZ,
  translateExact,
} from "./shared/geometry";
import { createMaterial, type FinishName } from "./shared/materials";
import { indexedName, NameRegistry } from "./shared/naming";
import { KitParameterError, type ParamValidator, resolveKitParams } from "./shared/params";

/** Keyboard layout: the default 65% layout, or a rectangular grid of 1u keys. */
export type KeyboardLayout = "full65" | { rows: number; columns: number };

/** The reduced 2 × 3 grid used as the Keyboard_Fixture (Req 23.9, 23.10). */
export const KEYBOARD_FIXTURE_LAYOUT: { readonly rows: 2; readonly columns: 3 } = Object.freeze({ rows: 2, columns: 3 });

/**
 * 65% Mechanical Keyboard (Req 23.1, 23.5, 23.9, 23.10): a navy frame on a slate case, a brushed
 * brass plate over an emerald PCB, faceted switches and sculpted matte PBT keycaps, held together
 * by keyed black-oxide screws driven up through the case into the frame.
 *
 * Layout, in millimetres with +Y up and rows running from the back (-Z) to the front (+Z). The
 * case, PCB and plate are full-size slabs stacked like a sandwich mount, and the frame ring sits
 * on the plate around the switches:
 * - `case_screw_N`: keyed pan-head screws with their heads 0.4 below the case, driven up through
 *   the case, PCB and plate into the frame, tips at 12.2.
 * - `bottom_case`: extruded slab, 0 to 4, with screw holes, a USB notch on the back edge and a
 *   tooling hole.
 * - `pcb`: extruded slab, 4.4 to 6.4, with screw holes, a keyed (chamfered) corner and a tooling
 *   hole.
 * - `plate`: extruded slab, 6.8 to 8.8, with screw holes, a keyed corner and one 14 × 14 cut-out
 *   under each switch.
 * - `top_frame`: extruded ring, 9.2 to 17, 2 mm clear of the key grid, with screw through-holes,
 *   a cable notch over the USB notch and an indicator window.
 * - `switch_N`: 4-segment lathe columns standing on the plate from 9.2 to 20.2.
 * - `keycap_N`: extruded keycaps with uneven corners, a vertical skirt, a tapered crown and a
 *   sculpted top tilt per row, floating 0.4 above their switch.
 *
 * Every key edge lies on the 1u lattice (u = 19.05), keycaps are 1.05 smaller than their cells,
 * and every switch is centred on a cell. Projected overlaps between any two keys along a
 * Canonical_Direction are therefore either broad or absent, never slivers (Req 22.17). Every
 * Part's principal axes are aligned with X, Y and Z by balanced features (Req 23.11, 23.12):
 * mirrored extrusion caps fix Y, and a solved corner radius, tooling hole, window or keyed ring
 * cancels each remaining cross-moment.
 */
export function buildMechanicalKeyboard65(params?: { layout?: KeyboardLayout }): Group {
  const { layout } = resolveKitParams<{ layout: KeyboardLayout }>("buildMechanicalKeyboard65", params, {
    layout: { validate: validateLayout, fallback: "full65" },
  });

  const keys = layout === "full65" ? fullLayout() : gridLayout(layout.rows, layout.columns);
  const columnsU = layout === "full65" ? 16 : layout.columns;
  const rows = layout === "full65" ? 5 : layout.rows;
  const board: Board = { halfWidth: (columnsU * U) / 2, halfDepth: (rows * U) / 2 };

  const names = new NameRegistry();
  const root = new Group();
  root.name = names.claim("mechanical-keyboard");
  const add = (geometry: BufferGeometry, name: string, finish: FinishName, x = 0, y = 0, z = 0): void => {
    const mesh = new Mesh(geometry, createMaterial(finish));
    mesh.name = names.claim(name);
    assertFiniteGeometry(geometry, mesh.name);
    mesh.position.set(x, y, z);
    setConstructionAxis(mesh, AXIS_Y);
    root.add(mesh);
  };

  const screws = screwPositions(board, layout === "full65");
  add(buildCase(board, screws), "bottom_case", "anodizedSlate");
  add(buildFrame(board, screws), "top_frame", "anodizedNavy");
  add(buildPcb(board, screws), "pcb", "emeraldSolderMask");
  add(buildPlate(board, keys, screws), "plate", "brushedBrass");
  const switchGeometry = buildSwitch();
  keys.forEach((key, k) => {
    add(switchGeometry.clone(), indexedName("switch", k + 1), "switchHousing", key.switchX - board.halfWidth, SWITCH_BOTTOM, key.z - board.halfDepth);
  });
  keys.forEach((key, k) => {
    const cap = buildKeycap(key.widthU, ROW_TILT[key.row] ?? 0);
    add(cap.geometry, indexedName("keycap", k + 1), key.finish, key.centerX - board.halfWidth, KEYCAP_FLOOR - cap.lowest, key.z - board.halfDepth);
  });
  screws.forEach(([x, z], k) => {
    add(buildScrew(), indexedName("case_screw", k + 1), "blackOxideSteel", x, 0, z);
  });
  return root;
}

const validateLayout: ParamValidator<KeyboardLayout> = (value, fail) => {
  if (value === "full65") return value;
  if (typeof value === "string") return fail(`expected "full65" or { rows, columns }, received "${value}"`);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(`expected "full65" or { rows, columns }, received ${value === null ? "null" : Array.isArray(value) ? "an array" : `type ${typeof value}`}`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return fail("expected a plain { rows, columns } object");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record).sort()) {
    if (key !== "rows" && key !== "columns") {
      throw new KitParameterError("buildMechanicalKeyboard65", `layout.${key}`, record[key], "unknown layout key; accepted keys: columns, rows");
    }
  }
  const grid = { columns: 0, rows: 0 };
  for (const [key, max] of [
    ["columns", 15],
    ["rows", 5],
  ] as const) {
    const n = record[key];
    if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > max) {
      throw new KitParameterError("buildMechanicalKeyboard65", `layout.${key}`, n, `expected an integer from 1 to ${max}`);
    }
    grid[key] = n;
  }
  return grid;
};

// ---------------------------------------------------------------------------
// Dimensions (mm)
// ---------------------------------------------------------------------------

const U = 19.05;
const GAP = 0.4;
const CASE_TOP = 4;
const PCB_BOTTOM = CASE_TOP + GAP;
const PCB_THICKNESS = 2;
const PLATE_BOTTOM = PCB_BOTTOM + PCB_THICKNESS + GAP;
const PLATE_THICKNESS = 2;
const FRAME_BOTTOM = PLATE_BOTTOM + PLATE_THICKNESS + GAP;
const FRAME_TOP = 17;
const SWITCH_BOTTOM = FRAME_BOTTOM;
const SWITCH_HEIGHT = 11;
const KEYCAP_FLOOR = SWITCH_BOTTOM + SWITCH_HEIGHT + GAP;
const KEYCAP_HEIGHT = 9.2;
const KEYCAP_GAP_X = 1.05;
const KEYCAP_DEPTH = U - 1.05;
const KEYCAP_INSET = 1.2;
const KEYCAP_SKIRT = 3;
/** Sculpted top slope (dy/dz) per row, number row first. */
const ROW_TILT = [0.03, 0.015, 0, -0.015, -0.025] as const;
/** The frame opening clears the key grid by 2 mm on every side. */
const FRAME_INNER = 2;
const FRAME_WALL = 12;
const OUTER = FRAME_INNER + FRAME_WALL;
const OUTER_RADIUS = 6;
const SCREW_SHAFT = 1.4;
const SCREW_HOLE = SCREW_SHAFT + GAP;
const SCREW_TIP = FRAME_BOTTOM + 3;
const CUTOUT_HALF = 7;

interface Board {
  halfWidth: number;
  halfDepth: number;
}

interface Key {
  row: number;
  /** Left edge and width in u. */
  xU: number;
  widthU: number;
  /** Keycap centre and switch centre from the board's left edge, and row centre from its back edge (mm). */
  centerX: number;
  switchX: number;
  z: number;
  finish: FinishName;
}

/**
 * Widths in u of the 68-key layout. Every key edge lies on the 1u lattice: wide keys (Tab, Caps,
 * Shift, Enter, Backspace, the 6u spacebar) span whole cells, so neighbouring rows never stagger.
 * With a stagger of a fraction of a key, keycaps of adjacent rows would meet along 45° headings
 * through thin corner wedges that too few Sample_Rays detect (Req 22.17).
 */
const FULL_ROWS: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1],
  [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1],
  [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1],
  [2, 1, 1, 6, 1, 1, 1, 1, 1, 1],
];
/** Accent keys of the full layout: Esc, Enter, Up and the bottom arrows (row, index). */
const ACCENTS = new Set(["0:0", "2:12", "3:12", "4:7", "4:8", "4:9"]);

/** Each switch sits under the cell of its key nearest the key's centre (the left one on a tie). */
function makeKey(row: number, xU: number, widthU: number, finish: FinishName): Key {
  const switchU = xU + Math.ceil(widthU / 2) - 0.5;
  return { row, xU, widthU, centerX: (xU + widthU / 2) * U, switchX: switchU * U, z: (row + 0.5) * U, finish };
}

function fullLayout(): Key[] {
  const keys: Key[] = [];
  FULL_ROWS.forEach((widths, row) => {
    let x = 0;
    widths.forEach((w, i) => {
      const last = i === widths.length - 1;
      const finish: FinishName = ACCENTS.has(`${row}:${i}`) ? "pbtAccent" : w !== 1 || last ? "pbtCharcoal" : "pbtIvory";
      keys.push(makeKey(row, x, w, finish));
      x += w;
    });
    if (x !== 16) throw new RangeError(`row ${row} of the 65% layout is ${x}u wide, not 16u`);
  });
  return keys;
}

function gridLayout(rows: number, columns: number): Key[] {
  const keys: Key[] = [];
  for (let row = 0; row < rows; row++) {
    for (let c = 0; c < columns; c++) {
      const finish: FinishName = row === 0 && c === 0 ? "pbtAccent" : c === columns - 1 && columns > 1 ? "pbtCharcoal" : "pbtIvory";
      keys.push(makeKey(row, c, 1, finish));
    }
  }
  return keys;
}

/**
 * Four corner screws, plus front and back middle screws on the full layout. Each screw sits a
 * quarter key beyond the grid in x and half a key in z (the middle screws a quarter key off the
 * centre line), off the lines of the key lattice: a screw on such a line would see the keycaps
 * along the 3D diagonals past their corners only through thin slivers (Req 22.17).
 */
function screwPositions(board: Board, full: boolean): Point2[] {
  const x = board.halfWidth + U / 4;
  const z = board.halfDepth + U / 2;
  const positions: Point2[] = [
    [-x, -z],
    [x, -z],
    [x, z],
    [-x, z],
  ];
  if (full) positions.push([U / 4, -z], [U / 4, z]);
  return positions;
}

// ---------------------------------------------------------------------------
// Slabs
// ---------------------------------------------------------------------------

const arc = (r: number, segments = 3): CornerSpec => ({ kind: "arc", r, segments });

/**
 * Outer outline shared by every slab: a rounded rectangle with an optional keyed (chamfered)
 * corner, and a notch of `notchDepth` on the back edge when it is positive.
 */
function outerOutline(board: Board, notchDepth: number, keyedCorner = -1, chamfer = 0): Point2[] {
  const x1 = board.halfWidth + OUTER;
  const z1 = board.halfDepth + OUTER;
  const round = arc(OUTER_RADIUS, 4);
  const corners: [CornerSpec, CornerSpec, CornerSpec, CornerSpec] = [round, round, round, round];
  if (keyedCorner >= 0) corners[keyedCorner] = { kind: "chamfer", c: chamfer };
  const outline = cornerOutline(-x1, x1, -z1, z1, corners);
  if (notchDepth > 0) {
    // The back edge runs from the last point (-x1 + r, -z1) to the first one (x1 - r, -z1).
    const centre = -0.45 * board.halfWidth;
    const half = Math.min(5, 0.2 * board.halfWidth);
    outline.push([centre - half, -z1], [centre - half, -z1 + notchDepth], [centre + half, -z1 + notchDepth], [centre + half, -z1]);
  }
  return outline;
}

/**
 * Slides a round hole of `radius` with `segments` points along the segment `from -> to` until
 * the cross-moment of all outline and hole points vanishes, and returns the hole.
 */
function balancingHole(points: readonly Point2[], from: Point2, to: Point2, radius: number, segments: number, label: string): Point2[] {
  const at = (t: number): Point2[] => circlePoints(from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1]), radius, segments);
  const t = bisectRoot((s) => crossMoment2([...points, ...at(s)]), 0, 1, label);
  return at(t);
}

/**
 * Extrudes a world (x, z) outline with holes along +Y. `ExtrudeGeometry` re-winds holes only when
 * it reverses the outline, so every loop is first made counter-clockwise in the shape plane; three
 * then reverses the outline alone and the holes end up wound opposite to it.
 */
function extrudeXZ(outline: readonly Point2[], holes: readonly (readonly Point2[])[], depth: number, y0: number, steps = 1): BufferGeometry {
  const ccw = (loop: readonly Point2[]): Point2[] => {
    const shaped = toShapeXZ(loop);
    return signedArea(shaped) > 0 ? shaped : shaped.reverse();
  };
  return extrudeAlongY(polygonShape(ccw(outline), holes.map(ccw)), depth, y0, steps);
}

const screwHoles = (screws: readonly Point2[]): Point2[][] => screws.map(([x, z]) => circlePoints(x, z, SCREW_HOLE, 16));

function buildCase(board: Board, screws: readonly Point2[]): BufferGeometry {
  const outline = outerOutline(board, 4);
  const holes = screwHoles(screws);
  const z = 0.5 * board.halfDepth;
  holes.push(balancingHole([...outline, ...holes.flat()], [-board.halfWidth + 4, z], [board.halfWidth - 4, z], 2, 16, "bottom_case"));
  return extrudeXZ(outline, holes, CASE_TOP, 0);
}

/** The PCB spans the whole case, so every screw passes through it, with a keyed front-left corner. */
function buildPcb(board: Board, screws: readonly Point2[]): BufferGeometry {
  const outline = outerOutline(board, 0, 2, 6);
  const holes = screwHoles(screws);
  // Tooling hole in the margin behind the key grid, clear of the screws.
  const z = -(board.halfDepth + 4);
  holes.push(balancingHole([...outline, ...holes.flat()], [-board.halfWidth, z], [board.halfWidth, z], 1.5, 16, "pcb"));
  return extrudeXZ(outline, holes, PCB_THICKNESS, PCB_BOTTOM);
}

/** The plate spans the case too, with a keyed back-right corner and one cut-out per switch. */
function buildPlate(board: Board, keys: readonly Key[], screws: readonly Point2[]): BufferGeometry {
  const outline = outerOutline(board, 0, 0, 7);
  const holes = screwHoles(screws);
  // Cut-outs have chamfered corners: with plain squares, whose edges are collinear across a row,
  // the cap triangulation drops triangles and leaves the plate open.
  const h = CUTOUT_HALF;
  const c = 0.6;
  for (const key of keys) {
    const x = key.switchX - board.halfWidth;
    const z = key.z - board.halfDepth;
    holes.push([
      [x - h + c, z - h],
      [x + h - c, z - h],
      [x + h, z - h + c],
      [x + h, z + h - c],
      [x + h - c, z + h],
      [x - h + c, z + h],
      [x - h, z + h - c],
      [x - h, z - h + c],
    ]);
  }
  // Tooling hole in the margin in front of the last row of cut-outs.
  const z = board.halfDepth + 1;
  holes.push(balancingHole([...outline, ...holes.flat()], [-board.halfWidth + 2, z], [board.halfWidth - 2, z], 1, 32, "plate"));
  return extrudeXZ(outline, holes, PLATE_THICKNESS, PLATE_BOTTOM);
}

function buildFrame(board: Board, screws: readonly Point2[]): BufferGeometry {
  const outline = outerOutline(board, 3);
  const xi = board.halfWidth + FRAME_INNER;
  const zi = board.halfDepth + FRAME_INNER;
  const holes: Point2[][] = [cornerOutline(-xi, xi, -zi, zi, [arc(1, 2), arc(1, 2), arc(1, 2), arc(1, 2)]), ...screwHoles(screws)];
  // Indicator window in the left wall, sliding front to back.
  const x = -(board.halfWidth + FRAME_INNER + FRAME_WALL / 2);
  holes.push(balancingHole([...outline, ...holes.flat()], [x, -board.halfDepth + 2], [x, board.halfDepth - 2], 1.2, 12, "top_frame"));
  return extrudeXZ(outline, holes, FRAME_TOP - FRAME_BOTTOM, FRAME_BOTTOM);
}

// ---------------------------------------------------------------------------
// Keycaps
// ---------------------------------------------------------------------------

/**
 * A keycap of `widthU` with its footprint centred on the local origin and its lowest point at
 * `lowest` (local y). The corners carry different vertex counts (6 and 4 on the +x side, 2 and 4
 * on the -x side), which gives a strong skew along X and Z at every key width, since the
 * Axis_Generator weighs every vertex equally. The diagonal counts are equal, and the radius of the
 * (-x, -z) corner is solved so that the outline's X–Z cross-moment vanishes exactly, which puts the
 * in-plane principal axes on X and Z.
 *
 * The top is inset by `KEYCAP_INSET` with a scale about the outline's vertex mean `μ` (so its
 * mean and zero cross-moment are preserved) and tilted by `tilt` along Z. The bottom and the top
 * of the vertical skirt are tilted by `-tilt · sz² / 2`, which makes the Y–Z cross-moment of the
 * whole vertex set exactly zero, so the sculpted top does not tilt the principal axis away from Y.
 */
function buildKeycap(widthU: number, tilt: number): { geometry: BufferGeometry; lowest: number } {
  const w = widthU * U - KEYCAP_GAP_X;
  const d = KEYCAP_DEPTH;
  const outlineFor = (radius: number): Point2[] =>
    cornerOutline(-w / 2, w / 2, -d / 2, d / 2, [arc(1.2, 5), arc(1.5), { kind: "chamfer", c: 1.2 }, arc(radius)]);
  const radius = bisectRoot((r) => crossMoment2(outlineFor(r)), 0.3, 7, `keycap ${widthU}u`);
  const outline = outlineFor(radius);
  let mx = 0;
  let mz = 0;
  for (const [x, z] of outline) {
    mx += x;
    mz += z;
  }
  mx /= outline.length;
  mz /= outline.length;
  const sx = 1 - (2 * KEYCAP_INSET) / w;
  const sz = 1 - (2 * KEYCAP_INSET) / d;
  // The skirt ring (y = KEYCAP_SKIRT) and the bottom ring share one slope, chosen so that
  // bottom + skirt + top give a zero Y–Z cross-moment: 2·m·var + tilt·sz²·var = 0.
  const bottomTilt = (-tilt * sz * sz) / 2;

  // Two steps: a vertical skirt, then the tapered crown. Without the skirt, a ray straight up from
  // a cap triangle near the outline would meet the inward-leaning wall within a fraction of a
  // millimetre, which breaks the thickness rule (Req 22.15).
  const geometry = extrudeXZ(outline, [], KEYCAP_HEIGHT, 0, 2);
  const position = geometry.getAttribute("position");
  let lowest = Number.POSITIVE_INFINITY;
  for (let v = 0; v < position.count; v++) {
    const x = position.getX(v);
    const y = position.getY(v);
    const z = position.getZ(v);
    if (y > 0.75 * KEYCAP_HEIGHT) {
      const zt = mz + sz * (z - mz);
      position.setXYZ(v, mx + sx * (x - mx), KEYCAP_HEIGHT + tilt * (zt - mz), zt);
    } else if (y > 0.25 * KEYCAP_HEIGHT) {
      position.setY(v, KEYCAP_SKIRT + bottomTilt * (z - mz));
    } else {
      const yb = bottomTilt * (z - mz);
      position.setY(v, yb);
      lowest = Math.min(lowest, yb);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return { geometry, lowest };
}

// ---------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------

/**
 * A switch as a square column: a 10 mm housing with one chamfered vertical corner (the LED window
 * side), about 18 × 17.6 mm, topped by a 3 × 3 stem, local y from 0 to `SWITCH_HEIGHT`.
 *
 * The housing is built from one {@link keyedQuad} ring, which keeps a zero mean and a zero X–Z
 * cross-moment, so the column's principal axes are exactly X, Y and Z, while the chamfer gives
 * the skews that fix the signs of the in-plane axes.
 *
 * The housing is tall, straight-walled and nearly fills its cell on purpose (Req 22.17):
 * - along a 3D diagonal toward a neighbouring switch the contact is a corner wedge whose size
 *   grows with (housing height − gap), so 1 mm gaps beside a 10 mm housing give a broad contact;
 * - with no flange ledge and no taper, a keycap's ray falling at 45° between two housings meets
 *   no narrow ledge further on, so keycaps never graze distant switches.
 */
function buildSwitch(): BufferGeometry {
  const H = SWITCH_HEIGHT;
  const housing = keyedQuad(8.8, 8.5, 1.6);
  for (const [x, z] of housing) {
    if (!(Math.abs(x) <= U / 2 - 0.5 && Math.abs(z) <= U / 2 - 0.5)) {
      throw new RangeError("switch housing must leave at least 1 mm between neighbouring switches");
    }
  }
  const rings: ColumnRing[] = [
    { hx: 0, hz: 0, y: 0 },
    { hx: 8.8, hz: 8.5, y: 0, quad: housing },
    { hx: 8.8, hz: 8.5, y: H - 1, quad: housing },
    { hx: 1.5, hz: 1.5, y: H - 1 },
    { hx: 1.5, hz: 1.5, y: H },
    { hx: 0, hz: 0, y: H },
  ];
  return buildSquareColumn(rings);
}

// ---------------------------------------------------------------------------
// Screws
// ---------------------------------------------------------------------------

/** A keyed screw driven up from below: head under the case, tip at `SCREW_TIP`. */
function buildScrew(): BufferGeometry {
  const headBottomGap = GAP;
  const geometry = buildKeyedScrew({
    headRadius: 1.95,
    headHeight: 1.4,
    shaftRadius: SCREW_SHAFT,
    shaftLength: SCREW_TIP + headBottomGap,
    socket: { radius: 0.8, depth: 0.7 },
  });
  // Turn it upside down with a rotation of π about Z (x -> -x, y -> -y keeps the winding).
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  for (let v = 0; v < position.count; v++) {
    position.setXYZ(v, -position.getX(v) + 0, -position.getY(v) + 0, position.getZ(v));
    normal.setXYZ(v, -normal.getX(v), -normal.getY(v), normal.getZ(v));
  }
  return sortTrianglesByHeight(translateExact(geometry, 0, -headBottomGap, 0));
}

import { Group, Mesh, SphereGeometry } from "three";
import { AXIS_Y, setConstructionAxis } from "./shared/constructionAxis";
import { assertFiniteGeometry, buildLathe, ensureIndexed, type Point2 } from "./shared/geometry";
import { createMaterial } from "./shared/materials";
import { indexedName, NameRegistry } from "./shared/naming";
import { integerParam, resolveKitParams } from "./shared/params";

/**
 * Deadlock_Cage B (Req 24): metal balls trapped in a glass bottle lying on its side.
 *
 * The bottle is one closed lathe solid with 2 mm walls: a body of inner radius 12, a shoulder,
 * and a neck of inner radius 5.5. Each `ship_ball_N` has radius 9, larger than the neck, so a
 * ball moving in any direction meets the inner wall, the shoulder or the bottom, and the bottle
 * moving in any direction sweeps its walls into the balls. Ball centres are 30 mm apart on the
 * bottle axis (more than 3.2 radii), so two balls only shadow each other along directions close
 * to the axis, where they overlap fully. Units are millimetres; the bottle axis is world +X.
 */
export function buildDeadlockCageShipInBottle(params?: { ballCount?: number }): Group {
  const { ballCount } = resolveKitParams<{ ballCount: number }>("buildDeadlockCageShipInBottle", params, {
    ballCount: integerParam(1, 3, 2),
  });

  const names = new NameRegistry();
  const root = new Group();
  root.name = names.claim("deadlock-cage-ship-in-bottle");

  const WALL = 2;
  const BODY = 14;
  const NECK = 7.5;
  const BODY_END = 100;
  const NECK_START = 112;
  const MOUTH = 126;
  const BALL = 9;
  const SPACING = 30;

  // Inner shoulder: the outer shoulder line offset inward by the wall thickness.
  const dx = NECK - BODY;
  const dy = NECK_START - BODY_END;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len; // inward normal (toward the axis and the bottom)
  const ny = dx / len;
  const ox = BODY + WALL * nx;
  const oy = BODY_END + WALL * ny;
  const atRadius = (r: number): number => oy + ((r - ox) * dy) / dx;
  const innerBody = BODY - WALL;
  const innerNeck = NECK - WALL;

  const profile: Point2[] = [
    [0, 0],
    [BODY - 2.5, 0],
    [BODY, 2.5],
    [BODY, BODY_END],
    [NECK, NECK_START],
    [NECK, MOUTH - 3],
    [NECK + 1.4, MOUTH - 2.2],
    [NECK + 1.4, MOUTH - 0.6],
    [NECK + 0.8, MOUTH],
    [innerNeck, MOUTH],
    [innerNeck, atRadius(innerNeck)],
    [innerBody, atRadius(innerBody)],
    [innerBody, WALL + 2],
    [innerBody - 2, WALL],
    [0, WALL],
  ];
  const bottle = buildLathe(profile, { segments: 48 });
  addPart(root, names, bottle, "bottle", "bottleGlass");

  const centre = (WALL + BODY_END) / 2 + 5;
  for (let k = 0; k < ballCount; k++) {
    const along = centre + (k - (ballCount - 1) / 2) * SPACING;
    const ball = ensureIndexed(new SphereGeometry(BALL, 24, 16));
    const mesh = addPart(root, names, ball, indexedName("ship_ball", k + 1), k % 2 === 0 ? "polishedChrome" : "polishedGold");
    mesh.position.set(along, 0, 0);
  }
  return root;
}

function addPart(
  root: Group,
  names: NameRegistry,
  geometry: SphereGeometry | ReturnType<typeof buildLathe>,
  name: string,
  finish: "bottleGlass" | "polishedChrome" | "polishedGold",
): Mesh {
  const mesh = new Mesh(geometry, createMaterial(finish));
  mesh.name = names.claim(name);
  assertFiniteGeometry(geometry, mesh.name);
  if (name === "bottle") {
    // Lay the bottle on its side: local +Y (the lathe axis) becomes world +X.
    mesh.rotation.set(0, 0, -Math.PI / 2);
  }
  setConstructionAxis(mesh, AXIS_Y);
  root.add(mesh);
  return mesh;
}

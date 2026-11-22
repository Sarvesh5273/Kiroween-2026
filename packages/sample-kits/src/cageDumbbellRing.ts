import { Group, Mesh } from "three";
import { AXIS_Y, setConstructionAxis } from "./shared/constructionAxis";
import { assertFiniteGeometry, buildLathe, type Point2 } from "./shared/geometry";
import { createMaterial } from "./shared/materials";
import { NameRegistry } from "./shared/naming";
import { resolveKitParams } from "./shared/params";

/**
 * Deadlock_Cage A (Req 24): a titanium dumbbell with a crimson ring captive on its bar.
 *
 * The ring's bore (radius 7) is wider than the bar (radius 5) and narrower than the knobs
 * (radius 17), and the knobs are wider than the ring itself (radius 14). The ring fills the bar
 * between the knobs except for 0.6 mm axial gaps. Any translation of the ring with a
 * perpendicular component drives its bore into the bar; any axial component drives a ring face
 * into a knob face that covers it entirely. The same holds for the dumbbell relative to the
 * ring, so the two Parts form one strongly connected deadlock with no hardcoded blocking data.
 * Units are millimetres, axis +Y.
 */
export function buildDeadlockCageDumbbellRing(params?: Record<string, never>): Group {
  resolveKitParams<Record<string, never>>("buildDeadlockCageDumbbellRing", params, {});

  const names = new NameRegistry();
  const root = new Group();
  root.name = names.claim("deadlock-cage-dumbbell-ring");

  const BAR = 5;
  const KNOB = 17;
  const KNOB_THICKNESS = 6;
  const RING_BORE = 7;
  const RING_OUTER = 14;
  const RING_HALF = 6;
  const AXIAL_GAP = 0.6;
  const inner = RING_HALF + AXIAL_GAP;
  const outer = inner + KNOB_THICKNESS;

  const dumbbellProfile: Point2[] = [
    [0, -outer],
    [KNOB - 1.5, -outer],
    [KNOB, -outer + 1.5],
    [KNOB, -inner - 1.5],
    [KNOB - 1.5, -inner],
    [BAR + 0.8, -inner],
    [BAR, -inner + 0.8],
    [BAR, inner - 0.8],
    [BAR + 0.8, inner],
    [KNOB - 1.5, inner],
    [KNOB, inner + 1.5],
    [KNOB, outer - 1.5],
    [KNOB - 1.5, outer],
    [0, outer],
  ];
  const ringProfile: Point2[] = [
    [RING_BORE + 0.6, -RING_HALF],
    [RING_OUTER - 0.8, -RING_HALF],
    [RING_OUTER, -RING_HALF + 0.8],
    [RING_OUTER, RING_HALF - 0.8],
    [RING_OUTER - 0.8, RING_HALF],
    [RING_BORE + 0.6, RING_HALF],
    [RING_BORE, RING_HALF - 0.6],
    [RING_BORE, -RING_HALF + 0.6],
    [RING_BORE + 0.6, -RING_HALF],
  ];

  const parts = [
    { name: "dumbbell", geometry: buildLathe(dumbbellProfile, { segments: 48 }), finish: "satinTitanium" as const },
    { name: "captive_ring", geometry: buildLathe(ringProfile, { segments: 48 }), finish: "anodizedCrimson" as const },
  ];
  for (const part of parts) {
    const mesh = new Mesh(part.geometry, createMaterial(part.finish));
    mesh.name = names.claim(part.name);
    assertFiniteGeometry(part.geometry, mesh.name);
    setConstructionAxis(mesh, AXIS_Y);
    root.add(mesh);
  }
  return root;
}

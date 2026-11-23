import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshBasicMaterial, Path, Shape, type BufferGeometry } from "three";
import { stage0ParseScene } from "../../src/stage0/stage0";
import { stage1Prepare } from "../../src/stage1/stage1";
import type { NormalizedPart, Stage1Result, Vec3 } from "../../src/types";
import type { Box } from "./reference/boxSweep";

/**
 * Small hand-built scenes for the finite straight-move verifier tests. Every scene runs through
 * Stage 0 and Stage 1 at the default config, so the Parts are the normalized Parts the pipeline
 * would produce. World-space boxes can be mapped to normalized space with `toNormalized`, which
 * applies the same `p * scale + translation` formula as the Normalizer.
 */
export interface SceneItem {
  name: string;
  geometry: BufferGeometry;
  position: Vec3;
}

export interface BuiltScene {
  root: Group;
  stage1: Stage1Result;
  scale: number;
  part(name: string): NormalizedPart;
  toNormalized(point: Vec3): Vec3;
  normalizeBox(box: Box): Box;
}

export function buildScene(items: readonly SceneItem[]): BuiltScene {
  const root = new Group();
  const material = new MeshBasicMaterial();
  for (const item of items) {
    const mesh = new Mesh(item.geometry, material);
    mesh.name = item.name;
    mesh.position.set(item.position[0], item.position[1], item.position[2]);
    root.add(mesh);
  }
  const stage1 = stage1Prepare(stage0ParseScene(root, {}), {});
  if (stage1.status === "error") {
    throw new Error(`the test scene failed Stage 1: ${stage1.error.kind}: ${stage1.error.message}`);
  }
  const byName = new Map<string, NormalizedPart>();
  for (const part of stage1.parts) {
    if (byName.has(part.sourceNodeName)) {
      throw new Error(`the test scene has two Parts from node ${part.sourceNodeName}`);
    }
    byName.set(part.sourceNodeName, part);
  }
  const { scale, translation } = stage1.normalization;
  const toNormalized = (p: Vec3): Vec3 => [p[0] * scale + translation[0], p[1] * scale + translation[1], p[2] * scale + translation[2]];
  return {
    root,
    stage1,
    scale,
    part(name: string): NormalizedPart {
      const part = byName.get(name);
      if (part === undefined) {
        throw new Error(`the test scene has no Part named ${name}`);
      }
      return part;
    },
    toNormalized,
    normalizeBox(box: Box): Box {
      return { min: toNormalized(box.min), max: toNormalized(box.max) };
    },
  };
}

export function boxGeometry(x: number, y: number, z: number): BufferGeometry {
  return new BoxGeometry(x, y, z);
}

/** Swaps the last two corners of every triangle, so a closed mesh becomes inward-wound. */
export function reversedWinding(geometry: BufferGeometry): BufferGeometry {
  const index = geometry.index;
  if (index === null) {
    throw new Error("reversedWinding needs an indexed geometry");
  }
  for (let i = 0; i + 2 < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  index.needsUpdate = true;
  return geometry;
}

/** A square plate of side `outer` with a centred square hole of side `hole`, `depth` thick along z, centred on z = 0. */
export function plateWithSquareHole(outer: number, hole: number, depth: number): BufferGeometry {
  const o = outer / 2;
  const h = hole / 2;
  const shape = new Shape();
  shape.moveTo(-o, -o);
  shape.lineTo(o, -o);
  shape.lineTo(o, o);
  shape.lineTo(-o, o);
  shape.lineTo(-o, -o);
  const path = new Path();
  path.moveTo(-h, -h);
  path.lineTo(-h, h);
  path.lineTo(h, h);
  path.lineTo(h, -h);
  path.lineTo(-h, -h);
  shape.holes.push(path);
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

/** The same plate as four boxes, in world space around `center`: the reference decomposition of its solid. */
export function plateBars(outer: number, hole: number, depth: number, center: Vec3): Box[] {
  const o = outer / 2;
  const h = hole / 2;
  const z0 = center[2] - depth / 2;
  const z1 = center[2] + depth / 2;
  const box = (x0: number, x1: number, y0: number, y1: number): Box => ({
    min: [center[0] + x0, center[1] + y0, z0],
    max: [center[0] + x1, center[1] + y1, z1],
  });
  return [box(-o, -h, -o, o), box(h, o, -o, o), box(-h, h, -o, -h), box(-h, h, h, o)];
}

/** A closed cylinder of the given radius and length with its axis along z, centred on the origin. */
export function pinAlongZ(radius: number, length: number, segments: number): BufferGeometry {
  const geometry = new CylinderGeometry(radius, radius, length, segments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** World-space box from a centre and a size. */
export function worldBox(center: Vec3, size: Vec3): Box {
  return {
    min: [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2],
    max: [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2],
  };
}

import { describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PointLight,
  SkinnedMesh,
} from "three";
import { stage0ParseScene } from "../../src/stage0/stage0";
import type { ErrorResult, Part, Stage0Result } from "../../src/types";

function requireOk(result: Stage0Result | ErrorResult): Stage0Result {
  if (result.status !== "ok") {
    throw new Error(`expected a Stage 0 result, received ${result.error.kind}: ${result.error.message}`);
  }
  return result;
}

function requireError(result: Stage0Result | ErrorResult): ErrorResult {
  if (result.status !== "error") {
    throw new Error("expected an error result, received a Stage 0 result");
  }
  return result;
}

function partById(parts: readonly Part[], partId: string): Part {
  const part = parts.find((candidate) => candidate.partId === partId);
  if (part === undefined) {
    throw new Error(`no Part ${partId}; have ${parts.map((candidate) => candidate.partId).join(", ")}`);
  }
  return part;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}

/** Non-indexed triangle soup of a unit box, with every coordinate moved by `center`. */
function nonIndexedBox(center: readonly [number, number, number]): number[] {
  const position = new BoxGeometry(1, 1, 1).toNonIndexed().getAttribute("position");
  const out: number[] = [];
  for (let i = 0; i < position.count; i++) {
    out.push(position.getX(i) + center[0], position.getY(i) + center[1], position.getZ(i) + center[2]);
  }
  return out;
}

/** Diagonal of the AABB of a flat coordinate list, the same quantity the weld radius uses. */
function diagonalOf(coordinates: readonly number[]): number {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < coordinates.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = coordinates[i + k] ?? 0;
      min[k] = Math.min(min[k] ?? 0, value);
      max[k] = Math.max(max[k] ?? 0, value);
    }
  }
  return Math.hypot(
    (max[0] ?? 0) - (min[0] ?? 0),
    (max[1] ?? 0) - (min[1] ?? 0),
    (max[2] ?? 0) - (min[2] ?? 0),
  );
}

function geometryFromCoordinates(coordinates: readonly number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(coordinates, 3));
  return geometry;
}

describe("Stage 0 diagnostics for instanced and skinned meshes", () => {
  it("uses the base geometry and reports instancing and skinning as ignored", () => {
    const root = new Group();
    const instanced = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2);
    const skinned = new SkinnedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    skinned.position.set(5, 0, 0);
    root.add(instanced, skinned);

    const result = requireOk(stage0ParseScene(root));

    expect(result.parts).toHaveLength(2);
    const instancingDiagnostics = result.diagnostics.filter((d) => d.code === "instancing-ignored");
    const skinningDiagnostics = result.diagnostics.filter((d) => d.code === "skinning-ignored");
    // nodeType is the node's `type` field as three.js sets it. InstancedMesh keeps "Mesh", and the
    // diagnostic code is what identifies the instancing case.
    expect(instancingDiagnostics.map((d) => [d.nodePath, d.nodeType])).toStrictEqual([[[0], instanced.type]]);
    expect(skinningDiagnostics.map((d) => [d.nodePath, d.nodeType])).toStrictEqual([[[1], skinned.type]]);
  });
});

describe("Stage 0 mirrored transforms", () => {
  it("keeps face normals outward and reorders corner normals with the corners", () => {
    // BoxGeometry is closed and counter-clockwise from outside. Replacing its per-face normals
    // with per-vertex directions makes each triangle corner carry a different normal, so a
    // wrong corner reorder would be visible.
    const box = new BoxGeometry(1, 1, 1);
    const position = box.getAttribute("position");
    const normals = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const length = Math.hypot(x, y, z);
      normals.set([x / length, y / length, z / length], 3 * i);
    }
    box.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    const index = box.index;
    if (index === null) {
      throw new Error("BoxGeometry is expected to be indexed");
    }

    const mirrored = new Mesh(box);
    mirrored.position.set(2, 0, 0);
    mirrored.scale.set(-1, 1, 1);
    const other = new Mesh(new BoxGeometry(1, 1, 1));
    other.position.set(10, 0, 0);
    const root = new Group();
    root.add(mirrored, other);
    const positionBefore = mirrored.position.toArray();
    const scaleBefore = mirrored.scale.toArray();

    const result = requireOk(stage0ParseScene(root));
    const part = partById(result.parts, "/0#0");

    // The parser must not change the input hierarchy (Req 4.7).
    expect(mirrored.position.toArray()).toStrictEqual(positionBefore);
    expect(mirrored.scale.toArray()).toStrictEqual(scaleBefore);

    // Mirror across x = 2 means world point (x, y, z) maps to (2 - x, y, z). The box is centered
    // at (2, 0, 0), so each outward normal must satisfy dot(n, centroid - center) > 0.
    const center = [2, 0, 0];
    const triangleCount = part.triangles.length / 3;
    for (let t = 0; t < triangleCount; t++) {
      const corners = [0, 1, 2].map((k) => part.triangles[3 * t + k] ?? 0);
      const centroid = [0, 1, 2].map((j) => {
        const sum = corners.reduce((acc, c) => acc + (part.positions[3 * c + j] ?? 0), 0);
        return sum / 3 - (center[j] ?? 0);
      });
      const faceDot =
        (part.faceNormals[3 * t] ?? 0) * (centroid[0] ?? 0) +
        (part.faceNormals[3 * t + 1] ?? 0) * (centroid[1] ?? 0) +
        (part.faceNormals[3 * t + 2] ?? 0) * (centroid[2] ?? 0);
      expect(faceDot, `triangle ${t} face normal points inward`).toBeGreaterThan(0);
    }

    // Part corner k is source corner [0, 2, 1][k], because the winding is reversed.
    const flipOrder = [0, 2, 1];
    for (let t = 0; t < triangleCount; t++) {
      const sourceTriangle = part.sourceTriangleIndices[t] ?? -1;
      for (let k = 0; k < 3; k++) {
        const sourceCorner = flipOrder[k] ?? 0;
        const sourceVertex = index.getX(3 * sourceTriangle + sourceCorner);
        const localVertex = part.triangles[3 * t + k] ?? 0;

        const sx = position.getX(sourceVertex);
        const sy = position.getY(sourceVertex);
        const sz = position.getZ(sourceVertex);
        expect(part.positions[3 * localVertex] ?? NaN).toBeCloseTo(2 - sx, 9);
        expect(part.positions[3 * localVertex + 1] ?? NaN).toBeCloseTo(sy, 9);
        expect(part.positions[3 * localVertex + 2] ?? NaN).toBeCloseTo(sz, 9);

        // Source normal is (sx, sy, sz) / |s|. The mirror maps its x component to -x.
        const length = Math.hypot(sx, sy, sz);
        const expected = [-sx / length, sy / length, sz / length];
        for (let j = 0; j < 3; j++) {
          expect(part.cornerNormals[9 * t + 3 * k + j] ?? NaN).toBeCloseTo(expected[j] ?? NaN, 5);
        }
      }
    }
  });
});

describe("Stage 0 source triangle indices", () => {
  it("reads non-indexed geometry as consecutive vertex triples 3k, 3k+1, 3k+2", () => {
    const coordinates = [...nonIndexedBox([0, 0, 0]), ...nonIndexedBox([5, 0, 0])];
    const geometry = geometryFromCoordinates(coordinates);
    const result = requireOk(stage0ParseScene(new Mesh(geometry)));

    expect(result.parts.map((part) => part.partId)).toStrictEqual(["/#0", "/#1"]);
    expect(Array.from(partById(result.parts, "/#0").sourceTriangleIndices)).toStrictEqual(range(0, 12));
    expect(Array.from(partById(result.parts, "/#1").sourceTriangleIndices)).toStrictEqual(range(12, 24));

    // Corner k of Part triangle t is the source vertex 3k' + k of the source triangle.
    const second = partById(result.parts, "/#1");
    for (let t = 0; t < second.triangles.length / 3; t++) {
      const sourceTriangle = second.sourceTriangleIndices[t] ?? -1;
      for (let k = 0; k < 3; k++) {
        const localVertex = second.triangles[3 * t + k] ?? 0;
        const sourceOffset = 3 * (3 * sourceTriangle + k);
        for (let j = 0; j < 3; j++) {
          expect(second.positions[3 * localVertex + j] ?? NaN).toBeCloseTo(coordinates[sourceOffset + j] ?? NaN, 12);
        }
      }
    }

    // Derived normals are reported for the node with no normal attribute.
    expect(result.diagnostics.map((d) => d.code)).toContain("derived-normals");
  });
});

describe("Stage 0 empty assemblies", () => {
  it("returns EmptyAssemblyError with diagnostics when only lights and cameras are present", () => {
    const root = new Group();
    root.add(new PointLight(0xffffff, 1), new PerspectiveCamera());

    const result = requireError(stage0ParseScene(root));

    expect(result.error.kind).toBe("EmptyAssemblyError");
    if (result.error.kind !== "EmptyAssemblyError") {
      return;
    }
    expect(result.error.message.length).toBeGreaterThan(0);
    expect(result.error.diagnostics.map((d) => [d.nodePath, d.code, d.nodeType])).toStrictEqual([
      [[], "excluded-node", "Group"],
      [[0], "excluded-node", "PointLight"],
      [[1], "excluded-node", "PerspectiveCamera"],
    ]);
  });

  it("excludes a Mesh with zero triangles and reports its node path", () => {
    const root = new Group();
    const empty = new Mesh(geometryFromCoordinates([]));
    root.add(empty);

    const result = requireError(stage0ParseScene(root));

    expect(result.error.kind).toBe("EmptyAssemblyError");
    if (result.error.kind !== "EmptyAssemblyError") {
      return;
    }
    expect(result.error.diagnostics).toContainEqual(
      expect.objectContaining({ code: "excluded-node", nodePath: [0], nodeType: "Mesh" }),
    );
  });
});

describe("Stage 0 monolithic meshes", () => {
  it("returns MonolithicMeshError with the total triangles and the Island node path", () => {
    const root = new Group();
    const light = new PointLight(0xffffff, 1);
    const nested = new Group();
    nested.add(new Mesh(new BoxGeometry(1, 1, 1)));
    root.add(light, nested);

    const result = requireError(stage0ParseScene(root));

    expect(result.error.kind).toBe("MonolithicMeshError");
    if (result.error.kind !== "MonolithicMeshError") {
      return;
    }
    expect(result.error.totalTriangles).toBe(12);
    expect(result.error.nodePath).toStrictEqual([1, 0]);
    expect(result.error.message.length).toBeGreaterThan(0);
  });
});

describe("Stage 0 island welding and splitting", () => {
  it("welds exactly touching boxes into one Island, even with weldTolerance 0", () => {
    const coordinates = [...nonIndexedBox([-0.5, 0, 0]), ...nonIndexedBox([0.5, 0, 0]), ...nonIndexedBox([10, 0, 0])];
    const geometry = geometryFromCoordinates(coordinates);

    const defaults = requireOk(stage0ParseScene(new Mesh(geometry)));
    const zeroTolerance = requireOk(stage0ParseScene(new Mesh(geometry), { weldTolerance: 0 }));

    for (const result of [defaults, zeroTolerance]) {
      expect(result.parts.map((part) => part.triangles.length / 3)).toStrictEqual([24, 12]);
    }
  });

  it("splits boxes separated by a gap larger than the weld radius", () => {
    const coordinates = [
      ...nonIndexedBox([-0.5 - 0.0005, 0, 0]),
      ...nonIndexedBox([0.5 + 0.0005, 0, 0]),
      ...nonIndexedBox([10, 0, 0]),
    ];
    const result = requireOk(stage0ParseScene(new Mesh(geometryFromCoordinates(coordinates))));

    expect(result.parts.map((part) => part.triangles.length / 3)).toStrictEqual([12, 12, 12]);
  });

  it("welds vertices along a chain even when the chain's endpoints are farther apart than the radius", () => {
    // Three triangles whose anchor vertices are P0, P1 and P2 on the x axis. Each adjacent pair is
    // 0.4 apart and P0 to P2 is 0.8 apart. The radius is 0.5, so only the chain links them.
    const chain = [
      0, 0, 0, 0, 10, 0, 0, 0, 10,
      0.4, 0, 0, 0.4, 20, 0, 0.4, 0, 20,
      0.8, 0, 0, 0.8, 40, 0, 0.8, 0, 40,
    ];
    const box = nonIndexedBox([100, 0, 0]);
    const diagonal = diagonalOf([...chain, ...box]);

    const root = new Group();
    root.add(new Mesh(geometryFromCoordinates(chain)), new Mesh(geometryFromCoordinates(box)));

    const joined = requireOk(stage0ParseScene(root, { weldTolerance: 0.5 / diagonal }));
    expect(joined.parts.map((part) => part.partId)).toStrictEqual(["/0#0", "/1#0"]);
    expect(Array.from(partById(joined.parts, "/0#0").sourceTriangleIndices)).toStrictEqual([0, 1, 2]);
    expect(partById(joined.parts, "/0#0").triangles.length / 3).toBe(3);

    // With a radius of 0.3, every adjacent pair is farther apart than the radius, so the chain
    // splits into three Islands numbered by their triangle index.
    const split = requireOk(stage0ParseScene(root, { weldTolerance: 0.3 / diagonal }));
    expect(split.parts.map((part) => part.partId)).toStrictEqual(["/0#0", "/0#1", "/0#2", "/1#0"]);
    expect(Array.from(partById(split.parts, "/0#1").sourceTriangleIndices)).toStrictEqual([1]);
  });
});

describe("Stage 0 invalid geometry", () => {
  it("lists a non-finite node and a malformed node in traversal order and reports non-finite", () => {
    const root = new Group();
    // [0]: indexed with 4 indices, so malformed.
    const malformed = new BufferGeometry();
    malformed.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3));
    malformed.setIndex([0, 1, 2, 3]);
    // [1, 0]: a non-finite vertex inside a child group.
    const nested = new Group();
    nested.add(new Mesh(geometryFromCoordinates([Number.NaN, 0, 0, 1, 0, 0, 0, 1, 0])));
    // [2]: an infinite position.
    const infinite = new Mesh(geometryFromCoordinates([0, 0, 0, Number.POSITIVE_INFINITY, 0, 0, 0, 1, 0]));
    // [3]: a valid box, which must not appear in the list.
    const valid = new Mesh(new BoxGeometry(1, 1, 1));
    valid.position.set(20, 0, 0);
    root.add(new Mesh(malformed), nested, infinite, valid);

    const result = requireError(stage0ParseScene(root));

    expect(result.error.kind).toBe("InvalidGeometryError");
    if (result.error.kind !== "InvalidGeometryError") {
      return;
    }
    expect(result.error.reason).toBe("non-finite");
    expect(result.error.nodePaths).toStrictEqual([[0], [1, 0], [2]]);
    expect(result.error.message.length).toBeGreaterThan(0);
  });

  it("reports malformed when no node has a non-finite value", () => {
    const root = new Group();
    const badIndex = new BufferGeometry();
    badIndex.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3));
    badIndex.setIndex([0, 1, 2, 3]);
    // Non-indexed with 4 vertices: the count is not a multiple of 3.
    const badCount = geometryFromCoordinates([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    root.add(new Mesh(badIndex), new Mesh(new BoxGeometry(1, 1, 1)), new Mesh(badCount));

    const result = requireError(stage0ParseScene(root));

    expect(result.error.kind).toBe("InvalidGeometryError");
    if (result.error.kind !== "InvalidGeometryError") {
      return;
    }
    expect(result.error.reason).toBe("malformed");
    expect(result.error.nodePaths).toStrictEqual([[0], [2]]);
  });

  it("returns InvalidGeometryError before EmptyAssemblyError when a malformed node has no triangles", () => {
    const root = new Group();
    root.add(new PointLight(0xffffff, 1));
    const badIndex = new BufferGeometry();
    badIndex.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    badIndex.setIndex([0, 1]);
    root.add(new Mesh(badIndex));

    const result = requireError(stage0ParseScene(root));

    expect(result.error.kind).toBe("InvalidGeometryError");
  });
});

describe("Stage 0 error precedence and input safety", () => {
  it("returns a ConfigurationError without reading any geometry", () => {
    const box = new BoxGeometry(1, 1, 1);
    const mesh = new Mesh();
    let geometryReads = 0;
    Object.defineProperty(mesh, "geometry", {
      get() {
        geometryReads++;
        return box;
      },
    });

    const result = requireError(stage0ParseScene(mesh, { tau: 1 }));

    expect(result.error.kind).toBe("ConfigurationError");
    expect(geometryReads).toBe(0);

    // A valid config does read geometry. This single box then forms one Island.
    const valid = requireError(stage0ParseScene(mesh, undefined));
    expect(valid.error.kind).toBe("MonolithicMeshError");
    expect(geometryReads).toBeGreaterThan(0);
  });

  it("reports a ConfigurationError ahead of InvalidGeometryError", () => {
    const root = new Group();
    const badIndex = new BufferGeometry();
    badIndex.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    badIndex.setIndex([0, 1]);
    root.add(new Mesh(badIndex));

    const result = requireError(stage0ParseScene(root, { samplesPerPartPerDirection: 0 }));

    expect(result.error.kind).toBe("ConfigurationError");
  });

  it("never reads matrixWorld or calls updateMatrixWorld, so a stale or broken matrixWorld has no effect", () => {
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    mesh.position.set(3, 0, 0);
    Object.defineProperty(mesh, "matrixWorld", {
      get() {
        throw new Error("matrixWorld must not be read");
      },
    });
    const other = new Mesh(new BoxGeometry(1, 1, 1));
    other.position.set(10, 0, 0);
    root.add(mesh, other);
    const spy = vi.spyOn(root, "updateMatrixWorld");

    const result = requireOk(stage0ParseScene(root));

    expect(spy).not.toHaveBeenCalled();
    const part = partById(result.parts, "/0#0");
    const xs = Array.from({ length: part.positions.length / 3 }, (_, i) => part.positions[3 * i] ?? NaN);
    expect(Math.min(...xs)).toBeCloseTo(2.5, 12);
    expect(Math.max(...xs)).toBeCloseTo(3.5, 12);
  });
});

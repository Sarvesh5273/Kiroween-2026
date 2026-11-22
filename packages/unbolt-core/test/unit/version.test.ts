import * as THREE from "three";
import { describe, expect, it } from "vitest";
import packageManifest from "../../package.json";
import { UNBOLT_CORE_VERSION } from "../../src/index";

describe("unbolt-core version", () => {
  it("UNBOLT_CORE_VERSION equals the version field of package.json", () => {
    expect(UNBOLT_CORE_VERSION).toBe(packageManifest.version);
  });

  it("resolves the three dependency", () => {
    expect(typeof THREE.REVISION).toBe("string");
  });
});

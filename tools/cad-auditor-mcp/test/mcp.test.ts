import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEADLOCK_CAGES, SHOWCASE_KITS } from "@unboltkit/sample-kits";
import { Box3, Group, Mesh, Vector3 } from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { diffRepairability, inspectAssemblyDbg, listSampleKits } from "../src/auditor.js";
import { GlbParseError, parseGlb } from "../src/glbReader.js";
import { boxGltf, buildBoxGlb, packGlb, TWO_PART_BOXES, TWO_PART_OPTIONS } from "./helpers/glbBuilder.js";

const PACKAGE_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WORKSPACE_ROOT = resolve(PACKAGE_DIR, "../..");
const SERVER_JS = join(PACKAGE_DIR, "dist", "server.js");

const LOCKBOX = "haunted-clockwork-lockbox";
const DUMBBELL_RING = "deadlock-cage-dumbbell-ring";

// ---------------------------------------------------------------------------
// glbReader
// ---------------------------------------------------------------------------

describe("glbReader", () => {
  const glb = buildBoxGlb(TWO_PART_BOXES, TWO_PART_OPTIONS);

  it("parses a valid 2-part .glb into a Group with hierarchy, TRS and geometry", () => {
    const root = parseGlb(glb);
    expect(root).toBeInstanceOf(Group);
    expect(root.name).toBe("test_scene");
    expect(root.children).toHaveLength(1);

    const assembly = root.children[0]!;
    expect(assembly.name).toBe("assembly");
    expect(assembly.position.toArray()).toEqual([10, 0, 0]);
    expect(assembly.children.map((child) => child.name)).toEqual(["base_plate", "top_cover"]);

    const [base, cover] = assembly.children as [Mesh, Mesh];
    expect(base).toBeInstanceOf(Mesh);
    expect(cover).toBeInstanceOf(Mesh);
    expect(cover.position.toArray()).toEqual([0, 3, 0]);

    for (const [mesh, half] of [[base, 1], [cover, 0.5]] as const) {
      const position = mesh.geometry.getAttribute("position");
      const normal = mesh.geometry.getAttribute("normal");
      expect(position.count).toBe(24);
      expect(normal.count).toBe(24);
      expect(mesh.geometry.getIndex()?.count).toBe(36);
      // Every vertex of a cube lies on the surface of the box.
      for (let i = 0; i < position.count; i++) {
        const extent = Math.max(Math.abs(position.getX(i)), Math.abs(position.getY(i)), Math.abs(position.getZ(i)));
        expect(extent).toBeCloseTo(half, 6);
      }
    }

    // World placement comes from the parent translation plus the child's local translation.
    root.updateMatrixWorld(true);
    const coverBox = new Box3().setFromObject(cover);
    expect(coverBox.min.toArray()).toEqual([9.5, 2.5, -0.5]);
    expect(coverBox.max.toArray()).toEqual([10.5, 3.5, 0.5]);
    const baseCenter = new Box3().setFromObject(base).getCenter(new Vector3());
    expect(baseCenter.toArray()).toEqual([10, 0, 0]);
    expect(root.userData["glbWarnings"]).toEqual([]);
  });

  it("reads node.matrix as a local transform", () => {
    const { json, bin } = boxGltf([{ name: "solo_box", half: 1, translation: [0, 0, 0] }]);
    const nodes = json["nodes"] as Record<string, unknown>[];
    // Column-major: uniform scale 2 and translation (1, 2, 3).
    nodes[0] = { name: "solo_box", mesh: 0, matrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 2, 3, 1] };
    const root = parseGlb(packGlb(json, bin));
    const mesh = root.children[0]!;
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
    expect(mesh.scale.toArray()).toEqual([2, 2, 2]);
  });

  it("rejects an invalid magic", () => {
    const bad = Buffer.from(glb);
    bad.writeUInt32LE(0x12345678, 0);
    expect(() => parseGlb(bad)).toThrow(GlbParseError);
    expect(() => parseGlb(bad)).toThrow(/magic/i);
  });

  it("rejects an unsupported version", () => {
    const bad = Buffer.from(glb);
    bad.writeUInt32LE(1, 4);
    expect(() => parseGlb(bad)).toThrow(/version 1/);
  });

  it("rejects buffers shorter than the header", () => {
    expect(() => parseGlb(new Uint8Array(0))).toThrow(GlbParseError);
    expect(() => parseGlb(glb.subarray(0, 11))).toThrow(/truncated/i);
  });

  it("rejects a buffer cut short of its declared length", () => {
    expect(() => parseGlb(glb.subarray(0, glb.length - 10))).toThrow(GlbParseError);
    expect(() => parseGlb(glb.subarray(0, glb.length - 10))).toThrow(/truncated/i);
    expect(() => parseGlb(glb.subarray(0, 20))).toThrow(/truncated/i);
  });

  it("rejects a chunk that overruns the file", () => {
    const bad = Buffer.from(glb);
    // Claim the JSON chunk is longer than the whole file, keeping the header length intact.
    bad.writeUInt32LE(glb.length * 2, 12);
    expect(() => parseGlb(bad)).toThrow(/chunk 0/);
  });

  it("rejects invalid JSON and a missing JSON chunk", () => {
    const body = Buffer.from("{ not json", "utf8");
    const padded = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4, 0x20)]);
    const chunk = Buffer.alloc(8);
    chunk.writeUInt32LE(padded.length, 0);
    chunk.writeUInt32LE(0x4e4f534a, 4);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + padded.length, 8);
    expect(() => parseGlb(Buffer.concat([header, chunk, padded]))).toThrow(/not valid JSON/);

    const headerOnly = Buffer.alloc(12);
    headerOnly.writeUInt32LE(0x46546c67, 0);
    headerOnly.writeUInt32LE(2, 4);
    headerOnly.writeUInt32LE(12, 8);
    expect(() => parseGlb(headerOnly)).toThrow(/no JSON chunk/);
  });

  it("rejects accessors that read outside their buffer", () => {
    const { json, bin } = boxGltf(TWO_PART_BOXES);
    const accessors = json["accessors"] as { count: number }[];
    accessors[0]!.count = 10_000;
    expect(() => parseGlb(packGlb(json, bin))).toThrow(/bufferView holds/);
  });

  it("rejects a node hierarchy with a cycle", () => {
    const { json, bin } = boxGltf(TWO_PART_BOXES);
    const nodes = json["nodes"] as { children?: number[] }[];
    nodes[0]!.children = [1];
    nodes[1]!.children = [0];
    expect(() => parseGlb(packGlb(json, bin))).toThrow(/cycle/);
  });

  it("rejects external buffer files", () => {
    const { json, bin } = boxGltf(TWO_PART_BOXES);
    (json["buffers"] as { uri?: string }[])[0]!.uri = "parts.bin";
    expect(() => parseGlb(packGlb(json, bin))).toThrow(/external file/);
  });
});

// ---------------------------------------------------------------------------
// auditor, on a real .glb file
// ---------------------------------------------------------------------------

describe("auditor on a .glb file", () => {
  let dir: string;
  let twoPartPath: string;
  let monolithPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "cad-auditor-"));
    twoPartPath = join(dir, "two-part.glb");
    writeFileSync(twoPartPath, buildBoxGlb(TWO_PART_BOXES, TWO_PART_OPTIONS));
    monolithPath = join(dir, "monolith.glb");
    writeFileSync(monolithPath, buildBoxGlb([{ name: "solo_box", half: 1, translation: [0, 0, 0] }]));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("solves the two-part assembly with a clash-free plan", () => {
    const audit = inspectAssemblyDbg({ glbPath: twoPartPath });
    expect(audit.error).toBeUndefined();
    expect(audit.status).toBe("solved");
    expect(audit.partCount).toBe(2);
    expect(audit.totalTriangles).toBe(24);
    expect(audit.polyBudgetExceeded).toBe(false);
    expect(audit.oracleTotalClashes).toBe(0);
    expect(audit.steps.map((step) => step.repairabilityDepth)).toEqual([1, 2]);
    expect(audit.steps.map((step) => step.name).sort()).toEqual(["base_plate", "top_cover"]);
    for (const step of audit.steps) {
      expect(["linear_slide", "helical_unscrew", "two_step_l_slide"]).toContain(step.primitive);
      expect(Number.isFinite(step.escapeDistance)).toBe(true);
      expect(step.escapeDistance).toBeGreaterThanOrEqual(0);
    }
    expect(audit.deadlockWitness).toBeUndefined();
  });

  it("reports a single-island .glb as an error value, not an exception", () => {
    const audit = inspectAssemblyDbg({ glbPath: monolithPath });
    expect(audit.status).toBe("error");
    expect(audit.error?.kind).toBe("MonolithicMeshError");
  });

  it("reports bad input as an error value", () => {
    expect(inspectAssemblyDbg({ kitName: "no-such-kit" }).error?.kind).toBe("AuditInputError");
    expect(inspectAssemblyDbg({}).status).toBe("error");
    expect(inspectAssemblyDbg({ kitName: LOCKBOX, glbPath: twoPartPath }).status).toBe("error");
    expect(inspectAssemblyDbg({ glbPath: join(dir, "missing.glb") }).status).toBe("error");
  });

  it("passes when an assembly is diffed against itself", () => {
    const diff = diffRepairability({ baseline: { glbPath: twoPartPath }, candidate: { glbPath: twoPartPath } });
    expect(diff.passed).toBe(true);
    expect(diff.deadlock.regressed).toBe(false);
    expect(diff.depthRegressions).toEqual([]);
    expect(diff.clashDeltas.oracleTotalClashes).toEqual({ baseline: 0, candidate: 0, delta: 0 });
  });

  it("fails the diff when either side errors", () => {
    const diff = diffRepairability({ baseline: { glbPath: twoPartPath }, candidate: { glbPath: monolithPath } });
    expect(diff.passed).toBe(false);
    expect(diff.errors).toHaveLength(1);
    expect(diff.errors[0]).toMatch(/candidate audit failed: MonolithicMeshError/);
  });

  it("flags a part that gets harder to reach, and honors targetPartFilter", () => {
    // Baseline: two parts. Candidate: the same two parts plus a cap above them. Parts present in
    // both are matched by name, and every reported depth change must be a real, non-zero delta.
    const baseline = join(dir, "baseline.glb");
    const candidate = join(dir, "candidate.glb");
    writeFileSync(baseline, buildBoxGlb(TWO_PART_BOXES, TWO_PART_OPTIONS));
    writeFileSync(
      candidate,
      buildBoxGlb([...TWO_PART_BOXES, { name: "extra_cap", half: 0.5, translation: [0, 5, 0] }], TWO_PART_OPTIONS),
    );
    const diff = diffRepairability({ baseline: { glbPath: baseline }, candidate: { glbPath: candidate } });
    expect(diff.passed).toBe(true);
    expect(diff.addedParts).toEqual(["extra_cap"]);
    for (const change of [...diff.depthRegressions, ...diff.depthImprovements]) {
      expect(change.delta).toBe((change.candidateDepth as number) - (change.baselineDepth as number));
      expect(change.delta).not.toBe(0);
    }

    const filtered = diffRepairability({
      baseline: { glbPath: baseline },
      candidate: { glbPath: candidate },
      targetPartFilter: "base_*",
    });
    const touched = [...filtered.depthRegressions, ...filtered.depthImprovements].map((change) => change.name);
    expect(touched.every((name) => name === "base_plate")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MCP server over real stdio
// ---------------------------------------------------------------------------

interface RpcMessage {
  jsonrpc: string;
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

class McpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting = new Map<number, (message: RpcMessage) => void>();
  private pending = "";
  private nextId = 1;
  readonly stdoutLines: string[] = [];
  readonly unparseable: string[] = [];
  readonly messages: RpcMessage[] = [];
  stderr = "";
  readonly exited: Promise<number | null>;

  constructor() {
    this.child = spawn(process.execPath, [SERVER_JS], { cwd: PACKAGE_DIR, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    this.exited = new Promise((done) => this.child.on("close", (code) => done(code)));
  }

  private onStdout(chunk: string): void {
    this.pending += chunk;
    for (let newline = this.pending.indexOf("\n"); newline >= 0; newline = this.pending.indexOf("\n")) {
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      this.stdoutLines.push(line);
      let message: RpcMessage;
      try {
        message = JSON.parse(line) as RpcMessage;
      } catch (cause) {
        // Recorded, then asserted empty by the stdout-cleanliness test.
        this.unparseable.push(`${line} (${String(cause)})`);
        continue;
      }
      this.messages.push(message);
      if (typeof message.id === "number") {
        this.waiting.get(message.id)?.(message);
        this.waiting.delete(message.id);
      }
    }
  }

  request(method: string, params?: unknown): Promise<RpcMessage> {
    const id = this.nextId++;
    const reply = new Promise<RpcMessage>((done) => this.waiting.set(id, done));
    this.writeLine({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    return reply;
  }

  /** Sends a raw line and waits for the next message with the given id (or any id when null). */
  rawRequest(line: string): Promise<RpcMessage> {
    const before = this.messages.length;
    this.child.stdin.write(`${line}\n`);
    return new Promise((done, fail) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (this.messages.length > before) {
          clearInterval(timer);
          done(this.messages[before] as RpcMessage);
        } else if (Date.now() - started > 20_000) {
          clearInterval(timer);
          fail(new Error(`no reply to raw line: ${line}`));
        }
      }, 10);
    });
  }

  notify(method: string, params?: unknown): void {
    this.writeLine({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  async callTool(name: string, args: unknown): Promise<{ structured: Record<string, any>; isError: boolean; text: string }> {
    const reply = await this.request("tools/call", { name, arguments: args });
    expect(reply.error).toBeUndefined();
    const result = reply.result as { content: { type: string; text: string }[]; structuredContent?: Record<string, any>; isError?: boolean };
    expect(result.content[0]?.type).toBe("text");
    const text = result.content[0]?.text ?? "";
    if (result.structuredContent !== undefined) {
      expect(JSON.parse(text)).toEqual(result.structuredContent);
    }
    return { structured: result.structuredContent ?? {}, isError: result.isError === true, text };
  }

  private writeLine(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async close(): Promise<number | null> {
    this.child.stdin.end();
    return this.exited;
  }
}

describe("cad-auditor MCP server over stdio", () => {
  let client: McpClient;

  beforeAll(() => {
    if (!existsSync(SERVER_JS)) {
      throw new Error(`Missing ${SERVER_JS}. Run "npm run build" in tools/cad-auditor-mcp before the tests.`);
    }
    client = new McpClient();
  });

  afterAll(async () => {
    await client.close();
  });

  it("answers initialize and accepts notifications/initialized without a reply", async () => {
    const reply = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "0.0.0" },
    });
    expect(reply.jsonrpc).toBe("2.0");
    expect(reply.error).toBeUndefined();
    expect(reply.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "cad-auditor-mcp" },
    });
    const before = client.messages.length;
    client.notify("notifications/initialized");
    const ping = await client.request("ping");
    expect(ping.result).toEqual({});
    // Only the ping reply arrived after the notification.
    expect(client.messages.length).toBe(before + 1);
  });

  it("falls back to its latest protocol version for an unknown request", async () => {
    const reply = await client.request("initialize", { protocolVersion: "1999-01-01" });
    expect(reply.result?.["protocolVersion"]).toBe("2025-06-18");
  });

  it("lists the three tools with input schemas", async () => {
    const reply = await client.request("tools/list");
    const tools = (reply.result as { tools: { name: string; description: string; inputSchema: { type: string } }[] }).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual(["diff_repairability", "inspect_assembly_dbg", "list_sample_kits"]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("list_sample_kits returns all 5 bundled kits", async () => {
    const { structured, isError } = await client.callTool("list_sample_kits", {});
    expect(isError).toBe(false);
    const kits = structured["kits"] as { name: string; category: string }[];
    expect(kits).toHaveLength(5);
    expect(kits.map((kit) => kit.name)).toEqual([...SHOWCASE_KITS, ...DEADLOCK_CAGES].map((kit) => kit.name));
    expect(kits.filter((kit) => kit.category === "showcase")).toHaveLength(3);
    expect(kits.filter((kit) => kit.category === "deadlock-cage")).toHaveLength(2);
    expect(kits).toEqual(listSampleKits());
  });

  it("inspect_assembly_dbg solves haunted-clockwork-lockbox with 0 oracle clashes", async () => {
    const { structured, isError } = await client.callTool("inspect_assembly_dbg", { kitName: LOCKBOX });
    expect(isError).toBe(false);
    expect(structured["status"]).toBe("solved");
    expect(structured["oracleTotalClashes"]).toBe(0);
    expect(structured["polyBudgetExceeded"]).toBe(false);
    expect(structured["deadlockWitness"]).toBeUndefined();
    const steps = structured["steps"] as { repairabilityDepth: number; partId: string; name: string; primitive: string; escapeDistance: number }[];
    expect(structured["partCount"]).toBeGreaterThan(1);
    // A solved plan removes every part exactly once, in 1-based depth order.
    expect(steps).toHaveLength(structured["partCount"]);
    expect(steps.map((step) => step.repairabilityDepth)).toEqual(steps.map((_, index) => index + 1));
    expect(new Set(steps.map((step) => step.partId)).size).toBe(steps.length);
    for (const step of steps) {
      expect(step.name).toMatch(/^[a-z]/);
      expect(["linear_slide", "helical_unscrew", "two_step_l_slide"]).toContain(step.primitive);
      expect(Number.isFinite(step.escapeDistance)).toBe(true);
      expect(step.escapeDistance).toBeGreaterThanOrEqual(0);
    }
    // Moving every part straight outward is not a valid plan for this kit.
    expect(structured["naiveTotalClashes"]).toBeGreaterThan(0);
    expect(structured["naiveObstructedParts"]).toBeGreaterThan(0);
    expect(structured["totalTriangles"]).toBeGreaterThan(0);
  });

  it("inspect_assembly_dbg reports deadlock-cage-dumbbell-ring as deadlocked with SCCs", async () => {
    const { structured } = await client.callTool("inspect_assembly_dbg", { kitName: DUMBBELL_RING });
    expect(structured["status"]).toBe("deadlocked");
    const witness = structured["deadlockWitness"] as {
      sccs: { partIds: string[]; names: string[]; edges: { from: string; to: string }[] }[];
      unassigned: { partId: string }[];
    };
    expect(witness.sccs.length).toBeGreaterThanOrEqual(1);
    for (const scc of witness.sccs) {
      expect(scc.partIds.length).toBeGreaterThanOrEqual(2);
      expect(scc.names).toHaveLength(scc.partIds.length);
      // Every witness edge connects two members of its SCC.
      for (const edge of scc.edges) {
        expect(scc.partIds).toContain(edge.from);
        expect(scc.partIds).toContain(edge.to);
      }
    }
    // Steps taken before the deadlock, the SCC members and the other blocked parts are disjoint
    // and together account for every part.
    const steps = structured["steps"] as { partId: string }[];
    const sccIds = witness.sccs.flatMap((scc) => scc.partIds);
    const allIds = [...steps.map((step) => step.partId), ...sccIds, ...witness.unassigned.map((part) => part.partId)];
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds).toHaveLength(structured["partCount"]);
    expect(structured["oracleTotalClashes"]).toBe(0);
  });

  it("diff_repairability fails lockbox -> dumbbell ring with a deadlock regression", async () => {
    const { structured, isError } = await client.callTool("diff_repairability", {
      baseline: { kitName: LOCKBOX },
      candidate: { kitName: DUMBBELL_RING },
    });
    expect(isError).toBe(false);
    expect(structured["passed"]).toBe(false);
    expect(structured["verdict"]).toMatch(/^FAIL/);
    expect(structured["deadlock"].regressed).toBe(true);
    expect(structured["deadlock"].newlyDeadlocked).toBe(true);
    expect(structured["deadlock"].newSccs.length).toBeGreaterThanOrEqual(1);
    expect(structured["baseline"].status).toBe("solved");
    expect(structured["candidate"].status).toBe("deadlocked");
    expect(structured["errors"]).toEqual([]);
    const oracle = structured["clashDeltas"].oracleTotalClashes as { baseline: number; candidate: number; delta: number };
    expect(oracle.delta).toBe(oracle.candidate - oracle.baseline);
  });

  it("diff_repairability passes the reverse direction (deadlock resolved)", async () => {
    const { structured } = await client.callTool("diff_repairability", {
      baseline: { kitName: DUMBBELL_RING },
      candidate: { kitName: LOCKBOX },
    });
    expect(structured["passed"]).toBe(true);
    expect(structured["deadlock"].regressed).toBe(false);
    expect(structured["deadlock"].resolvedSccs.length).toBeGreaterThanOrEqual(1);
  });

  it("reports bad tool arguments as tool errors the model can read", async () => {
    const both = await client.callTool("inspect_assembly_dbg", { kitName: LOCKBOX, glbPath: "x.glb" });
    expect(both.isError).toBe(true);
    expect(both.text).toMatch(/exactly one/);

    const unknownKit = await client.callTool("inspect_assembly_dbg", { kitName: "no-such-kit" });
    expect(unknownKit.isError).toBe(true);
    expect(unknownKit.structured["status"]).toBe("error");

    const reply = await client.request("tools/call", { name: "diff_repairability", arguments: { baseline: { kitName: LOCKBOX } } });
    const result = reply.result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/candidate/);
  });

  it("returns JSON-RPC errors for unknown methods, unknown tools and bad JSON", async () => {
    const method = await client.request("resources/list");
    expect(method.error?.code).toBe(-32601);

    const tool = await client.request("tools/call", { name: "delete_everything", arguments: {} });
    expect(tool.error?.code).toBe(-32602);

    const parse = await client.rawRequest("{ this is not json");
    expect(parse.id).toBeNull();
    expect(parse.error?.code).toBe(-32700);
  });

  it("keeps stdout to JSON-RPC lines and sends logs to stderr", async () => {
    const exitCode = await client.close();
    expect(exitCode).toBe(0);
    expect(client.unparseable).toEqual([]);
    expect(client.stdoutLines.length).toBeGreaterThan(0);
    for (const message of client.messages) {
      expect(message.jsonrpc).toBe("2.0");
    }
    expect(client.stderr).toMatch(/listening on stdio/);
    expect(client.stderr).toMatch(/unparseable input line/);
  });
});

// ---------------------------------------------------------------------------
// Hooks, power and MCP configuration files
// ---------------------------------------------------------------------------

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("Kiro hooks, power and workspace MCP config", () => {
  const hooksDir = join(WORKSPACE_ROOT, ".kiro", "hooks");
  const powerDir = join(WORKSPACE_ROOT, "powers", "cad-assembly-auditor");

  it("parses every .kiro/hooks/*.kiro.hook file as JSON", () => {
    const files = readdirSync(hooksDir).filter((file) => file.endsWith(".kiro.hook"));
    expect(files.sort()).toEqual(["sync-extraction-primitive.kiro.hook", "verify-dbg-invariants.kiro.hook"]);
    for (const file of files) {
      const hook = readJson(join(hooksDir, file));
      expect(hook.enabled).toBe(true);
      expect(hook.version).toBe("1.0.0");
      expect(typeof hook.name).toBe("string");
      expect(hook.when.type).toBe("fileEdited");
      expect(Array.isArray(hook.when.patterns)).toBe(true);
    }
  });

  it("defines the Sync Extraction Primitive hook as an agent prompt", () => {
    const hook = readJson(join(hooksDir, "sync-extraction-primitive.kiro.hook"));
    expect(hook.name).toBe("Sync Extraction Primitive Across UnboltKit");
    expect(hook.when.patterns).toEqual(["packages/unbolt-core/src/primitives/*.ts"]);
    expect(hook.then.type).toBe("askAgent");
    for (const mention of [
      "packages/unbolt-core",
      "registry.ts",
      "src/types.ts",
      "src/state/authoringSlice.ts",
      "src/authoring/stepText.ts",
      "src/modules/soundModule.ts",
      ".kiro/steering/ui-separation.md",
      "typecheck",
    ]) {
      expect(hook.then.prompt).toContain(mention);
    }
  });

  it("defines the Verify Core DBG Quick Suite hook as a shell command", () => {
    const hook = readJson(join(hooksDir, "verify-dbg-invariants.kiro.hook"));
    expect(hook.name).toBe("Verify Core DBG Quick Suite");
    expect(hook.when.patterns).toEqual(["packages/unbolt-core/src/**/*.ts"]);
    expect(hook.then).toEqual({ type: "runCommand", command: "npm --workspace=@unboltkit/core run test:quick" });
  });

  it("parses every powers/cad-assembly-auditor/*.json file", () => {
    const files = readdirSync(powerDir).filter((file) => file.endsWith(".json"));
    expect(files.sort()).toEqual(["mcp.json", "plugin.json"]);
    for (const file of files) {
      expect(() => readJson(join(powerDir, file))).not.toThrow();
    }
  });

  it("describes the power in plugin.json", () => {
    const plugin = readJson(join(powerDir, "plugin.json"));
    expect(plugin.name).toBe("cad-assembly-auditor");
    expect(plugin.version).toBe("0.1.0");
    expect(plugin.description.length).toBeGreaterThan(10);
    expect(plugin.keywords).toEqual(["cad", "glb", "gltf", "disassembly", "deadlock", "repairability", "tarjan", "unboltkit"]);
  });

  function expectLaunchesCompiledServer(server: Record<string, any>): void {
    expect(server.command).toBe("node");
    expect(server.args).toEqual(["tools/cad-auditor-mcp/dist/server.js"]);
    expect(server.disabled).toBe(false);
    // The path is relative to the workspace root, where the config is used.
    expect(resolve(WORKSPACE_ROOT, server.args[0])).toBe(SERVER_JS);
  }

  it("launches the compiled server from the power's mcp.json", () => {
    expectLaunchesCompiledServer(readJson(join(powerDir, "mcp.json")).mcpServers["cad-assembly-auditor"]);
  });

  it("registers the server in the workspace .kiro/settings/mcp.json", () => {
    expectLaunchesCompiledServer(readJson(join(WORKSPACE_ROOT, ".kiro", "settings", "mcp.json")).mcpServers["cad-assembly-auditor"]);
  });

  it("has POWER.md frontmatter and a SKILL.md", () => {
    const power = readFileSync(join(powerDir, "POWER.md"), "utf8");
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(power)?.[1] ?? "";
    for (const key of ["name:", "displayName:", "description:", "keywords:"]) {
      expect(frontmatter).toContain(key);
    }
    expect(frontmatter).toContain("name: cad-assembly-auditor");
    const skill = readFileSync(join(powerDir, "skills", "cad-audit", "SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: cad-audit\n/);
  });
});

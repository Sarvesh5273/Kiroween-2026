/**
 * Minimal MCP (Model Context Protocol) request handler over JSON-RPC 2.0, with no MCP SDK.
 *
 * `handleMessage` takes one parsed JSON-RPC message and returns the response to send, or `null`
 * for a notification. It does no I/O, so the stdio loop in `server.ts` and the tests share it.
 */
import { diffRepairability, inspectAssemblyDbg, listSampleKits } from "./auditor.js";
import type { AssemblySource, DiffInput } from "./auditor.js";

export const SERVER_INFO = Object.freeze({ name: "cad-auditor-mcp", version: "0.1.0" });
export const LATEST_PROTOCOL_VERSION = "2025-06-18";
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [LATEST_PROTOCOL_VERSION, "2025-03-26", "2024-11-05"];

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

type JsonRpcId = string | number | null;

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** A failure that maps to a JSON-RPC error object. */
class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/** Invalid tool arguments. Reported as a tool result with `isError`, so the model can retry. */
class ToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolArgumentError";
  }
}

const SOURCE_PROPERTIES = {
  kitName: {
    type: "string",
    description: "Name of a bundled sample kit. Call list_sample_kits for the names.",
  },
  glbPath: {
    type: "string",
    description: "Path to a binary glTF 2.0 (.glb) file. A relative path resolves against the server's working directory.",
  },
} as const;

const SOURCE_SCHEMA = {
  type: "object",
  description: "One assembly. Give exactly one of kitName or glbPath.",
  properties: SOURCE_PROPERTIES,
  additionalProperties: false,
} as const;

export const TOOLS = [
  {
    name: "list_sample_kits",
    description: "List the five bundled UnboltKit sample assemblies: three showcase kits and two deadlock cages.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "inspect_assembly_dbg",
    description:
      "Run the full UnboltKit disassembly pipeline (Stages 0 to 4) on a sample kit or a .glb file. Returns status (solved, deadlocked or error), part and triangle counts, the ordered removal steps with 1-based repairabilityDepth and motion primitive, the independent clash-oracle total, the naive radial clash baseline, and the Tarjan SCC deadlockWitness when deadlocked.",
    inputSchema: {
      type: "object",
      properties: SOURCE_PROPERTIES,
      additionalProperties: false,
    },
  },
  {
    name: "diff_repairability",
    description:
      "Audit a baseline and a candidate assembly and report newly introduced deadlock SCCs, per-part repairability depth regressions, and clash deltas. passed is false on any deadlock regression or audit error.",
    inputSchema: {
      type: "object",
      properties: {
        baseline: SOURCE_SCHEMA,
        candidate: SOURCE_SCHEMA,
        targetPartFilter: {
          description: "Optional. Limit the depth comparison to parts matching these names or Part_IDs. '*' is a wildcard.",
          oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        },
      },
      required: ["baseline", "candidate"],
      additionalProperties: false,
    },
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSource(value: unknown, label: string): AssemblySource {
  if (!isRecord(value)) {
    throw new ToolArgumentError(`${label} must be an object with kitName or glbPath.`);
  }
  const source: AssemblySource = {};
  for (const field of ["kitName", "glbPath"] as const) {
    const entry = value[field];
    if (entry === undefined) {
      continue;
    }
    if (typeof entry !== "string" || entry === "") {
      throw new ToolArgumentError(`${label}.${field} must be a non-empty string.`);
    }
    source[field] = entry;
  }
  if ((source.kitName === undefined) === (source.glbPath === undefined)) {
    throw new ToolArgumentError(`${label} needs exactly one of kitName or glbPath.`);
  }
  return source;
}

function parseDiffInput(args: Record<string, unknown>): DiffInput {
  const input: DiffInput = {
    baseline: parseSource(args["baseline"], "baseline"),
    candidate: parseSource(args["candidate"], "candidate"),
  };
  const filter = args["targetPartFilter"];
  if (filter !== undefined) {
    const valid = typeof filter === "string" || (Array.isArray(filter) && filter.every((item) => typeof item === "string"));
    if (!valid) {
      throw new ToolArgumentError("targetPartFilter must be a string or an array of strings.");
    }
    input.targetPartFilter = filter as string | string[];
  }
  return input;
}

interface ToolOutcome {
  value: unknown;
  isError: boolean;
}

function runTool(name: string, args: Record<string, unknown>): ToolOutcome {
  switch (name) {
    case "list_sample_kits":
      return { value: { kits: listSampleKits() }, isError: false };
    case "inspect_assembly_dbg": {
      const audit = inspectAssemblyDbg(parseSource(args, "arguments"));
      return { value: audit, isError: audit.status === "error" };
    }
    case "diff_repairability":
      // A failed verdict is a result, not a tool failure, so isError stays false.
      return { value: diffRepairability(parseDiffInput(args)), isError: false };
    default:
      throw new RpcError(INVALID_PARAMS, `Unknown tool: ${name}`);
  }
}

function callTool(params: unknown): unknown {
  if (!isRecord(params) || typeof params["name"] !== "string") {
    throw new RpcError(INVALID_PARAMS, "tools/call requires params.name as a string.");
  }
  const rawArgs = params["arguments"] ?? {};
  if (!isRecord(rawArgs)) {
    throw new RpcError(INVALID_PARAMS, "tools/call params.arguments must be an object.");
  }
  let outcome: ToolOutcome;
  try {
    outcome = runTool(params["name"], rawArgs);
  } catch (cause) {
    if (cause instanceof ToolArgumentError) {
      return { content: [{ type: "text", text: cause.message }], isError: true };
    }
    throw cause;
  }
  return {
    content: [{ type: "text", text: JSON.stringify(outcome.value, null, 2) }],
    structuredContent: outcome.value,
    isError: outcome.isError,
  };
}

function dispatch(method: string, params: unknown): unknown {
  switch (method) {
    case "initialize": {
      const requested = isRecord(params) ? params["protocolVersion"] : undefined;
      const protocolVersion =
        typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
      return { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return callTool(params);
    default:
      throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

function errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Response for a line that is not valid JSON. */
export function parseErrorResponse(detail: string): JsonRpcResponse {
  return errorResponse(null, PARSE_ERROR, `Parse error: ${detail}`);
}

/**
 * Handles one parsed JSON-RPC message. Returns `null` for notifications (no `id`), which get no
 * reply, including `notifications/initialized`.
 */
export function handleMessage(message: unknown): JsonRpcResponse | null {
  if (!isRecord(message) || message["jsonrpc"] !== "2.0" || typeof message["method"] !== "string") {
    const id = isRecord(message) && (typeof message["id"] === "string" || typeof message["id"] === "number") ? message["id"] : null;
    return errorResponse(id, INVALID_REQUEST, "Invalid request: expected a JSON-RPC 2.0 request object with a string method.");
  }
  const hasId = "id" in message;
  const rawId = message["id"];
  if (hasId && typeof rawId !== "string" && typeof rawId !== "number") {
    return errorResponse(null, INVALID_REQUEST, "Invalid request: id must be a string or a number.");
  }
  const method = message["method"];
  if (!hasId) {
    // A notification. Nothing is sent back, so only the cheap known ones need any action.
    return null;
  }
  const id = rawId as string | number;
  try {
    return { jsonrpc: "2.0", id, result: dispatch(method, message["params"]) };
  } catch (cause) {
    if (cause instanceof RpcError) {
      return errorResponse(id, cause.code, cause.message);
    }
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    return errorResponse(id, INTERNAL_ERROR, `Internal error: ${detail}`);
  }
}

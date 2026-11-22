#!/usr/bin/env node
/**
 * Stdio entry point of the CAD auditor MCP server.
 *
 * Transport: newline-delimited JSON-RPC 2.0. One JSON message per line on stdin, one per line on
 * stdout. stdout carries protocol messages only. Every log line goes to stderr.
 */
import { createInterface } from "node:readline";
import { handleMessage, parseErrorResponse, SERVER_INFO } from "./mcp.js";
import type { JsonRpcResponse } from "./mcp.js";

function log(message: string): void {
  process.stderr.write(`[${SERVER_INFO.name}] ${message}\n`);
}

function send(response: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function handleLine(line: string): void {
  if (line.trim() === "") {
    return;
  }
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    log(`unparseable input line: ${detail}`);
    send(parseErrorResponse(detail));
    return;
  }
  const response = handleMessage(message);
  if (response !== null) {
    send(response);
  }
}

function main(): void {
  log(`${SERVER_INFO.name} ${SERVER_INFO.version} listening on stdio`);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Audits are synchronous and CPU-bound, so lines are handled strictly in arrival order.
  lines.on("line", handleLine);
  lines.on("close", () => {
    log("stdin closed, exiting");
    process.exit(0);
  });
  process.on("uncaughtException", (error) => {
    log(`uncaught exception: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}

main();

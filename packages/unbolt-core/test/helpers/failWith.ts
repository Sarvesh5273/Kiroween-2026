import type { ContextValue } from "fast-check";

/**
 * Domain facts that help reproduce a property failure: kit name, quaternion, translation,
 * config seed, step index, Part_ID, `dir`, triangle lists, and so on.
 */
export type DomainContext = Readonly<Record<string, unknown>>;

const MAX_LISTED_ITEMS = 32;

/**
 * Deterministic text form of the domain facts. Keys are sorted, numbers keep `NaN`, `-0` and
 * `Infinity` visible, and long arrays are truncated with a count of the omitted items.
 */
export function describeDomain(domain: DomainContext): string {
  const lines = Object.keys(domain)
    .sort()
    .map((key) => `${key}: ${formatValue(domain[key], 0)}`);
  return lines.join("\n");
}

/**
 * Logs the domain facts through `fc.context()` and returns the message with those facts
 * appended. Pass the result to `expect(actual, message)` so a failed assertion reports them.
 */
export function domainMessage(context: ContextValue, domain: DomainContext, message: string): string {
  const details = describeDomain(domain);
  context.log(details);
  return `${message}\n${details}`;
}

/** Logs the domain facts through `fc.context()` and throws an `Error` with them appended. */
export function failWith(context: ContextValue, domain: DomainContext, message: string): never {
  throw new Error(domainMessage(context, domain, message));
}

function formatValue(value: unknown, depth: number): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "number":
      return formatNumber(value);
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return String(value);
    case "undefined":
      return "undefined";
    case "bigint":
      return `${String(value)}n`;
    case "symbol":
      return "[symbol]";
    case "function":
      return "[function]";
    default:
      break;
  }
  if (depth >= 4) {
    return "[nested]";
  }
  if (ArrayBuffer.isView(value)) {
    return formatList(Array.from(value as unknown as ArrayLike<number>, (entry) => formatNumber(entry)));
  }
  if (Array.isArray(value)) {
    return formatList(value.map((entry: unknown) => formatValue(entry, depth + 1)));
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${key}: ${formatValue(record[key], depth + 1)}`);
  return `{${entries.join(", ")}}`;
}

function formatList(items: string[]): string {
  if (items.length <= MAX_LISTED_ITEMS) {
    return `[${items.join(", ")}]`;
  }
  const shown = items.slice(0, MAX_LISTED_ITEMS).join(", ");
  return `[${shown}, ...(+${items.length - MAX_LISTED_ITEMS} more)]`;
}

function formatNumber(value: number): string {
  if (Number.isNaN(value)) {
    return "NaN";
  }
  if (value === Number.POSITIVE_INFINITY) {
    return "Infinity";
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return "-Infinity";
  }
  if (Object.is(value, -0)) {
    return "-0";
  }
  return String(value);
}

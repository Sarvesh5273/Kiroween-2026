/**
 * Plain-data checker for Req 1.5. A plain data value is built only from strings, finite numbers,
 * booleans, `null`, arrays, typed arrays and objects whose prototype is `Object.prototype`.
 * Cycles, `Map`, `Set`, class instances (including `THREE` objects), functions, `undefined`,
 * symbols, bigints and non-finite numbers are all rejected.
 */

export interface PlainDataProblem {
  path: string;
  reason: string;
}

export function findPlainDataProblems(value: unknown): PlainDataProblem[] {
  const problems: PlainDataProblem[] = [];
  visit(value, "$", new Set<object>(), problems);
  return problems;
}

export function isPlainData(value: unknown): boolean {
  return findPlainDataProblems(value).length === 0;
}

function visit(value: unknown, path: string, ancestors: Set<object>, problems: PlainDataProblem[]): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      problems.push({ path, reason: `non-finite number ${String(value)}` });
    }
    return;
  }
  if (typeof value !== "object") {
    problems.push({ path, reason: `value of type ${typeof value} is not plain data` });
    return;
  }

  if (ancestors.has(value)) {
    problems.push({ path, reason: "cycle" });
    return;
  }

  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      problems.push({ path, reason: "DataView is not plain data" });
      return;
    }
    const elements = value as unknown as ArrayLike<unknown>;
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      if (typeof element === "bigint") {
        problems.push({ path: `${path}[${i}]`, reason: "bigint typed array element" });
      } else if (typeof element === "number" && !Number.isFinite(element)) {
        problems.push({ path: `${path}[${i}]`, reason: `non-finite number ${String(element)}` });
      }
    }
    return;
  }

  if (value instanceof Map) {
    problems.push({ path, reason: "Map is not plain data" });
    return;
  }
  if (value instanceof Set) {
    problems.push({ path, reason: "Set is not plain data" });
    return;
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      visit(value[i], `${path}[${i}]`, ancestors, problems);
    }
  } else {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype) {
      problems.push({ path, reason: `class instance or non-plain prototype (${describePrototype(value)})` });
    } else {
      for (const key of Object.keys(value)) {
        visit((value as Record<string, unknown>)[key], `${path}.${key}`, ancestors, problems);
      }
    }
  }
  ancestors.delete(value);
}

function describePrototype(value: object): string {
  const constructor: unknown = Object.getPrototypeOf(value)?.constructor;
  return typeof constructor === "function" && constructor.name !== "" ? constructor.name : "anonymous";
}

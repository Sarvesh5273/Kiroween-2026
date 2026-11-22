/**
 * Kit parameter validation (Req 22.10).
 *
 * Every Kit_Builder validates its whole parameter object before it builds any geometry. An
 * unknown key, a wrong type, a non-finite number, a non-integer where an integer is required, or
 * a value outside the documented range throws {@link KitParameterError}, which names the
 * offending parameter. A Kit_Builder never returns a `THREE.Group` after a validation failure.
 */

/** Thrown by a Kit_Builder for an invalid parameter. `param` names the parameter. */
export class KitParameterError extends Error {
  readonly param: string;
  readonly value: unknown;

  constructor(kit: string, param: string, value: unknown, reason: string) {
    super(`${kit}: invalid parameter "${param}" (${describe(value)}): ${reason}`);
    this.name = "KitParameterError";
    this.param = param;
    this.value = value;
  }
}

/** Validates one parameter value. Returns the resolved value or throws via `fail`. */
export type ParamValidator<T> = (value: unknown, fail: (reason: string) => never) => T;

/** A schema maps each accepted key to its validator and default. */
export type ParamSchema<R> = { readonly [K in keyof R]: { readonly validate: ParamValidator<R[K]>; readonly fallback: R[K] } };

/** An integer in `[min, max]`. */
export function integerParam(min: number, max: number, fallback: number): {
  validate: ParamValidator<number>;
  fallback: number;
} {
  return {
    fallback,
    validate(value, fail) {
      if (typeof value !== "number") {
        return fail(`expected an integer from ${min} to ${max}, received type ${typeof value}`);
      }
      if (!Number.isFinite(value)) {
        return fail("expected a finite number");
      }
      if (!Number.isInteger(value)) {
        return fail(`expected an integer from ${min} to ${max}`);
      }
      if (value < min || value > max) {
        return fail(`expected an integer from ${min} to ${max}`);
      }
      return value;
    },
  };
}

/**
 * Resolves `params` against `schema`. `undefined` (the whole object or a single key) selects the
 * documented default. Keys are checked in sorted order so the reported parameter is deterministic.
 *
 * @throws KitParameterError for anything that is not a plain object, for unknown keys and for
 *   any value its validator rejects.
 */
export function resolveKitParams<R extends object>(kit: string, params: unknown, schema: ParamSchema<R>): R {
  const accepted = Object.keys(schema) as (keyof R & string)[];
  const resolved = {} as R;
  if (params === undefined) {
    for (const key of accepted) {
      resolved[key] = schema[key].fallback;
    }
    return resolved;
  }
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new KitParameterError(kit, "params", params, "expected a plain object or undefined");
  }
  const prototype = Object.getPrototypeOf(params) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new KitParameterError(kit, "params", params, "expected a plain object or undefined");
  }
  const record = params as Record<string, unknown>;
  const given = Object.keys(record).sort();
  for (const key of given) {
    if (!accepted.includes(key as keyof R & string)) {
      const allowed = accepted.length === 0 ? "this kit takes no parameters" : `accepted keys: ${accepted.join(", ")}`;
      throw new KitParameterError(kit, key, record[key], `unknown parameter; ${allowed}`);
    }
  }
  for (const key of [...accepted].sort()) {
    const value = record[key];
    if (value === undefined) {
      resolved[key] = schema[key].fallback;
      continue;
    }
    resolved[key] = schema[key].validate(value, (reason) => {
      throw new KitParameterError(kit, key, value, reason);
    });
  }
  return resolved;
}

function describe(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value.length > 32 ? `${value.slice(0, 32)}…` : value);
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

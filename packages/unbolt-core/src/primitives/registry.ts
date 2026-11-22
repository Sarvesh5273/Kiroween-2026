import type { RegistryError, RegistryResult } from "../types";
import { formatRejected } from "../errors";
import { helicalUnscrew } from "./helicalUnscrew";
import { linearSlide } from "./linearSlide";
import { twoStepLSlide } from "./twoStepLSlide";
import type { MotionPrimitive, PrimitiveRegistry } from "./types";

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function fail<T>(error: RegistryError): RegistryResult<T> {
  return { ok: false, error };
}

/** The first member that breaks Req 17.3 or 17.8, in the order name, priority, then the functions. */
function firstInvalidMember(candidate: unknown): "name" | "priority" | "isApplicable" | "buildParams" | "pose" | null {
  if (typeof candidate !== "object" || candidate === null) {
    return "name";
  }
  const record = candidate as Record<string, unknown>;
  if (typeof record.name !== "string" || !NAME_PATTERN.test(record.name)) {
    return "name";
  }
  if (typeof record.priority !== "number" || !Number.isFinite(record.priority)) {
    return "priority";
  }
  for (const member of ["isApplicable", "buildParams", "pose"] as const) {
    if (typeof record[member] !== "function") {
      return member;
    }
  }
  return null;
}

function comparePrimitives(a: MotionPrimitive, b: MotionPrimitive): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * An empty Primitive_Registry (Req 17). `list()` sorts on every call, so the listing never
 * depends on registration order. A rejected `register` leaves the contents unchanged.
 */
export function createPrimitiveRegistry(): PrimitiveRegistry {
  const registered: MotionPrimitive[] = [];
  const list = (): readonly MotionPrimitive[] => registered.slice().sort(comparePrimitives);
  return {
    register(primitive) {
      const invalid = firstInvalidMember(primitive);
      if (invalid !== null) {
        return fail({
          kind: "InvalidPrimitive",
          member: invalid,
          message: `Cannot register the primitive: member ${invalid} is missing or invalid`,
        });
      }
      if (registered.some((existing) => existing.name === primitive.name)) {
        return fail({
          kind: "DuplicatePrimitiveName",
          name: primitive.name,
          message: `A primitive named ${primitive.name} is already registered`,
        });
      }
      registered.push(primitive);
      return { ok: true, value: undefined };
    },
    get(name) {
      const found = registered.find((existing) => existing.name === name);
      if (found === undefined) {
        return fail({
          kind: "UnknownPrimitive",
          name: String(name),
          message: `No primitive named ${formatRejected(name)} is registered`,
        });
      }
      return { ok: true, value: found };
    },
    list,
    select(step, part, ctx) {
      for (const primitive of list()) {
        if (primitive.isApplicable(step, part, ctx)) {
          return { ok: true, value: primitive };
        }
      }
      return fail({
        kind: "NoApplicablePrimitive",
        partId: step.partId,
        message: `No registered primitive applies to the step of Part ${step.partId}`,
      });
    },
  };
}

/** A registry that holds exactly the 3 built-ins `linear_slide`, `helical_unscrew` and `two_step_l_slide` (Req 17.2). */
export function createDefaultPrimitiveRegistry(): PrimitiveRegistry {
  const registry = createPrimitiveRegistry();
  for (const primitive of [linearSlide, helicalUnscrew, twoStepLSlide]) {
    const result = registry.register(primitive as MotionPrimitive);
    if (!result.ok) {
      throw new Error(`built-in primitive ${primitive.name} was rejected: ${result.error.message}`);
    }
  }
  return registry;
}

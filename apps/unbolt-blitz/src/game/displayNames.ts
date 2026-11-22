/**
 * Display_Name derivation (Req 10.2, 12.4). Pure TypeScript: no DOM, React or Three.js.
 */

export interface DisplayNameInput {
  readonly partId: string;
  readonly nodeName: string;
}

const SEPARATORS = /[_\-\s]+/;
const FALLBACK_NAME = "Part";

/** Code-unit comparison, so the order never depends on the runtime locale. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function capitalize(piece: string): string {
  const [first = "", ...rest] = Array.from(piece);
  return first.toUpperCase() + rest.join("");
}

/** `lid_fastener_1` becomes "Lid Fastener 1". An empty result becomes "Part". */
function baseName(nodeName: string): string {
  const pieces = nodeName.split(SEPARATORS).filter((piece) => piece.length > 0);
  return pieces.length === 0 ? FALLBACK_NAME : pieces.map(capitalize).join(" ");
}

/**
 * Derives a readable, level-unique Display_Name for every part.
 *
 * 1. Split the node name on `[_\-\s]+`, drop empty pieces, capitalize each piece.
 * 2. Parts that share a base name get ` #k` (k from 1) in ascending `partId` order.
 * 3. A name that still collides gets ` (partId)` appended, so names are unique.
 *
 * If the same `partId` appears more than once in the input, the first entry wins.
 */
export function deriveDisplayNames(parts: readonly DisplayNameInput[]): Map<string, string> {
  const unique = new Map<string, DisplayNameInput>();
  for (const part of parts) {
    if (!unique.has(part.partId)) unique.set(part.partId, part);
  }
  const ordered = [...unique.values()].sort((a, b) => compareIds(a.partId, b.partId));

  const bases = new Map<string, string>();
  const baseCounts = new Map<string, number>();
  for (const part of ordered) {
    const base = baseName(part.nodeName);
    bases.set(part.partId, base);
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }

  const nextIndex = new Map<string, number>();
  const names = new Map<string, string>();
  for (const part of ordered) {
    const base = bases.get(part.partId) as string;
    if ((baseCounts.get(base) ?? 0) > 1) {
      const k = (nextIndex.get(base) ?? 0) + 1;
      nextIndex.set(base, k);
      names.set(part.partId, `${base} #${k}`);
    } else {
      names.set(part.partId, base);
    }
  }

  const nameCounts = new Map<string, number>();
  for (const name of names.values()) {
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const part of ordered) {
    let name = names.get(part.partId) as string;
    if ((nameCounts.get(name) ?? 0) > 1) name = `${name} (${part.partId})`;
    // Final guard: a suffixed name can still equal another part's name.
    while (used.has(name)) name = `${name} (${part.partId})`;
    used.add(name);
    result.set(part.partId, name);
  }
  return result;
}

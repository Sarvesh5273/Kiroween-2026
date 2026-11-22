/**
 * Recursive source reader for the static tests. Returns each file's absolute
 * path and text for `src/` and `test/` under apps/unbolt-blitz.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface SourceFile {
  /** Absolute path of the file. */
  readonly path: string;
  /** UTF-8 text of the file. */
  readonly text: string;
}

/** Absolute path of apps/unbolt-blitz (two levels above test/helpers). */
export const APP_ROOT: string = fileURLToPath(new URL("../../", import.meta.url));

const SKIPPED_DIRS: ReadonlySet<string> = new Set(["node_modules", "dist", ".git"]);

/**
 * Reads every file under `dir` recursively, sorted by path so the order is
 * deterministic. Skips `node_modules`, `dist`, and `.git`. When `extensions`
 * is given, only files ending with one of them are returned.
 */
export function readTree(dir: string, extensions?: readonly string[]): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        if (extensions === undefined || extensions.some((ext) => entry.name.endsWith(ext))) {
          out.push({ path: full, text: readFileSync(full, "utf8") });
        }
      }
    }
  };
  walk(dir);
  return out;
}

/** Every file under `src/`. */
export function readSrcFiles(extensions?: readonly string[]): SourceFile[] {
  return readTree(join(APP_ROOT, "src"), extensions);
}

/** Every file under `test/`. */
export function readTestFiles(extensions?: readonly string[]): SourceFile[] {
  return readTree(join(APP_ROOT, "test"), extensions);
}

/** Every file under `src/` and `test/`, `src/` first. */
export function readAllSources(extensions?: readonly string[]): SourceFile[] {
  return [...readSrcFiles(extensions), ...readTestFiles(extensions)];
}

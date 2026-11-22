/**
 * Source scanning helpers for the static tests in `test/static/`.
 *
 * The tests read project files as text (Vite `?raw` glob imports, so no Node built-ins and no
 * `@types/node`). Scanning raw text for a word also hits comments, strings and regex literals,
 * so every scan first runs {@link maskSource}, a small tokenizer that understands line and block
 * comments, single, double and template strings (including nested `${...}`) and regex literals.
 *
 * Masked text has the same length as the input and keeps every newline, so an index into one
 * form is an index into the other.
 */
export type StringMode = "keep" | "blank";
export interface StringLiteral {
  /** Text between the quotes, as written (escapes are not decoded). */
  content: string;
  /** Index of the opening quote in the source. */
  start: number;
}
const REGEX_PRECEDING_PUNCTUATION = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_PRECEDING_WORDS = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "delete",
  "void",
  "throw",
  "new",
  "else",
  "do",
  "instanceof",
  "yield",
  "await",
]);
function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}
/**
 * Replaces every comment with spaces. With `strings: "blank"` the contents of string, template
 * and regex literals become spaces too (the delimiters stay). With `strings: "keep"` literals are
 * left as written. `onString` receives each string and template literal part (not regexes).
 */
export function maskSource(source: string, options: { strings: StringMode; onString?: (literal: StringLiteral) => void }): string {
  const blank = options.strings === "blank";
  const out: string[] = [];
  const n = source.length;
  // Open `${` expressions inside templates: each entry counts the unclosed `{` inside it.
  const expressionDepth: number[] = [];
  let mode: "code" | "template" = "code";
  let previousKind: "start" | "punct" | "word" | "literal" | "close" = "start";
  let previousText = "";
  let templateStart = -1;
  let templateBuffer = "";
  const emitLiteralText = (text: string): void => {
    out.push(blank ? text.replace(/[^\r\n]/g, " ") : text);
  };
  const blankRange = (from: number, to: number): void => {
    out.push(source.slice(from, to).replace(/[^\r\n]/g, " "));
  };
  const flushTemplate = (): void => {
    if (options.onString !== undefined && templateStart >= 0) {
      options.onString({ content: templateBuffer, start: templateStart });
    }
    templateStart = -1;
    templateBuffer = "";
  };
  let i = 0;
  while (i < n) {
    const ch = source[i] as string;
    const next = i + 1 < n ? (source[i + 1] as string) : "";
    if (mode === "template") {
      if (ch === "\\") {
        const pair = source.slice(i, i + 2);
        templateBuffer += pair;
        emitLiteralText(pair);
        i += 2;
      } else if (ch === "`") {
        flushTemplate();
        out.push("`");
        mode = "code";
        previousKind = "literal";
        i++;
      } else if (ch === "$" && next === "{") {
        flushTemplate();
        out.push("${");
        expressionDepth.push(0);
        mode = "code";
        previousKind = "punct";
        previousText = "{";
        i += 2;
      } else {
        templateBuffer += ch;
        emitLiteralText(ch);
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      let end = source.indexOf("\n", i);
      if (end < 0) end = n;
      blankRange(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      let end = source.indexOf("*/", i + 2);
      end = end < 0 ? n : end + 2;
      blankRange(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && source[j] !== ch && source[j] !== "\n") {
        j += source[j] === "\\" ? 2 : 1;
      }
      const content = source.slice(i + 1, Math.min(j, n));
      options.onString?.({ content, start: i });
      out.push(ch);
      emitLiteralText(content);
      if (j < n && source[j] === ch) out.push(ch);
      i = Math.min(j + 1, n);
      previousKind = "literal";
      continue;
    }
    if (ch === "`") {
      out.push("`");
      mode = "template";
      templateStart = i;
      templateBuffer = "";
      i++;
      continue;
    }
    const regexAllowed =
      previousKind === "start" ||
      (previousKind === "punct" && REGEX_PRECEDING_PUNCTUATION.has(previousText)) ||
      (previousKind === "word" && REGEX_PRECEDING_WORDS.has(previousText));
    if (ch === "/" && regexAllowed) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n && source[j] !== "\n") {
        const c = source[j] as string;
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        const body = source.slice(i + 1, j);
        out.push("/");
        emitLiteralText(body);
        out.push("/");
        j++;
        while (j < n && /[a-z]/.test(source[j] as string)) {
          out.push(source[j] as string);
          j++;
        }
        i = j;
        previousKind = "literal";
        continue;
      }
    }
    const top = expressionDepth.length - 1;
    if (ch === "{") {
      if (top >= 0) expressionDepth[top] = (expressionDepth[top] ?? 0) + 1;
    } else if (ch === "}" && top >= 0) {
      if (expressionDepth[top] === 0) {
        expressionDepth.pop();
        out.push("}");
        mode = "template";
        templateStart = i;
        templateBuffer = "";
        i++;
        continue;
      }
      expressionDepth[top] = (expressionDepth[top] ?? 0) - 1;
    }
    out.push(ch);
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (isWordChar(ch)) {
      let j = i;
      while (j < n && isWordChar(source[j] as string)) j++;
      const word = source.slice(i, j);
      out.push(source.slice(i + 1, j));
      previousKind = /^[0-9]/.test(word) ? "literal" : "word";
      previousText = word;
      i = j;
      continue;
    }
    previousKind = ch === ")" || ch === "]" || ch === "}" ? "close" : "punct";
    previousText = ch;
    i++;
  }
  return out.join("");
}
/** Source with comments removed and literals kept. */
export function stripComments(source: string): string {
  return maskSource(source, { strings: "keep" });
}
/** Source with comments removed and the contents of string, template and regex literals blanked. */
export function blankLiterals(source: string): string {
  return maskSource(source, { strings: "blank" });
}
/** Every string and template literal, in source order. */
export function stringLiterals(source: string): StringLiteral[] {
  const found: StringLiteral[] = [];
  maskSource(source, { strings: "keep", onString: (literal) => found.push(literal) });
  return found;
}
/**
 * Every module specifier of `import ... from`, `import "x"`, `export ... from` and `import("x")`
 * outside comments.
 */
export function extractSpecifiers(source: string): string[] {
  const text = stripComments(source);
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:import|export)\s[^;"']*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        specifiers.push(specifier);
      }
    }
  }
  return specifiers;
}
/**
 * The index just after the bracket that closes the one at `open`, or -1 when it never closes.
 * `text` should be blanked, so brackets inside strings do not count.
 */
export function matchingBracket(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const opening = text[open];
  const closing = opening === undefined ? undefined : pairs[opening];
  if (opening === undefined || closing === undefined) {
    return -1;
  }
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return ch === closing ? i + 1 : -1;
    }
  }
  return -1;
}
/** Splits `text` at commas that are not inside brackets. `text` should be blanked. */
export function splitTopLevel(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      ranges.push([start, i]);
      start = i + 1;
    }
  }
  ranges.push([start, text.length]);
  return ranges;
}
export interface CatchBlock {
  /** The bound error identifier, or `null` for `catch {`. */
  binding: string | null;
  /** Blanked text between the braces. */
  body: string;
  /** Index of the `catch` keyword. */
  index: number;
}
/** Every `catch` clause of blanked source, with its body. */
export function findCatchBlocks(blanked: string): CatchBlock[] {
  const blocks: CatchBlock[] = [];
  const pattern = /\bcatch\b\s*(?:\(\s*([A-Za-z_$][\w$]*)[^)]*\))?\s*\{/g;
  for (const match of blanked.matchAll(pattern)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = matchingBracket(blanked, open);
    if (close < 0) {
      throw new RangeError(`unbalanced catch block at index ${match.index ?? 0}`);
    }
    blocks.push({ binding: match[1] ?? null, body: blanked.slice(open + 1, close - 1), index: match.index ?? 0 });
  }
  return blocks;
}
/** Number of `.catch(` promise handlers in blanked source. */
export function countPromiseCatches(blanked: string): number {
  return [...blanked.matchAll(/\.\s*catch\s*\(/g)].length;
}
/**
 * True when a `catch` body does not swallow its error (Req 25.5): it rethrows, or it returns,
 * assigns or collects the caught error, or it returns a structured error value. `body` is
 * blanked text. A body that is empty or only logs the error is a swallow.
 */
export function catchBodyHandlesError(binding: string | null, body: string): boolean {
  if (body.trim() === "") {
    return false;
  }
  if (/\bthrow\b/.test(body)) {
    return true;
  }
  const returnsStructuredError = /\breturn\b[^;]*\b(?:[A-Za-z]*[Ee]rror\b|status\b)/.test(body);
  if (binding === null) {
    return returnsStructuredError;
  }
  const used = new RegExp(
    `\\breturn\\b[^;]*\\b${escapeRegExp(binding)}\\b|(?<![=!<>])=(?!=)[^;=]*\\b${escapeRegExp(binding)}\\b|\\.push\\(\\s*[^)]*\\b${escapeRegExp(binding)}\\b`,
  );
  return used.test(body) || returnsStructuredError;
}
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * Turns `import.meta.glob` keys, which are relative to the importing file, into paths relative
 * to the package directory `packages/unbolt-core` (the default importer is in `test/static`).
 * `../../src/a.ts` becomes `src/a.ts`, `../unit/a.test.ts` becomes `test/unit/a.test.ts`, and
 * `../../../sample-kits/src/a.ts` becomes `sample-kits/src/a.ts`.
 */
export function normalizeGlobKeys(raw: Record<string, string>, importerDirectory = "test/static"): Map<string, string> {
  const entries = Object.entries(raw).map(([key, text]): [string, string] => {
    const parts = importerDirectory.split("/").filter((segment) => segment !== "");
    for (const segment of key.split("/")) {
      if (segment === "." || segment === "") continue;
      if (segment === "..") {
        // Above `packages/unbolt-core` the next level is `packages`, so `sample-kits/...` follows.
        parts.pop();
      } else {
        parts.push(segment);
      }
    }
    return [parts.join("/"), text];
  });
  return new Map(entries);
}
/**
 * Resolves a relative specifier written in `fromFile` to a key of `files`, trying the bare path,
 * `.ts` and `/index.ts`. Returns `undefined` when no project file matches.
 */
export function resolveRelative(fromFile: string, specifier: string, files: ReadonlyMap<string, string>): string | undefined {
  const parts = fromFile.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  const base = parts.join("/");
  return [base, `${base}.ts`, `${base}/index.ts`].find((candidate) => files.has(candidate));
}
export interface BannedSourceRule {
  label: string;
  pattern: RegExp;
}
/**
 * Randomness and clock sources that no solver, kit or test may use (Req 3.2, 22.9). Each pattern
 * is assembled from fragments, so no line of this file matches it.
 */
export const BANNED_SOURCE_RULES: readonly BannedSourceRule[] = [
  { label: "Math." + "random", pattern: new RegExp("\\bMath\\s*\\.\\s*ran" + "dom\\b") },
  { label: "crypto" + " (any use)", pattern: new RegExp("\\bcry" + "pto\\b") },
  { label: "Date" + " (any use)", pattern: new RegExp("\\bDa" + "te\\b") },
  { label: "performance." + "now", pattern: new RegExp("\\bperform" + "ance\\s*\\.\\s*no" + "w\\b") },
  { label: "getRandom" + "Values", pattern: new RegExp("\\bgetRan" + "domValues\\b") },
];
/** `file:line: label` for the first use of each banned name in each file, after masking literals. */
export function findBannedSources(files: ReadonlyMap<string, string>): string[] {
  const found: string[] = [];
  for (const [file, text] of files) {
    const code = blankLiterals(text);
    for (const rule of BANNED_SOURCE_RULES) {
      const match = rule.pattern.exec(code);
      if (match !== null) {
        found.push(`${file}:${code.slice(0, match.index).split("\n").length}: ${rule.label}`);
      }
    }
  }
  return found;
}
export interface CallSite {
  /** Index of the first character of the callee name. */
  index: number;
  /** Blanked text between the parentheses. */
  args: string;
  /** Index in the source of the first character after `(`. */
  argsStart: number;
}
/** Calls whose callee text matches `callee` (a regex source ending just before the `(`). */
export function findCalls(blanked: string, callee: string): CallSite[] {
  const calls: CallSite[] = [];
  const pattern = new RegExp(`${callee}\\s*\\(`, "g");
  for (const match of blanked.matchAll(pattern)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = matchingBracket(blanked, open);
    if (close < 0) {
      throw new RangeError(`unbalanced call at index ${match.index ?? 0}`);
    }
    calls.push({ index: match.index ?? 0, args: blanked.slice(open + 1, close - 1), argsStart: open + 1 });
  }
  return calls;
}

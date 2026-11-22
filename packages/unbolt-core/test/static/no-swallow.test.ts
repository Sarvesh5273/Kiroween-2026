/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  blankLiterals,
  catchBodyHandlesError,
  countPromiseCatches,
  findBannedSources,
  findCatchBlocks,
  normalizeGlobKeys,
} from "../helpers/sourceScan";
/**
 * No swallowed errors (Req 25.5, workspace rule "never hide failures"): every `catch` clause in
 * `src/` and `test/` of both packages rethrows the error, or returns, stores or collects it, or
 * returns a structured error value. An empty `catch`, a `catch` that only logs, and a promise
 * `.catch(...)` handler are rejected.
 *
 * Sources are read with Vite raw glob imports. Comments and string contents are masked first.
 */
const coreSrc = import.meta.glob("../../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const coreTests = import.meta.glob("../../test/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const kitSrc = import.meta.glob("../../../sample-kits/src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const kitTests = import.meta.glob("../../../sample-kits/test/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
// The glob never includes the importing file; `no-trivial-assert.test.ts` scans this one.
const FILES = normalizeGlobKeys({ ...coreSrc, ...coreTests, ...kitSrc, ...kitTests });
const SIBLING = import.meta.glob("./determinism-sources.test.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}
function swallowed(source: string): { handled: number; swallowed: { line: number; binding: string | null; body: string }[] } {
  const code = blankLiterals(source);
  const blocks = findCatchBlocks(code);
  const bad = blocks
    .filter((block) => !catchBodyHandlesError(block.binding, block.body))
    .map((block) => ({ line: lineOf(code, block.index), binding: block.binding, body: block.body.trim() }));
  return { handled: blocks.length - bad.length, swallowed: bad };
}
describe("no catch block swallows an error (Req 25.5)", () => {
  it("scans the sources and tests of both packages", () => {
    expect(FILES.size).toBeGreaterThan(70);
    expect(FILES.has("src/stage1/bvhBuilder.ts")).toBe(true);
    expect(FILES.has("test/unit/stage4.test.ts")).toBe(true);
  });
  it("rethrows, returns or records the error in every catch block", () => {
    const offenders: string[] = [];
    let handled = 0;
    for (const [file, text] of FILES) {
      const result = swallowed(text);
      handled += result.handled;
      for (const bad of result.swallowed) {
        offenders.push(`${file}:${bad.line}: catch (${bad.binding ?? ""}) { ${bad.body.slice(0, 60)} }`);
      }
    }
    expect(offenders).toEqual([]);
    // The scan really found catch blocks, so an empty result is not a missing glob.
    expect(handled).toBeGreaterThanOrEqual(7);
  });
  it("uses no promise .catch() handler", () => {
    const offenders = [...FILES].filter(([, text]) => countPromiseCatches(blankLiterals(text)) > 0).map(([file]) => file);
    expect(offenders).toEqual([]);
  });
  it("keeps the sibling static test free of unseeded randomness and clock reads", () => {
    const sibling = normalizeGlobKeys(SIBLING);
    expect([...sibling.keys()]).toEqual(["test/static/determinism-sources.test.ts"]);
    expect(findBannedSources(sibling)).toEqual([]);
  });
});
describe("the catch scanner (guards against a vacuous pass)", () => {
  it("accepts a rethrow, a wrapped rethrow, a returned error, a stored error and a collected error", () => {
    const good = [
      "try { a(); } catch (error) { throw error; }",
      "try { a(); } catch (error) { throw new Wrapped(id, error); }",
      "try { a(); } catch (error) { return error; }",
      "try { a(); } catch (error) { thrown = error; }",
      "try { a(); } catch (error) { errors.push(error); }",
      "try { a(); } catch (error) { return { status: 'error', error }; }",
      "try { a(); } catch { return { status: 'error' }; }",
      "try { a(); } catch { throw new RangeError('bad'); }",
    ];
    for (const source of good) {
      expect(swallowed(source).swallowed, source).toEqual([]);
      expect(swallowed(source).handled, source).toBe(1);
    }
  });
  it("rejects an empty catch, a comment-only catch, a log-only catch, a bare return and an unused binding", () => {
    const bad = [
      "try { a(); } catch (error) {}",
      "try { a(); } catch {}",
      "try { a(); } catch (error) { /* ignore */ }",
      "try { a(); } catch (error) { console.log(error); }",
      "try { a(); } catch (error) { return; }",
      "try { a(); } catch (error) { return false; }",
      "try { a(); } catch (error) { cleanup(); }",
      "try { a(); } catch { cleanup(); }",
    ];
    for (const source of bad) {
      expect(swallowed(source).swallowed, source).toHaveLength(1);
    }
  });
  it("ignores the word catch in comments and strings, and finds nested catch blocks", () => {
    expect(findCatchBlocks(blankLiterals("// catch (e) {}\nconst s = 'catch (e) {}';"))).toEqual([]);
    const nested = "try { a(); } catch (outer) { try { b(); } catch (inner) { } throw outer; }";
    const result = swallowed(nested);
    expect(result.swallowed).toHaveLength(1);
    expect(result.swallowed[0]?.binding).toBe("inner");
    expect(countPromiseCatches(blankLiterals("p.then(f).catch(g); const s = '.catch(x)';"))).toBe(1);
  });
});

/**
 * Theme contract: tokens.css is the only file with colour literals, every declared text and
 * background pair reaches WCAG AA (4.5:1), and the design values the Swiss CAD system promises
 * (navy accent, #DCE3EE hairline, elevation) are the ones in the file.
 *
 * The stylesheets are read from disk as plain text. Vitest replaces imported `.css` modules with an
 * empty string, even with `?raw`, so an import would test nothing.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readTheme(fileName: string): string {
  const css = readFileSync(new URL(`../../src/theme/${fileName}`, import.meta.url), "utf8");
  // A blank read would make every check below pass or fail for the wrong reason.
  expect(css.length, `${fileName} must not be empty`).toBeGreaterThan(500);
  return css;
}

const appCss = readTheme("app.css");
const tokensCss = readTheme("tokens.css");

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** `--name: #RRGGBB;` declarations outside comments. */
function parseHexTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of stripComments(css).matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens.set(match[1] as string, (match[2] as string).toUpperCase());
  }
  return tokens;
}

/** `pair: --fg on --bg` lines from the header comment. */
function parsePairs(css: string): { fg: string; bg: string }[] {
  return [...css.matchAll(/pair:\s*(--[a-z0-9-]+)\s+on\s+(--[a-z0-9-]+)/g)].map((match) => ({
    fg: match[1] as string,
    bg: match[2] as string,
  }));
}

function channelToLinear(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const r = channelToLinear(parseInt(hex.slice(1, 3), 16));
  const g = channelToLinear(parseInt(hex.slice(3, 5), 16));
  const b = channelToLinear(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("contrast helper", () => {
  it("gives 21:1 for black on white and 1:1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#1E3A5F", "#1E3A5F")).toBeCloseTo(1, 10);
  });
});

describe("tokens.css contrast pairs", () => {
  const tokens = parseHexTokens(tokensCss);
  const pairs = parsePairs(tokensCss);

  it("declares the pairs that the stylesheet relies on", () => {
    expect(pairs.length).toBeGreaterThanOrEqual(20);
    const declared = new Set(pairs.map((pair) => `${pair.fg} on ${pair.bg}`));
    // The two active states of the hero toggle: white on navy and white on crimson.
    expect(declared.has("--on-accent on --accent")).toBe(true);
    expect(declared.has("--on-crimson on --crimson")).toBe(true);
  });

  it.each(pairs.map((pair) => [`${pair.fg} on ${pair.bg}`, pair] as const))(
    "%s reaches 4.5:1",
    (_label, pair) => {
      const fg = tokens.get(pair.fg);
      const bg = tokens.get(pair.bg);
      expect(fg, `${pair.fg} must be a hex token`).toBeDefined();
      expect(bg, `${pair.bg} must be a hex token`).toBeDefined();
      expect(contrastRatio(fg as string, bg as string)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("Swiss CAD design tokens", () => {
  const tokens = parseHexTokens(tokensCss);
  const css = stripComments(tokensCss);

  it("uses deep blueprint navy for DBG and a vivid crimson for Naive", () => {
    expect(tokens.get("--accent")).toBe("#1E3A5F");
    expect(tokens.get("--crimson")).toBe("#DC143C");
  });

  it("uses whisper-thin #DCE3EE hairlines, 8px radii and the gentle elevation", () => {
    expect(tokens.get("--hairline")).toBe("#DCE3EE");
    expect(css).toMatch(/--radius:\s*8px;/);
    expect(css).toContain("--elevation: 0 4px 16px rgba(15, 23, 42, 0.06);");
  });

  it("fades the studio backdrop from #FAFBFD in the centre to #EEF3F8 at the edges", () => {
    expect(tokens.get("--studio-center")).toBe("#FAFBFD");
    expect(tokens.get("--studio-edge")).toBe("#EEF3F8");
  });
});

describe("studio backdrop in the 3D scene", () => {
  const sceneSource = readFileSync(new URL("../../src/viewport/sceneController.ts", import.meta.url), "utf8");

  /** `NAME: readonly [number, number, number] = [0xRR, 0xGG, 0xBB];` as `#RRGGBB`. */
  function sceneRgbConstant(name: string): string {
    const match = new RegExp(
      `${name}:[^=]*=\\s*\\[\\s*0x([0-9a-f]{2}),\\s*0x([0-9a-f]{2}),\\s*0x([0-9a-f]{2})\\s*\\]`,
      "i",
    ).exec(sceneSource);
    if (match === null) throw new Error(`${name} not found in sceneController.ts`);
    return `#${match[1]}${match[2]}${match[3]}`.toUpperCase();
  }

  // WebGL cannot read CSS variables, so the controller repeats the two colours. They must not drift.
  it("paints the same centre and edge colours as the CSS backdrop tokens", () => {
    const tokens = parseHexTokens(tokensCss);
    expect(sceneRgbConstant("STUDIO_CENTER_RGB")).toBe(tokens.get("--studio-center"));
    expect(sceneRgbConstant("STUDIO_EDGE_RGB")).toBe(tokens.get("--studio-edge"));
  });
});

describe("app.css", () => {
  const css = stripComments(appCss);

  it("contains no colour literal, so every colour comes from tokens.css", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i);
  });

  it("floats the view controls as frosted-glass pills with a 10px blur", () => {
    expect(css).toMatch(/\.gf-glass[\s\S]*?backdrop-filter:\s*blur\(10px\)/);
  });

  it("colours the active hero segment per mode: navy for DBG, crimson for Naive", () => {
    expect(css).toMatch(
      /\.gf-hero__option\[aria-pressed="true"\]\[data-mode="dbg"\]\s*\{[^}]*background:\s*var\(--accent\)/,
    );
    expect(css).toMatch(
      /\.gf-hero__option\[aria-pressed="true"\]\[data-mode="naive"\]\s*\{[^}]*background:\s*var\(--crimson\)/,
    );
  });
});

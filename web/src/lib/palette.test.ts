import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "postcss";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { buttonVariants } from "../components/ui/button";

type Palette = Record<string, string>;
type RGB = [number, number, number];
const stylesheet = parse(readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8"));
const staleSelector = ":where([data-tab-content], [data-sheet-body]) .opacity-60";
const semanticTokens = [
  "background", "foreground", "surface", "surface-muted", "border", "text-muted",
  "brand", "brand-hover", "brand-foreground", "brand-text", "focus-ring",
  "success", "warning", "danger", "info", "chart-line", "progress-fill", "progress-track",
  "control-border", "surface-hover", "brand-selected", "status-tint", "overlay",
];

// declarations reads real CSS declarations with Vite's existing PostCSS parser.
function declarations(selector: string): Palette {
  const result: Palette = {};
  stylesheet.walkRules((rule) => {
    if (rule.selectors.includes(selector)) {
      rule.walkDecls((declaration) => { result[declaration.prop] = declaration.value; });
    }
  });
  return result;
}

// palette applies the same root and explicit theme overrides used by the document.
function palette(theme: "dark" | "light"): Palette {
  return { ...declarations(":root"), ...declarations(`:root[data-theme="${theme}"]`) };
}

// value resolves semantic aliases before measuring their rendered color.
function value(tokens: Palette, name: string): string {
  const color = tokens[`--${name}`];
  expect(color, `missing --${name}`).toBeDefined();
  const alias = /^var\(--([a-z-]+)\)$/.exec(color);
  return alias ? value(tokens, alias[1]) : color;
}

// rgb converts a six-digit sRGB color to channels for alpha compositing.
function rgb(color: string): RGB {
  expect(color).toMatch(/^#[\da-f]{6}$/i);
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16)) as RGB;
}

// composite models browser alpha blending before WCAG linearization.
function composite(front: RGB, back: RGB, alpha: number): RGB {
  return front.map((channel, index) => channel * alpha + back[index] * (1 - alpha)) as RGB;
}

// luminance applies the WCAG sRGB transfer function to final rendered channels.
function luminance(color: RGB): number {
  const linear = color.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

// contrast compares foreground and the final opaque background, not raw tint values.
function contrast(front: RGB, back: RGB): number {
  const a = luminance(front);
  const b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// backgrounds includes actual row alpha, warning tint and selected/hover surfaces.
function backgrounds(tokens: Palette): RGB[] {
  const colors = ["background", "surface", "surface-muted", "surface-hover", "brand-selected"].map((name) => rgb(value(tokens, name)));
  colors.push(composite(rgb(value(tokens, "surface-muted")), rgb(value(tokens, "surface")), 0.6));
  for (const name of ["background", "surface", "surface-muted"]) {
    for (const tint of ["status-tint", "warning"]) {
      colors.push(composite(rgb(value(tokens, tint)), rgb(value(tokens, name)), 0.05));
    }
  }
  return colors;
}

// presentationFiles inventories only the existing presentation ownership boundary.
function presentationFiles(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name, directory);
    return entry.isDirectory() ? presentationFiles(new URL(`${entry.name}/`, directory))
      : /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [fileURLToPath(url)] : [];
  });
}

describe("official Unraid semantic palette", () => {
  it.each([
    ["dark", {
      background: "#1D1B1B", surface: "#262626", "surface-muted": "#303030",
      foreground: "#F2F2F2", brand: "#FF8C2F", deeporange: "#F15A2C", "brand-text": "#FF8C2F",
    }],
    ["light", {
      background: "#F2F2F2", surface: "#FFFFFF", "surface-muted": "#F7F9F9",
      foreground: "#1D1B1B", brand: "#FF8C2F", deeporange: "#F15A2C", "brand-text": "#B83D14",
    }],
  ] as const)("keeps the required %s bases without substituting contrast-derived colors", (theme, expected) => {
    const tokens = palette(theme);
    for (const [name, color] of Object.entries(expected)) expect(value(tokens, name).toUpperCase()).toBe(color);
    expect(declarations(":root")["color-scheme"]).toBe("dark");
    expect(declarations(':root[data-theme="light"]')["color-scheme"]).toBe("light");
  });

  it("exposes each semantic Tailwind v4 utility as a locally resolved CSS variable", async () => {
    const theme: Palette = {};
    stylesheet.walkAtRules("theme", (rule) => {
      expect(rule.params).toBe("inline");
      rule.walkDecls((declaration) => { theme[declaration.prop] = declaration.value; });
    });
    for (const name of semanticTokens) expect(theme[`--color-${name}`]).toBe(`var(--${name})`);
    expect(declarations(":root").background).toBe("var(--background)");
    expect(declarations("body").background).toBe("var(--background)");
    expect(declarations(":root").color).toBe("var(--foreground)");
    const source = stylesheet.clone();
    source.walkAtRules("import", (rule) => { rule.name = "tailwind"; rule.params = "utilities"; });
    const compiler = await compile(source.toString());
    const generated = parse(compiler.build(["text-foreground", "text-text-muted", "text-chart-line", "bg-progress-fill", "bg-warning/5"]));
    for (const [selector, property, color] of [
      [".text-foreground", "color", "foreground"],
      [".text-text-muted", "color", "text-muted"],
      [".text-chart-line", "color", "chart-line"],
      [".bg-progress-fill", "background-color", "progress-fill"],
    ]) {
      let actual: string | undefined;
      generated.walkRules(selector, (rule) => {
        rule.walkDecls(property, (declaration) => { actual = declaration.value; });
      });
      expect(actual).toBe(`var(--${color})`);
    }
    let alpha: string | undefined;
    generated.walkRules(".bg-warning\\/5", (rule) => {
      rule.walkDecls("background-color", (declaration) => { alpha = declaration.value; });
    });
    expect(alpha).toBe("color-mix(in oklab, var(--warning) 5%, transparent)");
  });

  it.each(["dark", "light"] as const)("keeps small %s text readable on opaque and actual alpha surfaces", (theme) => {
    const tokens = palette(theme);
    for (const name of ["foreground", "text-muted", "brand-text", "success", "warning", "danger", "info"]) {
      for (const back of backgrounds(tokens)) {
        expect(contrast(rgb(value(tokens, name)), back), `${theme} ${name} on ${back}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const background of ["brand", "brand-hover"]) {
      expect(contrast(rgb(value(tokens, "brand-foreground")), rgb(value(tokens, background)))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(["dark", "light"] as const)("distinguishes %s control boundaries and offset focus rings", (theme) => {
    const tokens = palette(theme);
    for (const back of backgrounds(tokens)) {
      expect(contrast(rgb(value(tokens, "control-border")), back)).toBeGreaterThanOrEqual(3);
      expect(contrast(rgb(value(tokens, "focus-ring")), back)).toBeGreaterThanOrEqual(3);
    }
    for (const back of ["brand", "brand-hover"]) {
      expect(contrast(rgb(value(tokens, "brand-foreground")), rgb(value(tokens, back)))).toBeGreaterThanOrEqual(3);
    }
    for (const variant of ["primary", "secondary"] as const) {
      const classes = buttonVariants({ variant }).split(" ");
      expect(classes).toContain("border");
      expect(classes).toContain(variant === "primary" ? "border-brand-foreground" : "border-control-border");
      expect(classes).toContain("focus-visible:ring-focus-ring");
      expect(classes).toContain("focus-visible:ring-offset-2");
      expect(classes).toContain("focus-visible:ring-offset-surface");
      expect(classes).toContain("motion-reduce:transition-none");
      expect(classes.some((name) => name.includes("opacity"))).toBe(false);
    }
  });

  it.each(["dark", "light"] as const)("keeps %s chart and progress independent and visible", (theme) => {
    const tokens = palette(theme);
    for (const name of ["chart-line", "progress-fill"]) {
      const color = value(tokens, name);
      expect(color).not.toBe(value(tokens, "brand"));
      for (const status of ["success", "warning", "danger", "info"]) expect(color).not.toBe(value(tokens, status));
      for (const back of backgrounds(tokens)) expect(contrast(rgb(color), back)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(rgb(value(tokens, "progress-fill")), rgb(value(tokens, "progress-track")))).toBeGreaterThanOrEqual(3);
  });

  it.each(["dark", "light"] as const)("retains the stale marker without fading nested %s text, SVG or statuses", (theme) => {
    const tokens = palette(theme);
    const stale = declarations(staleSelector);
    expect(declarations(".opacity-60").opacity).toBeUndefined();
    expect(stale.opacity).toBe("1");
    expect(stale.color).toBe("var(--foreground)");
    expect(stale["--foreground"]).toBe("var(--stale-foreground)");
    expect(stale["--text-muted"]).toBe("var(--stale-text-muted)");
    const scoped = { ...tokens, ...stale };
    expect(value(scoped, "foreground")).not.toBe(value(tokens, "foreground"));
    for (const name of ["foreground", "text-muted", "brand-text", "success", "warning", "danger", "info"]) {
      for (const back of backgrounds(tokens)) expect(contrast(rgb(value(scoped, name)), back)).toBeGreaterThanOrEqual(4.5);
    }
    for (const name of ["chart-line", "progress-fill", "success", "warning"]) {
      expect(value(scoped, name)).toBe(value(tokens, name));
    }
  });

  it("migrates every owned presentation color away from literal palette utilities", () => {
    const paths = [
      ...presentationFiles(new URL("../features/", import.meta.url)),
      ...presentationFiles(new URL("../routes/", import.meta.url)),
      ...["AppSheet", "BottomNavigation", "LoadingPanel", "PWAUpdateBanner"].map((name) =>
        fileURLToPath(new URL(`../components/app/${name}.tsx`, import.meta.url))),
      fileURLToPath(new URL("../components/ui/button.tsx", import.meta.url)),
      fileURLToPath(new URL("../app/router.tsx", import.meta.url)),
    ];
    for (const path of paths) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/(?:bg|text|border|divide|ring|outline|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d+|\/|\b)/);
      expect(source, path).not.toMatch(/(?:fill|stroke)=["']#[\da-f]+/i);
    }
    const tokenForm = readFileSync(new URL("../features/auth/TokenForm.tsx", import.meta.url), "utf8");
    expect(tokenForm).toContain("border-control-border");
    expect(tokenForm).toContain("focus-visible:ring-offset-2");
    const sheet = readFileSync(new URL("../components/app/AppSheet.tsx", import.meta.url), "utf8");
    expect(sheet).toContain("bg-overlay/60");
    expect(sheet).toContain("border-control-border");
  });
});

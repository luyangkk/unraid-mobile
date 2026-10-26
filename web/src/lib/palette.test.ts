import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "postcss";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { buttonVariants } from "../components/ui/button";

type Palette = Record<string, string>;
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
      background: "#171717", surface: "#2B2A29", "surface-muted": "#333231",
      foreground: "#FFFFFF", brand: "#FF8C2F", deeporange: "#F15A2C", "brand-text": "#FF8C2F",
      "brand-red": "#E22828",
    }],
    ["light", {
      background: "#F1ECE3", surface: "#FFFFFF", "surface-muted": "#EEE4D2",
      foreground: "#171717", brand: "#FF8C2F", deeporange: "#F15A2C", "brand-text": "#F15A2C",
      "brand-red": "#E22828",
    }],
  ] as const)("keeps the website's %s bases without substituting derived colors", (theme, expected) => {
    const tokens = palette(theme);
    for (const [name, color] of Object.entries(expected)) expect(value(tokens, name).toUpperCase()).toBe(color);
    expect(declarations(":root")["color-scheme"]).toBe("dark");
    expect(declarations(':root[data-theme="light"]')["color-scheme"]).toBe("light");
  });

  it.each(["dark", "light"] as const)("matches the website's %s gradient button colors and separate variants", (theme) => {
    const tokens = palette(theme);
    expect(value(tokens, "brand-foreground")).toBe("#FFFFFF");
    expect(value(tokens, "brand-interactive-foreground")).toBe("#171717");
    expect(tokens["--brand-gradient"]).toBe("linear-gradient(90deg, var(--brand-red), var(--brand))");
    expect(tokens["--brand-gradient-flow"]).toBe("linear-gradient(90deg, var(--brand-red), var(--brand), var(--brand-red), var(--brand))");
    const primary = buttonVariants({ variant: "primary" }).split(" ");
    const secondary = buttonVariants({ variant: "secondary" }).split(" ");
    expect(primary).toContain("button-primary");
    expect(primary).toContain("rounded-sm");
    expect(primary).not.toContain("hover:bg-brand-hover");
    expect(secondary).toContain("button-secondary");
    expect(secondary).toContain("rounded-full");
    expect(secondary).toContain("border-transparent");
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

  it("retains keyboard focus, disabled feedback and minimum touch height", () => {
    for (const variant of ["primary", "secondary"] as const) {
      const classes = buttonVariants({ variant }).split(" ");
      expect(classes).toContain("border");
      expect(classes).toContain("min-h-11");
      expect(classes).toContain("focus-visible:ring-focus-ring");
      expect(classes).toContain("focus-visible:ring-offset-2");
      expect(classes).toContain("focus-visible:ring-offset-surface");
      expect(classes).toContain("motion-reduce:transition-none");
      expect(classes.some((name) => name.includes("opacity"))).toBe(false);
    }
  });

  it.each(["dark", "light"] as const)("uses the %s brand text for CPU and network chart lines", (theme) => {
    expect(value(palette(theme), "chart-line")).toBe(value(palette(theme), "brand-text"));
  });

  it.each(["dark", "light"] as const)("keeps %s status and capacity independent from brand charts", (theme) => {
    const tokens = palette(theme);
    for (const name of ["chart-line", "progress-fill"]) {
      const color = value(tokens, name);
      for (const status of ["success", "warning", "danger", "info"]) expect(color).not.toBe(value(tokens, status));
    }
    expect(value(tokens, "progress-fill")).not.toBe(value(tokens, "brand"));
    expect(value(tokens, "progress-fill")).not.toBe(value(tokens, "chart-line"));
    expect(value(tokens, "progress-fill")).not.toBe(value(tokens, "progress-track"));
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

// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve("index.html"), "utf8");

// bootstrap executes the actual head script with browser storage and media preferences.
function bootstrap(saved: string | null, darkSystem = false, blocked = false) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const context = {
    document: doc,
    localStorage: { getItem: () => saved },
    matchMedia: () => ({ matches: darkSystem }),
  };
  if (blocked) Object.defineProperty(context, "localStorage", { get() { throw new Error("Storage blocked"); } });
  const script = doc.querySelector("head script[data-theme-bootstrap]");
  expect(script, "Theme bootstrap must run in the head before the app").not.toBeNull();
  vm.runInNewContext(script!.textContent!, context);
  return doc;
}

describe("appearance before React", () => {
  it.each([
    [null, false, "dark"], ["dark", false, "dark"], ["light", true, "light"],
    ["system", false, "light"], ["system", true, "dark"], ["invalid", false, "dark"],
  ])("applies %s with system dark=%s before any app renders", (saved, system, resolved) => {
    const doc = bootstrap(saved as string | null, system as boolean);
    expect(doc.documentElement.dataset.theme).toBe(resolved);
    expect(doc.documentElement.style.colorScheme).toBe(resolved);
    expect(doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content)
      .toBe(resolved === "dark" ? "#1D1B1B" : "#F2F2F2");
  });

  it("falls back to Dark when access to localStorage throws", () => {
    const doc = bootstrap("light", false, true);
    expect(doc.documentElement.dataset.theme).toBe("dark");
  });

  it("uses the default dark launch color in the static manifest and metadata", () => {
    const manifest = JSON.parse(readFileSync(resolve("public/manifest.webmanifest"), "utf8"));
    expect(manifest.theme_color).toBe("#1D1B1B");
    expect(manifest.background_color).toBe("#1D1B1B");
    expect(html).toContain('name="theme-color" content="#1D1B1B"');
  });
});

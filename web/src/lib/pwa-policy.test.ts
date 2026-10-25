import { describe, expect, it } from "vitest";
import { shellRequest } from "./pwa-policy";

const origin = "https://console.example";

// request models browser request metadata without requiring a navigation constructor.
function request(path: string, mode = "navigate", headers = new Headers(), method = "GET") {
  return { url: new URL(path, origin).href, mode, headers, method } as Request;
}

describe("static shell request boundary", () => {
  it.each(["/", "/docker", "/vm", "/storage", "/unknown", "/unknown/nested", "/docker?view=running"])(
    "allows only browser client navigation to %s", (path) => {
      expect(shellRequest(request(path), origin)).toBe("navigation");
      expect(shellRequest(request(path, "cors"), origin)).toBeNull();
    },
  );

  it.each([
    "/api", "/api/", "/api/v1/system", "/api/v1/events", "/api/v1/operations/op_1",
    "/api/v1/docker/container/icon?v=version", "/api/v1/missing", "/healthz", "/healthz/child", "//api/v1/system",
    "/%61pi/v1/system", "/api%2fv1/events", "/%2fapi/v1/system",
    "/outside/%2e%2e/api/v1/system", "/docker%2fchild", "/docker//child",
    "/.hidden", "/docker/", "/assets", "/assets/missing.js", "/missing.js",
    "/assets/missing.js/child", "/icons/missing.png", "/sw.js",
    "/icons", "/icons/missing", "/outside/api/v1/events",
    "/docker?token=private", "/?access_token=private", "/?APP_TOKEN=private",
  ])("never returns cached HTML for %s", (path) => {
    expect(shellRequest(request(path), origin)).toBeNull();
  });

  it.each(["/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/assets/app.js", "/assets/app.css"])(
    "allows a static lookup for %s without inventing missing resources", (path) => {
      expect(shellRequest(request(path, "cors"), origin)).toBe("static");
      expect(shellRequest(request(`${path}?token=private`, "cors"), origin)).toBeNull();
    },
  );

  it("bypasses credentials, external URLs and non-GET methods", () => {
    expect(shellRequest(request("/docker", "navigate", new Headers({ Authorization: "Bearer private" })), origin)).toBeNull();
    expect(shellRequest(request("/index.html", "cors", new Headers({ Authorization: "Bearer private" })), origin)).toBeNull();
    expect(shellRequest(request("https://external.example/index.html", "cors"), origin)).toBeNull();
    expect(shellRequest(request("/docker", "navigate", new Headers(), "POST"), origin)).toBeNull();
  });
});

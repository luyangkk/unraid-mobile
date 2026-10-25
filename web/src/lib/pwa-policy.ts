// shellRequest classifies requests eligible for the public static application shell.
export function shellRequest(request: Request, origin: string): "navigation" | "static" | null {
  if (request.method !== "GET" || request.headers.has("Authorization")) return null;
  const url = new URL(request.url);
  if (url.origin !== origin) return null;
  const path = url.pathname;
  const segments = path.slice(1).split("/");
  if ([...url.searchParams.keys()].some((key) => /token|authorization/i.test(key))) return null;
  // Reject encoded/noncanonical paths before matching any static cache key.
  if (path !== "/" && segments.some((segment) => !segment || segment.startsWith(".")) ||
      /[%\\]/.test(path) || segments.includes("api") ||
      path === "/healthz" || path.startsWith("/healthz/")) return null;

  if (request.mode === "navigate") {
    if (path === "/assets" || path.startsWith("/assets/") ||
        path === "/icons" || path.startsWith("/icons/") ||
        segments.some((segment) => segment.includes("."))) return null;
    return "navigation";
  }
  if (url.search) return null;
  if (path === "/index.html" || path === "/manifest.webmanifest" ||
      /^\/assets\/[^/]+\.(js|css)$/.test(path) || /^\/icons\/[^/]+\.png$/.test(path)) return "static";
  return null;
}

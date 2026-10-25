import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { inflateSync } from "node:zlib";
import vm from "node:vm";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const origin = "https://console.example";
const manifest = JSON.parse(await readFile(`${dist}manifest.webmanifest`, "utf8"));
for (const [key, value] of Object.entries({
  name: "Unraid Mobile", short_name: "Unraid",
  description: "Mobile console for a single Unraid server",
  start_url: "/", scope: "/", display: "standalone", orientation: "portrait",
  theme_color: "#171717", background_color: "#171717",
})) assert.equal(manifest[key], value, key);
assert.deepEqual(manifest.icons.map(({ sizes, type, purpose }) => ({ sizes, type, purpose })), [
  { sizes: "192x192", type: "image/png", purpose: "any" },
  { sizes: "512x512", type: "image/png", purpose: "any" },
  { sizes: "512x512", type: "image/png", purpose: "maskable" },
]);
assert.equal(manifest.share_target, undefined);
assert.equal(manifest.file_handlers, undefined);

// checkIcon verifies real PNG dimensions, opacity, borders and maskable safe-area pixels.
async function checkIcon(path, size, maskable = false) {
  assert.match(path, /^\/icons\/[a-z0-9-]+\.png$/);
  const data = await readFile(`${dist}${path.slice(1)}`);
  assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(data.readUInt32BE(16), size);
  assert.equal(data.readUInt32BE(20), size);
  assert.equal(data[24], 8);
  assert.equal(data[25], 2, "icons must be opaque RGB");
  const chunks = [];
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset);
    if (data.subarray(offset + 4, offset + 8).toString() === "IDAT") {
      chunks.push(data.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const pixels = inflateSync(Buffer.concat(chunks));
  let detailPixels = 0;
  let artworkPixels = 0;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    assert.equal(pixels[row], 0);
    for (let x = 0; x < size; x++) {
      const rgb = [...pixels.subarray(row + 1 + x * 3, row + 4 + x * 3)];
      const background = rgb[0] === 2 && rgb[1] === 6 && rgb[2] === 23;
      if (!background) detailPixels++;
      if (rgb[0] > 150 && rgb[1] < 180 && rgb[2] < 90) artworkPixels++;
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1 ||
          maskable && Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) > size * 0.4) {
        assert.ok(background, "icon edges and maskable outer area must be background");
      }
    }
  }
  assert.ok(detailPixels > size * size * 0.1, "icon must contain visible artwork");
  assert.ok(artworkPixels > size * size * 0.01, "icon must contain the provided red/orange artwork");
}
for (const icon of manifest.icons) await checkIcon(icon.src, Number(icon.sizes.split("x")[0]), icon.purpose === "maskable");
await checkIcon("/icons/apple-touch-icon.png", 180);
await checkIcon("/icons/favicon.png", 32);
const html = await readFile(`${dist}index.html`, "utf8");
assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
assert.match(html, /viewport-fit=cover/);
assert.match(html, /apple-mobile-web-app-capable/);
assert.match(html, /name="theme-color" content="#171717"/);
assert.match(html, /<script data-theme-bootstrap>/);

const handlers = new Map();
const stores = new Map([["unraid-mobile-static-old", new Map()], ["unrelated-cache", new Map()]]);
const networkRequests = [];
let failMigration = false;
let cacheAccesses = 0;
let claims = 0;
let activations = 0;
const scope = {
  location: { origin },
  clients: { claim: async () => { claims++; } },
  skipWaiting: async () => { activations++; },
  addEventListener: (type, callback) => handlers.set(type, callback),
};
const cacheStorage = {
  // open implements browser cache semantics with real Response cloning.
  async open(name) {
    cacheAccesses++;
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      put: async (key, response) => {
        if (failMigration && String(key).includes("quota-old")) throw new Error("Quota exceeded");
        store.set(String(key), response.clone());
      },
      match: async (key) => store.get(typeof key === "string" ? key : key.url)?.clone(),
      keys: async () => [...store.keys()].map((url) => new Request(url)),
    };
  },
  keys: async () => { cacheAccesses++; return [...stores.keys()]; },
  delete: async (name) => { cacheAccesses++; return stores.delete(name); },
};
vm.runInNewContext(await readFile(`${dist}sw.js`, "utf8"), {
  self: scope, caches: cacheStorage, crypto: webcrypto,
  Request, Response, URL, TextEncoder, console,
  // fetch serves build files during install and rejects unexpected runtime network reads.
  fetch: async (request) => {
    networkRequests.push(request);
    const url = new URL(request.url);
    assert.equal(url.origin, origin, "no external precache");
    assert.equal(url.search, "", "no credentials or query in precache keys");
    assert.match(url.pathname, /^\/(?:index\.html|manifest\.webmanifest|icons\/[a-z0-9-]+\.png|assets\/[^?]+\.(?:js|css))$/);
    assert.equal(request.headers.has("Authorization"), false);
    assert.equal(request.credentials, "omit");
    const bytes = await readFile(`${dist}${url.pathname.slice(1)}`);
    return new Response(bytes, { status: 200 });
  },
});

// lifecycle waits for the worker's install/activate/message contract.
async function lifecycle(type, data) {
  const promises = [];
  handlers.get(type)({ data, waitUntil: (promise) => promises.push(promise) });
  await Promise.all(promises);
}
await lifecycle("install");
assert.equal(activations, 0, "install must not skip waiting");
const expectedAssets = (await readdir(`${dist}assets`)).filter((name) => /\.(js|css)$/.test(name));
for (const asset of expectedAssets) assert.ok(networkRequests.some((request) => request.url.endsWith(`/assets/${asset}`)));
for (const path of ["/index.html", "/manifest.webmanifest", ...manifest.icons.map((icon) => icon.src),
  "/icons/apple-touch-icon.png", "/icons/favicon.png"]) {
  assert.ok(networkRequests.some((request) => request.url === origin + path), `missing precache ${path}`);
}
await lifecycle("activate");
assert.equal(claims, 1);
assert.ok(stores.has("unrelated-cache"));
assert.ok(!stores.has("unraid-mobile-static-old"));
const names = [...stores.keys()].filter((name) => name.startsWith("unraid-mobile-static-"));
assert.equal(names.length, 1);
assert.match(names[0], /^unraid-mobile-static-[0-9a-f]{64}$/);
const installed = stores.get(names[0]);
const installedKeys = [...installed.keys()];

// dispatchFetch exercises the generated worker, returning undefined for browser network bypass.
async function dispatchFetch(path, mode = "navigate", headers = new Headers(), method = "GET") {
  let response;
  handlers.get("fetch")({
    request: { url: new URL(path, origin).href, mode, headers, method },
    respondWith: (value) => { response = value; },
  });
  return await response;
}
for (const path of ["/", "/docker", "/vm", "/storage", "/unknown", "/unknown/nested", "/docker?view=running"]) {
  assert.equal(await (await dispatchFetch(path)).text(), html, `offline navigation ${path}`);
}
for (const asset of expectedAssets) {
  assert.deepEqual(Buffer.from(await (await dispatchFetch(`/assets/${asset}`, "cors")).arrayBuffer()),
    await readFile(`${dist}assets/${asset}`));
}
const beforeBypass = cacheAccesses;
for (const path of [
  "/api", "/api/v1/capabilities", "/api/v1/system", "/api/v1/docker", "/api/v1/vms",
  "/api/v1/storage", "/api/v1/events", "/api/v1/operations/op_1", "/api/v1/missing",
  "/healthz", "/healthz/child", "/%61pi/v1/system", "/api%2fv1/events",
  "/%2fapi/v1/events", "/docker//child", "/missing.js", "/outside/api/v1/events",
  "/icons", "/icons/missing", "/sw.js", "https://external.example/index.html",
]) {
  for (const mode of ["navigate", "cors"]) assert.equal(await dispatchFetch(path, mode), undefined, path);
}
assert.equal(await dispatchFetch("/docker", "navigate", new Headers({ Authorization: "Bearer disposable" })), undefined);
assert.equal(await dispatchFetch("/index.html?token=disposable", "cors"), undefined);
assert.equal(await dispatchFetch("/docker?token=disposable"), undefined);
assert.equal(await dispatchFetch("/?access_token=disposable"), undefined);
assert.equal(await dispatchFetch("/docker", "cors"), undefined);
assert.equal(await dispatchFetch("/docker", "navigate", new Headers(), "POST"), undefined);
assert.equal(cacheAccesses, beforeBypass, "network-only requests must never access Cache Storage");
assert.deepEqual([...installed.keys()], installedKeys, "runtime requests must not write caches");
for (const path of ["/assets/missing.js", "/icons/missing.png"]) {
  assert.equal(await dispatchFetch(path), undefined, "asset navigation must not become HTML");
  await assert.rejects(dispatchFetch(path, "cors"), "missing resource remains a network failure");
}
const legacyAsset = origin + "/assets/DockerPage-oldhash.js";
// Cache keys preserve creation order: simulate an older cache before the current build.
stores.delete(names[0]);
stores.set("unraid-mobile-static-older", new Map([[legacyAsset, new Response("old route chunk")]]));
stores.set(names[0], installed);
stores.set("unraid-mobile-static-installing-newer", new Map([[origin + "/index.html", new Response("newer shell")]]));
await lifecycle("activate");
assert.ok(!stores.has("unraid-mobile-static-older"), "old cache names must be deleted");
assert.ok(stores.has("unraid-mobile-static-installing-newer"), "activation must not delete later installing caches");
stores.delete("unraid-mobile-static-installing-newer");
assert.equal(await (await dispatchFetch("/assets/DockerPage-oldhash.js", "cors")).text(), "old route chunk",
  "a still-running old tab must be able to load its route chunks after another tab accepts");
const quotaAsset = origin + "/assets/quota-old.js";
stores.delete(names[0]);
stores.set("unraid-mobile-static-quota-older", new Map([[quotaAsset, new Response("quota old chunk")]]));
stores.set(names[0], installed);
failMigration = true;
await lifecycle("activate");
assert.ok(stores.has("unraid-mobile-static-quota-older"), "failed migration must preserve its source cache");
assert.equal(await (await dispatchFetch("/assets/quota-old.js", "cors")).text(), "quota old chunk");
failMigration = false;
await lifecycle("activate");
assert.ok(!stores.has("unraid-mobile-static-quota-older"));
// A worker-only update sharing static revisions must not destroy an active cache on failure.
const beforeFailure = [...installed.keys()];
const beforeReinstall = networkRequests.length;
await lifecycle("install");
assert.equal(networkRequests.length, beforeReinstall, "worker-only reinstall must reuse complete active static cache");
assert.deepEqual([...stores.get(names[0]).keys()], beforeFailure);
const failedHandlers = new Map();
const failedScope = { ...scope, addEventListener: (type, callback) => failedHandlers.set(type, callback) };
const failedWorker = (await readFile(`${dist}sw.js`, "utf8")).replace(
  /"revision":"[^"]+","url":"index\.html"/, '"revision":"failed-install-revision","url":"index.html"',
);
vm.runInNewContext(failedWorker, {
  self: failedScope, caches: cacheStorage, crypto: webcrypto, Request, Response, URL, TextEncoder, console,
  fetch: async () => { throw new TypeError("Network unavailable"); },
});
let failure;
failedHandlers.get("install")({ waitUntil: (promise) => { failure = promise; } });
await assert.rejects(failure, /Network unavailable/);
assert.deepEqual([...stores.get(names[0]).keys()], beforeFailure, "a failed new install must preserve active assets");
assert.equal([...stores.keys()].filter((name) => name.startsWith("unraid-mobile-static-")).length, 1);
await lifecycle("message", { type: "OTHER" });
assert.equal(activations, 0);
await lifecycle("message", { type: "SKIP_WAITING" });
assert.equal(activations, 1);
console.log(`PWA build checks passed: manifest, 5 opaque icons, ${installedKeys.length} static precache entries, offline routes, network-only boundaries, old chunk migration, failed-install isolation, consent activation`);

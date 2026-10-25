/// <reference lib="webworker" />
import { shellRequest } from "./lib/pwa-policy";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

const entries = self.__WB_MANIFEST;
const prefix = "unraid-mobile-static-";
const urls = entries.map((entry) => new URL(entry.url, self.location.origin).href);
const cacheName = crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(entries)))
  .then((digest) => prefix + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));

// installShell writes only successful public build assets under credential-free keys.
async function installShell() {
  const name = await cacheName;
  // Worker-only updates reuse immutable assets without touching the active cache.
  const exists = (await caches.keys()).includes(name);
  if (exists) {
    const cache = await caches.open(name);
    if ((await Promise.all(urls.map((url) => cache.match(url)))).every(Boolean)) return;
  }
  // Download completely before opening a new cache; transport failure cannot erase a live shell.
  const responses = await Promise.all(urls.map(async (url) => {
    const response = await fetch(new Request(url, { cache: "no-store", credentials: "omit" }));
    if (response.status !== 200 || response.type === "opaque" || response.redirected) {
      throw new Error("Static shell installation failed");
    }
    return response;
  }));
  try {
    const cache = await caches.open(name);
    for (let index = 0; index < urls.length; index++) await cache.put(urls[index], responses[index]);
  } catch (error) {
    if (!exists) await caches.delete(name);
    throw error;
  }
}

// activateShell removes older shell versions only after this worker is activated.
async function activateShell() {
  const name = await cacheName;
  const current = await caches.open(name);
  const names = await caches.keys();
  // Cache Storage lists creation order; later caches may belong to an in-flight install.
  const oldNames = names.slice(0, names.indexOf(name)).filter((key) => key.startsWith(prefix));
  // Carry only built JS/CSS so unrefreshed tabs can still import their old hashed chunks.
  for (const oldName of oldNames) {
    try {
      const previous = await caches.open(oldName);
      for (const request of await previous.keys()) {
        const url = new URL(request.url);
        if (url.origin !== self.location.origin || url.search || request.headers.has("Authorization") ||
            !/^\/assets\/[^/]+\.(js|css)$/.test(url.pathname) || await current.match(request.url)) continue;
        const response = await previous.match(request);
        if (response?.status === 200) await current.put(request.url, response);
      }
      await caches.delete(oldName);
    } catch {
      // Preserve the source on quota/storage failure; old chunks can still be read below.
    }
  }
  await self.clients.claim();
}

// cachedShell reads a known static key; it never writes runtime responses.
async function cachedShell(key: string, request: Request) {
  const cache = await caches.open(await cacheName);
  const response = await cache.match(key);
  if (response) return response;
  if (/^\/assets\/[^/]+\.(js|css)$/.test(new URL(key).pathname)) {
    const names = await caches.keys();
    for (const name of names.slice(0, names.indexOf(await cacheName)).reverse()) {
      if (!name.startsWith(prefix)) continue;
      const previous = await caches.open(name);
      const asset = await previous.match(key);
      if (asset?.status === 200) return asset;
    }
  }
  return fetch(request);
}

self.addEventListener("install", (event) => event.waitUntil(installShell()));
self.addEventListener("activate", (event) => event.waitUntil(activateShell()));
self.addEventListener("fetch", (event) => {
  const kind = shellRequest(event.request, self.location.origin);
  if (kind === "navigation") {
    event.respondWith(cachedShell(new URL("/index.html", self.location.origin).href, event.request));
  } else if (kind === "static") {
    event.respondWith(cachedShell(event.request.url, event.request));
  }
  // All other requests, including API/SSE/health, pass directly to the browser network.
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

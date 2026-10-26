// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ContainerIcon } from "./ContainerIcon";
import { dockerSample } from "../../test/app-fixtures";
import { clearAppToken, setAppToken, subscribeUnauthorized } from "../../lib/auth";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  clearAppToken();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mountIcon(version?: string, enabled = true) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const create = vi.fn(() => "blob:icon");
  const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  async function update(iconVersion?: string, enabled = true) {
    await act(async () => root.render(<ContainerIcon container={{ ...dockerSample.containers[0], iconVersion }} enabled={enabled} />));
  }
  await update(version, enabled);
  disposers.push(async () => { await act(async () => root.unmount()); host.remove(); });
  return { host, root, create, revoke, update };
}
it("uses the generic icon without a verified version and makes no request", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const icon = await mountIcon();
  expect(icon.host.querySelector("svg")).not.toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
it("loads a same-origin icon with Bearer authentication once per version and keeps it while paused", async () => {
  setAppToken("test-only-token");
  const fetcher = vi.fn().mockResolvedValue(new Response("png", { headers: { "Content-Type": "image/png" } }));
  vi.stubGlobal("fetch", fetcher);
  const icon = await mountIcon("first");
  expect(fetcher.mock.calls[0][0]).toBe("/api/v1/docker/plex/icon?v=first");
  expect(fetcher.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer test-only-token");
  expect(fetcher.mock.calls[0][1].cache).toBe("no-store");
  expect(icon.host.querySelector("img")?.getAttribute("src")).toBe("blob:icon");
  await icon.update("first");
  await icon.update("first", false);
  expect(icon.host.querySelector("img")).not.toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => { icon.host.querySelector("img")!.dispatchEvent(new Event("error")); });
  expect(icon.host.querySelector("img")).toBeNull();
  expect(icon.host.querySelector("svg")).not.toBeNull();
});
it.each([404, 500, 401])("falls back on HTTP %s and reports current-session 401", async (status) => {
  const unauthorized = vi.fn();
  const unsubscribe = subscribeUnauthorized(unauthorized);
  try {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status })));
    const icon = await mountIcon("first");
    expect(icon.host.querySelector("img")).toBeNull();
    expect(icon.host.querySelector("svg")).not.toBeNull();
    expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  } finally { unsubscribe(); }
});
it("aborts obsolete reads, ignores late results, and revokes replaced and unmounted blob URLs", async () => {
  let resolveFirst!: (value: Response) => void;
  let firstSignal!: AbortSignal;
  const fetcher = vi.fn((_path, init) => {
    if (!resolveFirst) {
      firstSignal = init.signal;
      return new Promise<Response>((resolve) => { resolveFirst = resolve; });
    }
    return Promise.resolve(new Response("png", { headers: { "Content-Type": "image/png" } }));
  });
  vi.stubGlobal("fetch", fetcher);
  const icon = await mountIcon("first");
  await icon.update("second");
  expect(firstSignal.aborted).toBe(true);
  expect(icon.create).toHaveBeenCalledTimes(1);
  await act(async () => resolveFirst(new Response("old", { headers: { "Content-Type": "image/png" } })));
  expect(icon.create).toHaveBeenCalledTimes(1);
  await icon.update("third");
  expect(icon.revoke).toHaveBeenCalledTimes(1);
  await icon.update(undefined);
  expect(icon.revoke).toHaveBeenCalledTimes(2);
});
it("waits for foreground/online before loading and rejects non-image responses", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("<html>", { headers: { "Content-Type": "text/html" } }));
  vi.stubGlobal("fetch", fetcher);
  const icon = await mountIcon("first", false);
  expect(fetcher).not.toHaveBeenCalled();
  await icon.update("first", true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(icon.host.querySelector("img")).toBeNull();
});

it("fetches the configured HTTPS folder icon without app credentials and uses a folder fallback", async () => {
  setAppToken("test-only-token");
  const fetcher=vi.fn().mockResolvedValue(new Response("png",{headers:{"Content-Type":"image/png"}}));
  vi.stubGlobal("fetch",fetcher);
  const panel=await mountIcon();
  await act(async()=>panel.root.render(<ContainerIcon container={{id:"folder-photos",folder:true,iconUrl:"https://example.test/immich.png"}} enabled />));
  expect(fetcher.mock.calls[0][0]).toBe("https://example.test/immich.png");
  expect(fetcher.mock.calls[0][1]).toMatchObject({cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer",mode:"cors"});
  expect(new Headers(fetcher.mock.calls[0][1].headers).has("Authorization")).toBe(false);
  expect(panel.host.querySelector("img")?.getAttribute("src")).toBe("blob:icon");
  await act(async()=>panel.host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(panel.host.querySelector(".lucide-folder")).not.toBeNull();
});
it("never requests an unsafe folder icon reference",async()=>{
 const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
 const panel=await mountIcon();
 for(const iconUrl of ["javascript:alert(1)","http://example.test/icon.png","https://user:pass@example.test/icon.png"]){
  await act(async()=>panel.root.render(<ContainerIcon container={{id:"folder-photos",folder:true,iconUrl}} enabled />));
  expect(panel.host.querySelector(".lucide-folder")).not.toBeNull();
 }
 expect(fetcher).not.toHaveBeenCalled();
});
it("does not expire the app session when an external folder icon returns 401",async()=>{
 const unauthorized=vi.fn();const unsubscribe=subscribeUnauthorized(unauthorized);
 try{
  setAppToken("test-only-token");
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("private icon",{status:401})));
  const panel=await mountIcon();
  await act(async()=>panel.root.render(<ContainerIcon container={{id:"folder-photos",folder:true,iconUrl:"https://example.test/private.png"}} enabled />));
  expect(panel.host.querySelector(".lucide-folder")).not.toBeNull();
  expect(unauthorized).not.toHaveBeenCalled();
 }finally{unsubscribe();}
});

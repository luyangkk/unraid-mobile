// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DockerPanel } from "./DockerPanel";
import { dockerSample } from "../../test/app-fixtures";
import { clearAppToken } from "../../lib/auth";

const snapshot = {
  ...dockerSample,
  containers: dockerSample.containers.map(container => ({ ...container, iconVersion: `icon-${container.id}` })),
};
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  clearAppToken();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mountPanel(enabled = true) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:container-icon"), revokeObjectURL: vi.fn(),
  }));
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(
    new Response("synthetic png", { headers: { "Content-Type": "image/png" } }),
  ));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  // update replaces a snapshot without remounting the panel or resetting its state.
  async function update(loadIcons: boolean, nextSnapshot = snapshot) {
    await act(async () => root.render(<DockerPanel snapshot={nextSnapshot} loadIcons={loadIcons} />));
  }
  await update(enabled);
  disposers.push(async () => { await act(async () => root.unmount()); host.remove(); });
  return { host, root, fetcher, update };
}
function group(host: HTMLElement, name: string) {
  return [...host.querySelectorAll("details")].find(details => details.querySelector("summary")?.textContent?.startsWith(name))!;
}
async function toggle(details: HTMLDetailsElement, open: boolean) {
  await act(async () => { details.open = open; details.dispatchEvent(new Event("toggle")); });
}
it("loads real icons in Running and Other rows and defers Stopped icons until expansion", async () => {
  const panel = await mountPanel();
  expect(panel.fetcher.mock.calls.map(([url]) => url).sort()).toEqual([
    "/api/v1/docker/db/icon?v=icon-db", "/api/v1/docker/plex/icon?v=icon-plex",
  ]);
  expect(panel.host.querySelectorAll("article img")).toHaveLength(2);
  expect(panel.host.querySelector("article img")?.parentElement?.classList.contains("size-10")).toBe(true);
  expect(panel.host.querySelector("article button, article a")).toBeNull();
  const stopped = group(panel.host, "Stopped");
  expect(stopped.open).toBe(false);
  await toggle(stopped, true);
  expect(stopped.querySelector("img")).not.toBeNull();
  expect(panel.fetcher.mock.calls[2][0]).toBe("/api/v1/docker/backup/icon?v=icon-backup");
  // Polls and closing/reopening a group reuse the already loaded image.
  await panel.update(true);
  await toggle(stopped, false);
  await toggle(stopped, true);
  expect(panel.fetcher).toHaveBeenCalledTimes(3);
});
it("defers a persisted collapsed Running group and pauses new image reads in the background", async () => {
  localStorage.setItem("unraid-mobile.docker.runningCollapsed.v1", "true");
  const panel = await mountPanel(false);
  expect(panel.fetcher).not.toHaveBeenCalled();
  expect(group(panel.host, "Running").open).toBe(false);
  await panel.update(true);
  expect(panel.fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/v1/docker/db/icon?v=icon-db"]);
  await toggle(group(panel.host, "Running"), true);
  expect(panel.fetcher).toHaveBeenCalledTimes(2);
  await panel.update(false);
  expect(panel.host.querySelectorAll("article img")).toHaveLength(2);
  await toggle(group(panel.host, "Stopped"), true);
  expect(panel.fetcher).toHaveBeenCalledTimes(2);
  await panel.update(true);
  expect(panel.fetcher).toHaveBeenCalledTimes(3);
});

it.each([
  { state: "unavailable", interruption: { ...snapshot, available: false } },
  { state: "empty", interruption: { ...snapshot, containers: [], summary: { running: 0, stopped: 0, other: 0 } } },
])("loads Stopped icons only for visible groups after $state snapshots", async ({ interruption }) => {
  const panel = await mountPanel();
  await toggle(group(panel.host, "Stopped"), true);
  await panel.update(true, interruption);
  expect(panel.host.querySelector("details")).toBeNull();
  const requestsBeforeRestore = panel.fetcher.mock.calls.length;
  await panel.update(true);
  const stopped = group(panel.host, "Stopped");
  if (stopped.open) {
    expect(stopped.querySelector("img")).not.toBeNull();
  } else {
    const requests = panel.fetcher.mock.calls.slice(requestsBeforeRestore).map(([url]) => url);
    expect(requests).not.toContain("/api/v1/docker/backup/icon?v=icon-backup");
  }
});

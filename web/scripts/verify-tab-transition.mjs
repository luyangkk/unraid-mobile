import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, isAbsolute } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = fileURLToPath(new URL("../", import.meta.url));
const directory = "/tmp/unraid-tab-transition-browser";
const base = new URL(process.env.CHECK_BASE_URL || "http://127.0.0.1:18183");
const require = createRequire(new URL("../package.json", import.meta.url));
const modulePath = process.env.PLAYWRIGHT_MODULE || require.resolve("playwright");
const chrome = process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const reportPath = resolve(process.env.CHECK_REPORT_PATH || `${directory}/report.md`);
assert(reportPath.startsWith(`${directory}/`), "CHECK_REPORT_PATH must stay inside the permitted evidence directory");
await mkdir(directory, { recursive: true });
await mkdir(dirname(reportPath), { recursive: true });
process.env.TMPDIR = directory;
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
const ts = (await import(pathToFileURL(`${web}node_modules/typescript/lib/typescript.js`).href)).default;
const results = {
  startedAt: new Date().toISOString(), baseURL: base.href, versions: {}, checks: [], errors: [],
  limitations: [
    "Desktop Chrome automation does not validate iPhone Safari, installed PWA, or a real Unraid host.",
    "Playwright fulfill cannot stream SSE. Only /events is redirected by route.continue to this script's temporary synthetic streaming server; all REST fixtures are returned directly by route.fulfill.",
    "Snapshot content is checked by separate old/new screenshots plus before/after semantic DOM evidence; screenshot pixel differences alone are not OCR.",
    "Real hidden/visible lifecycle remains unverified: headless and headed local Chrome, tab activation, window minimization, Page.setWebLifecycleState, and disabled CDP focus emulation all retained visible. No fabricated visibility events are used. See visibility-probe.json.",
    "No npm ci, application unit tests, build, Go tests, or image checks are performed by this browser-only script.",
  ],
};
const pages = new Set();
let browser;
let currentCheck;

// fixtures reads only synthetic sample declarations through the existing TS parser.
async function fixtures() {
  const source = ts.createSourceFile("fixtures.tsx", await readFile(`${web}src/test/app-fixtures.tsx`, "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["systemSample", "dockerSample", "vmSample", "storageSample"]);
  const nodes = source.statements.filter((node) => ts.isVariableStatement(node)
    && node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && names.has(item.name.text)));
  assert.equal(nodes.length, 4, "Expected the four existing synthetic fixture declarations");
  const printer = ts.createPrinter();
  const output = ts.transpileModule(nodes.map((node) => printer.printNode(ts.EmitHint.Unspecified, node, source)).join("\n"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}
const samples = await fixtures();
const transports = new Map();
let streamId = 0;
// streamServer keeps one real synthetic SSE open, including during route changes.
const streamServer = createServer((request, response) => {
  const id = new URL(request.url, "http://localhost").searchParams.get("id");
  const transport = transports.get(id);
  if (!transport) { response.writeHead(404); response.end(); return; }
  transport.opens++;
  transport.active++;
  transport.maxActive = Math.max(transport.maxActive, transport.active);
  transport.response = response;
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": base.origin, "X-Accel-Buffering": "no" });
  response.write(`event: system.metrics\ndata: ${JSON.stringify(transport.system)}\n\n`);
  const heartbeat = setInterval(() => response.write(": fixture heartbeat\n\n"), 1000);
  response.on("close", () => {
    clearInterval(heartbeat);
    transport.active--;
    if (transport.response === response) transport.response = undefined;
  });
});
await new Promise((accept) => streamServer.listen(0, "127.0.0.1", accept));
const streamOrigin = `http://127.0.0.1:${streamServer.address().port}`;

// verify records real assertion outcomes; full observations live in each check's data.
async function verify(name, actual, predicate) {
  const passed = Boolean(predicate(actual));
  currentCheck.assertions.push({ name, passed });
  assert(passed, `${name}: ${JSON.stringify(actual).slice(0, 1500)}`);
}

// streamStats strips Node response/socket objects from browser evidence.
function streamStats(transport) {
  return { opens: transport.opens, active: transport.active, maxActive: transport.maxActive };
}

// instrument observes DOM and browser-created Animation objects without router internals.
function instrument({ nativeMissing, freeze }) {
  if (nativeMissing) Object.defineProperty(document, "startViewTransition", { value: undefined, configurable: true });
  const state = window.__tabCheck = {
    frames: [], mutations: [], histories: [], touches: [], recording: false, freeze, frozen: false,
    nativeStarts: 0, lastMarker: null, epoch: 0, lifecycle: [],
  };
  // lifecycle uses event and attribute timestamps even when native capture suspends rAF.
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.attributeName === "data-tab-transition") state.lifecycle.push({
        name: "marker", at: performance.now(), previous: record.oldValue,
        marker: document.documentElement.dataset.tabTransition ?? null,
      });
    }
  }).observe(document, { subtree: true, attributes: true, attributeOldValue: true,
    attributeFilter: ["data-tab-transition"] });
  for (const name of ["resize", "visibilitychange"]) {
    (name === "resize" ? window : document).addEventListener(name, () => state.lifecycle.push({
      name, at: performance.now(), viewport: [innerWidth, innerHeight], visibility: document.visibilityState,
    }));
  }
  for (const name of ["pushState", "replaceState"]) {
    const original = history[name].bind(history);
    history[name] = (...args) => {
      state.histories.push({ kind: name, url: String(args[2]), at: performance.now() });
      return original(...args);
    };
  }
  for (const name of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    document.addEventListener(name, (event) => {
      if (event.pointerType === "touch") state.touches.push({
        name, x: event.clientX, y: event.clientY, trusted: event.isTrusted, at: performance.now(),
        target: event.target?.tagName, ancestors: event.composedPath().filter((node) => node instanceof Element)
          .slice(0, 5).map((node) => ({ tag: node.tagName, role: node.getAttribute("role") })),
      });
    }, true);
  }
  new MutationObserver(() => {
    const content = document.querySelector("[data-tab-content]");
    state.mutations.push({
      at: performance.now(), main: document.querySelectorAll("main").length,
      content: document.querySelectorAll("[data-tab-content]").length,
      children: content?.children.length ?? 0,
      visibleChildren: [...(content?.children ?? [])].filter((node) => node.checkVisibility()).length,
    });
  }).observe(document, { subtree: true, childList: true });
  // frame tracks unpaused values before optionally freezing the actual pseudo animations.
  function frame() {
    if (state.recording) {
      const root = document.documentElement;
      const marker = root.dataset.tabTransition ?? null;
      if (marker && marker !== state.lastMarker) state.nativeStarts++;
      state.lastMarker = marker;
      const content = document.querySelector("[data-tab-content]");
      const main = document.querySelector("main");
      const nav = document.querySelector("nav");
      if (content && main && nav) {
        const style = getComputedStyle(content);
        const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
        const animations = document.getAnimations().filter((animation) =>
          animation.effect?.pseudoElement?.includes("tab-content"));
        const pseudo = (name) => {
          const value = getComputedStyle(root, `::view-transition-${name}(tab-content)`);
          const transform = new DOMMatrixReadOnly(value.transform === "none" ? undefined : value.transform);
          return { opacity: Number(value.opacity), x: transform.m41, transform: value.transform,
            width: parseFloat(value.width), height: parseFloat(value.height), animationName: value.animationName,
            objectFit: value.objectFit };
        };
        const native = animations.map((animation) => ({
          pseudo: animation.effect.pseudoElement, time: animation.currentTime,
          state: animation.playState, duration: animation.effect.getTiming().duration,
          frames: animation.effect.getKeyframes().map(({ offset, opacity, transform }) => ({ offset, opacity, transform })),
        }));
        const links = [...nav.querySelectorAll("a")].filter((link) => link.getAttribute("aria-current") === "page");
        state.frames.push({
          at: performance.now(), path: location.pathname, marker, direction: root.dataset.tabDirection,
          heading: content.querySelector("h2")?.textContent ?? null,
          pending: [...content.querySelectorAll('[role="status"]')].some((node) =>
            node.checkVisibility() && node.textContent.includes("Loading page")),
          main: document.querySelectorAll("main").length,
          content: document.querySelectorAll("[data-tab-content]").length,
          active: links.map((link) => new URL(link.href).pathname),
          motion: { x: matrix.m41, opacity: Number(style.opacity), transform: style.transform },
          old: pseudo("old"), new: pseudo("new"), native,
          rect: content.getBoundingClientRect().toJSON(), mainRect: main.getBoundingClientRect().toJSON(),
          navRect: nav.getBoundingClientRect().toJSON(), scrollY,
          scrollWidth: document.documentElement.scrollWidth, viewport: [innerWidth, innerHeight],
          clip: getComputedStyle(root, "::view-transition").clipPath,
          groupAnimation: getComputedStyle(root, "::view-transition-group(tab-content)").animationName,
        });
        if (state.freeze && !state.frozen && native.length >= 2
          && native.some((animation) => animation.state === "running" && animation.time >= 45 && animation.time < 130)) {
          state.animations = animations;
          for (const animation of animations) { animation.pause(); animation.currentTime = 90; }
          state.frozen = true;
        }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// createPage blocks external traffic and routes REST into mutable synthetic snapshots.
async function createPage({ path = "/", nativeMissing = false, freeze = false, delayed = false,
  longStorage = false, viewport = { width: 390, height: 844 }, theme = process.env.CHECK_THEME || "dark",
  scenario = "ready", mobile = true } = {}) {
  assert.ok(["dark", "light", "system"].includes(theme), "CHECK_THEME must be dark, light or system");
  const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1,
    serviceWorkers: "block", reducedMotion: "no-preference" });
  await context.addInitScript((preference) => localStorage.setItem("unraid-mobile.theme", preference), theme);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const transport = { id: String(++streamId), system: structuredClone(samples.systemSample),
    opens: 0, active: 0, maxActive: 0 };
  transports.set(transport.id, transport);
  const requests = [];
  const values = {
    "/api/v1/capabilities": { docker: true, vm: true,
      dockerActions: { start: false, stop: false, restart: false },
      vmActions: { start: false, stop: false, forceStop: false } },
    "/api/v1/system": transport.system, "/api/v1/docker": structuredClone(samples.dockerSample),
    "/api/v1/vms": structuredClone(samples.vmSample), "/api/v1/storage": structuredClone(samples.storageSample),
  };
  if (longStorage) {
    values["/api/v1/storage"].disks = Array.from({ length: 8 }, (_, index) => ({
      ...values["/api/v1/storage"].disks[0], name: `disk${index + 1}`, device: `sd${String.fromCharCode(98 + index)}`,
    }));
    values["/api/v1/storage"].pools = Array.from({ length: 3 }, (_, index) => ({
      ...values["/api/v1/storage"].pools[0], name: `cache${index + 1}`,
    }));
  }
  let releaseChunk;
  let receivedChunk;
  const chunkRequested = new Promise((accept) => { receivedChunk = accept; });
  const gate = new Promise((accept) => { releaseChunk = accept; });
  const environment = { context, page, transport, requests, values, releaseChunk, chunkRequested };
  pages.add(environment);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    requests.push({ path: url.pathname, at: Date.now() });
    if (url.origin !== base.origin) return route.abort();
    if (url.pathname.startsWith("/api/") && scenario === "offline") return route.abort();
    if (url.pathname.startsWith("/api/") && scenario === "auth") {
      return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({
        error: { code: "UNAUTHORIZED", message: "Authentication required", retryable: false },
      }) });
    }
    if (url.pathname === "/api/v1/events") {
      return route.continue({ url: `${streamOrigin}/events?id=${transport.id}` });
    }
    if (url.pathname.startsWith("/api/")) {
      if (!(url.pathname in values)) return route.fulfill({ status: 404, body: "Unexpected synthetic API" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(values[url.pathname]) });
    }
    if (delayed && /\/assets\/DockerPage-.*\.js$/.test(url.pathname)) { receivedChunk(); await gate; }
    return route.continue();
  });
  page.on("pageerror", (error) => results.errors.push({ check: currentCheck?.id, message: error.message }));
  await page.addInitScript(instrument, { nativeMissing, freeze });
  environment.cdp = await context.newCDPSession(page);
  await page.goto(new URL(path, base).href, { waitUntil: "domcontentloaded" });
  if (scenario === "ready") await ready(environment, path);
  else if (scenario === "auth") await page.getByRole("heading", { name: "API authentication" }).waitFor();
  else await page.getByRole("button", { name: "Retry connection", exact: true }).waitFor();
  return environment;
}

// ready waits for committed semantic content, selected Tab, live SSE, and neutral visuals.
async function ready(environment, path) {
  const label = { "/": "Home", "/docker": "Docker", "/vm": "VM", "/storage": "Storage" }[path];
  await environment.page.evaluate(() => { window.__tabCheck.readyFrames = 0; });
  await environment.page.waitForFunction(({ path, label }) => {
    const content = document.querySelector("[data-tab-content]");
    const style = content && getComputedStyle(content);
    const active = document.querySelector('nav a[aria-current="page"]');
    const neutral = location.pathname === path && content?.querySelector("h2")?.textContent === label
      && new URL(active?.href ?? location.href).pathname === path
      && !document.documentElement.dataset.tabTransition
      && style?.opacity === "1" && (style.transform === "none" || new DOMMatrixReadOnly(style.transform).m41 === 0)
      && document.querySelector("header")?.textContent.includes("Live");
    window.__tabCheck.readyFrames = neutral ? window.__tabCheck.readyFrames + 1 : 0;
    return window.__tabCheck.readyFrames >= 3;
  }, { path, label });
  const specific = { "/": "System", "/docker": "Plex", "/vm": "Linux", "/storage": "Array" }[path];
  await environment.page.getByText(specific, { exact: true }).first().waitFor();
}

// recording resets test-only observation buffers, never application state.
async function recording(environment, freeze = false) {
  await environment.page.evaluate((freeze) => {
    const state = window.__tabCheck;
    state.frames = []; state.histories = []; state.touches = []; state.mutations = []; state.lifecycle = [];
    state.frozen = false; state.freeze = freeze; state.lastMarker = null; state.nativeStarts = 0;
    state.epoch = performance.now(); state.recording = true;
  }, freeze);
}

// observations returns the current real frames and lifecycle evidence.
async function observations(environment) {
  return environment.page.evaluate(() => {
    const state = window.__tabCheck;
    return { frames: state.frames, mutations: state.mutations, histories: state.histories, lifecycle: state.lifecycle,
      touches: state.touches, nativeStarts: state.nativeStarts, epoch: state.epoch,
      path: location.pathname, historyLength: history.length,
      text: document.querySelector("[data-tab-content]")?.innerText.slice(0, 1200),
      marker: document.documentElement.dataset.tabTransition ?? null };
  });
}

// nativeClick uses trusted CDP mouse input, including to test overlay hit handling.
async function nativeClick(environment, locator) {
  const rect = await locator.boundingBox();
  assert(rect, "Click target is not visible");
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await environment.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await environment.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await environment.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

// navigate uses only the real bottom Link for setup, then verifies Router's commit.
async function navigate(environment, path) {
  const label = { "/": "Home", "/docker": "Docker", "/vm": "VM", "/storage": "Storage" }[path];
  await nativeClick(environment, environment.page.getByRole("navigation").getByRole("link", { name: label, exact: true }));
  await ready(environment, path);
}

// gesturePoint finds safe content whitespace or a non-interactive card pixel.
async function gesturePoint(environment, mode = "content") {
  return environment.page.evaluate((mode) => {
    const main = document.querySelector("main");
    const nav = document.querySelector("nav");
    const rect = main.getBoundingClientRect();
    const bottom = Math.min(rect.bottom, nav.getBoundingClientRect().top);
    const x = innerWidth / 2;
    const controls = "button,a,summary,input,select,textarea,[role=button],[data-sheet-content]";
    const valid = (y) => {
      const target = document.elementFromPoint(x, y);
      return target && main.contains(target) && !target.closest(controls);
    };
    if (mode === "gap" || mode === "content") {
      const y = bottom - 12;
      if (valid(y)) return { x, y, main: rect.toJSON(), hit: document.elementFromPoint(x, y).tagName };
    }
    if (mode === "blank") {
      const contentBottom = main.querySelector("[data-tab-content]")?.firstElementChild?.getBoundingClientRect().bottom;
      for (let y = bottom - 18; y > Math.max(rect.top + 15, contentBottom + 8); y -= 10) {
        if (valid(y)) return { x, y, main: rect.toJSON(), hit: document.elementFromPoint(x, y).tagName };
      }
      throw new Error("No genuine short-page blank area found");
    }
    for (let y = Math.max(80, rect.top + 70); y < bottom - 15; y += 12) {
      if (valid(y)) return { x, y, main: rect.toJSON(), hit: document.elementFromPoint(x, y).tagName };
    }
    throw new Error("No safe main gesture point");
  }, mode);
}

// swipe dispatches native touch input; it never calls controller methods or animate.
async function swipe(environment, direction, { point, mode = "content" } = {}) {
  const start = point ?? await gesturePoint(environment, mode);
  const distance = Math.min(110, start.x - 30, (await environment.page.evaluate(() => innerWidth)) - start.x - 30);
  const touch = (x) => [{ x, y: start.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
  await environment.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(start.x) });
  for (const fraction of [0.18, 0.4, 0.7, 1]) {
    await environment.cdp.send("Input.dispatchTouchEvent", { type: "touchMove",
      touchPoints: touch(start.x - direction * distance * fraction) });
  }
  await environment.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  return start;
}

// screenshot persists real rendered pixels in the only permitted temporary directory.
async function screenshot(environment, name) {
  const path = `${directory}/${currentCheck.id}-${name}.png`;
  const image = await environment.page.screenshot({ path, animations: "allow" });
  currentCheck.screenshots.push(path);
  return { path, hash: createHash("sha256").update(image).digest("hex") };
}

// screencast saves compositor frames independently of rAF DOM observations.
async function screencast(environment) {
  const captures = [];
  const writes = [];
  const timeOrigin = await environment.page.evaluate(() => performance.timeOrigin);
  const id = currentCheck.id;
  const listener = ({ data, metadata, sessionId }) => {
    const path = `${directory}/${id}-paint-${String(captures.length).padStart(3, "0")}.png`;
    captures.push({ path, at: metadata.timestamp * 1000 - timeOrigin, metadata });
    writes.push(writeFile(path, Buffer.from(data, "base64")));
    void environment.cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  };
  environment.cdp.on("Page.screencastFrame", listener);
  await environment.cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  // stop returns actual pixel artifacts with browser timestamps for frame correlation.
  return async function stop() {
    await environment.cdp.send("Page.stopScreencast");
    environment.cdp.off("Page.screencastFrame", listener);
    await Promise.all(writes);
    return captures;
  };
}

// paintedOpacity measures a stable panel-fill patch against its final opaque pixels.
async function paintedOpacity(environment, firstPath, finalPath, top) {
  const encoded = await Promise.all([firstPath, finalPath].map(async (path) =>
    (await readFile(path)).toString("base64")));
  return environment.page.evaluate(async ({ encoded, top }) => {
    const averages = [];
    for (const image of encoded) {
      const bytes = Uint8Array.from(atob(image), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(120, Math.round(top) + 10, 130, 7).data;
      const rgb = [0, 0, 0];
      for (let index = 0; index < pixels.length; index += 4) {
        for (let channel = 0; channel < 3; channel++) rgb[channel] += pixels[index + channel];
      }
      averages.push(rgb.map((value) => value / (pixels.length / 4)));
      bitmap.close();
    }
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext("2d");
    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const background = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const vector = averages[1].map((value, index) => value - background[index]);
    const opacity = vector.reduce((sum, value, index) =>
      sum + value * (averages[0][index] - background[index]), 0)
      / vector.reduce((sum, value) => sum + value * value, 0);
    return { firstRGB: averages[0], finalRGB: averages[1], opacity,
      region: { x: 120, y: Math.round(top) + 10, width: 130, height: 7 } };
  }, { encoded, top });
}

// unfreeze resumes existing native animations without creating synthetic animations.
async function unfreeze(environment) {
  await environment.page.evaluate(() => {
    const state = window.__tabCheck;
    state.freeze = false;
    for (const animation of state.animations ?? []) animation.play();
    state.animations = [];
  });
}

// consistent checks actual URL, visible semantic page, and aria selection together.
async function consistent(environment, path) {
  const actual = await environment.page.evaluate(() => ({
    path: location.pathname,
    heading: document.querySelector("[data-tab-content] h2")?.textContent,
    active: [...document.querySelectorAll('nav a[aria-current="page"]')].map((link) => new URL(link.href).pathname),
  }));
  const label = { "/": "Home", "/docker": "Docker", "/vm": "VM", "/storage": "Storage" }[path];
  await verify("URL/content/aria-current agree", actual,
    (value) => value.path === path && value.heading === label && value.active.length === 1 && value.active[0] === path);
}

// runCheck preserves failures immediately and continues with independent browser contexts.
async function runCheck(id, title, action) {
  if (process.env.CHECK_ONLY && !process.env.CHECK_ONLY.split(",").includes(id)) return;
  currentCheck = { id, title, status: "running", assertions: [], screenshots: [], startedAt: new Date().toISOString() };
  results.checks.push(currentCheck);
  const before = new Set(pages);
  try {
    await action();
    currentCheck.status = "passed";
  } catch (error) {
    currentCheck.status = "failed";
    currentCheck.error = error.stack;
    for (const environment of pages) {
      if (before.has(environment)) continue;
      try {
        currentCheck.failureEvidence = await observations(environment);
        await screenshot(environment, "failure");
      } catch (captureError) { currentCheck.captureError = captureError.message; }
    }
    console.error(`FAIL ${id}: ${error.message}`);
  } finally {
    for (const environment of [...pages]) {
      if (before.has(environment)) continue;
      environment.releaseChunk();
      await environment.context.close();
      pages.delete(environment);
    }
    currentCheck.finishedAt = new Date().toISOString();
    await writeFile(`${directory}/${id}.json`, JSON.stringify(currentCheck, null, 2));
    await persist();
    console.log(`${currentCheck.status.toUpperCase()} ${id}`);
  }
}

// persist writes an incremental report, so failed or interrupted runs retain evidence.
async function persist() {
  results.finishedAt = new Date().toISOString();
  results.summary = {
    passed: results.checks.filter((check) => check.status === "passed").length,
    failed: results.checks.filter((check) => check.status === "failed").length,
    assertions: results.checks.reduce((total, check) => total + check.assertions.length, 0),
  };
  await writeFile(`${directory}/results.json`, JSON.stringify(results, null, 2));
  const lines = [
    "# Production Tab Transition Browser Acceptance", "",
    `- Run: ${results.startedAt}`, `- URL: ${base.href}`, `- Chrome: ${results.versions.chrome ?? "not launched"}`,
    `- Node: ${process.version}`, `- Playwright module: ${modulePath}`,
    `- Summary: ${results.summary.passed} passed, ${results.summary.failed} failed, ${results.summary.assertions} assertions`,
    "- The configured local server serves production files; API fixtures and faults are synthetic.", "",
    "## Checks", "", "| Check | Result | Evidence |", "| --- | --- | --- |",
    ...results.checks.map((check) => `| ${check.id}: ${check.title} | ${check.status} | ${check.id}.json |`),
    "", "## Failures", "",
    ...results.checks.filter((check) => check.error).flatMap((check) => [
      `### ${check.id}`, "", "```text", check.error, "```", "",
      ...check.screenshots.map((path) => `- ${path}`), "",
    ]),
    "## Browser Errors", "", "```json", JSON.stringify(results.errors, null, 2), "```", "",
    "## Limitations", "", ...results.limitations.map((item) => `- ${item}`), "",
    "## Repeat", "", "```sh",
    "PLAYWRIGHT_MODULE=/tmp/unraid-primary-pages-check/node_modules/playwright/index.mjs \\",
    "CHECK_BASE_URL=http://127.0.0.1:18183 node web/scripts/verify-tab-transition.mjs",
    "# Without PLAYWRIGHT_MODULE, the script resolves the existing local playwright package.",
    "# From web/: node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 18183 --strictPort",
    "# CHECK_BASE_URL, PLAYWRIGHT_MODULE, CHROME_EXECUTABLE, CHECK_REPORT_PATH, CHECK_THEME are supported.",
    "# CHECK_REPORT_PATH must remain under /tmp/unraid-tab-transition-browser/.",
    "```", "",
  ];
  await writeFile(reportPath, lines.join("\n"));
}

try {
  browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ["--no-first-run", "--no-default-browser-check"] });
  results.versions.chrome = browser.version();
  results.versions.node = process.version;
  results.versions.playwright = JSON.parse(await readFile(resolve(dirname(modulePath), "package.json"), "utf8")).version;
  results.build = { indexHash: createHash("sha256").update(await readFile(`${web}dist/index.html`)).digest("hex") };

  await runCheck("website-buttons", "Website gradient moves on hover and stays static for focus, touch and reduced motion", async () => {
    for (const theme of ["dark", "light"]) {
      const environment = await createPage({ theme, scenario: "auth", mobile: false });
      const { page } = environment;
      const primary = page.getByRole("button", { name: "Connect", exact: true });
      const input = page.getByLabel("APP_TOKEN", { exact: true });
      // paint reads the real compiled CSS on controls and their masked border.
      async function paint(locator, pseudo = null) {
        return locator.evaluate((node, pseudo) => {
          const style = getComputedStyle(node, pseudo);
          return { image: style.backgroundImage, position: style.backgroundPosition,
            size: style.backgroundSize, animation: style.animationName, duration: style.animationDuration,
            timing: style.animationTimingFunction, iterations: style.animationIterationCount,
            color: style.color, opacity: style.opacity, border: style.borderColor, shadow: style.boxShadow,
            height: node.getBoundingClientRect().height, focused: node.matches(":focus-visible") };
        }, pseudo);
      }
      await verify(`${theme} disabled primary is neutral without gradient`, await paint(primary),
        (data) => data.image === "none" && data.animation === "none" && data.height >= 44);
      await input.fill("synthetic-button-check");
      await page.waitForFunction(() => getComputedStyle(document.querySelector(".button-primary")).color === "rgb(255, 255, 255)");
      await verify(`${theme} enabled primary has website red/orange fill and white resting text`, await paint(primary),
        (data) => data.image.includes("rgb(226, 40, 40)") && data.image.includes("rgb(255, 140, 47)")
          && data.color === "rgb(255, 255, 255)" && data.animation === "none");
      await primary.hover();
      const first = await paint(primary);
      await page.waitForFunction(() => {
        const button = document.querySelector(".button-primary");
        const animation = button.getAnimations().find((animation) => animation.animationName === "brand-flow");
        return animation?.currentTime > 450;
      });
      await verify(`${theme} hover advances website 4s linear background`, { first, next: await paint(primary) },
        (data) => data.first.animation === "brand-flow" && data.first.duration === "4s"
          && data.first.timing === "linear" && data.first.iterations === "infinite"
          && data.first.size === "300% 100%" && data.first.position !== data.next.position
          && data.next.color === "rgb(23, 23, 23)");
      await screenshot(environment, `${theme}-primary-flow`);
      await page.mouse.move(0, 0);
      await input.focus();
      await page.keyboard.press("Tab");
      await verify(`${theme} keyboard primary focus is visible without continuous motion`, await paint(primary),
        (data) => data.focused && data.shadow !== "none" && data.animation === "none");
      await primary.hover();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await verify(`${theme} reduced motion stops active primary hover`, await paint(primary),
        (data) => data.animation === "none" && data.image.includes("linear-gradient"));
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await input.fill("");
      await verify(`${theme} becoming disabled removes the running fill`, await paint(primary),
        (data) => data.animation === "none" && data.image === "none");

      const home = await createPage({ theme, mobile: false });
      const secondary = home.page.getByRole("button", { name: "Appearance", exact: true });
      await verify(`${theme} secondary resting border is not moving`, await paint(secondary, "::before"),
        (data) => data.opacity === "1" && data.image.includes("rgb(226, 40, 40)") && data.animation === "none");
      await verify(`${theme} secondary resting fill is transparent`, await paint(secondary, "::after"),
        (data) => data.opacity === "0" && data.animation === "none");
      // paint belongs to the same Locator API and can inspect either isolated page.
      const outerBorder = (await paint(secondary)).border;
      await secondary.hover();
      await home.page.waitForFunction(() => {
        const button = document.querySelector('[aria-label="Appearance"]');
        return document.getAnimations().some((animation) => animation.effect?.target === button &&
          animation.animationName === "brand-flow" && animation.currentTime > 450);
      });
      await verify(`${theme} secondary fades in the flowing website fill`,
        { inner: await paint(secondary, "::after"), outer: await paint(secondary) },
        (data) => data.inner.animation === "brand-flow" && data.inner.duration === "4s"
          && data.inner.opacity === "1" && data.outer.animation === "none" && data.outer.border === outerBorder
          && data.outer.color === "rgb(23, 23, 23)");
      await screenshot(home, `${theme}-secondary-flow`);
      await home.page.mouse.move(0, 0);
      await home.page.keyboard.press("Tab");
      await verify(`${theme} secondary keyboard focus keeps a static gradient and ring`,
        { inner: await paint(secondary, "::after"), outer: await paint(secondary) },
        (data) => data.outer.focused && data.outer.shadow !== "none"
          && data.inner.opacity === "1" && data.inner.animation === "none");
      await secondary.hover();
      await home.page.emulateMedia({ reducedMotion: "reduce" });
      await verify(`${theme} reduced motion disables the secondary flow`, await paint(secondary, "::after"),
        (data) => data.animation === "none" && data.opacity === "1");
      await verify(`${theme} selected Tab has a static website gradient`,
        await paint(home.page.locator('nav a[aria-current="page"]'), "::before"),
        (data) => data.image.includes("rgb(226, 40, 40)") && data.animation === "none");

      const touch = await createPage({ theme, scenario: "auth" });
      await touch.page.getByLabel("APP_TOKEN", { exact: true }).fill("synthetic-touch-check");
      const touchButton = touch.page.getByRole("button", { name: "Connect", exact: true });
      const box = await touchButton.boundingBox();
      await touch.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await verify(`${theme} coarse touch context does not start hover flow`,
        { style: await paint(touchButton), coarse: await touch.page.evaluate(() => matchMedia("(pointer: coarse)").matches) },
        (data) => data.coarse && data.style.animation === "none" && data.style.image.includes("linear-gradient"));
    }
  });

  await runCheck("appearance", "Both palettes preserve pages, Portal focus and 320px header controls", async () => {
    for (const theme of ["dark", "light"]) {
      const environment = await createPage({ theme, viewport: { width: 320, height: 740 } });
      const { page } = environment;
      for (const path of ["/", "/docker", "/vm", "/storage"]) {
        await page.locator(`nav a[href="${path}"]`).click();
        await ready(environment, path);
        const rendered = await page.evaluate(() => ({
          theme: document.documentElement.dataset.theme,
          background: getComputedStyle(document.body).backgroundColor,
          foreground: getComputedStyle(document.querySelector("main")).color,
          chrome: document.querySelector('meta[name="theme-color"]').content,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }));
        await verify(`${theme} ${path} resolves official page colors without overflow`, rendered,
          (data) => data.theme === theme && !data.overflow
            && data.background === (theme === "dark" ? "rgb(23, 23, 23)" : "rgb(241, 236, 227)")
            && data.foreground === (theme === "dark" ? "rgb(255, 255, 255)" : "rgb(23, 23, 23)")
            && data.chrome === (theme === "dark" ? "#171717" : "#F1ECE3"));
        await screenshot(environment, `${theme}-${path.slice(1) || "home"}-page`);
      }
      await page.getByRole("button", { name: "Appearance", exact: true }).click();
      await page.waitForFunction(() => {
        const rect = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
        return rect && rect.bottom <= innerHeight + 1;
      });
      await screenshot(environment, `${theme}-appearance-sheet`);
      const next = theme === "dark" ? "light" : "dark";
      const dialog = await page.getByRole("dialog", { name: "Appearance", exact: true }).elementHandle();
      await page.locator(`input[name="appearance"][value="${next}"]`).check();
      await verify(`${theme} palette replacement does not interpolate foreground and background`,
        await page.evaluate(() => ({
          colorTransitions: document.getAnimations().filter((animation) =>
            animation instanceof CSSTransition && /color|fill|stroke|box-shadow/.test(animation.transitionProperty)
            && animation.playState !== "finished").map((animation) => animation.transitionProperty),
          navigation: getComputedStyle(document.querySelector('nav a[aria-current="page"]')).color,
        })), (data) => data.colorTransitions.length === 0
          && data.navigation === (next === "dark" ? "rgb(255, 140, 47)" : "rgb(241, 90, 44)"));
      await verify(`${theme} selection keeps the Portal and focused native radio`, await page.evaluate((original) => ({
        same: original === document.querySelector('[role="dialog"]'),
        theme: document.documentElement.dataset.theme,
        focused: document.activeElement?.getAttribute("value"),
      }), dialog), (data) => data.same && data.theme === next && data.focused === next);
      await page.keyboard.press("ArrowDown");
      await verify(`${theme} radio group accepts native keyboard selection`, await page.evaluate(() => ({
        value: document.activeElement?.getAttribute("value"),
        checked: document.activeElement?.checked,
      })), (data) => data.checked && data.value === (next === "dark" ? "light" : "system"));
      await page.getByRole("button", { name: "Close sheet" }).click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.evaluate(() => sessionStorage.setItem("unraid-mobile.app-token", "synthetic-theme-header"));
      await page.reload();
      await ready(environment, "/storage");
      await verify(`${theme} authenticated header has three 44px controls with room for identity`,
        await page.evaluate(() => ({
          buttons: [...document.querySelectorAll("header button")].map((node) => {
            const rect = node.getBoundingClientRect();
            return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
          }),
          identity: document.querySelector("h1").getBoundingClientRect().width,
          overflow: document.documentElement.scrollWidth > innerWidth,
        })), (data) => data.buttons.length === 3 && data.identity > 100 && !data.overflow
          && data.buttons.every((button) => button.width >= 44 && button.height >= 44 && button.left >= 0 && button.right <= 320));
      await screenshot(environment, `${theme}-320-header`);
      await page.setViewportSize({ width: 844, height: 390 });
      await page.getByRole("button", { name: "Appearance", exact: true }).click();
      await page.waitForFunction(() => {
        const rect = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
        return rect && rect.top >= 0 && rect.bottom <= innerHeight + 1;
      });
      await verify(`${theme} landscape Sheet scrolls within the viewport`,
        await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]').getBoundingClientRect();
          const body = document.querySelector("[data-sheet-body]");
          return { top: dialog.top, bottom: dialog.bottom, height: innerHeight,
            scrollable: getComputedStyle(body).overflowY === "auto",
            overflow: document.documentElement.scrollWidth > innerWidth };
        }), (data) => data.top >= -1 && data.bottom <= data.height + 1 && data.scrollable && !data.overflow);
      await page.getByRole("button", { name: "Close sheet" }).click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.setViewportSize({ width: 320, height: 740 });
      await page.locator("summary").filter({ hasText: "Disks" }).first().click();
      await page.getByRole("button", { name: /disk1/i }).click();
      await verify(`${theme} disk detail Portal uses the active surface and retains status text`,
        await page.getByRole("dialog").evaluate((node) => ({
          background: getComputedStyle(node).backgroundColor,
          text: node.textContent,
        })), (data) => data.background === (theme === "dark" ? "rgb(43, 42, 41)" : "rgb(255, 255, 255)")
          && data.text.includes("Active") && data.text.includes("35"));
      await page.waitForFunction(() => {
        const rect = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
        return rect && rect.bottom <= innerHeight + 1;
      });
      await screenshot(environment, `${theme}-disk-detail`);
    }
  });

  await runCheck("appearance-session", "Authentication and offline cold startup use both saved palettes", async () => {
    for (const theme of ["dark", "light"]) {
      for (const scenario of ["auth", "offline"]) {
        const environment = await createPage({ theme, scenario, viewport: { width: 320, height: 740 } });
        const state = await environment.page.evaluate(() => ({
          theme: document.documentElement.dataset.theme,
          background: getComputedStyle(document.body).backgroundColor,
          surface: getComputedStyle(document.querySelector("main section")).backgroundColor,
          chrome: document.querySelector('meta[name="theme-color"]').content,
          routerMounted: !!document.querySelector("nav"),
          overflow: document.documentElement.scrollWidth > innerWidth,
        }));
        await verify(`${theme} ${scenario} paints before protected consumers mount`, {
          ...state, business: environment.requests.filter(({ path }) => path.startsWith("/api/")).map(({ path }) => path),
        }, (data) => data.theme === theme && !data.routerMounted && !data.overflow
          && data.background === (theme === "dark" ? "rgb(23, 23, 23)" : "rgb(241, 236, 227)")
          && data.surface === (theme === "dark" ? "rgb(43, 42, 41)" : "rgb(255, 255, 255)")
          && data.chrome === (theme === "dark" ? "#171717" : "#F1ECE3")
          && data.business.length === 1 && data.business[0] === "/api/v1/capabilities");
        await screenshot(environment, `${theme}-${scenario}`);
      }
    }
  });

  await runCheck("appearance-transition", "System palette changes cancel a native snapshot and retain committed navigation", async () => {
    const environment = await createPage({ theme: "system" });
    await environment.page.emulateMedia({ colorScheme: "dark" });
    await recording(environment, true);
    await swipe(environment, 1);
    await environment.page.waitForFunction(() => window.__tabCheck.frozen);
    const before = streamStats(environment.transport);
    await environment.page.emulateMedia({ colorScheme: "light" });
    await ready(environment, "/docker");
    await verify("OS theme changes remove the old screenshot and preserve live transports",
      await environment.page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        marker: document.documentElement.dataset.tabTransition ?? null,
        animated: document.getAnimations().filter((animation) =>
          String(animation.effect?.pseudoElement).includes("view-transition")).length,
        contentLayers: document.querySelectorAll("[data-tab-content]").length,
      })), (data) => data.theme === "light" && !data.marker && data.animated === 0 && data.contentLayers === 1);
    await verify("Palette changes retain the single stream", { before, after: streamStats(environment.transport) },
      (data) => data.before.opens === data.after.opens && data.after.active === 1 && data.after.maxActive === 1);
    await consistent(environment, "/docker");
    await screenshot(environment, "live-light-after-native-cancel");
  });

  if (process.env.CHECK_PWA === "1") {
    await runCheck("appearance-pwa", "Real waiting updates and offline shell retain both palettes", async () => {
      for (const theme of ["dark", "light"]) {
        const context = await browser.newContext({ viewport: { width: 320, height: 740 },
          hasTouch: true, isMobile: true, serviceWorkers: "allow", reducedMotion: "reduce" });
        await context.addInitScript((value) => localStorage.setItem("unraid-mobile.theme", value), theme);
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const environment = { context, page, releaseChunk() {} };
        pages.add(environment);
        await page.goto(base.href, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => !!navigator.serviceWorker.controller);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => !!navigator.serviceWorker.controller);
        await page.getByRole("button", { name: "Appearance", exact: true }).waitFor();
        let navigations = 0;
        page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations++; });
        await page.evaluate(async () => {
          await fetch("/__test/new-worker", { method: "POST" });
          await (await navigator.serviceWorker.getRegistration()).update();
        });
        await page.getByRole("button", { name: "Refresh to update" }).waitFor();
        await verify(`${theme} real waiting banner has readable theme colors and 44px controls`,
          await page.evaluate(() => ({
            theme: document.documentElement.dataset.theme,
            background: getComputedStyle(document.querySelector('[role="status"]')).backgroundColor,
            buttons: [...document.querySelectorAll('[role="status"] button')].map((node) => {
              const rect = node.getBoundingClientRect();
              return { width: rect.width, height: rect.height };
            }),
            overflow: document.documentElement.scrollWidth > innerWidth,
          })), (data) => data.theme === theme && !data.overflow
            && data.background === (theme === "dark" ? "rgb(43, 42, 41)" : "rgb(255, 255, 255)")
            && data.buttons.every((button) => button.width >= 44 && button.height >= 44));
        await screenshot(environment, `${theme}-waiting-update`);
        await page.getByRole("button", { name: "Dismiss update" }).click();
        await verify(`${theme} dismissal keeps the waiting worker and current document`,
          await page.evaluate(async () => ({
            waiting: !!(await navigator.serviceWorker.getRegistration()).waiting,
            banner: !!document.querySelector('[aria-label="Refresh to update"]'),
          })), (data) => data.waiting && !data.banner && navigations === 0);
        await page.evaluate(async () => {
          await fetch("/__test/new-worker", { method: "POST" });
          await (await navigator.serviceWorker.getRegistration()).update();
        });
        await page.getByRole("button", { name: "Refresh to update" }).waitFor();
        await page.getByRole("button", { name: "Refresh to update" }).click();
        await page.waitForFunction(() => !!navigator.serviceWorker.controller
          && !document.querySelector('[aria-label="Refresh to update"]') && !!document.querySelector("nav"));
        await verify(`${theme} explicit update refreshes once and restores saved appearance`,
          { navigations, theme: await page.evaluate(() => document.documentElement.dataset.theme),
            waiting: await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting) },
          (data) => data.navigations === 1 && data.theme === theme && !data.waiting);
        await context.setOffline(true);
        const offline = await context.newPage();
        await offline.goto(new URL("/storage", base).href, { waitUntil: "domcontentloaded" });
        await offline.getByRole("button", { name: "Retry connection", exact: true }).waitFor();
        await verify(`${theme} real offline cold navigation loads only the application shell`,
          await offline.evaluate(async () => ({
            theme: document.documentElement.dataset.theme,
            navigation: !!document.querySelector("nav"),
            background: getComputedStyle(document.body).backgroundColor,
            cached: (await Promise.all((await caches.keys()).map(async (key) =>
              (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname)))).flat(),
          })), (data) => data.theme === theme && !data.navigation
            && data.background === (theme === "dark" ? "rgb(23, 23, 23)" : "rgb(241, 236, 227)")
            && data.cached.length > 0 && !data.cached.some((path) => path.startsWith("/api/") || path === "/healthz"));
        await screenshot({ page: offline }, `${theme}-offline-cold-storage`);
      }
    });
  }

  for (const [from, to, direction] of [
    ["/", "/docker", 1], ["/docker", "/", -1], ["/docker", "/vm", 1],
    ["/vm", "/docker", -1], ["/vm", "/storage", 1], ["/storage", "/vm", -1],
  ]) {
    const id = `native-${from.slice(1) || "home"}-${to.slice(1) || "home"}`;
    await runCheck(id, "Adjacent native old/new live direction and one real route", async () => {
      const environment = await createPage({ path: from, longStorage: from === "/storage" || to === "/storage" });
      await recording(environment, true);
      const before = await observations(environment);
      const point = await swipe(environment, direction);
      await environment.page.waitForFunction(() => window.__tabCheck.frozen);
      const data = await observations(environment);
      currentCheck.data = { before, point, ...data };
      const live = data.frames.filter((frame) => frame.native.length === 2
        && frame.native.every((animation) => animation.state === "running")
        && frame.old.opacity > 0 && frame.old.opacity < 1 && frame.new.opacity > 0 && frame.new.opacity < 1);
      await verify("Unpaused real overlapping pseudo-element frames", live,
        (frames) => frames.length >= 1);
      await verify("Old/new displacement signs", live,
        (frames) => frames.every((frame) => frame.old.x * direction < 0 && frame.new.x * direction > 0));
      await verify("Native path never stacks Motion on real content", live,
        (frames) => frames.every((frame) => Math.abs(frame.motion.x) < 0.01 && frame.motion.opacity === 1));
      const clip = await environment.page.evaluate(() => ({
        bottom: innerHeight - parseFloat(document.documentElement.style.getPropertyValue("--tab-clip-bottom")),
        navTop: document.querySelector("nav").getBoundingClientRect().top,
      }));
      const nativeFrame = live.at(-1);
      const unionBottom = Math.min(clip.navTop, nativeFrame.rect.top
        + Math.max(nativeFrame.old.height, nativeFrame.new.height));
      currentCheck.clip = { ...clip, unionBottom };
      await verify("Clip includes old/new union and excludes bottom navigation", currentCheck.clip,
        (value) => Math.abs(value.bottom - value.unionBottom) < 1 && value.bottom <= value.navTop + 0.5);
      await verify("Only one main and one real content layer", data.mutations,
        (frames) => frames.length > 0 && frames.every((frame) =>
          frame.main === 1 && frame.content === 1 && frame.visibleChildren <= 1));
      await verify("Input was native trusted touch", data.touches,
        (touches) => touches.some((touch) => touch.name === "pointerup") && touches.every((touch) => touch.trusted));
      await screenshot(environment, "mid-90ms");
      const oldOnly = await environment.page.addStyleTag({ content: `
        html::view-transition-old(tab-content) { opacity: 1 !important; }
        html::view-transition-new(tab-content) { opacity: 0 !important; }` });
      const oldImage = await screenshot(environment, "old-only");
      await oldOnly.evaluate((node) => node.remove());
      const newOnly = await environment.page.addStyleTag({ content: `
        html::view-transition-old(tab-content) { opacity: 0 !important; }
        html::view-transition-new(tab-content) { opacity: 1 !important; }` });
      const newImage = await screenshot(environment, "new-only");
      await newOnly.evaluate((node) => node.remove());
      currentCheck.isolatedImages = { oldImage, newImage };
      await verify("Old/new isolated screenshots contain different rendered pixels", { oldImage, newImage },
        (value) => value.oldImage.hash !== value.newImage.hash);
      await unfreeze(environment);
      await ready(environment, to);
      await consistent(environment, to);
      const final = await observations(environment);
      await verify("One History push per swipe", final.histories.filter((event) => event.kind === "pushState"),
        (events) => events.length === 1);
      currentCheck.stream = streamStats(environment.transport);
      await verify("One live System SSE through navigation", currentCheck.stream,
        (value) => value.opens === 1 && value.active === 1 && value.maxActive === 1);
      currentCheck.final = final;
    });
  }

  await runCheck("bottom-interruption", "Bottom click interrupts native visuals; busy swipes are ignored", async () => {
    const environment = await createPage();
    await recording(environment, true);
    await swipe(environment, 1);
    await environment.page.waitForFunction(() => window.__tabCheck.frozen);
    await swipe(environment, 1);
    const busy = await observations(environment);
    await verify("Busy swipe does not queue or push History", busy,
      (value) => value.path === "/docker" && value.histories.filter((event) => event.kind === "pushState").length === 1);
    const link = environment.page.getByRole("navigation").getByRole("link", { name: "Storage", exact: true });
    const hit = await link.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("a") === node;
    });
    await verify("Native overlay does not intercept bottom Link", hit, (value) => value === true);
    await nativeClick(environment, link);
    await ready(environment, "/storage");
    await consistent(environment, "/storage");
    await screenshot(environment, "final");
    const final = await observations(environment);
    await verify("Interrupted transaction leaves no pseudo animations or marker", await environment.page.evaluate(() => ({
      marker: document.documentElement.dataset.tabTransition ?? null,
      animations: document.getAnimations().filter((animation) => animation.effect?.pseudoElement?.includes("tab-content")).length,
    })), (value) => value.marker === null && value.animations === 0);
    currentCheck.data = { busy, final };
  });

  await runCheck("slow-chunk", "Real lazy chunk delayed beyond 350ms: pending, no frozen snapshot, one navigation", async () => {
    const environment = await createPage({ delayed: true });
    await recording(environment);
    const initialHistory = await environment.page.evaluate(() => history.length);
    await swipe(environment, 1);
    await environment.page.waitForFunction(() => window.__tabCheck.frames.some((frame) => frame.marker));
    await environment.page.waitForFunction(() => {
      const state = window.__tabCheck;
      return state.frames.some((frame) => frame.marker) && !document.documentElement.dataset.tabTransition;
    });
    await environment.page.getByText("Loading page…", { exact: true }).waitFor();
    const pending = await observations(environment);
    await screenshot(environment, "pending-after-budget");
    const start = pending.frames.find((frame) => frame.marker)?.at;
    const skipped = pending.frames.find((frame) => frame.at > start && !frame.marker)?.at;
    await verify("Capture budget actually skips after approximately 350ms", skipped - start,
      (value) => value >= 300 && value < 550);
    await verify("Pending is visible, not a native captured target", pending.frames.at(-1),
      (value) => value.pending && value.native.length === 0 && !value.marker);
    await swipe(environment, 1);
    environment.releaseChunk();
    await ready(environment, "/docker");
    const final = await observations(environment);
    await verify("A real Docker route chunk was requested exactly once", environment.requests.filter((request) =>
      /\/assets\/DockerPage-.*\.js$/.test(request.path)), (requests) => requests.length === 1);
    await verify("Timeout navigates once even after chunk resumes", {
      pushes: final.histories.filter((event) => event.kind === "pushState").length,
      growth: final.historyLength - initialHistory,
    }, (value) => value.pushes === 1 && value.growth === 1);
    await verify("No expired native or Motion entry replay after late commit", final.frames.filter((frame) =>
      frame.heading === "Docker" && !frame.pending),
    (frames) => frames.length > 0 && frames.every((frame) =>
      frame.native.length === 0 && frame.motion.x === 0 && frame.motion.opacity === 1));
    await consistent(environment, "/docker");
    await screenshot(environment, "final");
    currentCheck.data = { start, skipped, pending, final, requests: environment.requests };
  });

  for (const [from, to, direction] of [["/", "/docker", 1], ["/vm", "/docker", -1]]) {
    await runCheck(`motion-${direction > 0 ? "forward" : "backward"}`, "Native missing: real directional Motion entry frames", async () => {
      const environment = await createPage({ path: from, nativeMissing: true });
      await recording(environment);
      const stop = await screencast(environment);
      await swipe(environment, direction);
      await ready(environment, to);
      const data = await observations(environment);
      data.paintedFrames = await stop();
      data.paintedFrames = data.paintedFrames.map((paint) => ({
        ...paint, precedingDOM: data.frames.findLast((frame) => frame.at <= paint.at + 0.5),
      }));
      currentCheck.data = data;
      const live = data.frames.filter((frame) => frame.heading === "Docker"
        && frame.motion.opacity > 0 && frame.motion.opacity < 1 && Math.abs(frame.motion.x) > 0.01);
      await verify("Real Motion DOM intermediate frames exist with expected direction", live,
        (frames) => frames.length >= 2 && frames.every((frame) => frame.motion.x * direction > 0));
      const first = data.paintedFrames.find((paint) => paint.precedingDOM?.heading === "Docker"
        && !paint.precedingDOM.pending);
      assert(first, "Missing compositor capture of the first target frame");
      const finalImage = await screenshot(environment, "final");
      data.firstPaintPixels = await paintedOpacity(environment, first.path, finalImage.path,
        first.precedingDOM.rect.top);
      data.firstPaintPixels.path = first.path;
      await verify("First compositor target frame is already faded; no opaque flash before entry",
        data.firstPaintPixels, (value) => value.opacity >= 0 && value.opacity < 0.9);
      data.firstDOMFrame = data.frames.find((frame) => frame.heading === "Docker" && !frame.pending);
      data.firstFrameNote = "A neutral rAF style read may precede Motion's write in the same frame. The compositor pixels, not that early DOM read, determine visible flashing.";
      await verify("Fallback does not create native pseudo animations", data.frames,
        (frames) => frames.every((frame) => frame.native.length === 0));
      await consistent(environment, to);
    });
  }

  await runCheck("reduced-dynamic", "Dynamic reduced-motion interrupts native and still permits touch navigation", async () => {
    const environment = await createPage();
    await recording(environment, true);
    await swipe(environment, 1);
    await environment.page.waitForFunction(() => window.__tabCheck.frozen);
    await environment.page.emulateMedia({ reducedMotion: "reduce" });
    await ready(environment, "/docker");
    const stopped = await observations(environment);
    await recording(environment);
    await swipe(environment, 1);
    await ready(environment, "/vm");
    const reduced = await observations(environment);
    await verify("Reduced-motion swipes perform no position or opacity animation", reduced.frames,
      (frames) => frames.length > 0 && frames.every((frame) =>
        frame.native.length === 0 && frame.motion.x === 0 && frame.motion.opacity === 1));
    await consistent(environment, "/vm");
    await environment.page.emulateMedia({ reducedMotion: "no-preference" });
    await recording(environment, true);
    await swipe(environment, -1);
    await environment.page.waitForFunction(() => window.__tabCheck.frozen);
    const restored = await observations(environment);
    await verify("Native visuals resume after preference turns off", restored.frames,
      (frames) => frames.some((frame) => frame.native.length === 2));
    await unfreeze(environment);
    await ready(environment, "/docker");
    currentCheck.data = { stopped, reduced, restored };
  });

  await runCheck("width-320", "320px native and fallback have no horizontal overflow", async () => {
    for (const nativeMissing of [false, true]) {
      const environment = await createPage({ nativeMissing, viewport: { width: 320, height: 740 } });
      await recording(environment);
      await swipe(environment, 1);
      await ready(environment, "/docker");
      const data = await observations(environment);
      await verify(`${nativeMissing ? "Motion" : "Native"} viewport never horizontally overflows`, data.frames,
        (frames) => frames.length > 0 && frames.every((frame) => frame.scrollWidth <= frame.viewport[0]));
      currentCheck[nativeMissing ? "motion" : "native"] = data;
      await screenshot(environment, nativeMissing ? "motion-final" : "native-final");
    }
  });

  await runCheck("geometry-long-short", "Long/short natural snapshot ratios, no group resize, snapshots stay above nav", async () => {
    const environment = await createPage();
    await recording(environment, true);
    await swipe(environment, 1);
    await environment.page.waitForFunction(() => window.__tabCheck.frozen);
    const data = await observations(environment);
    const frame = data.frames.findLast((item) => item.native.length === 2);
    currentCheck.data = data;
    await verify("Different-height snapshots keep their own natural heights", frame,
      (value) => value.old.height > value.new.height + 100 && Math.abs(value.old.width - value.new.width) < 1);
    await verify("Group default geometry interpolation is disabled", frame.groupAnimation,
      (value) => value === "none");
    const clip = await environment.page.evaluate(() => {
      const root = document.documentElement;
      const bottom = parseFloat(root.style.getPropertyValue("--tab-clip-bottom"));
      const nav = document.querySelector("nav").getBoundingClientRect();
      return { bottom, navTop: nav.top, height: innerHeight,
        pseudoClip: getComputedStyle(root, "::view-transition").clipPath };
    });
    await verify("Pseudo-layer clip excludes the entire bottom nav", clip,
      (value) => value.height - value.bottom <= value.navTop + 0.5 && value.pseudoClip !== "none");
    await screenshot(environment, "mid-native-nav");
    await unfreeze(environment);
    await ready(environment, "/docker");
    const natural = await environment.page.locator("[data-tab-content]").evaluate((node) => ({
      height: node.getBoundingClientRect().height, inlineHeight: node.style.height,
    }));
    await verify("New page ends at its natural short height", natural,
      (value) => value.inlineHeight === "" && Math.abs(value.height - frame.new.height) < 2);
  });

  await runCheck("data-details-no-replay", "SSE refresh, REST refresh, and details expansion never replay route entry", async () => {
    const environment = await createPage();
    await recording(environment);
    environment.transport.system = { ...environment.transport.system, cpuUsage: 47,
      timestamp: "2026-10-25T00:00:01Z" };
    environment.values["/api/v1/system"] = environment.transport.system;
    environment.transport.response.write(`event: system.metrics\ndata: ${JSON.stringify(environment.transport.system)}\n\n`);
    await environment.page.getByText("47.0%", { exact: true }).waitFor();
    await nativeClick(environment, environment.page.getByRole("button", { name: "Refresh status", exact: true }));
    await environment.page.waitForFunction(() => window.__tabCheck.frames.length > 15);
    const refreshed = await observations(environment);
    await verify("Metrics refresh never triggers native or Motion entry", refreshed.frames,
      (frames) => frames.length > 0 && frames.every((frame) =>
        !frame.marker && frame.native.length === 0 && frame.motion.x === 0 && frame.motion.opacity === 1));
    await navigate(environment, "/storage");
    await recording(environment);
    const summary = environment.page.locator("summary").filter({ hasText: "Disks" }).first();
    await nativeClick(environment, summary);
    await environment.page.getByRole("button", { name: /disk1/i }).waitFor();
    await environment.page.waitForFunction(() => window.__tabCheck.frames.length > 12);
    const expanded = await observations(environment);
    await verify("Details expansion never triggers route entry", expanded.frames,
      (frames) => frames.every((frame) => !frame.marker && frame.native.length === 0
        && frame.motion.x === 0 && frame.motion.opacity === 1));
    await verify("Single stream survives all non-route updates", streamStats(environment.transport),
      (value) => value.maxActive === 1 && value.active === 1);
    currentCheck.data = { refreshed, expanded, stream: {
      opens: environment.transport.opens, maxActive: environment.transport.maxActive, active: environment.transport.active,
    } };
  });

  await runCheck("blank-gap-gestures", "VM true blank area and Storage bottom spacing accept native touch swipe", async () => {
    const environment = await createPage({ path: "/vm", longStorage: true });
    await recording(environment);
    const blank = await swipe(environment, 1, { mode: "blank" });
    await ready(environment, "/storage");
    await nativeClick(environment, environment.page.locator("summary").filter({ hasText: "Disks" }).first());
    await environment.page.getByRole("button", { name: /disk8/i }).waitFor();
    await environment.cdp.send("Input.synthesizeScrollGesture", {
      x: 180, y: 600, yDistance: -1500, gestureSourceType: "touch", speed: 1800,
    });
    await environment.page.waitForFunction(() => scrollY > 0);
    await recording(environment);
    const gap = await swipe(environment, -1, { mode: "gap" });
    await ready(environment, "/vm");
    await consistent(environment, "/vm");
    const data = await observations(environment);
    await verify("Both whitespace gesture origins are real main pixels", { blank, gap },
      (value) => ["MAIN", "DIV"].includes(value.blank.hit) && value.gap.y <= value.gap.main.bottom
        && value.gap.y > value.gap.main.bottom - 33);
    currentCheck.data = { blank, gap, ...data };
  });

  await runCheck("rotation-during-capture", "Viewport rotation during delayed capture falls back without displacement", async () => {
    const environment = await createPage({ delayed: true });
    await recording(environment);
    await swipe(environment, 1);
    await environment.chunkRequested;
    const timeOrigin = await environment.page.evaluate(() => performance.timeOrigin);
    const timing = { resizeRequestedAt: Date.now() - timeOrigin };
    await environment.page.setViewportSize({ width: 844, height: 390 });
    timing.firstResizeReturnedAt = Date.now() - timeOrigin;
    await environment.page.waitForFunction(() => innerWidth === 844
      && !document.documentElement.dataset.tabTransition);
    await environment.page.setViewportSize({ width: 812, height: 375 });
    await environment.page.waitForFunction(() => innerWidth === 812);
    timing.chunkReleasedAt = Date.now() - timeOrigin;
    environment.releaseChunk();
    await ready(environment, "/docker");
    const data = await observations(environment);
    const visible = data.frames.filter((frame) => frame.heading === "Docker" && !frame.pending);
    await verify("Rotation rejects dual native snapshots", visible,
      (frames) => frames.length > 0 && frames.every((frame) => frame.native.length === 0));
    const markerStart = data.lifecycle.find((event) => event.name === "marker" && event.marker)?.at;
    const markerEnd = data.lifecycle.find((event) => event.name === "marker"
      && event.previous && !event.marker)?.at;
    const deadlineReached = markerEnd - markerStart >= 340;
    currentCheck.timing = { ...timing, markerStart, markerEnd, captureMs: markerEnd - markerStart,
      policy: deadlineReached ? "deadline-neutral" : "geometry-opacity" };
    await verify("Rotation policy matches capture timing: geometry opacity or expired neutral", visible,
      (frames) => frames.length > 0 && frames.every((frame) => frame.motion.x === 0)
        && (deadlineReached ? frames.every((frame) => frame.motion.opacity === 1)
          : frames.some((frame) => frame.motion.opacity > 0 && frame.motion.opacity < 1)));
    await consistent(environment, "/docker");
    currentCheck.data = data;
    await screenshot(environment, "landscape-final");
  });

  await runCheck("scroll-geometry", "Scrolled old page to top-restored new page uses opacity-only geometry fallback", async () => {
    const environment = await createPage();
    await environment.cdp.send("Input.synthesizeScrollGesture", {
      x: 180, y: 620, yDistance: -300, gestureSourceType: "touch", speed: 1800,
    });
    await environment.page.waitForFunction(() => scrollY > 100);
    await recording(environment);
    await swipe(environment, 1);
    await ready(environment, "/docker");
    const data = await observations(environment);
    const visible = data.frames.filter((frame) => frame.heading === "Docker" && !frame.pending);
    await verify("Scroll restoration rejects mismatched native geometry", visible,
      (frames) => frames.length > 0 && frames.every((frame) => frame.native.length === 0));
    await verify("Scrolled geometry fallback uses no horizontal displacement", visible,
      (frames) => frames.some((frame) => frame.motion.opacity > 0 && frame.motion.opacity < 1)
        && frames.every((frame) => frame.motion.x === 0));
    currentCheck.data = data;
  });

  await runCheck("deadline-then-resize", "Deadline-suppressed pending navigation stays neutral through repeated resize", async () => {
    const environment = await createPage({ delayed: true });
    await recording(environment);
    await swipe(environment, 1);
    await environment.chunkRequested;
    await environment.page.waitForFunction(() => window.__tabCheck.frames.some((frame) => frame.marker)
      && !document.documentElement.dataset.tabTransition);
    await environment.page.getByText("Loading page…", { exact: true }).waitFor();
    await screenshot(environment, "pending");
    await environment.page.setViewportSize({ width: 844, height: 390 });
    await environment.page.waitForFunction(() => innerWidth === 844);
    await environment.page.setViewportSize({ width: 812, height: 375 });
    await environment.page.waitForFunction(() => innerWidth === 812);
    environment.releaseChunk();
    await ready(environment, "/docker");
    const data = await observations(environment);
    const visible = data.frames.filter((frame) => frame.heading === "Docker" && !frame.pending);
    await verify("Late commit after deadline and resize never replays visuals", visible,
      (frames) => frames.length > 0 && frames.every((frame) =>
        frame.native.length === 0 && frame.motion.x === 0 && frame.motion.opacity === 1));
    await verify("Repeated resize and late commit keep one History push", data.histories,
      (events) => events.filter((event) => event.kind === "pushState").length === 1);
    await consistent(environment, "/docker");
    currentCheck.data = data;
    await screenshot(environment, "final");
  });

  await runCheck("endpoints-same-route", "Endpoint swipes and same-tab activation do not navigate or animate", async () => {
    const environment = await createPage();
    await recording(environment);
    await swipe(environment, -1);
    await nativeClick(environment, environment.page.getByRole("navigation").getByRole("link", { name: "Home", exact: true }));
    await environment.page.waitForFunction(() => window.__tabCheck.frames.length > 12);
    const home = await observations(environment);
    await verify("Home endpoint and same Tab preserve route/history/neutral visuals", home,
      (value) => value.path === "/" && value.histories.filter((event) => event.kind === "pushState").length === 0
        && value.frames.every((frame) => !frame.marker && frame.motion.x === 0 && frame.motion.opacity === 1));
    await navigate(environment, "/storage");
    await recording(environment);
    await swipe(environment, 1);
    await environment.page.waitForFunction(() => window.__tabCheck.frames.length > 12);
    const storage = await observations(environment);
    await verify("Storage endpoint does not navigate or animate", storage,
      (value) => value.path === "/storage" && value.histories.filter((event) => event.kind === "pushState").length === 0
        && value.frames.every((frame) => !frame.marker && frame.motion.x === 0 && frame.motion.opacity === 1));
    currentCheck.data = { home, storage };
  });
} catch (error) {
  results.errors.push({ check: "harness", message: error.stack });
} finally {
  for (const environment of pages) {
    environment.releaseChunk();
    await environment.context.close();
  }
  await browser?.close();
  for (const transport of transports.values()) transport.response?.end();
  streamServer.closeAllConnections();
  await new Promise((accept) => streamServer.close(accept));
  await persist();
}
if (results.summary.failed || results.errors.length) process.exitCode = 1;
console.log(JSON.stringify({ versions: results.versions, summary: results.summary, errors: results.errors, reportPath }, null, 2));

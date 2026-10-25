import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.CHECK_BASE_URL ?? "http://127.0.0.1:18081";
const report = { checks: [], errors: [], startedAt: new Date().toISOString() };
const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
let diagnosticPage;

// connect authenticates against a local synthetic production-handler fixture.
async function connect(width = 390, reducedMotion = "no-preference") {
  const context = await browser.newContext({
    viewport: { width, height: 740 }, hasTouch: true, isMobile: true,
    reducedMotion, serviceWorkers: "block",
  });
  const page = await context.newPage();
  diagnosticPage = page;
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.goto(base);
  await page.getByLabel("APP_TOKEN", { exact: true }).fill("disposable-ui-test");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.locator("nav").waitFor();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => {
    window.touchTrace = [];
    window.touchScrollChecks = [];
    // Bubble observation runs after the Shell's native touchmove capture guard.
    window.addEventListener("touchmove", (event) => window.touchScrollChecks.push({
      prevented: event.defaultPrevented, cancelable: event.cancelable,
    }), { passive: true });
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture", "click"]) {
      window.addEventListener(type, (event) => window.touchTrace.push({
        type, x: event.clientX, y: event.clientY, id: event.pointerId,
        pointerType: event.pointerType, primary: event.isPrimary,
        target: event.target.outerHTML?.slice(0, 150), path: location.pathname,
      }), true);
    }
  });
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

// point chooses a visible main area that is not a native interactive control.
async function point(page) {
  await page.evaluate(() => scrollTo(0, 0));
  return page.evaluate(() => {
    const main = document.querySelector("main").getBoundingClientRect();
    for (let y = main.top + 25; y < Math.min(main.bottom, innerHeight - 90); y += 15) {
      const x = innerWidth / 2;
      const target = document.elementFromPoint(x, y);
      if (target && document.querySelector("main").contains(target)
        && !target.closest("a,button,summary,input,select,textarea,[contenteditable]")) return { x, y };
    }
    throw new Error("No non-interactive main point");
  });
}

// touch sends native Chrome input so default scrolling and click synthesis run.
async function touch(cdp, start, dx, dy = 0, end = "touchEnd") {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  for (let step = 1; step <= 14; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: start.x + dx * step / 14, y: start.y + dy * step / 14 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: end, touchPoints: [] });
}

// route verifies the URL, selected item and only one mounted main after a gesture.
async function route(page, path) {
  await page.waitForFunction((path) => location.pathname === path
    && document.querySelector("nav a[aria-current=page]")?.getAttribute("href") === path, path);
  assert.equal(await page.locator("main").count(), 1);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// navPoint resolves a real bottom link center for native touch.
async function navPoint(page, label) {
  const box = await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// openSheet exposes a real disk and waits for its animated panel to settle.
async function openSheet(page) {
  const summary = page.getByText(/^Disks \(/);
  if (!await summary.evaluate((node) => node.parentElement.open)) await summary.click();
  await page.getByRole("button", { name: "View disk1 details", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForFunction(() => document.querySelector("[role=dialog]")?.getBoundingClientRect().bottom <= innerHeight + 1);
}

try {
  const run = await connect();
  const { page, cdp } = run;
  const requests = [];
  page.on("request", (request) => { if (request.url().includes("/api/")) requests.push(new URL(request.url()).pathname); });
  await page.evaluate(() => {
    window.tabChecks = { main: document.querySelector("main"), fades: [] };
    // sample records actual rendered opacity rather than Motion function calls.
    function sample() {
      const main = document.querySelector("main");
      const opacity = main ? Number(getComputedStyle(main).opacity) : 1;
      if (opacity < 1) window.tabChecks.fades.push({ path: location.pathname, opacity, time: performance.now() });
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  assert.equal(await page.locator("main").evaluate((main) => getComputedStyle(main).opacity), "1");
  report.checks.push("Initial entry has no fade");
  for (const path of ["/docker", "/vm", "/storage"]) {
    await touch(cdp, await point(page), -100);
    await route(page, path);
  }
  for (const path of ["/vm", "/docker", "/"]) {
    await touch(cdp, await point(page), 100);
    await route(page, path);
  }
  report.checks.push("Native main touch switches all six adjacent destinations");
  assert.equal(await page.evaluate(() => window.tabChecks.main === document.querySelector("main")), true);
  assert.equal(await page.evaluate(() => window.tabChecks.fades.some(({ opacity }) => opacity >= 0.92 && opacity < 1)), true);
  report.checks.push("Stable single main shows real opacity entry frames");
  await page.waitForFunction(() => getComputedStyle(document.querySelector("main")).opacity === "1"
    && performance.now() - window.tabChecks.fades.at(-1).time > 300);
  const fadeCount = await page.evaluate(() => window.tabChecks.fades.length);
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(() => window.tabChecks.fades.length), fadeCount);
  report.checks.push("System updates do not replay the fade");
  const historyLength = await page.evaluate(() => history.length);
  await touch(cdp, await navPoint(page, "VM"), 70);
  await route(page, "/");
  assert.equal(await page.evaluate(() => history.length), historyLength);
  report.checks.push("Boundary bottom swipe does not navigate or add History");
  await touch(cdp, await navPoint(page, "Storage"), -80);
  await route(page, "/docker");
  report.checks.push("Bottom link swipe navigates once without activating the touched link");
  await page.getByRole("navigation").getByRole("link", { name: "Storage", exact: true }).tap();
  await route(page, "/storage");
  report.checks.push("A fresh bottom tap still works after a swipe");
  await page.goBack();
  await route(page, "/docker");
  await page.goForward();
  await route(page, "/storage");
  report.checks.push("History back/forward keeps content and active navigation aligned");
  const mainPoint = await point(page);
  await touch(cdp, { ...mainPoint, x: 10 }, 120);
  await route(page, "/storage");
  report.checks.push("Viewport edge touch does not trigger Tab navigation");
  await touch(cdp, mainPoint, 120, 0, "touchCancel");
  await route(page, "/storage");
  report.checks.push("Native touchCancel discards Tab navigation");
  await page.getByText(/^Disks \(/).click();
  await page.evaluate(() => scrollTo(0, 0));
  const previousScroll = await page.evaluate(() => scrollY);
  await touch(cdp, await point(page), 0, -140);
  await page.waitForFunction((previous) => scrollY > previous, previousScroll);
  await route(page, "/storage");
  report.checks.push("Native vertical body scrolling preserves the selected Tab");
  assert.equal(await page.evaluate(() => window.touchScrollChecks.at(-1).prevented), false);
  // Start within a scrolled content area: this differs from the fixed bottom bar.
  // Let the preceding vertical flick's inertia finish before measuring drift.
  await page.evaluate(async () => {
    let previous = scrollY;
    let stable = 0;
    for (let frame = 0; frame < 180 && stable < 8; frame++) {
      await new Promise(requestAnimationFrame);
      stable = scrollY === previous ? stable + 1 : 0;
      previous = scrollY;
    }
    if (stable < 8) throw new Error("Vertical flick did not settle");
  });
  await page.evaluate(() => { scrollTo(0, 80); window.touchScrollChecks = []; });
  const driftStart = await page.evaluate(() => {
    for (let y = 180; y < innerHeight - 120; y += 20) {
      const target = document.elementFromPoint(160, y);
      if (target && document.querySelector("main").contains(target)
        && !target.closest("a,button,summary,input,select,textarea")) return { x: 160, y };
    }
    throw new Error("No scrolled content point");
  });
  const driftScroll = await page.evaluate(() => scrollY);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [driftStart] });
  for (let step = 1; step <= 14; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{
      x: driftStart.x + 100 * step / 14,
      y: driftStart.y + (step > 4 ? 30 * (step - 4) / 10 : 0),
    }] });
  }
  assert.equal(await page.evaluate(() => scrollY), driftScroll);
  assert.equal(await page.evaluate(() => window.touchScrollChecks.some(({ prevented }) => prevented)), true);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await route(page, "/vm");
  report.checks.push("Scrolled content reserves native horizontal touch with later vertical drift and navigates once");
  await page.getByRole("navigation").getByRole("link", { name: "Storage", exact: true }).tap();
  await route(page, "/storage");
  await page.evaluate(() => scrollTo(0, 0));
  await openSheet(page);
  let box = await page.locator("[data-sheet-body]").boundingBox();
  await touch(cdp, { x: box.x + 40, y: box.y + 75 }, 145, 5);
  await page.locator("[data-sheet-content]").waitFor({ state: "detached" });
  await route(page, "/storage");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "View disk1 details");
  assert.equal(await page.evaluate(() => document.body.hasAttribute("data-scroll-locked")), false);
  report.checks.push("Sheet right touch closes without changing Tab, restoring focus and scrolling");
  await page.getByRole("button", { name: "View disk1 details", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForFunction(() => document.querySelector("[role=dialog]")?.getBoundingClientRect().bottom <= innerHeight + 1);
  box = await page.locator("[data-sheet-handle]").boundingBox();
  await touch(cdp, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 0, 150);
  await page.locator("[data-sheet-content]").waitFor({ state: "detached" });
  await route(page, "/storage");
  report.checks.push("Existing Sheet handle drag still dismisses without changing Tab");
  assert.equal(requests.filter((url) => url.endsWith("/events")).length, 0);
  assert.equal(requests.filter((url) => url.endsWith("/capabilities")).length, 0);
  report.checks.push("Route switching adds no System SSE or capabilities requests");
  await run.context.close();

  const pending = await connect();
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  await pending.page.route("**/assets/VMPage-*.js", async (request) => { await gate; await request.continue(); });
  await pending.page.getByRole("navigation").getByRole("link", { name: "Docker", exact: true }).tap();
  await route(pending.page, "/docker");
  await touch(pending.cdp, await point(pending.page), -100);
  await pending.page.getByText("Loading page…", { exact: true }).waitFor();
  await touch(pending.cdp, await point(pending.page), -100);
  assert.equal(new URL(pending.page.url()).pathname, "/vm");
  await pending.page.getByRole("navigation").getByRole("link", { name: "Storage", exact: true }).tap();
  await route(pending.page, "/storage");
  release();
  await pending.page.waitForTimeout(300);
  await route(pending.page, "/storage");
  report.checks.push("Delayed real lazy chunk shows Router pending UI, rejects swipes, accepts superseding clicks");
  await pending.context.close();

  const reduced = await connect(320, "reduce");
  await touch(reduced.cdp, await point(reduced.page), -90);
  await route(reduced.page, "/docker");
  assert.equal(await reduced.page.locator("main").evaluate((main) => getComputedStyle(main).opacity), "1");
  assert.equal(await reduced.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  report.checks.push("320px reduced-motion view keeps Tab swipes and disables entry animation without overflow");
  await reduced.context.close();
  assert.deepEqual(report.errors, []);
  report.completedAt = new Date().toISOString();
} catch (error) {
  report.failure = error.message;
  if (diagnosticPage && !diagnosticPage.isClosed()) {
    report.trace = await diagnosticPage.evaluate(() => window.touchTrace);
    report.touchScrollChecks = await diagnosticPage.evaluate(() => window.touchScrollChecks);
    report.path = new URL(diagnosticPage.url()).pathname;
  }
  throw error;
} finally {
  await fs.writeFile(process.env.CHECK_REPORT_PATH ?? new URL("./browser-results.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));

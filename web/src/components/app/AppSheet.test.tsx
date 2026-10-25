// @vitest-environment jsdom
import { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AppSheet } from "./AppSheet";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// mountSheet exercises the real modal and focus lifecycle with a controlled host.
async function mountSheet(reduced = true) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let reduce = reduced;
  let closeCount = 0;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return reduce; },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const trigger = createRef<HTMLButtonElement>();
  // Harness keeps application controls outside the modal for focus assertions.
  function Harness() {
    const [open, setOpen] = useState(false);
    // changeOpen counts dismissal requests independently of the resulting state.
    function changeOpen(value: boolean) {
      if (!value) closeCount++;
      setOpen(value);
    }
    return <>
      <button ref={trigger} onClick={() => setOpen(true)}>Open details</button>
      <button>Background action</button>
      <AppSheet open={open} onOpenChange={changeOpen} title="Disk details"
        description="Current read-only sample" returnFocusRef={trigger}
        footer={<button>Footer action</button>}>
        <p>Read only</p><button>Body action</button>
        <label><input type="radio" name="appearance" /><span>Light</span></label>
      </AppSheet>
    </>;
  }
  await act(async () => root.render(<Harness />));
  disposers.push(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  await act(async () => trigger.current!.click());
  return {
    host, trigger,
    get closeCount() { return closeCount; },
    // setReduced delivers an operating-system preference change while open.
    async setReduced(value: boolean) {
      await act(async () => { reduce = value; listeners.forEach((listener) => listener()); });
    },
  };
}

// settleClose lets presence removal complete before checking restored focus.
async function settleClose(duration = 80) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, duration)); });
}

// pointer sends actual pointer events through the sheet's gesture listeners.
async function pointer(
  target: EventTarget, type: string, y: number, x = 10,
  pointerId = 1, isPrimary = true, pointerType = "mouse",
) {
  await act(async () => {
    const event = new MouseEvent(type, { bubbles: true, clientY: y, clientX: x, button: 0 });
    Object.defineProperties(event, {
      pointerType: { value: pointerType },
      pointerId: { value: pointerId },
      isPrimary: { value: isPrimary },
    });
    target.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 35));
  });
}

it("labels a modal dialog, focuses inside and locks background scrolling", async () => {
  const { host } = await mountSheet();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Disk details");
  expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("Current read-only sample");
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.body.getAttribute("data-scroll-locked")).toBe("1");
  expect(host.getAttribute("aria-hidden")).toBe("true");
  expect(dialog.textContent).toContain("Footer action");
  expect(dialog.querySelector('[data-sheet-body]')?.className).toContain("overflow-y-auto");
});

it.each(["button", "escape", "overlay"])("closes with %s and returns focus to an unfocused tap trigger", async (method) => {
  const { trigger } = await mountSheet();
  await act(async () => {
    if (method === "button") document.querySelector<HTMLButtonElement>('[aria-label="Close sheet"]')!.click();
    else if (method === "escape") document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    else {
      const overlay = document.querySelector("[data-sheet-overlay]")!;
      const event = new Event("pointerdown", { bubbles: true });
      Object.defineProperty(event, "pointerType", { value: "mouse" });
      overlay.dispatchEvent(event);
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  });
  await settleClose();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger.current);
  expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
});

it("contains attempted background focus until the modal closes", async () => {
  const { host } = await mountSheet();
  await act(async () => host.querySelectorAll<HTMLButtonElement>("button")[1].focus());
  expect(document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
});

it("disables handle dragging and translation when reduced motion is preferred", async () => {
  const sheet = await mountSheet();
  const handle = document.querySelector<HTMLElement>("[data-sheet-handle]")!;
  expect(handle.getAttribute("data-drag-enabled")).toBe("false");
  expect(handle.style.touchAction).not.toBe("none");
  expect(document.querySelector<HTMLElement>('[role="dialog"]')!.style.transform).not.toContain("translateY");
  await sheet.setReduced(false);
  expect(handle.getAttribute("data-drag-enabled")).toBe("true");
  await sheet.setReduced(true);
  expect(handle.getAttribute("data-drag-enabled")).toBe("false");
});

it("releases scroll locking and modal accessibility state on unmount", async () => {
  const { host } = await mountSheet();
  await disposers.pop()!();
  expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
  expect(host.hasAttribute("aria-hidden")).toBe(false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("snaps back a canceled downward gesture without dismissing", async () => {
  await mountSheet(false);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await pointer(document.querySelector("[data-sheet-handle]")!, "pointerdown", 0);
  await pointer(window, "pointermove", 140);
  expect(dialog.style.transform).toContain("140px");
  await pointer(window, "pointercancel", 140);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  expect(dialog.style.transform).not.toContain("140px");
});

it("cancels an old held gesture before closing and reopening", async () => {
  const { trigger } = await mountSheet(false);
  await pointer(document.querySelector("[data-sheet-handle]")!, "pointerdown", 0);
  await pointer(window, "pointermove", 140);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close sheet"]')!.click());
  await act(async () => trigger.current!.click());
  const reopened = document.querySelector('[role="dialog"]');
  await pointer(window, "pointermove", 160);
  await pointer(window, "pointerup", 160);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
  expect(document.querySelector('[role="dialog"]')).toBe(reopened);
});

it("closes after a right swipe in the body and restores focus and scrolling", async () => {
  const { trigger } = await mountSheet(false);
  await pointer(document.querySelector("[data-sheet-body] p")!, "pointerdown", 0);
  await pointer(window, "pointermove", 20, 150);
  await pointer(window, "pointerup", 20, 150);
  await settleClose(650);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  // Radix defers close autofocus until after presence has unmounted the dialog.
  await settleClose();
  expect(document.activeElement).toBe(trigger.current);
  expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
});

it.each([
  ["short", 30, 5],
  ["leftward", -150, 5],
  ["vertical", 20, 160],
  ["diagonal", 150, 160],
] as const)("keeps the sheet open after a %s body gesture", async (_name, x, y) => {
  await mountSheet(false);
  const dialog = document.querySelector('[role="dialog"]');
  await pointer(document.querySelector("[data-sheet-body] p")!, "pointerdown", 0);
  await pointer(window, "pointermove", y, x);
  await pointer(window, "pointerup", y, x);
  await settleClose();
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
});

it("keeps the sheet open after a canceled right swipe", async () => {
  await mountSheet(false);
  const dialog = document.querySelector('[role="dialog"]');
  await pointer(document.querySelector("[data-sheet-body] p")!, "pointerdown", 0);
  await pointer(window, "pointermove", 10, 150);
  await pointer(window, "pointercancel", 10, 150);
  await settleClose();
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
});

it.each(["[data-sheet-body] button", "[data-sheet-body] label span", "[data-sheet-handle]"])(
  "does not dismiss a right swipe that starts on %s", async (selector) => {
    const sheet = await mountSheet(false);
    const dialog = document.querySelector('[role="dialog"]');
    await pointer(document.querySelector(selector)!, "pointerdown", 0);
    await pointer(window, "pointermove", 0, 150);
    await pointer(window, "pointerup", 0, 150);
    await settleClose();
    expect(sheet.closeCount).toBe(0);
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  },
);

it("discards a held body swipe across closing and reopening", async () => {
  const { trigger } = await mountSheet(false);
  await pointer(document.querySelector("[data-sheet-body] p")!, "pointerdown", 0);
  await pointer(window, "pointermove", 0, 150);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close sheet"]')!.click());
  await act(async () => trigger.current!.click());
  const reopened = document.querySelector('[role="dialog"]');
  await pointer(window, "pointermove", 0, 180);
  await pointer(window, "pointerup", 0, 180);
  await settleClose(650);
  expect(document.querySelector('[role="dialog"]')).toBe(reopened);
});

it("discards a held swipe when reduced motion is enabled and then disabled", async () => {
  const sheet = await mountSheet(false);
  const dialog = document.querySelector('[role="dialog"]');
  await pointer(document.querySelector("[data-sheet-body] p")!, "pointerdown", 0);
  await pointer(window, "pointermove", 0, 150);
  await sheet.setReduced(true);
  await sheet.setReduced(false);
  await pointer(window, "pointerup", 0, 150);
  await settleClose();
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
});

it("does not dismiss a non-primary pointer's right swipe", async () => {
  await mountSheet(false);
  const dialog = document.querySelector('[role="dialog"]');
  await pointer(document.querySelector("[data-sheet-body] p")!, "pointerdown", 0, 10, 2, false);
  await pointer(window, "pointermove", 0, 150, 2, false);
  await pointer(window, "pointerup", 0, 150, 2, false);
  await settleClose();
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
});

it.each(["reopen", "preference change"])(
  "does not reuse an old touch offset for a new mouse swipe after %s", async (change) => {
    const sheet = await mountSheet(false);
    await pointer(document.querySelector("[data-sheet-body] p")!, "pointerdown", 0, 10, 2, true, "touch");
    await pointer(window, "pointermove", 0, 150, 2, true, "touch");
    if (change === "reopen") {
      await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close sheet"]')!.click());
      await act(async () => sheet.trigger.current!.click());
    } else {
      await sheet.setReduced(true);
      await sheet.setReduced(false);
    }
    const dialog = document.querySelector('[role="dialog"]');
    await pointer(document.querySelector("[data-sheet-body] p")!, "pointerdown", 0, 200);
    await pointer(window, "pointermove", 0, 205);
    await pointer(window, "pointerup", 0, 205);
    await settleClose(650);
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    await pointer(window, "pointerup", 0, 180, 2, true, "touch");
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  },
);

it("does not request another dismissal from the exiting panel", async () => {
  const sheet = await mountSheet(false);
  const content = document.querySelector("[data-sheet-body] p")!;
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close sheet"]')!.click());
  await pointer(content, "pointerdown", 0);
  await pointer(window, "pointermove", 0, 150);
  await pointer(window, "pointerup", 0, 150);
  expect(sheet.closeCount).toBe(1);
});

it("closes after a fast right flick below the distance threshold", async () => {
  await mountSheet(false);
  await pointer(document.querySelector("[data-sheet-body] p")!, "pointerdown", 0);
  await pointer(window, "pointermove", 0, 90);
  await pointer(window, "pointerup", 0, 90);
  await settleClose(650);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("discards a primary touch swipe when a second finger starts", async () => {
  await mountSheet(false);
  const dialog = document.querySelector('[role="dialog"]');
  const content = document.querySelector("[data-sheet-body] p")!;
  await pointer(content, "pointerdown", 0, 10, 2, true, "touch");
  await pointer(window, "pointermove", 0, 150, 2, true, "touch");
  await pointer(content, "pointerdown", 0, 100, 3, false, "touch");
  await pointer(window, "pointerup", 0, 100, 3, false, "touch");
  await pointer(window, "pointerup", 0, 180, 2, true, "touch");
  await settleClose(650);
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
});

// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Button } from "./button";

it("preserves a Slot link's identity, ref and accessible disabled styling", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const link = createRef<HTMLButtonElement>();
  try {
    await act(async () => root.render(
      <Button asChild ref={link} aria-disabled="true"><a href="/storage">Storage details</a></Button>,
    ));
    const anchor = host.querySelector("a")!;
    expect(host.querySelector("button")).toBeNull();
    expect(anchor.getAttribute("href")).toBe("/storage");
    expect(anchor.textContent).toBe("Storage details");
    expect(anchor.getAttribute("aria-disabled")).toBe("true");
    expect(link.current).toBe(anchor);
    expect(anchor.classList.contains("button-primary")).toBe(true);
    expect(anchor.classList.contains("aria-disabled:bg-surface-muted")).toBe(true);
  } finally { await act(async () => root.unmount()); }
});

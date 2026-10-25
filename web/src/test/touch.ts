import { act } from "react";

type TouchPoint = {
  x: number; y?: number; id?: number; time?: number; pointerType?: string; isPrimary?: boolean;
};

// touchMove complements Pointer Events with the browser's cancelable scroll event.
export async function touchMove(target: EventTarget, points: TouchPoint[], cancelable = true) {
  const event = new Event("touchmove", { bubbles: true, cancelable });
  Object.defineProperty(event, "touches", { value: points.map((point) => ({
    identifier: point.id ?? 7, clientX: point.x, clientY: point.y ?? 150,
  })) });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}

// pointer delivers browser-shaped events with deterministic coordinates and time.
export async function pointer(target: EventTarget, type: string, point: TouchPoint) {
  await act(async () => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: point.id ?? 1 }, pointerType: { value: point.pointerType ?? "touch" },
      isPrimary: { value: point.isPrimary ?? true }, button: { value: 0 },
      clientX: { value: point.x }, clientY: { value: point.y ?? 150 },
      timeStamp: { value: point.time ?? 1000 },
    });
    target.dispatchEvent(event);
  });
}

// swipe releases one horizontal touch after crossing the recognition threshold.
export async function swipe(target: EventTarget, dx = -90, x = 220) {
  await pointer(target, "pointerdown", { x, time: 1000 });
  await pointer(target, "pointermove", { x: x + dx, time: 1100 });
  await pointer(target, "pointerup", { x: x + dx, time: 1200 });
}

// touchClick models the compatibility click emitted after a released touch.
export async function touchClick(target: EventTarget, id = 1, legacy = false) {
  let delivered = false;
  // receive distinguishes Shell suppression from Router's normal preventDefault.
  function receive() { delivered = true; }
  target.addEventListener("click", receive, true);
  await act(async () => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
    Object.defineProperty(event, "timeStamp", { value: 1201 });
    if (!legacy) Object.defineProperties(event, {
      pointerId: { value: id }, pointerType: { value: "touch" },
    });
    target.dispatchEvent(event);
  });
  target.removeEventListener("click", receive, true);
  return !delivered;
}

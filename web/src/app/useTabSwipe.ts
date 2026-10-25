import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, type RefObject } from "react";
import { primaryNavigation } from "../components/app/primaryNavigation";
import { tabMotion } from "../lib/motion";

const modalSelector = "[data-sheet-overlay], [data-sheet-content]";
const controls = "button, a, summary, input, select, textarea, [contenteditable]:not([contenteditable='false']), [role='button'], [role='slider']";
type Gesture = {
  id: number; x: number; y: number; time: number; path: string; nav: boolean;
  direction: "horizontal" | "vertical" | null;
};

// excludedStart preserves controls and native horizontal scrolling inside main.
function excludedStart(target: Element, main: HTMLElement) {
  if (target.closest(controls)) return true;
  for (let node: Element | null = target; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowX;
    if (/(auto|scroll)/.test(overflow) && node.scrollWidth > node.clientWidth) return true;
    if (node === main) break;
  }
  return false;
}

// useTabSwipe tracks touch pointers only while the authenticated Shell is mounted.
export function useTabSwipe(main: RefObject<HTMLElement | null>, nav: RefObject<HTMLElement | null>) {
  const router = useRouter();
  const gesture = useRef<Gesture | null>(null);
  useEffect(() => {
    const pointers = new Set<number>();
    let navigating = false;
    let consumedClick: { id: number; time: number } | null = null;
    // cancel discards held input without scheduling navigation after recovery.
    function cancel() { gesture.current = null; }
    // blocked includes retained Sheet exit DOM and unresolved Router navigation.
    function blocked() {
      return document.hidden || !!document.querySelector(modalSelector)
        || navigating || router.state.status === "pending" || router.state.isLoading;
    }
    // down verifies real DOM containment instead of relying on Portal bubbling.
    function down(event: PointerEvent) {
      consumedClick = null;
      cancel();
      if (event.pointerType !== "touch") return;
      pointers.add(event.pointerId);
      if (pointers.size !== 1 || !event.isPrimary || event.button !== 0 || blocked()) return;
      const target = event.target;
      if (!(target instanceof Element) || !main.current || !nav.current) return;
      const inNav = nav.current.contains(target);
      if (!inNav && (!main.current.contains(target) || excludedStart(target, main.current))) return;
      if (event.clientX < tabMotion.viewportEdge || event.clientX > window.innerWidth - tabMotion.viewportEdge) return;
      const path = router.state.location.pathname;
      if (!primaryNavigation.some(({ to }) => to === path)) return;
      gesture.current = {
        id: event.pointerId, x: event.clientX, y: event.clientY,
        time: event.timeStamp, path, nav: inNav, direction: null,
      };
    }
    // track locks the first recognized direction, including vertical scrolling.
    function track(event: PointerEvent) {
      const held = gesture.current;
      if (!held) return;
      if (held.id !== event.pointerId || event.pointerType !== "touch" || event.timeStamp < held.time) {
        cancel();
        return;
      }
      const dx = Math.abs(event.clientX - held.x);
      const dy = Math.abs(event.clientY - held.y);
      if (!held.direction && Math.max(dx, dy) >= tabMotion.directionOffset) {
        if (dx >= tabMotion.directionRatio * dy) held.direction = "horizontal";
        else if (dy >= tabMotion.directionRatio * dx) held.direction = "vertical";
      }
    }
    // up confirms one destination on release and consumes its nav compatibility click.
    function up(event: PointerEvent) {
      pointers.delete(event.pointerId);
      track(event);
      const held = gesture.current;
      cancel();
      if (!held || held.direction !== "horizontal" || blocked()
        || router.state.location.pathname !== held.path) return;
      const dx = event.clientX - held.x;
      const dy = event.clientY - held.y;
      const elapsed = event.timeStamp - held.time;
      const speed = elapsed > 0 ? Math.abs(dx) / elapsed * 1000 : 0;
      if (Math.abs(dx) < tabMotion.directionRatio * Math.abs(dy)
        || (Math.abs(dx) < tabMotion.dismissOffset
          && (Math.abs(dx) < tabMotion.flickOffset || speed < tabMotion.flickVelocity))) return;
      if (held.nav) consumedClick = { id: held.id, time: event.timeStamp };
      const index = primaryNavigation.findIndex(({ to }) => to === held.path);
      const destination = primaryNavigation[index + (dx < 0 ? 1 : -1)];
      if (!destination) return;
      navigating = true;
      void router.navigate({ to: destination.to }).catch(() => {}).finally(() => { navigating = false; });
    }
    // lost resets tracking after cancellation or loss of pointer capture.
    function lost(event: PointerEvent) {
      pointers.delete(event.pointerId);
      if (gesture.current?.id === event.pointerId) cancel();
    }
    // click suppresses only the compatibility click belonging to a valid nav swipe.
    function click(event: MouseEvent) {
      const consumed = consumedClick;
      if (!consumed || event.detail === 0 || !(event.target instanceof Node) || !nav.current?.contains(event.target)) return;
      const pointer = event as PointerEvent;
      // Legacy MouseEvent clicks follow the completed touch with no intervening down.
      const legacy = pointer.pointerId === undefined && pointer.pointerType === undefined;
      if ((!legacy && (pointer.pointerId !== consumed.id || pointer.pointerType !== "touch"))
        || event.timeStamp < consumed.time || event.timeStamp - consumed.time > tabMotion.clickWindow) return;
      consumedClick = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    // visibility discards all held touches when the browser changes activity.
    function visibility() {
      cancel();
      pointers.clear();
      consumedClick = null;
    }
    const observer = new MutationObserver((records) => {
      if (!gesture.current) return;
      // Added-node records retain a modal even when it was removed in the same task.
      const appeared = records.some((record) => [...record.addedNodes].some((node) =>
        node instanceof Element && (node.matches(modalSelector) || !!node.querySelector(modalSelector))));
      if (appeared || document.querySelector(modalSelector)) cancel();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const unsubscribe = router.subscribe("onBeforeNavigate", cancel);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", track, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", lost, true);
    window.addEventListener("lostpointercapture", lost, true);
    window.addEventListener("click", click, true);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      visibility();
      observer.disconnect();
      unsubscribe();
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", track, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", lost, true);
      window.removeEventListener("lostpointercapture", lost, true);
      window.removeEventListener("click", click, true);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [router, main, nav]);
}

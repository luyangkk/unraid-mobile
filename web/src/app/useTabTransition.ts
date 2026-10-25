import { useRouter } from "@tanstack/react-router";
import { animate, useMotionValue } from "motion/react";
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { primaryNavigation } from "../components/app/primaryNavigation";
import { subscribeAuthChange } from "../lib/auth";
import { tabMotion, useReducedMotion } from "../lib/motion";
import { subscribeThemeChange } from "../lib/theme";

export type TabPath = (typeof primaryNavigation)[number]["to"];
export type TabTransitionRequest = { from: TabPath; to: TabPath };
export type TabTransitionController = {
  requestSwipe: (request: TabTransitionRequest) => Promise<void>;
  isBusy: () => boolean;
  cancelVisual: () => void;
};
export const TabEntryContext = createContext<(path: TabPath) => void>(() => {});

// useTabPageEntry arms a committed page before paint, outside pending Suspense UI.
export function useTabPageEntry(path: TabPath) {
  const prepare = useContext(TabEntryContext);
  useLayoutEffect(() => prepare(path), [path, prepare]);
}
type NativeTransition = {
  ready: Promise<void>; updateCallbackDone: Promise<void>; finished: Promise<void>;
  skipTransition: () => void;
};
type TransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => NativeTransition;
};
type Geometry = {
  top: number; left: number; bottom: number; width: number; scrollX: number; scrollY: number;
  viewport: number[];
};
type Transaction = TabTransitionRequest & {
  id: number; direction: number; geometry: Geometry;
  phase: "capturing" | "updating" | "animating" | "skipped";
  kind: "native" | "motion" | "none"; committed: boolean; navigationSeen: boolean;
  fallbackDirection?: number;
  native?: NativeTransition; skipped: boolean; timer?: ReturnType<typeof setTimeout>;
  settleRender?: () => void; entry?: Promise<void>;
};
const modalSelector = "[data-sheet-overlay], [data-sheet-content]";
const properties = [
  "--tab-exit-x", "--tab-enter-x", "--tab-exit-duration", "--tab-enter-duration",
  "--tab-ease", "--tab-clip-top", "--tab-clip-right", "--tab-clip-bottom", "--tab-clip-left",
];

// geometry excludes height: each snapshot must keep its own natural aspect ratio.
function geometry(content: HTMLElement): Geometry {
  const rect = content.getBoundingClientRect();
  const viewport = window.visualViewport;
  return {
    top: rect.top, left: rect.left, bottom: rect.bottom, width: rect.width, scrollX: window.scrollX, scrollY: window.scrollY,
    viewport: [window.innerWidth, window.innerHeight, viewport?.offsetTop ?? 0,
      viewport?.offsetLeft ?? 0, viewport?.width ?? window.innerWidth,
      viewport?.height ?? window.innerHeight, viewport?.scale ?? 1],
  };
}

// sameGeometry permits different page lengths but rejects scroll and viewport changes.
function sameGeometry(before: Geometry, after: Geometry) {
  return Math.abs(before.top - after.top) < 1 && Math.abs(before.left - after.left) < 1
    && Math.abs(before.width - after.width) < 1
    && before.scrollX === after.scrollX && before.scrollY === after.scrollY
    && before.viewport.every((value, index) => value === after.viewport[index]);
}

// useTabTransition owns visual resources without retaining a second React route.
export function useTabTransition(content: RefObject<HTMLElement | null>, nav: RefObject<HTMLElement | null>) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const preference = useRef(reduced);
  const engine = useRef<(TabTransitionController & { preparePage: (path: TabPath) => void }) | null>(null);
  const x = useMotionValue(0);
  const opacity = useMotionValue(1);
  const requestSwipe = useCallback((request: TabTransitionRequest) =>
    engine.current?.requestSwipe(request) ?? Promise.resolve(), []);
  const isBusy = useCallback(() => engine.current?.isBusy() ?? true, []);
  const cancelVisual = useCallback(() => engine.current?.cancelVisual(), []);
  const preparePage = useCallback((path: TabPath) => engine.current?.preparePage(path), []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    let alive = true;
    let sessionValid = true;
    let generation = 0;
    let current: Transaction | undefined;
    let controls: ReturnType<typeof animate> | undefined;
    let finishEntry: (() => void) | undefined;
    let committedPath = router.state.location.pathname;
    let suppressedEntry: { id: number; to: TabPath } | undefined;
    let preparedPath: TabPath | undefined;

    // owns prevents abandoned Promise handlers from changing a later transaction.
    function owns(tx: Transaction) { return alive && current === tx && generation === tx.id; }
    // clearMarkers removes only the CSS properties written by this transaction.
    function clearMarkers(tx: Transaction) {
      if (root.dataset.tabTransition !== String(tx.id)) return;
      delete root.dataset.tabTransition;
      delete root.dataset.tabDirection;
      properties.forEach((property) => root.style.removeProperty(property));
    }
    // resetEntry also settles stopped Motion sequences, whose thenables may not finish.
    function resetEntry() {
      controls?.stop();
      controls = undefined;
      finishEntry?.();
      finishEntry = undefined;
      x.stop(); opacity.stop();
      x.set(0); opacity.set(1);
      if (content.current) {
        content.current.style.transform = "none";
        content.current.style.opacity = "1";
      }
    }
    // cancel ends visuals synchronously; an already submitted Router navigation continues.
    function cancel(suppressPending = false) {
      const tx = current;
      if (suppressPending && tx?.navigationSeen && !tx.committed) suppressedEntry = { id: tx.id, to: tx.to };
      current = undefined;
      generation++;
      if (tx) {
        if (!tx.skipped && tx.native) { tx.skipped = true; tx.native.skipTransition(); }
        clearTimeout(tx.timer);
        tx.settleRender?.();
        clearMarkers(tx);
      }
      resetEntry();
    }
    // entry sets start values at page layout or native failure before visibility.
    function entry(direction: number, tx?: Transaction) {
      resetEntry();
      if (preference.current || document.hidden || !sessionValid || document.querySelector(modalSelector)) return;
      x.set(direction * tabMotion.displacement);
      opacity.set(0);
      // Motion schedules its DOM write; set the initial frame before layout returns.
      if (content.current) {
        content.current.style.transform = `translateX(${direction * tabMotion.displacement}px)`;
        content.current.style.opacity = "0";
      }
      let finish!: () => void;
      const done = new Promise<void>((resolve) => { finish = resolve; });
      finishEntry = finish;
      try {
        const animation = animate([
          [x, 0, { duration: tabMotion.enter.duration, ease: tabMotion.ease }],
          [opacity, 1, { at: 0, duration: tabMotion.enter.duration, ease: tabMotion.ease }],
        ]);
        controls = animation;
        // complete ignores stopped sequences after a new entry replaces their controls.
        function complete() {
          finish();
          if (controls !== animation) return;
          controls = undefined; finishEntry = undefined;
          x.set(0); opacity.set(1);
        }
        void animation.then(complete, complete);
      } catch {
        resetEntry();
        finish();
      }
      if (tx) { tx.entry = done; tx.phase = "animating"; }
    }
    // skip drops the native overlay without ever submitting another navigation.
    function skip(tx: Transaction, fallback: boolean, reason: string) {
      if (!owns(tx) || tx.skipped) return;
      tx.skipped = true;
      clearTimeout(tx.timer);
      tx.native?.skipTransition();
      clearMarkers(tx);
      tx.phase = "skipped";
      tx.kind = fallback ? "motion" : "none";
      tx.fallbackDirection = reason === "geometry" ? 0 : tx.direction;
      if (import.meta.env.DEV && reason === "geometry") console.debug("Tab transition skipped: geometry changed");
      if (tx.committed && fallback) entry(reason === "geometry" ? 0 : tx.direction, tx);
    }
    // mark publishes one parameter source to the scoped native pseudo-element CSS.
    function mark(tx: Transaction) {
      root.dataset.tabTransition = String(tx.id);
      root.dataset.tabDirection = String(tx.direction);
      const rect = content.current!.getBoundingClientRect();
      const bottom = Math.min(Math.max(tx.geometry.bottom, rect.bottom),
        nav.current?.getBoundingClientRect().top ?? window.innerHeight, window.innerHeight);
      const values = [
        `${-tx.direction * tabMotion.displacement}px`, `${tx.direction * tabMotion.displacement}px`,
        `${tabMotion.exit.duration}s`, `${tabMotion.nativeEnter.duration}s`,
        `cubic-bezier(${tabMotion.ease.join(", ")})`,
        `${Math.max(0, rect.top)}px`, `${Math.max(0, window.innerWidth - rect.right)}px`,
        `${Math.max(0, window.innerHeight - bottom)}px`, `${Math.max(0, rect.left)}px`,
      ];
      properties.forEach((property, index) => root.style.setProperty(property, values[index]));
    }
    // pending checks public Router state rather than treating an early URL as a commit.
    function pending() { return router.state.status === "pending" || router.state.isLoading; }
    // run gives each swipe one cached commit Promise and an independently tracked visual end.
    async function run(request: TabTransitionRequest) {
      const from = primaryNavigation.findIndex(({ to }) => to === request.from);
      const to = primaryNavigation.findIndex(({ to }) => to === request.to);
      if (!alive || !sessionValid || current || pending() || document.hidden || !content.current
        || document.querySelector(modalSelector) || router.state.location.pathname !== request.from
        || from < 0 || to < 0 || from === to) return;
      resetEntry();
      const tx: Transaction = {
        ...request, id: ++generation, direction: Math.sign(to - from), geometry: geometry(content.current),
        phase: "capturing", kind: "none", committed: false, navigationSeen: false, skipped: false,
      };
      current = tx;
      let commitPromise: Promise<void> | undefined;
      // commitOnce subscribes before navigate and releases its waiter on all exit paths.
      function commitOnce(): Promise<void> {
        if (commitPromise) return commitPromise;
        if (!owns(tx)) return Promise.resolve();
        tx.phase = "updating";
        commitPromise = new Promise<void>((resolve) => {
          // settle unregisters even when a redirect or interruption produces no target event.
          function settleRender() {
            unsubscribe();
            tx.settleRender = undefined;
            resolve();
          }
          const unsubscribe = router.subscribe("onRendered", ({ toLocation }) => {
            if (toLocation.pathname !== tx.to || pending()) return;
            tx.committed = true;
            if (owns(tx) && tx.kind === "native" && content.current) {
              if (!sameGeometry(tx.geometry, geometry(content.current))) skip(tx, true, "geometry");
              else mark(tx);
            }
            else if (owns(tx) && tx.kind === "motion" && !tx.entry) entry(tx.fallbackDirection ?? tx.direction, tx);
            settleRender();
          });
          tx.settleRender = settleRender;
          try {
            void router.navigate({ to: tx.to, viewTransition: false }).then(() => {
              if (!tx.committed && owns(tx)) cancel();
              if (suppressedEntry?.id === tx.id) suppressedEntry = undefined;
              settleRender();
            }, () => {
              if (owns(tx)) cancel();
              if (suppressedEntry?.id === tx.id) suppressedEntry = undefined;
              settleRender();
            });
          } catch {
            if (owns(tx)) cancel();
            settleRender();
          }
        });
        return commitPromise;
      }
      try {
        const documentWithTransition = document as TransitionDocument;
        const supported = typeof documentWithTransition.startViewTransition === "function"
          && typeof CSS !== "undefined" && CSS.supports("view-transition-name", "tab-content")
          && CSS.supports("selector(::view-transition-old(tab-content))")
          && CSS.supports("overflow-x", "clip");
        if (preference.current || !supported) {
          tx.kind = preference.current ? "none" : "motion";
          await commitOnce();
        } else {
          tx.kind = "native";
          mark(tx);
          try { tx.native = documentWithTransition.startViewTransition!(commitOnce); }
          catch {
            clearMarkers(tx);
            tx.kind = "motion";
            await commitOnce();
          }
          if (tx.native) {
            tx.timer = setTimeout(() => skip(tx, false, "deadline"), tabMotion.captureBudget);
            // Observe all native rejections immediately, before awaiting DOM completion.
            void tx.native.ready.then(() => {
              clearTimeout(tx.timer);
              if (owns(tx) && !tx.skipped) tx.phase = "animating";
            }, () => skip(tx, true, "ready"));
            const updated = tx.native.updateCallbackDone.catch(() => { if (owns(tx)) cancel(); });
            const finished = tx.native.finished.catch(() => { if (owns(tx)) skip(tx, false, "finished"); });
            await updated;
            await finished;
          }
        }
        await tx.entry;
      } finally {
        clearTimeout(tx.timer);
        tx.settleRender?.();
        if (owns(tx)) { clearMarkers(tx); current = undefined; resetEntry(); }
      }
    }
    const before = router.subscribe("onBeforeNavigate", ({ fromLocation, toLocation }) => {
      const tx = current;
      if (tx && !tx.navigationSeen && tx.phase === "updating"
        && fromLocation?.pathname === tx.from && toLocation.pathname === tx.to) {
        tx.navigationSeen = true;
        return;
      }
      suppressedEntry = undefined;
      preparedPath = undefined;
      cancel();
    });
    const rendered = router.subscribe("onRendered", ({ toLocation }) => {
      const path = toLocation.pathname;
      if (pending() || path === committedPath) return;
      const previous = committedPath;
      committedPath = path;
      if (suppressedEntry?.to === path) { suppressedEntry = undefined; return; }
      if (current) return;
      if (preparedPath === path) { preparedPath = undefined; return; }
      const from = primaryNavigation.findIndex(({ to }) => to === previous);
      const to = primaryNavigation.findIndex(({ to }) => to === path);
      if (to >= 0) entry(from >= 0 ? Math.sign(to - from) : 0);
    });
    // prepare arms only real route components, never a loading placeholder.
    function prepare(path: TabPath) {
      if (path === committedPath || suppressedEntry?.to === path || preparedPath === path) return;
      preparedPath = path;
      const tx = current;
      if (tx) {
        if (tx.to === path && tx.kind === "motion" && !tx.entry) entry(tx.fallbackDirection ?? tx.direction, tx);
        return;
      }
      const from = primaryNavigation.findIndex(({ to }) => to === committedPath);
      const to = primaryNavigation.findIndex(({ to }) => to === path);
      entry(from >= 0 ? Math.sign(to - from) : 0);
    }
    // click lets normal Link semantics interrupt even same-route Tab activations.
    function click(event: MouseEvent) {
      if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey
        && !event.shiftKey && !event.altKey && event.target instanceof Node
        && nav.current?.contains(event.target)) cancel();
    }
    // hidden invalidates a capture callback that has not submitted navigation yet.
    function hidden() { if (document.hidden) cancel(true); }
    // resized uses opacity fallback only while capture is still waiting for target DOM.
    function resized() {
      if (current && !current.committed) {
        if (current.kind === "native") skip(current, true, "geometry");
        else if (current.kind === "motion") current.fallbackDirection = 0;
        return;
      }
      cancel();
    }
    const observer = new MutationObserver((records) => {
      const appeared = records.some((record) => [...record.addedNodes].some((node) =>
        node instanceof Element && (node.matches(modalSelector) || !!node.querySelector(modalSelector))));
      if (appeared || document.querySelector(modalSelector)) cancel(true);
    });
    observer.observe(document.body, { subtree: true, childList: true });
    const auth = subscribeAuthChange(() => { sessionValid = false; cancel(); });
    const theme = subscribeThemeChange(() => cancel(true));
    const navigation = nav.current;
    navigation?.addEventListener("click", click, true);
    window.addEventListener("resize", resized);
    window.visualViewport?.addEventListener("resize", resized);
    window.visualViewport?.addEventListener("scroll", resized);
    document.addEventListener("visibilitychange", hidden);
    document.fonts?.addEventListener("loadingdone", resized);
    engine.current = { requestSwipe: run, isBusy: () => !!current || pending(),
      cancelVisual: () => cancel(true), preparePage: prepare };
    return () => {
      cancel();
      alive = false;
      engine.current = null;
      before(); rendered(); auth(); theme(); observer.disconnect();
      navigation?.removeEventListener("click", click, true);
      window.removeEventListener("resize", resized);
      window.visualViewport?.removeEventListener("resize", resized);
      window.visualViewport?.removeEventListener("scroll", resized);
      document.removeEventListener("visibilitychange", hidden);
      document.fonts?.removeEventListener("loadingdone", resized);
    };
  }, [router, content, nav, x, opacity]);

  useLayoutEffect(() => {
    preference.current = reduced;
    if (reduced) cancelVisual();
  }, [reduced, cancelVisual]);
  return useMemo(() => ({ requestSwipe, isBusy, cancelVisual, preparePage, x, opacity }),
    [requestSwipe, isBusy, cancelVisual, preparePage, x, opacity]);
}

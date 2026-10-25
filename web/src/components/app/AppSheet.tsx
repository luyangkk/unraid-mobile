import { AnimatePresence, animate, motion, useDragControls, useMotionValue } from "motion/react";
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { sheetMotion, shouldDismissSheet, useReducedMotion } from "../../lib/motion";
import {
  Sheet, SheetClose, SheetContent, SheetDescription, SheetOverlay, SheetPortal, SheetTitle,
} from "../ui/sheet";

export type AppSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

// AppSheet centralizes accessible mobile modality and handle-only dismissal.
export function AppSheet({
  open, onOpenChange, title, description, children, footer, returnFocusRef,
}: AppSheetProps) {
  const reduced = useReducedMotion();
  const controls = useDragControls();
  const dragY = useMotionValue(0);
  const previousFocus = useRef<HTMLElement | null>(null);
  const dragStartedAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    controls.cancel();
    dragStartedAt.current = null;
    dragY.stop();
    if (open || reduced) dragY.set(0);
    return () => {
      controls.cancel();
      dragStartedAt.current = null;
      dragY.stop();
    };
  }, [open, reduced, controls, dragY]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPortal forceMount>
        <AnimatePresence>
          {open ? (
            <SheetOverlay forceMount asChild key="overlay">
              <motion.div data-sheet-overlay
                className="fixed inset-0 z-50 bg-black/60"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={reduced ? sheetMotion.reduced : sheetMotion.fade} />
            </SheetOverlay>
          ) : null}
          {open ? (
            <motion.div key="content"
              className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md"
              initial={reduced ? { opacity: 0 } : { y: "100%" }}
              animate={reduced ? { opacity: 1, y: 0 } : { y: 0 }}
              exit={reduced ? { opacity: 0 } : { y: "100%" }}
              transition={reduced ? sheetMotion.reduced : sheetMotion.spring}>
            <SheetContent forceMount asChild aria-modal="true"
              onOpenAutoFocus={() => {
                previousFocus.current = document.activeElement instanceof HTMLElement
                  ? document.activeElement : null;
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const target = returnFocusRef?.current ?? previousFocus.current;
                if (target?.isConnected) target.focus({ preventScroll: true });
              }}>
              <motion.section
                className="flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-xl outline-none"
                  style={{ y: reduced ? 0 : dragY, paddingBottom: "env(safe-area-inset-bottom)" }}
                  drag={reduced ? false : "y"} dragListener={false}
                  dragControls={controls} dragConstraints={{ top: 0 }}
                  dragElastic={{ top: 0, bottom: 1 }} dragMomentum={false}
                  onDragEnd={(event, info) => {
                    if (dragStartedAt.current === null || event.timeStamp < dragStartedAt.current) return;
                    dragStartedAt.current = null;
                    if (open && !reduced && event.type !== "pointercancel"
                      && shouldDismissSheet(info.offset.y, info.velocity.y)) {
                      onOpenChange(false);
                    } else {
                      void animate(dragY, 0, reduced ? sheetMotion.reduced : sheetMotion.spring);
                    }
                  }}>
                  <div data-sheet-handle data-drag-enabled={!reduced}
                    aria-hidden="true"
                    className="flex h-11 shrink-0 items-center justify-center"
                    style={{ touchAction: reduced ? "auto" : "none" }}
                    onPointerDown={(event) => {
                      if (open && !reduced && event.isPrimary !== false && event.button === 0) {
                        dragStartedAt.current = event.timeStamp;
                        controls.start(event);
                      }
                    }}>
                    <span className="h-1 w-10 rounded-full bg-slate-600" />
                  </div>
                  <header className="flex shrink-0 items-start gap-3 px-5 pb-4">
                    <div className="min-w-0 flex-1">
                      <SheetTitle className="break-words text-lg font-semibold">{title}</SheetTitle>
                      <SheetDescription className="mt-1 break-words text-sm text-slate-400">{description}</SheetDescription>
                    </div>
                    <SheetClose asChild>
                      <button type="button" aria-label="Close sheet"
                        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-cyan-300">
                        <X aria-hidden="true" size={20} />
                      </button>
                    </SheetClose>
                  </header>
                  <div data-sheet-body
                    className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-5">
                    {children}
                  </div>
                  {footer ? <footer className="shrink-0 border-t border-slate-800 px-5 py-4">{footer}</footer> : null}
              </motion.section>
            </SheetContent>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </SheetPortal>
    </Sheet>
  );
}

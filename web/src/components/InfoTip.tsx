/**
 * Small ⓘ button + hover/focus popover. The popover is portalled to
 * document.body with a fixed-position offset from the anchor rect so it
 * escapes any `overflow-hidden` parents (the HUD panel is one of them).
 *
 * Kept intentionally simple — no floating-ui, no external dep. The auto-
 * placement heuristic just chooses top-vs-bottom and clamps horizontally
 * to the viewport.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "../lib/cn";
import { useMedia } from "../lib/useMedia";

const TOOLTIP_W = 260;
const TOOLTIP_GAP = 8;

export function InfoTip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  // On touch primary devices, hover doesn't exist — tooltip toggles on tap
  // and a document-level tap dismisses. Kept purely feature-detected so
  // desktop hover behaviour is unchanged.
  const isTouch = useMedia("(pointer: coarse)");
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placement: "top" | "bottom";
  } | null>(null);

  // Position the popover next to the anchor. Prefers below; flips above if
  // there isn't room; clamps horizontally so it never crosses the viewport
  // edge. Recomputes on scroll/resize while open.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const placement: "top" | "bottom" = spaceBelow < 120 ? "top" : "bottom";
      const top =
        placement === "bottom" ? r.bottom + TOOLTIP_GAP : r.top - TOOLTIP_GAP;
      const preferredLeft = r.left + r.width / 2 - TOOLTIP_W / 2;
      const left = Math.max(
        8,
        Math.min(window.innerWidth - TOOLTIP_W - 8, preferredLeft),
      );
      setPos({ top, left, placement });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // Global escape to close (helps if focus was moved elsewhere).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // On touch, close when the user taps anywhere outside the tooltip button
  // or its popover. Desktop path is unchanged (hover in/out drives open).
  useEffect(() => {
    if (!isTouch || !open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (btnRef.current && target && btnRef.current.contains(target)) return;
      // The portalled popover has role=tooltip; if the tap landed inside
      // it, ignore. This also lets copy-selectable text inside stay usable.
      const inTooltip = (target as HTMLElement | null)?.closest?.(
        '[role="tooltip"]',
      );
      if (inTooltip) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, { passive: true });
    return () => window.removeEventListener("pointerdown", onDown);
  }, [isTouch, open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        // Touch: tap toggles. Desktop: hover/focus opens, blur closes.
        onMouseEnter={isTouch ? undefined : () => setOpen(true)}
        onMouseLeave={isTouch ? undefined : () => setOpen(false)}
        onFocus={isTouch ? undefined : () => setOpen(true)}
        onBlur={isTouch ? undefined : () => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isTouch) setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex items-center justify-center rounded-full align-middle",
          "text-[10px] font-semibold leading-none",
          "text-panel-muted hover:text-emerald-300 hover:bg-white/10",
          "border border-white/15 transition shrink-0",
          // Bigger hit target on touch. Desktop stays 14px.
          isTouch ? "h-6 w-6 text-[11px]" : "h-3.5 w-3.5",
          className,
        )}
        aria-label="More information"
        aria-expanded={open}
      >
        i
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: TOOLTIP_W,
              transform:
                pos.placement === "top" ? "translateY(-100%)" : undefined,
              zIndex: 1000,
            }}
            className={cn(
              "panel !bg-neutral-900/98 px-3 py-2 text-[11px] leading-snug",
              "text-panel-fg font-normal normal-case tracking-normal",
              "pointer-events-none",
            )}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

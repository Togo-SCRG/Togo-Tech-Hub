"use client";

import { Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  // Portal straight to <body> so this always sits above everything,
  // regardless of where it's triggered from in the tree — a modal
  // rendered from inside a `position: sticky`/`fixed` ancestor (e.g. the
  // Sidebar) would otherwise be trapped in that ancestor's stacking
  // context and can end up rendering *below* sibling elements like the
  // Topbar, even with a high z-index.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!open) setMaximized(false);
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // An image lightbox opened from inside this dialog sits above it and
      // registers its own Escape handler. Both listen on `document`, and this
      // one was attached first, so without this check a single Escape would
      // dismiss the preview *and* the dialog behind it.
      if (document.querySelector("[data-lightbox-open]")) return;
      onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Freeze the page behind the dialog — otherwise scrolling inside a short
  // modal bleeds through and moves the content you were working from.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    // `data-modal-open` lets global hotkeys stand down while a dialog is up.
    <div
      data-modal-open
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div
        className={cn(
          "relative w-full bg-togo-surface border border-togo-border rounded-md overflow-y-auto transition-[max-width,max-height] duration-150 animate-modal-in shadow-[var(--shadow-modal)]",
          maximized ? "max-w-6xl max-h-[90vh]" : "max-w-lg max-h-[90vh]",
          !maximized && className
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-togo-border sticky top-0 bg-togo-surface z-10 rounded-t-md">
          <h2 className="text-lg font-bold text-togo-white">{title}</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMaximized((m) => !m)}
              title={maximized ? "Restore" : "Maximize"}
              className="text-togo-muted hover:text-togo-white transition-colors"
            >
              {maximized ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
            <button onClick={onClose} className="text-togo-muted hover:text-togo-white transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body
  );
}

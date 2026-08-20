"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

/**
 * A photo at full size on a dimmed backdrop.
 *
 * Deliberately not the shared `Modal`: that carries a title bar and a
 * maximize/restore control, which are chrome a picture doesn't need — the image
 * is the whole content, so the frame should get out of its way. What it does
 * borrow from Modal is the parts that are easy to get wrong: portalling to
 * <body> so it can't be trapped in a `sticky` ancestor's stacking context,
 * closing on Escape, and freezing the page behind it.
 */
export function ImageLightbox({
  open,
  onClose,
  src,
  alt,
  caption,
}: {
  open: boolean;
  onClose: () => void;
  src: string;
  alt: string;
  /** Shown under the image — the person's name, typically. */
  caption?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
    // `data-modal-open` lets global hotkeys stand down while this is up, the
    // same way the shared Modal does.
    <div
      data-modal-open
      // Lets the shared Modal know something is stacked on top of it, so one
      // Escape doesn't collapse both layers at once — see Modal's key handler.
      data-lightbox-open
      role="dialog"
      aria-modal="true"
      aria-label={caption ? `${caption} — profile photo` : alt}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Anywhere outside the picture closes it, which is what a viewer of this
          shape is expected to do. */}
      <div className="animate-fade-in fixed inset-0 bg-black/80 backdrop-blur-[2px]" onClick={onClose} />

      <button
        onClick={onClose}
        title="Close preview"
        aria-label="Close preview"
        className="absolute right-4 top-4 rounded-md border border-togo-border bg-togo-surface/80 p-1.5 text-togo-muted transition-colors hover:border-togo-blue hover:text-togo-blue"
      >
        <X size={18} />
      </button>

      <div className="animate-modal-in relative flex max-h-full flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="max-h-[80vh] max-w-[90vw] rounded-md border border-togo-border object-contain shadow-[var(--shadow-modal)]"
        />
        {caption && <p className="text-sm font-semibold text-togo-white">{caption}</p>}
      </div>
    </div>,
    document.body
  );
}

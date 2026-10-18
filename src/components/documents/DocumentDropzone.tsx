"use client";

import { useId, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Drop files here, or click to pick them — any number at once.
 *
 * Only collects files; what happens to them (upload now, or hold until a form
 * is submitted) is up to the caller.
 */
export function DocumentDropzone({
  onFiles,
  disabled,
  compact,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** A single-line strip, for under an existing list rather than an empty one. */
  compact?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  function take(list: FileList | null | undefined) {
    const files = Array.from(list || []);
    if (files.length > 0) onFiles(files);
  }

  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed text-center transition-colors",
        compact ? "gap-2 px-4 py-3" : "flex-col gap-2 px-4 py-8",
        dragActive ? "border-togo-blue bg-togo-blue-muted" : "border-togo-border bg-togo-surface hover:border-togo-blue",
        disabled && "pointer-events-none opacity-60"
      )}
    >
      <UploadCloud size={compact ? 18 : 28} className={dragActive ? "text-togo-blue" : "text-togo-faint"} />
      <span className={cn("font-semibold text-togo-white", compact ? "text-xs" : "text-sm")}>
        {compact ? "Drop more files, or click to browse" : "Drag & drop documents here"}
      </span>
      <span className="text-xs text-togo-faint">
        {compact ? "Up to 20 MB each" : "or click to browse — PDF, Word, Excel, images and more, up to 20 MB each"}
      </span>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          take(e.target.files);
          // Cleared so picking the same file again still fires onChange.
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </label>
  );
}

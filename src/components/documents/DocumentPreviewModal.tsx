"use client";

import { useEffect, useState } from "react";
import { Code2, Eye } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

// Browsers render PDFs (and images) natively in an iframe, but not Office
// formats — those get routed through Microsoft's Office Online viewer, which
// just needs a URL it can fetch (works fine with a temporary signed URL, as
// long as it's still valid when the viewer loads).
const OFFICE_EXTENSIONS = ["doc", "docx", "ppt", "pptx", "xls", "xlsx"];

// Read and rendered by us rather than handed to the browser. Two reasons, both
// visible on a .md document: an iframe is a separate document, so the app's
// scrollbar styling (globals.css) can't reach inside it and you get the OS
// default; and the browser guesses the encoding of a text/plain response,
// which turns every em dash in a UTF-8 file into "â€"". Decoding explicitly
// below fixes the second, and owning the scroll container fixes the first.
const TEXT_EXTENSIONS = ["md", "markdown", "txt", "text", "csv", "json", "log", "yml", "yaml"];

// Uploaded HTML can't be previewed by pointing an iframe at its URL: Supabase
// Storage deliberately serves user-uploaded HTML as plain text so its own
// domain can't be turned into an XSS host, so the browser shows the source.
// Fetching the file and injecting it as `srcdoc` sidesteps the stored
// content-type entirely, and decodes as UTF-8 on the way in.
const HTML_EXTENSIONS = ["html", "htm"];

function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

/** A project document, shown in place. Was the PRD preview; any document type works the same way. */
export function DocumentPreviewModal({
  open,
  onClose,
  fileName,
  fileUrl,
}: {
  open: boolean;
  onClose: () => void;
  fileName: string;
  fileUrl: string;
}) {
  const extension = getExtension(fileName);
  const isOfficeDoc = OFFICE_EXTENSIONS.includes(extension);
  const isHtmlDoc = HTML_EXTENSIONS.includes(extension);
  const isTextDoc = TEXT_EXTENSIONS.includes(extension);
  // Both paths need the file's bytes rather than its URL.
  const needsFetch = isHtmlDoc || isTextDoc;

  const [text, setText] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    if (!open || !needsFetch) return;

    // `ignore` rather than an AbortController: closing and reopening quickly
    // would otherwise let a stale response overwrite the current file's text.
    let ignore = false;
    setText(null);
    setFetchFailed(false);
    setShowSource(false);

    fetch(fileUrl)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.arrayBuffer();
      })
      .then((buf) => {
        if (ignore) return;
        // Explicitly UTF-8 — the whole point of reading it ourselves.
        setText(new TextDecoder("utf-8").decode(buf));
      })
      .catch(() => {
        // Signed URL expired, or storage refused the cross-origin read. Falls
        // back to the plain iframe below, which at least still shows the file.
        if (!ignore) setFetchFailed(true);
      });

    return () => {
      ignore = true;
    };
  }, [open, needsFetch, fileUrl]);

  const embedSrc = isOfficeDoc
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`
    : fileUrl;

  const renderedHtml = isHtmlDoc && !fetchFailed && !showSource;
  const renderedText = (isTextDoc || (isHtmlDoc && showSource)) && !fetchFailed;

  return (
    <Modal open={open} onClose={onClose} title={fileName} className="max-w-4xl">
      {/* Source stays one click away for an HTML document — it's occasionally
          the thing you actually want. */}
      {isHtmlDoc && !fetchFailed && (
        <div className="mb-3 flex items-center gap-1 rounded-md border border-togo-border p-0.5 w-fit">
          {[
            { key: false, label: "Preview", icon: Eye },
            { key: true, label: "Source", icon: Code2 },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => setShowSource(key)}
              aria-pressed={showSource === key}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                showSource === key
                  ? "bg-togo-blue text-white"
                  : "text-togo-muted hover:text-togo-white"
              )}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      )}

      <div className="h-[75vh]">
        {needsFetch && !fetchFailed && text === null ? (
          <div className="flex h-full items-center justify-center rounded-md border border-togo-border">
            <p className="text-sm italic text-togo-faint">Loading…</p>
          </div>
        ) : renderedHtml ? (
          // `sandbox` with no allow-* tokens: no scripts, no access to this
          // origin, no form submission, no navigating the tab away. A document
          // is a document, and uploaded HTML is untrusted content — its own CSS,
          // fonts and images still load, which is all it needs to look right.
          <iframe
            srcDoc={text ?? ""}
            title={fileName}
            sandbox=""
            className="h-full w-full rounded-md border border-togo-border bg-white"
          />
        ) : renderedText ? (
          // overflow-auto here is what puts the scrollbar on an element the
          // app's CSS owns, so it matches every other scroll area in the hub.
          <div className="h-full overflow-auto rounded-md border border-togo-border bg-togo-surface-2/40 p-4">
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-togo-muted">
              {text}
            </pre>
          </div>
        ) : (
          <iframe src={embedSrc} title={fileName} className="h-full w-full rounded-md border border-togo-border" />
        )}
      </div>
    </Modal>
  );
}

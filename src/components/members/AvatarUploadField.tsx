"use client";

import { useRef, useState } from "react";
import { UploadCloud, Eye, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { Input, Label } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function AvatarUploadField({
  memberId,
  name,
  avatarUrl,
  onChange,
}: {
  memberId: string;
  name: string;
  avatarUrl: string;
  onChange: (url: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setError(null);
    if (file.size > MAX_SIZE) {
      setError("Image must be 5MB or smaller.");
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Only PNG, JPEG, WEBP, or GIF images are allowed.");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/members/${memberId}/avatar`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to upload image.");
        return;
      }
      onChange(data.avatarUrl);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  }

  return (
    <div>
      <Label>Photo</Label>
      <div className="flex items-start gap-4">
        <div className="relative shrink-0 group">
          <Avatar name={name} avatarUrl={avatarUrl} size="lg" className="h-28 w-28 text-3xl" />
          {avatarUrl && (
            <div className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                title="View photo"
                className="flex items-center justify-center h-8 w-8 rounded-full bg-togo-charcoal/90 text-togo-white hover:text-togo-blue transition-colors"
              >
                <Eye size={15} />
              </button>
              <button
                type="button"
                onClick={() => onChange("")}
                title="Remove photo"
                className="flex items-center justify-center h-8 w-8 rounded-full bg-togo-charcoal/90 text-togo-white hover:text-[#EF4444] transition-colors"
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div
            onClick={() => !uploading && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              "flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-4 text-center cursor-pointer transition-colors",
              dragOver ? "border-togo-blue bg-togo-blue-muted" : "border-togo-border hover:border-togo-blue"
            )}
          >
            <UploadCloud size={18} className="text-togo-faint" />
            <p className="text-xs text-togo-muted">
              {uploading ? "Uploading..." : "Drag & drop an image, or click to browse"}
            </p>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-togo-faint shrink-0">or paste a URL</span>
            <Input
              value={avatarUrl.startsWith("http") ? avatarUrl : ""}
              onChange={(e) => onChange(e.target.value)}
              placeholder="https://..."
              className="text-xs py-1.5"
            />
          </div>

          {error && <p className="text-xs text-[#EF4444]">{error}</p>}
        </div>
      </div>

      {/* Same viewer the team profile uses, rather than dumping the raw storage
          URL into a new browser tab — you stay in the form you were filling in,
          and Escape brings you straight back to it. */}
      {avatarUrl && (
        <ImageLightbox
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          src={avatarUrl}
          alt={`${name}'s profile photo`}
          caption={name}
        />
      )}
    </div>
  );
}

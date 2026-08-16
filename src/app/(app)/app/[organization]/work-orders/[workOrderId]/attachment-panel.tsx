"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Attachment = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByDisplayName: string | null;
  createdAt: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentPanel({
  workOrderId,
  canWrite,
}: {
  workOrderId: string;
  canWrite: boolean;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/work-orders/${workOrderId}/attachments`);
        if (res.ok) {
          const data = await res.json();
          setAttachments(data.attachments ?? []);
        }
      } catch {
        // Silently fail on load — the panel shows an empty state.
      }
    }
    void load();
  }, [workOrderId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/work-orders/${workOrderId}/attachments`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          file_too_large: "File is too large (max 25 MB).",
          invalid_content_type: "This file type is not allowed.",
          storage_not_configured: "File storage is not configured. Ask your administrator.",
        };
        throw new Error(messages[body.error] ?? "Upload failed.");
      }
      // Reload the list.
      const refreshRes = await fetch(`/api/work-orders/${workOrderId}/attachments`);
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        setAttachments(data.attachments ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setPending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(attachmentId: string) {
    if (!confirm("Delete this file?")) return;
    setPending(true);
    try {
      await fetch(`/api/work-orders/${workOrderId}/attachments/${attachmentId}`, {
        method: "DELETE",
      });
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Attachments</CardTitle>
        {canWrite ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleUpload}
              className="hidden"
              accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.csv,.docx,.xlsx"
              disabled={pending}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending}
            >
              Upload file
            </Button>
          </>
        ) : null}
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files attached.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <div className="flex flex-col">
                  <a
                    href={`/api/work-orders/${workOrderId}/attachments/${attachment.id}`}
                    className="text-sm font-medium text-link underline-offset-4 hover:underline"
                  >
                    {attachment.fileName}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(attachment.sizeBytes)} · {attachment.contentType}
                    {attachment.uploadedByDisplayName
                      ? ` · ${attachment.uploadedByDisplayName}`
                      : ""}
                  </span>
                </div>
                {canWrite ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(attachment.id)}
                    disabled={pending}
                  >
                    Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

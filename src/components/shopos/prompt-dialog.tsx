"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type PromptField = Readonly<{
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number" | "textarea";
  initialValue?: string;
  required?: boolean;
  autoFocus?: boolean;
}>;

export type PromptDialogProps = Readonly<{
  open: boolean;
  title: string;
  description?: string;
  fields: readonly PromptField[];
  submitLabel?: string;
  pending?: boolean;
  onCancel: () => void;
  onSubmit: (values: Readonly<Record<string, string>>) => void;
}>;

/**
 * Labeled, keyboard-friendly replacement for window.prompt flows: one or
 * more named fields in a dialog. Every field carries a visible label —
 * placeholder text alone is never the label (a11y structure test enforces
 * the same rule here as everywhere else).
 */
export function PromptDialog({
  open,
  title,
  description,
  fields,
  submitLabel = "Continue",
  pending = false,
  onCancel,
  onSubmit,
}: PromptDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  // Reset whenever the dialog opens for a new action.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const initial: Record<string, string> = {};
      for (const field of fields) initial[field.name] = field.initialValue ?? "";
      setValues(initial);
    }, 0);
    return () => clearTimeout(timer);
  }, [open, fields]);

  const missing = fields.some((field) => field.required && !values[field.name]?.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <div className="flex flex-col gap-1">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!missing && !pending) onSubmit(values);
          }}
        >
          {fields.map((field) => (
            <label key={field.name} className="grid gap-1 text-sm font-medium">
              {field.label}
              {field.type === "textarea" ? (
                <textarea
                  aria-label={field.label}
                  value={values[field.name] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                  placeholder={field.placeholder}
                  rows={3}
                  maxLength={500}
                  autoFocus={field.autoFocus}
                  className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
                />
              ) : (
                <Input
                  aria-label={field.label}
                  value={values[field.name] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                  placeholder={field.placeholder}
                  type={field.type === "number" ? "number" : "text"}
                  step={field.type === "number" ? "0.01" : undefined}
                  inputMode={field.type === "number" ? "decimal" : undefined}
                  autoFocus={field.autoFocus}
                />
              )}
            </label>
          ))}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || missing}>
              {pending ? "…" : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

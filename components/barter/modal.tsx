"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// A native <dialog> opened with showModal(): the page behind it is inert, focus stays
// inside, and Escape closes it. Children mount only while open, so forms start fresh.
export function Modal({
  open,
  onClose,
  labelledBy,
  closeOnBackdrop = false,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  closeOnBackdrop?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(event) => {
        // Clicks on the backdrop land on the dialog element itself.
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
      className={cn(
        // `open:flex` rather than `flex`, which would override the closed dialog's display: none.
        "m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-[1240px] overflow-hidden rounded-[20px] bg-white p-0 text-black backdrop:bg-black/55 open:flex open:flex-col lg:rounded-[24px]",
        className,
      )}
    >
      {open && children}
    </dialog>
  );
}

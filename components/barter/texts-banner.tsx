"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

const button = "h-10 rounded-[8px] bg-barter-navy px-5 text-[15px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60";

// "+15551234567" → "(555) 123-4567"; other formats are shown as they are.
function displayNumber(number: string) {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(number);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : number;
}

/** Gets the viewer's barter number, then offers to open Messages with it. */
export function TurnOnTexts({ className }: { className?: string }) {
  const router = useRouter();
  const [number, setNumber] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/texts", { method: "POST" });
      const data = await response.json().catch(() => null);
      if (response.ok && typeof data?.number === "string") setNumber(data.number);
      else setError(data?.error?.message ?? "We couldn't turn on texts. Please try again.");
    } catch {
      setError("Unable to connect. Please try again.");
    }
    setBusy(false);
  }

  if (!number) {
    return (
      <div className={className}>
        <button type="button" onClick={start} disabled={busy} className={button}>
          {busy ? "One moment…" : "Turn on texts"}
        </button>
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      <a href={`sms:${number}?&body=Hi%20barter!`} className={cn(button, "flex items-center")}>
        Open Messages
      </a>
      <p className="text-[15px]">
        or text “Hi barter!” to <span className="font-bold">{displayNumber(number)}</span>
      </p>
      <button type="button" onClick={() => router.refresh()} className="text-[15px] font-bold underline">
        Check again
      </button>
    </div>
  );
}

export function TextsBanner() {
  return (
    <section aria-label="Turn on texts" className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 bg-barter-periwinkle/15 px-6 py-3 lg:px-10">
      <p className="text-[15px] font-semibold text-barter-navy">Turn on texts to send and receive requests.</p>
      <TurnOnTexts />
    </section>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { formatAvailability } from "@/lib/availability";
import type { Service } from "@/lib/barter/data";

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8];
const label = "mb-1 block font-mono text-[15px] font-bold";
const field = "h-12 w-full border border-barter-line bg-white px-4 text-[15px] outline-none focus:border-barter-navy";

const coins = (amount: number) => `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${amount === 1 ? "coin" : "coins"}`;

// The request that Contact opens. It sends JSON to /api/bookings, which holds the coins and texts both people.
export function RequestForm({ service, balance, onBack, onSent }: { service: Service; balance: number; onBack: () => void; onSent: () => void }) {
  const [slot, setSlot] = useState(0);
  const [hours, setHours] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hourly = service.pricingType === "hourly";
  const total = (service.creditRate * (hourly ? hours : 1)) / 100;
  const providerFirstName = service.providerName.split(" ")[0];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    let message = "Unable to connect. Please try again.";
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, window: service.availability[slot] ?? null, ...(hourly ? { hours } : {}), ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      if (response.ok) {
        onSent();
        return;
      }
      const data = await response.json().catch(() => null);
      message = response.status === 429 ? "Too many requests. Please wait a minute and try again." : data?.error?.message ?? "We could not send your request. Please try again.";
    } catch {}
    setError(message);
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-8 max-w-[640px]">
      <button type="button" onClick={onBack} disabled={busy} className="font-mono text-[15px] font-bold underline">
        Back
      </button>
      <h3 className="mt-4 font-mono text-xl font-bold lg:text-2xl">Request {service.title}</h3>
      <fieldset disabled={busy} className="mt-6 grid gap-5">
        {service.availability.length > 0 ? (
          <div role="radiogroup" aria-labelledby="request-when">
            <p id="request-when" className={label}>When works for you?</p>
            <div className="grid gap-2">
              {service.availability.map((choice, index) => (
                <label key={`${choice.day}-${choice.start}`} className="flex items-center gap-3 font-mono text-base">
                  <input type="radio" name="window" checked={slot === index} onChange={() => setSlot(index)} className="size-[18px] accent-barter-navy" />
                  {formatAvailability([choice])}
                </label>
              ))}
            </div>
            <p className="mt-2 text-[13px] text-barter-gray">New York time. You&apos;ll settle the exact time after {providerFirstName} accepts.</p>
          </div>
        ) : (
          <p className="font-mono text-base text-barter-gray">Any time works for this listing. You&apos;ll settle the details after {providerFirstName} accepts.</p>
        )}
        {hourly && (
          <label className="block">
            <span className={label}>How many hours?</span>
            <select value={hours} onChange={(event) => setHours(Number(event.target.value))} className={field}>
              {HOURS.map((value) => (
                <option key={value} value={value}>{value} {value === 1 ? "hour" : "hours"}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className={label}>Note (optional)</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} rows={3} placeholder={`Anything ${providerFirstName} should know?`} className={`${field} h-auto resize-none py-3`} />
        </label>
        <p className="font-mono text-base">
          Total: <span className="font-bold">{coins(total)}</span> · Your balance: {coins(balance)}
        </p>
        {total > balance && <p className="text-sm text-red-700">You don&apos;t have enough coins for this request.</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy || total > balance} className="h-14 rounded-[10px] bg-barter-navy px-10 font-mono text-xl font-extrabold text-white transition-opacity hover:opacity-90 disabled:opacity-60">
          {busy ? "Sending…" : "Send request"}
        </button>
      </fieldset>
    </form>
  );
}

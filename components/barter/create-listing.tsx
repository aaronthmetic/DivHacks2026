"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { ChevronDown, X } from "lucide-react";
import type { CategoryOption } from "@/lib/barter/data";
import { DAY_NAMES, SHORT_DAY_NAMES, WEEK_DAYS } from "@/lib/availability";
import { cn } from "@/lib/utils";
import { Modal } from "./modal";

const MAX_PHOTOS = 5;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
// A listing is sent as one request, which the server caps at 4 MiB, so larger photos are
// shrunk in the browser first.
const KEEP_PHOTO_BYTES = 700 * 1024;
const MAX_PHOTO_EDGE = 1600;
const MAX_TOTAL_BYTES = 3.8 * 1024 * 1024;

const label = "mb-1 block text-[15px] font-semibold text-[#636363]";
const field =
  "h-[57px] w-full min-w-0 border border-barter-line bg-white px-5 text-[15px] text-black outline-none placeholder:text-[#636363] focus:border-barter-navy disabled:bg-barter-read disabled:text-[#9d9d9d] disabled:placeholder:text-[#9d9d9d]";
// Number inputs without the browser's spin buttons, as in the mockup.
const number =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

type Photo = { id: number; file: File; url: string };
// A chosen day's hours, as the time inputs' "HH:MM" values.
type DayHours = { day: number; start: string; end: string };

async function shrinkPhoto(file: File): Promise<File> {
  if (file.size <= KEEP_PHOTO_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  // JPEG has no transparency, so paint a white background first.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("The photo could not be encoded.");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
}

export function CreateListingModal({
  open,
  categories,
  onClose,
  onPublished,
}: {
  open: boolean;
  categories: CategoryOption[];
  onClose: () => void;
  onPublished: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="new-listing-heading"
      className="h-[calc(100dvh-1.5rem)] lg:h-auto lg:max-h-[min(822px,calc(100dvh-4rem))]"
    >
      <CreateListingForm categories={categories} onClose={onClose} onPublished={onPublished} />
    </Modal>
  );
}

function CreateListingForm({
  categories,
  onClose,
  onPublished,
}: {
  categories: CategoryOption[];
  onClose: () => void;
  onPublished: () => void;
}) {
  const [deliveryMode, setDeliveryMode] = useState("");
  const [frequency, setFrequency] = useState<"single" | "recurring">("single");
  const [days, setDays] = useState<DayHours[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const nextPhotoId = useRef(0);
  // Preview URLs are released when a photo is removed and when the form closes.
  const previewUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = previewUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function addPhotos(files: File[]) {
    const room = MAX_PHOTOS - photos.length;
    setError(files.length > room ? `You can add up to ${MAX_PHOTOS} photos.` : "");
    try {
      const chosen = await Promise.all(
        files.slice(0, room).map((file) => {
          if (!PHOTO_TYPES.includes(file.type)) throw new Error("Unsupported type");
          return shrinkPhoto(file);
        }),
      );
      const added = chosen.map((file) => {
        const url = URL.createObjectURL(file);
        previewUrls.current.add(url);
        return { id: nextPhotoId.current++, file, url };
      });
      setPhotos((current) => [...current, ...added]);
    } catch {
      setError("Choose JPEG, PNG, or WebP photos.");
    }
  }

  function removePhoto(photo: Photo) {
    URL.revokeObjectURL(photo.url);
    previewUrls.current.delete(photo.url);
    setPhotos((current) => current.filter((item) => item.id !== photo.id));
  }

  // Rows stay in the order days were picked, so a new day copies the latest hours.
  function toggleDay(day: number) {
    setDays((current) => {
      if (current.some((row) => row.day === day)) return current.filter((row) => row.day !== day);
      const latest = current.at(-1);
      return [...current, { day, start: latest?.start ?? "09:00", end: latest?.end ?? "17:00" }];
    });
  }

  function setHours(day: number, key: "start" | "end", value: string) {
    setDays((current) => current.map((row) => (row.day === day ? { ...row, [key]: value } : row)));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (days.length === 0) {
      setError("Choose at least one day you're available.");
      return;
    }
    // Time inputs give zero-padded 24-hour values, so they compare as strings.
    if (days.some((row) => !row.start || !row.end || row.end <= row.start)) {
      setError("Each day's end time must be after its start time.");
      return;
    }
    if (photos.reduce((total, photo) => total + photo.file.size, 0) > MAX_TOTAL_BYTES) {
      setError("Your photos are too large. Remove one or choose smaller photos.");
      return;
    }
    // Disabled inputs (the repeat interval of a single-time listing) are left out.
    const form = new FormData(event.currentTarget);
    form.set("availability", JSON.stringify(days));
    photos.forEach((photo) => form.append("images", photo.file, photo.file.name));
    setBusy(true);
    setError("");
    let message = "Unable to connect. Please try again.";
    try {
      const response = await fetch("/api/services", { method: "POST", body: form });
      if (response.ok) {
        onPublished();
        return;
      }
      const data = await response.json().catch(() => null);
      message =
        response.status === 429
          ? "Too many changes. Please wait a minute and try again."
          : data?.error?.message ?? "We could not publish your listing. Please try again.";
    } catch {}
    setError(message);
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-6 px-5 pt-6 pb-4 lg:px-[62px] lg:pt-[42px] lg:pb-3">
        <h2
          id="new-listing-heading"
          className="font-mono text-[26px] leading-tight font-extrabold lg:text-[40px]"
        >
          Create a listing for your service
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="shrink-0">
          <X className="size-8 lg:size-10" strokeWidth={2.5} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-8 lg:px-[62px]">
        <fieldset disabled={busy} className="grid min-w-0 gap-x-[39px] gap-y-6 lg:grid-cols-2">
          <Field label="Title" htmlFor="new-listing-title">
            <input id="new-listing-title" name="title" required maxLength={200} className={field} />
          </Field>
          <Field label="Category" htmlFor="new-listing-category">
            <Select
              id="new-listing-category"
              name="genreId"
              required
              options={categories.map(({ id, name }) => [id, name])}
            />
          </Field>
          <Field label="Description" htmlFor="new-listing-description">
            <textarea
              id="new-listing-description"
              name="description"
              required
              maxLength={10000}
              className={cn(field, "block h-[140px] resize-none py-4")}
            />
          </Field>
          {/* Starts a new row so the description keeps the right column empty. */}
          <Field label="Zip code" htmlFor="new-listing-zip" className="lg:col-start-1">
            <input
              id="new-listing-zip"
              name="zipCode"
              inputMode="numeric"
              autoComplete="postal-code"
              pattern="[0-9]{5}"
              title="Enter a 5-digit ZIP code."
              maxLength={5}
              required={deliveryMode !== "remote"}
              placeholder={deliveryMode === "remote" ? "Optional for remote" : undefined}
              className={field}
            />
          </Field>
          <Field label="Delivery method" htmlFor="new-listing-delivery">
            <Select
              id="new-listing-delivery"
              name="deliveryMode"
              required
              onValueChange={setDeliveryMode}
              options={[
                ["in_person", "In person"],
                ["remote", "Remote"],
                ["either", "In person or remote"],
              ]}
            />
          </Field>
          <div role="group" aria-labelledby="new-listing-pricing">
            <p id="new-listing-pricing" className={label}>Pricing model</p>
            <div className="flex items-center gap-3.5">
              <input
                name="coins"
                type="number"
                min={1}
                max={999999}
                step={1}
                inputMode="numeric"
                required
                aria-label="Number of coins"
                placeholder="# of coins"
                className={cn(field, number, "flex-1 lg:w-[240px] lg:flex-none")}
              />
              <span className="text-[15px] font-bold">per</span>
              <Select
                name="per"
                required
                aria-label="Charged per"
                className="flex-1"
                options={[
                  ["hour", "hour"],
                  ["service", "service"],
                ]}
              />
            </div>
          </div>
          <div role="group" aria-labelledby="new-listing-frequency">
            <p id="new-listing-frequency" className={label}>Frequency</p>
            <div className="flex min-h-[57px] flex-wrap items-center gap-x-3 gap-y-3">
              <Radio
                label="Single time"
                checked={frequency === "single"}
                onChange={() => setFrequency("single")}
                value="single"
              />
              <span className="text-[15px] font-bold">or</span>
              <Radio
                label="Recurring every"
                checked={frequency === "recurring"}
                onChange={() => setFrequency("recurring")}
                value="recurring"
              />
              <div className="flex gap-3">
                <input
                  name="interval"
                  type="number"
                  min={1}
                  max={99}
                  step={1}
                  inputMode="numeric"
                  required
                  disabled={frequency !== "recurring"}
                  aria-label="Repeats every"
                  placeholder="Number"
                  className={cn(field, number, "w-[107px]")}
                />
                <Select
                  name="unit"
                  required
                  disabled={frequency !== "recurring"}
                  aria-label="Repeat unit"
                  className="w-[124px]"
                  options={[
                    ["day", "days"],
                    ["week", "weeks"],
                    ["month", "months"],
                  ]}
                />
              </div>
            </div>
          </div>
          <div role="group" aria-labelledby="new-listing-availability" className="lg:col-span-2">
            <p id="new-listing-availability" className={label}>Availability</p>
            <div className="flex flex-wrap gap-2">
              {WEEK_DAYS.map((day) => {
                const chosen = days.some((row) => row.day === day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    aria-pressed={chosen}
                    aria-label={DAY_NAMES[day]}
                    className={cn(
                      "h-[41px] min-w-[58px] border px-3 text-[15px] font-semibold transition-colors",
                      chosen
                        ? "border-barter-navy bg-barter-navy text-white"
                        : "border-barter-line bg-white text-[#636363] hover:border-barter-navy",
                    )}
                  >
                    {SHORT_DAY_NAMES[day]}
                  </button>
                );
              })}
            </div>
            {days.length > 0 && (
              <ul className="mt-4 grid gap-3">
                {[...days]
                  .sort((a, b) => WEEK_DAYS.indexOf(a.day) - WEEK_DAYS.indexOf(b.day))
                  .map((row) => (
                    <li key={row.day} className="flex items-center gap-3">
                      <span className="w-10 shrink-0 text-[15px] font-bold">{SHORT_DAY_NAMES[row.day]}</span>
                      {/* Unnamed on purpose: the rows are sent together as the availability field. */}
                      <input
                        type="time"
                        step={900}
                        required
                        value={row.start}
                        onChange={(event) => setHours(row.day, "start", event.target.value)}
                        aria-label={`${DAY_NAMES[row.day]} from`}
                        className={cn(field, "flex-1 px-3 lg:w-[170px] lg:flex-none")}
                      />
                      <span className="text-[15px] font-bold">to</span>
                      <input
                        type="time"
                        step={900}
                        required
                        value={row.end}
                        onChange={(event) => setHours(row.day, "end", event.target.value)}
                        aria-label={`${DAY_NAMES[row.day]} until`}
                        className={cn(field, "flex-1 px-3 lg:w-[170px] lg:flex-none")}
                      />
                    </li>
                  ))}
              </ul>
            )}
            <p className="mt-2 text-[13px] text-[#636363]">Times are New York time.</p>
          </div>
          <div className="lg:col-start-1">
            <p className={label}>Image upload</p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={photos.length >= MAX_PHOTOS}
              className="h-[37px] bg-barter-line px-[23px] text-[15px] text-black transition-colors hover:bg-[#cdcdcd] disabled:opacity-60"
            >
              Upload
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={PHOTO_TYPES.join(",")}
              multiple
              tabIndex={-1}
              aria-hidden
              className="hidden"
              onChange={(event) => {
                void addPhotos([...(event.currentTarget.files ?? [])]);
                event.currentTarget.value = "";
              }}
            />
            {photos.length > 0 && (
              <ul className="mt-[17px] flex flex-wrap gap-4">
                {photos.map((photo, index) => (
                  <li key={photo.id} className="relative">
                    {/* Local preview of a photo that isn't uploaded yet. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.url}
                      alt={`Photo ${index + 1}`}
                      className="h-[105px] w-[206px] rounded-[10px] bg-barter-read object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(photo)}
                      aria-label={`Remove photo ${index + 1}`}
                      className="absolute -top-3 -right-3 flex size-[26px] items-center justify-center rounded-full bg-barter-line"
                    >
                      <X className="size-3.5" strokeWidth={2.5} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </fieldset>
      </div>
      {error && (
        <p role="alert" className="shrink-0 bg-red-50 px-5 py-3 text-sm font-medium text-red-700 lg:px-[62px]">
          {error}
        </p>
      )}
      <div className="grid shrink-0 grid-cols-2">
        <button
          type="button"
          onClick={onClose}
          className="h-16 bg-[#636363] px-5 text-left text-xl font-bold text-white transition-colors hover:bg-[#575757] lg:h-[103px] lg:px-12 lg:text-[32px]"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="h-16 bg-barter-periwinkle px-5 text-left text-xl font-bold text-white transition-colors hover:bg-[#5663f5] disabled:opacity-70 lg:h-[103px] lg:px-10 lg:text-[32px]"
        >
          {busy ? "Publishing…" : "Publish"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label: text,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={label}>
        {text}
      </label>
      {children}
    </div>
  );
}

// A native select styled like the mockup: gray "Select..." until a value is chosen.
function Select({
  options,
  onValueChange,
  className,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "defaultValue" | "value"> & {
  options: [string, string][];
  onValueChange?: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className={cn("relative", className)}>
      <select
        {...props}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          onValueChange?.(event.target.value);
        }}
        className={cn(field, "appearance-none pr-12", !value && "text-[#636363]")}
      >
        <option value="" disabled>
          Select...
        </option>
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue} className="text-black">
            {text}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-4 size-6 -translate-y-1/2 text-black"
        strokeWidth={1}
      />
    </div>
  );
}

function Radio({
  label: text,
  value,
  checked,
  onChange,
}: {
  label: string;
  value: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[15px] text-[#636363]">
      <input
        type="radio"
        name="frequency"
        value={value}
        checked={checked}
        onChange={onChange}
        className="size-[18px] accent-[#636363]"
      />
      {text}
    </label>
  );
}

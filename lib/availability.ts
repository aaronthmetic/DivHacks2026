import type { AvailabilityWindow } from "./exchange-schema";

// Weekly availability, shared by the domain rules, the listing form and modals, and later
// booking messages. Days are 0 (Sunday) to 6 (Saturday); times are minutes after midnight
// in New York time. Only type imports, so client components can use it.

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const SHORT_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Days in display order, Monday first. */
export const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0];

/** 1 to 7 windows on distinct days, each starting before it ends on the same day. */
export function isValidAvailability(windows: unknown): windows is AvailabilityWindow[] {
  if (!Array.isArray(windows) || windows.length < 1 || windows.length > 7) return false;
  const days = new Set<unknown>();
  for (const entry of windows) {
    if (typeof entry !== "object" || entry === null) return false;
    const { day, start, end } = entry as Record<string, unknown>;
    if (!whole(day, 0, 6) || days.has(day) || !whole(start, 0, 1439) || !whole(end, 0, 1439) || (start as number) >= (end as number)) return false;
    days.add(day);
  }
  return true;
}

function whole(value: unknown, min: number, max: number) {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

/** "17:30", a time input's value, → 1050; null when malformed. */
export function toMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** "Mon, Wed 5–8 PM · Sat 10 AM–2 PM": Monday first, days with the same hours grouped. */
export function formatAvailability(windows: AvailabilityWindow[] | undefined) {
  if (!windows?.length) return "Availability not listed";
  const groups = new Map<string, string[]>();
  for (const day of WEEK_DAYS) {
    const entry = windows.find((item) => item.day === day);
    if (!entry) continue;
    const hours = formatHours(entry.start, entry.end);
    groups.set(hours, [...(groups.get(hours) ?? []), SHORT_DAY_NAMES[day]]);
  }
  return [...groups].map(([hours, days]) => `${days.join(", ")} ${hours}`).join(" · ");
}

// The period is written once when both ends share it: "5–8 PM", but "10 AM–2 PM".
function formatHours(start: number, end: number) {
  const [from, fromPeriod] = clock(start), [until, untilPeriod] = clock(end);
  return fromPeriod === untilPeriod ? `${from}–${until} ${untilPeriod}` : `${from} ${fromPeriod}–${until} ${untilPeriod}`;
}

// 1050 → ["5:30", "PM"]; whole hours drop ":00".
function clock(minutes: number): [string, string] {
  const hours = Math.floor(minutes / 60), rest = minutes % 60, hour = hours % 12 || 12;
  return [rest ? `${hour}:${String(rest).padStart(2, "0")}` : String(hour), hours < 12 ? "AM" : "PM"];
}

// Converts between instants and New York wall-clock times. Availability and every time barter
// texts or shows for a booking are in New York time.

const ZONE = "America/New_York";

const clockParts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "short", month: "short", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit" });

/** The instant as a New York wall-clock time, like "2026-10-04T11:00". */
export function toNewYorkLocal(date: Date) {
  const part = Object.fromEntries(clockParts.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}`;
}

/** "2026-10-04T11:00" in New York → the instant; null when malformed or skipped by a clock change. */
export function fromNewYork(local: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  // New York is 4 or 5 hours behind UTC; keep the offset whose wall clock matches.
  for (const hours of [4, 5]) {
    const candidate = new Date(utc + hours * 3_600_000);
    if (toNewYorkLocal(candidate) === local) return candidate;
  }
  return null;
}

/** "Sat, Oct 4 at 11 AM" or "Sat, Oct 4 at 11:30 AM", in New York time. */
export function formatNewYork(date: Date) {
  // Intl may separate the time and AM/PM with a narrow no-break space; texts use plain spaces.
  return `${dayFormat.format(date)} at ${timeFormat.format(date).replace(":00", "")}`.replace(/\s+/g, " ");
}

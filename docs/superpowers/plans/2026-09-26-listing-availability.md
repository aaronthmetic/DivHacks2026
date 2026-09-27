# Listing Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require weekly availability windows on new listings, collect them in the create-listing modal, and show them in the listing modal.

**Architecture:** A client-safe module, `lib/availability.ts`, owns the rules: validation, time parsing and formatting. The domain (`validateService` and `createService`) requires and stores availability, booking snapshots copy it, and the listing endpoint parses a JSON form field into it. The explorer passes the windows to the page, where the listing modal formats them and the create form builds them from day chips and time inputs.

**Tech Stack:** Next.js 16.3 (App Router), React 19, TypeScript, Tailwind CSS v4, MongoDB Node driver, `node:test` with `tsx` and `mongodb-memory-server`.

Spec: `docs/superpowers/specs/2026-09-26-listing-availability-design.md`

## Global Constraints

- A window is `{ day, start, end }`. `day` is an integer from 0 (Sunday) to 6 (Saturday). `start` and `end` are integer minutes after midnight, 0–1439, in New York time, with `start < end` (no window runs past midnight).
- A listing has 1 to 7 windows, at most one per day. New listings require them. Existing listings are not migrated and show "Availability not listed".
- Availability is stored with only `day`, `start` and `end`, sorted by day. Booking snapshots copy it.
- The form field `availability` is a JSON array like `[{"day":1,"start":"17:00","end":"20:00"}]`, with `HH:MM` 24-hour times, at most 1,000 characters.
- Display: Monday first, with days that share hours grouped, e.g. `Mon, Wed 5–8 PM · Sat 10 AM–2 PM`. Minutes show when they aren't zero (`5:30–8 PM`). An empty or missing list gives `Availability not listed`. The listing modal appends ` (New York time)` when windows exist.
- Create form: Mon–Sun chips with `aria-pressed`, and time inputs with 15-minute steps (`step={900}`) labeled "Monday from" and "Monday until". A new row copies the most recently added row's hours, or 9 AM–5 PM for the first. The hint reads "Times are New York time."
- `lib/availability.ts` has only type imports, because it runs in client components.
- Match the surrounding code. Lib files use long single-line statements and terse comments; tests use `node:test` with `node:assert/strict`.
- Commands: run one test file with `node --import tsx --test tests/<file>.test.ts`. The full checks are `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Shared availability helpers

**Files:**
- Modify: `lib/exchange-schema.ts:14-17` (add the window type after `ServiceFrequency`)
- Create: `lib/availability.ts`
- Test: `tests/availability.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface AvailabilityWindow { day: number; start: number; end: number }` in `lib/exchange-schema.ts`
  - In `lib/availability.ts`: `DAY_NAMES: string[]` (index 0 = "Sunday"), `SHORT_DAY_NAMES: string[]` (index 0 = "Sun"), `WEEK_DAYS: number[]` (`[1, 2, 3, 4, 5, 6, 0]`), `isValidAvailability(windows: unknown): windows is AvailabilityWindow[]`, `toMinutes(time: string): number | null`, `formatAvailability(windows: AvailabilityWindow[] | undefined): string`

- [ ] **Step 1: Write the failing test**

Create `tests/availability.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAvailability, isValidAvailability, toMinutes } from "../lib/availability";

test("valid availability has 1 to 7 windows on distinct days, each ending after it starts", () => {
  assert.equal(isValidAvailability([{ day: 1, start: 1020, end: 1200 }, { day: 6, start: 600, end: 840 }]), true);
  assert.equal(isValidAvailability([0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: 0, end: 1439 }))), true);
  const invalid: unknown[] = [
    undefined, [], "Mon", [null],
    [{ day: 1, start: 600, end: 600 }], [{ day: 1, start: 700, end: 600 }],
    [{ day: 7, start: 0, end: 60 }], [{ day: -1, start: 0, end: 60 }], [{ day: 1.5, start: 0, end: 60 }],
    [{ day: 1, start: -1, end: 60 }], [{ day: 1, start: 0, end: 1440 }], [{ day: 1, start: "09:00", end: 60 }],
    [{ day: 1, start: 0, end: 60 }, { day: 1, start: 90, end: 120 }],
  ];
  for (const windows of invalid) assert.equal(isValidAvailability(windows), false, JSON.stringify(windows));
});

test("time input values convert to minutes after midnight", () => {
  assert.equal(toMinutes("00:00"), 0);
  assert.equal(toMinutes("17:30"), 1050);
  assert.equal(toMinutes("23:59"), 1439);
  for (const bad of ["24:00", "9:00", "17:60", "5pm", "17:30:00", ""]) assert.equal(toMinutes(bad), null, bad);
});

test("availability reads Monday first with shared hours grouped", () => {
  assert.equal(formatAvailability([{ day: 6, start: 600, end: 840 }, { day: 1, start: 1020, end: 1200 }, { day: 3, start: 1020, end: 1200 }]), "Mon, Wed 5–8 PM · Sat 10 AM–2 PM");
  assert.equal(formatAvailability([{ day: 0, start: 540, end: 1020 }, { day: 2, start: 1050, end: 1200 }]), "Tue 5:30–8 PM · Sun 9 AM–5 PM");
  assert.equal(formatAvailability([{ day: 5, start: 0, end: 720 }]), "Fri 12 AM–12 PM");
  assert.equal(formatAvailability([]), "Availability not listed");
  assert.equal(formatAvailability(undefined), "Availability not listed");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/availability.test.ts`
Expected: FAIL with `Cannot find module` for `../lib/availability`.

- [ ] **Step 3: Add the window type**

In `lib/exchange-schema.ts`, directly after the `ServiceFrequency` type (which ends at line 17), add:

```ts
/** A weekly window in New York time: `day` is 0 (Sunday) to 6 (Saturday); times are minutes after midnight. */
export interface AvailabilityWindow { day: number; start: number; end: number }
```

- [ ] **Step 4: Create the helpers**

Create `lib/availability.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test tests/availability.test.ts`
Expected: PASS with `# pass 3` and `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add lib/exchange-schema.ts lib/availability.ts tests/availability.test.ts
git commit -m "Add shared weekly availability helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Require availability on new listings

**Files:**
- Modify: `lib/exchange-schema.ts` (the `Service` interface and `ServiceSnapshot` type)
- Modify: `lib/exchange-service.ts:4-5` (imports), `:30` (validation), `:44` (storage helper), `:94` (stored document)
- Modify: `lib/booking-snapshot.ts:12`
- Modify: `lib/listing-service.ts:5-6, 13, 29, 49, 58`
- Modify: `lib/profile-seed.ts:60`
- Modify: `tests/exchange.test.ts:23`
- Modify: `tests/listing.test.ts`
- Modify: `docs/service-exchange.md`

**Interfaces:**
- Consumes: `AvailabilityWindow`, `isValidAvailability` and `toMinutes` from Task 1.
- Produces:
  - `Service.availability?: AvailabilityWindow[]` and `ServiceSnapshot.availability?: AvailabilityWindow[]`
  - `parseListingForm(form).input.availability`, a list of windows in minutes in the order the form sent them
  - The `availability` form field on `POST /api/services`
  - The test constant `storedAvailability` in `tests/listing.test.ts`, used again in Task 3

- [ ] **Step 1: Update the tests**

In `tests/listing.test.ts`, replace the `baseFields` line (line 43) with these lines:

```ts
const baseFields = (genre: string): Record<string, string> => ({ title: "Algebra help", genreId: genre, description: "Homework and test prep.", deliveryMode: "in_person", zipCode: "10027", coins: "5", per: "hour", frequency: "recurring", interval: "2", unit: "week", availability: JSON.stringify([{ day: 6, start: "10:00", end: "14:00" }, { day: 1, start: "17:00", end: "20:00" }]) });
// baseFields' availability in minutes, sorted by day the way it's stored.
const storedAvailability = [{ day: 1, start: 1020, end: 1200 }, { day: 6, start: 600, end: 840 }];
```

In the test "the listing form maps onto the service schema", replace the first `assert.deepEqual` (lines 57-61) with:

```ts
  assert.deepEqual({ ...input, genreId: input.genreId.toHexString() }, {
    genreId: genre, title: "Algebra help", description: "Homework and test prep.", deliveryMode: "in_person",
    zipCode: "10027", countryCode: "US", pricingType: "hourly", creditRate: 500,
    frequency: { type: "recurring", interval: 2, unit: "week" },
    availability: [{ day: 6, start: 600, end: 840 }, { day: 1, start: 1020, end: 1200 }], status: "active",
  });
```

In the same test, replace the `const invalid` line (line 65) with:

```ts
  const days = (...slots: object[]) => JSON.stringify(slots);
  const invalid: Record<string, string>[] = [{ zipCode: "" }, { zipCode: "1002" }, { coins: "0" }, { coins: "1.5" }, { per: "day" }, { frequency: "weekly" }, { interval: "0" }, { interval: "100" }, { unit: "year" }, { genreId: "nope" }, { title: " " },
    { availability: "" }, { availability: "[]" }, { availability: "Mondays" }, { availability: "{}" },
    { availability: days({ day: 1, start: "20:00", end: "17:00" }) }, { availability: days({ day: 1, start: "17:00", end: "17:00" }) },
    { availability: days({ day: 1, start: "5pm", end: "20:00" }) }, { availability: days({ day: 7, start: "17:00", end: "20:00" }) },
    { availability: days({ day: 1, start: "17:00", end: "20:00" }, { day: 1, start: "08:00", end: "09:00" }) },
    { availability: days({ day: 1, start: "17:00", end: "20:00", note: "x" }) },
    // Valid JSON, but longer than the 1,000-character limit.
    { availability: days({ day: 1, start: "17:00", end: "20:00" }).replace("[", `[${" ".repeat(1000)}`) },
  ];
```

After the test "frequency is validated, stored without extra keys, and snapshotted" (it ends at line 90), add:

```ts
test("availability is required, stored sorted without extra keys, and snapshotted", async () => {
  const user = await lister(5);
  const domain = createExchangeService(db, client);
  const input = { ...parseListingForm(listingForm(baseFields(await genreId()))).input };
  for (const availability of [undefined, [], [{ day: 1, start: 600, end: 600 }], [{ day: 7, start: 0, end: 60 }], [{ day: 1, start: 0, end: 60 }, { day: 1, start: 90, end: 120 }]]) {
    await assert.rejects(domain.createService(user.id, { ...input, availability } as never), JSON.stringify(availability));
  }
  const service = await domain.createService(user.id, { ...input, availability: [{ day: 6, start: 600, end: 840, note: "x" }, { day: 1, start: 1020, end: 1200 }] as never });
  assert.deepEqual((await exchangeCollections(db).services.findOne({ _id: service._id }))?.availability, storedAvailability);
  assert.deepEqual(snapshotService(service).availability, storedAvailability);
});
```

In the test "publishing requires a session and the app origin, stores photos, and cleans up failures", add this line directly after the `assert.deepEqual(service?.frequency, ...)` line (line 104):

```ts
  assert.deepEqual(service?.availability, storedAvailability);
```

and add this line directly after the line that posts `Buffer.from("not an image")` and expects 400 (line 112):

```ts
  assert.equal((await post(user.cookie, listingForm({ ...baseFields(genre), availability: "" }))).status, 400);
```

In `tests/exchange.test.ts`, replace line 23 with:

```ts
  const input = { genreId, title: "Lesson", description: "One lesson", pricingType: "fixed" as const, creditRate: rate, deliveryMode: "in_person" as const, zipCode: "00123", countryCode: "US", status: "active" as const, availability: [{ day: 1, start: 540, end: 1020 }] };
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/listing.test.ts`
Expected: FAIL. The tests that use `baseFields` throw `This request contains fields that cannot be set.`, because the endpoint doesn't know the `availability` field yet.

- [ ] **Step 3: Add the field to the schema**

In `lib/exchange-schema.ts`, replace the last two lines of the `Service` interface (the `frequency` comment and field, plus the closing brace) with:

```ts
  /** Services created before frequencies existed have none and are single-time. */
  frequency?: ServiceFrequency;
  /** Weekly windows (lib/availability.ts). Required for new listings; older ones have none. */
  availability?: AvailabilityWindow[];
}
```

Replace the `ServiceSnapshot` type's second line with:

```ts
  & Partial<Pick<Service, "genreId" | "deliveryMode" | "zipCode" | "countryCode" | "images" | "frequency" | "availability">>;
```

- [ ] **Step 4: Validate and store it in the domain**

In `lib/exchange-service.ts`, replace line 5 with these two lines:

```ts
import { isValidAvailability } from "./availability";
import { exchangeCollections, type AvailabilityWindow, type Booking, type Service, type ServiceFrequency } from "./exchange-schema";
```

In `validateService`, directly after the `input.frequency` line, add:

```ts
  requireValue(isValidAvailability(input.availability), "Choose the days and hours you're available, one time range per day.");
```

Directly after the `storedFrequency` function, add:

```ts
/** Copies only the known fields, sorted by day. */
function storedAvailability(availability: AvailabilityWindow[]): AvailabilityWindow[] {
  return availability.map(({ day, start, end }) => ({ day, start, end })).sort((a, b) => a.day - b.day);
}
```

In `createService`, replace the line that builds `const service: Service = { ... }` with:

```ts
        const service: Service = { _id: new ObjectId(), userId, genreId: input.genreId, title: input.title.trim(), description: input.description.trim(), deliveryMode: input.deliveryMode, pricingType: input.pricingType, creditRate: input.creditRate, status: input.status, images: [...(input.images ?? [])], ...(input.zipCode !== undefined ? { zipCode: input.zipCode.trim(), countryCode: input.countryCode } : {}), ...(input.frequency ? { frequency: storedFrequency(input.frequency) } : {}), availability: storedAvailability(input.availability!), createdAt: now, updatedAt: now };
```

(`validateService` has already rejected a missing list, so the non-null assertion holds.)

- [ ] **Step 5: Copy it into booking snapshots**

In `lib/booking-snapshot.ts`, directly after the `frequency` line (line 12), add:

```ts
    ...(service.availability !== undefined ? { availability: service.availability.map((entry) => ({ ...entry })) } : {}),
```

- [ ] **Step 6: Parse the form field**

In `lib/listing-service.ts`, replace line 6 with these two lines:

```ts
import { isValidAvailability, toMinutes } from "./availability";
import type { AvailabilityWindow, Service, ServiceFrequency } from "./exchange-schema";
```

Replace the `FIELDS` line with:

```ts
const FIELDS = ["title", "genreId", "description", "deliveryMode", "zipCode", "coins", "per", "frequency", "interval", "unit", "availability", "images"];
```

Directly after the `parseFrequency` function, add:

```ts
const AVAILABILITY_ERROR = "Choose the days and hours you're available.";

/** The form sends [{ day, start: "HH:MM", end: "HH:MM" }] as JSON; times are stored as minutes. */
function parseAvailability(value: string): AvailabilityWindow[] {
  if (!value) throw new InputError("Choose at least one day you're available.");
  let entries: unknown;
  try { entries = value.length <= 1000 ? JSON.parse(value) : null; } catch { entries = null; }
  if (!Array.isArray(entries)) throw new InputError(AVAILABILITY_ERROR);
  if (entries.length === 0) throw new InputError("Choose at least one day you're available.");
  const windows = entries.map((entry) => {
    if (typeof entry !== "object" || entry === null || Object.keys(entry).sort().join() !== "day,end,start") throw new InputError(AVAILABILITY_ERROR);
    const { day, start, end } = entry as Record<string, unknown>;
    const from = typeof start === "string" ? toMinutes(start) : null;
    const until = typeof end === "string" ? toMinutes(end) : null;
    if (from === null || until === null) throw new InputError("Enter a start and end time for each day.");
    if (until <= from) throw new InputError("Each day's end time must be after its start time.");
    return { day: day as number, start: from, end: until };
  });
  // Also rejects days outside Sunday to Saturday and repeated days.
  if (!isValidAvailability(windows)) throw new InputError(AVAILABILITY_ERROR);
  return windows;
}
```

In `parseListingForm`, directly after the `const frequency = parseFrequency(...)` line, add:

```ts
  const availability = parseAvailability(text(form, "availability"));
```

and in its returned `input`, replace `frequency, status: "active",` with:

```ts
      frequency, availability, status: "active",
```

- [ ] **Step 7: Give the demo listings availability**

`lib/profile-seed.ts` runs each demo listing through `validateService`, so the demo needs availability now. In the `listing()` helper, replace the `pricingType` line (line 60) with:

```ts
          pricingType: inPerson ? "hourly" : "fixed", creditRate: 100,
          availability: [{ day: 1, start: 1020, end: 1200 }, { day: 6, start: 600, end: 840 }],
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --import tsx --test tests/listing.test.ts tests/exchange.test.ts tests/profile-seed.test.ts tests/availability.test.ts`
Expected: PASS with `# fail 0`.

- [ ] **Step 9: Document the field**

In `docs/service-exchange.md`:

1. In the collections table, replace `pricing type/rate, frequency, status, timestamps.` with `pricing type/rate, frequency, weekly availability, status, timestamps.`
2. After the paragraph that starts ``A listing's `frequency` is either``, add this paragraph:

   ```markdown
   A listing's `availability` is a list of 1–7 weekly windows `{ day, start, end }`. `day` is 0 (Sunday) to 6 (Saturday), and `start` and `end` are minutes after midnight in New York time, with `start < end` on the same day and at most one window per day. New listings require it. It's stored sorted by day with only those keys, and booking snapshots copy it. Listings created before the field existed have none and show as "Availability not listed"; no migration is needed. `lib/availability.ts` validates and formats it.
   ```

3. In the "Listing endpoint and map page" section, replace ``and up to five `images` (JPEG, PNG, or WebP).`` with ```availability` (a JSON array of `{ day, start, end }` with `HH:MM` 24-hour times, at most 1,000 characters), and up to five `images` (JPEG, PNG, or WebP).``
4. Replace `Messaging, structured availability, distance search,` with `Messaging, distance search,`.

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck`
Expected: `✓ Types generated successfully`, then no errors (exit code 0).

- [ ] **Step 11: Commit**

```bash
git add lib/exchange-schema.ts lib/exchange-service.ts lib/booking-snapshot.ts lib/listing-service.ts lib/profile-seed.ts tests/exchange.test.ts tests/listing.test.ts docs/service-exchange.md
git commit -m "Require weekly availability on new listings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Show availability in the listing modal

**Files:**
- Modify: `lib/barter/data.ts` (the UI `Service` type)
- Modify: `lib/listing-data.ts:48`
- Modify: `components/barter/listing-modal.tsx:1-10, 63`
- Modify: `tests/listing.test.ts:138-143`

**Interfaces:**
- Consumes: `formatAvailability` (Task 1), the stored `Service.availability` (Task 2), and the test constant `storedAvailability` (Task 2).
- Produces: `availability: AvailabilityWindow[]` on the UI `Service` type (empty for old listings), filled by `getExplorerData`. Task 4 doesn't depend on it.

- [ ] **Step 1: Update the explorer test**

In `tests/listing.test.ts`, in the test "the explorer lists active listings with provider ratings and labels", replace the `assert.deepEqual(data.listings.find(...), { ... })` block (lines 138-143) with:

```ts
  assert.deepEqual(data.listings.find((listing) => listing.id === shown._id.toHexString()), {
    id: shown._id.toHexString(), title: "Laptop setup", description: "Homework and test prep.", category: "Tech", images: [],
    rating: 4.5, ratingCount: 2, location: "Morningside Heights", zip: "10027",
    tags: ["12 coins / service", "In person", "One time"], availability: storedAvailability,
    providerId: provider.id.toHexString(), providerName: "List Owner", own: false,
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/listing.test.ts`
Expected: FAIL in "the explorer lists active listings…" with `Expected values to be strictly deep-equal`, because the actual object has no `availability`.

- [ ] **Step 3: Add the field to the UI type**

In `lib/barter/data.ts`, add this import directly after the two opening comment lines:

```ts
import type { AvailabilityWindow } from "../exchange-schema";
```

and in the `Service` type, directly after `tags: string[];`, add:

```ts
  /** Weekly windows in New York time; empty for listings posted before availability existed. */
  availability: AvailabilityWindow[];
```

- [ ] **Step 4: Pass it from the explorer data**

In `lib/listing-data.ts`, replace line 48 (`zip, tags: [...],`) with:

```ts
      zip, tags: [priceLabel(s), DELIVERY[s.deliveryMode], frequencyLabel(s.frequency)], availability: s.availability ?? [],
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test tests/listing.test.ts`
Expected: PASS with `# fail 0`.

- [ ] **Step 6: Show it in the modal**

In `components/barter/listing-modal.tsx`, add this import after the `import type { Service } ...` line:

```ts
import { formatAvailability } from "@/lib/availability";
```

and directly after the closing `</ul>` of the Details list (line 63, inside the Description `<section>`), add:

```tsx
              <h3 className="mt-6 font-mono text-xl font-bold lg:mt-8 lg:text-2xl">Availability</h3>
              <p className="mt-3 font-mono text-base text-barter-gray lg:mt-4 lg:text-xl">
                {formatAvailability(service.availability)}
                {service.availability.length > 0 && " (New York time)"}
              </p>
```

- [ ] **Step 7: Check it in the browser**

The home page needs a signed-in account, so check the modal on a temporary page instead. Create `app/availability-check/page.tsx`:

```tsx
// TEMPORARY: availability check page. Delete before committing.
"use client";

import { ListingModal } from "@/components/barter/listing-modal";
import type { Service } from "@/lib/barter/data";

const listing: Service = {
  id: "check", title: "Guitar lessons", description: "Beginner and intermediate lessons.", category: "Music", images: [],
  rating: 4.5, ratingCount: 2, location: "Morningside Heights", zip: "10027", tags: ["5 coins / hour", "In person", "One time"],
  availability: [{ day: 1, start: 1020, end: 1200 }, { day: 3, start: 1020, end: 1200 }, { day: 6, start: 600, end: 840 }],
  providerId: "p", providerName: "Test Provider", own: false,
};

export default function AvailabilityCheck() {
  return <ListingModal service={listing} onClose={() => {}} />;
}
```

With the dev server running (`npm run dev`, port 3000), open `http://localhost:3000/availability-check`. Expected: the modal shows an "Availability" heading, then `Mon, Wed 5–8 PM · Sat 10 AM–2 PM (New York time)`. Change `availability` to `[]`, reload, and expect `Availability not listed` with no "(New York time)".

Then delete the page:

```bash
rm -r app/availability-check
```

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit with code 0 and no errors.

- [ ] **Step 9: Commit**

```bash
git status --short   # expect no app/availability-check
git add lib/barter/data.ts lib/listing-data.ts components/barter/listing-modal.tsx tests/listing.test.ts
git commit -m "Show listing availability in the listing modal" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Collect availability in the create-listing modal

**Files:**
- Modify: `components/barter/create-listing.tsx`

**Interfaces:**
- Consumes: `DAY_NAMES`, `SHORT_DAY_NAMES` and `WEEK_DAYS` (Task 1), and the `availability` form field that `POST /api/services` accepts (Task 2).
- Produces: nothing new for other code.

- [ ] **Step 1: Add the day state**

In `components/barter/create-listing.tsx`, add this import after `import type { CategoryOption } from "@/lib/barter/data";`:

```ts
import { DAY_NAMES, SHORT_DAY_NAMES, WEEK_DAYS } from "@/lib/availability";
```

After the line `type Photo = { id: number; file: File; url: string };`, add:

```ts
// A chosen day's hours, as the time inputs' "HH:MM" values.
type DayHours = { day: number; start: string; end: string };
```

In `CreateListingForm`, after `const [frequency, setFrequency] = useState<"single" | "recurring">("single");`, add:

```ts
  const [days, setDays] = useState<DayHours[]>([]);
```

After the `removePhoto` function, add:

```ts
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
```

- [ ] **Step 2: Validate and send it on submit**

In `submit`, directly after `if (busy) return;`, add:

```ts
    if (days.length === 0) {
      setError("Choose at least one day you're available.");
      return;
    }
    // Time inputs give zero-padded 24-hour values, so they compare as strings.
    if (days.some((row) => !row.start || !row.end || row.end <= row.start)) {
      setError("Each day's end time must be after its start time.");
      return;
    }
```

and directly after `const form = new FormData(event.currentTarget);`, add:

```ts
    form.set("availability", JSON.stringify(days));
```

- [ ] **Step 3: Add the availability group**

Directly after the closing `</div>` of the Frequency group (the `<div role="group" aria-labelledby="new-listing-frequency">` block that ends at line 289) and before `<div className="lg:col-start-1">` (Image upload), add:

```tsx
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
```

The time inputs must stay unnamed. `new FormData(form)` would otherwise send them as extra fields, and the endpoint rejects unknown fields.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit with code 0 and no errors.

- [ ] **Step 5: Check it in the browser**

Create `app/create-listing-check/page.tsx`:

```tsx
// TEMPORARY: create-listing check page. Delete before committing.
"use client";

import { CreateListingModal } from "@/components/barter/create-listing";

export default function CreateListingCheck() {
  return (
    <CreateListingModal
      open
      categories={[{ id: "000000000000000000000001", name: "Music" }]}
      onClose={() => {}}
      onPublished={() => {}}
    />
  );
}
```

Open `http://localhost:3000/create-listing-check` and check:

1. Click **Mon**. A row "Mon 09:00 to 17:00" appears and the chip reports `aria-pressed="true"`. Change it to 17:00–20:00.
2. Click **Wed**. Its row copies 17:00–20:00. Click **Sat** and change it to 10:00–14:00. The rows are listed Mon, Wed, Sat.
3. Record what the form would send by running this in the page's console (it stubs `fetch` for this page only):

   ```js
   window.sent = null;
   const realFetch = window.fetch;
   window.fetch = (url, init) => {
     if (String(url).includes("/api/services")) {
       window.sent = init.body.get("availability");
       return Promise.resolve(new Response(JSON.stringify({ error: { message: "captured" } }), { status: 400 }));
     }
     return realFetch(url, init);
   };
   ```

4. Fill in Title, Category, Description, Zip code `10027`, Delivery method, coins `5` and per `hour`, then click **Publish**. Expected: the banner says `captured`, and `window.sent` is `[{"day":1,"start":"17:00","end":"20:00"},{"day":3,"start":"17:00","end":"20:00"},{"day":6,"start":"10:00","end":"14:00"}]`.
5. Set Sat's end to 09:00 and click **Publish**. Expected: `Each day's end time must be after its start time.`
6. Deselect Mon, Wed and Sat, then click **Publish**. Expected: `Choose at least one day you're available.`

Then delete the page:

```bash
rm -r app/create-listing-check
```

- [ ] **Step 6: Run the full checks**

Run: `npm test && npm run build`
Expected: the tests report `# fail 0` and the build exits with code 0.

- [ ] **Step 7: Commit**

```bash
git status --short   # expect no app/create-listing-check
git add components/barter/create-listing.tsx
git commit -m "Collect weekly availability in the create-listing modal" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Report back**

Report the results. Push to `main` only when the user asks: pull first, then push straight to `main` if there are no conflicts.

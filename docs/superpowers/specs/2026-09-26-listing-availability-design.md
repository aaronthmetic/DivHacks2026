# Listing availability

Every new listing states when the provider is available, as weekly time windows. The create-listing modal collects them, the listing modal shows them, and the Contact flow (the Photon booking project, specified separately) will let a requester pick one.

## Data model

`lib/exchange-schema.ts` adds:

```ts
/** A weekly window in New York time. `day` is 0 (Sunday) to 6 (Saturday); times are minutes after midnight. */
export interface AvailabilityWindow { day: number; start: number; end: number }
```

and `availability?: AvailabilityWindow[]` on `Service`. The field is optional in the type only because listings created before it have none; `validateService` requires it for every new listing.

A valid list has 1 to 7 windows, at most one per day. `day` is an integer from 0 to 6; `start` and `end` are integers from 0 to 1439 with `start < end` (a window can't run past midnight). `createService` stores only those three keys, sorted by day, the way `storedFrequency` stores frequencies. `snapshotService` copies the list into booking snapshots like `frequency`, and `ServiceSnapshot` gains the optional field.

Existing listings are not migrated. Anything that shows availability treats a missing list as "not listed".

## Listing endpoint

`POST /api/services` accepts one more multipart field, `availability`: a JSON array such as `[{"day":1,"start":"17:00","end":"20:00"}]`, with times in the `HH:MM` 24-hour form that time inputs produce. `parseListingForm` rejects it, with a message for the user, when it is missing, longer than 1,000 characters, not a JSON array, or has entries with other keys, a day outside 0–6, a repeated day, a malformed time, or an end not after its start. It converts the times to minutes before `validateService` runs.

## Shared helpers

A new `lib/availability.ts` holds the rules and formatting, so the server, the modals and later the Photon messages agree:

- `isValidAvailability(windows)` for `validateService`.
- `toMinutes("17:30")` (1050, or `null` when malformed) for the endpoint.
- `formatAvailability(windows)` for display. It lists days Monday first, groups days with identical hours, and writes compact times: `Mon, Wed 5–8 PM · Sat 10 AM–2 PM`, and `5:30–8 PM` when minutes aren't zero. An empty or missing list gives `Availability not listed`.
- Day names (`DAY_NAMES`, `SHORT_DAY_NAMES`) and the Monday-first order (`WEEK_DAYS`) for the form.

It imports the window type with `import type` and nothing from the server, so client components can use it without pulling in the MongoDB driver. The form-field parser, `parseAvailability`, lives in `lib/listing-service.ts` beside `parseFrequency`, because it throws the endpoint's `InputError`.

## Create-listing modal

A full-width "Availability" group joins the form, after Frequency:

- Seven toggle chips, Mon to Sun (`aria-pressed`).
- Each selected day adds a row with the day's name and two time inputs (15-minute steps), labeled for screen readers ("Monday from", "Monday until"). A new row copies the hours of the most recently added row, or 9 AM–5 PM for the first. Deselecting a day removes its row.
- The form requires at least one day and an end after each start before submitting, and sends the rows as the `availability` field. The server's messages still show in the form's error banner.
- A hint under the group says times are New York time.

## Listing modal

`Service` in `lib/barter/data.ts` gains `availability: AvailabilityWindow[]` (empty for old listings), filled by `getExplorerData`. The listing modal adds an "Availability" section under the description that shows `formatAvailability` followed by "(New York time)", or "Availability not listed". Result cards don't change.

## Out of scope

Picking a window when contacting a provider (part of the Photon booking project), several windows on one day, windows past midnight, other time zones, and editing existing listings (there's no edit screen yet).

## Testing

- `tests/availability.test.ts` (new, no database): `isValidAvailability`, `toMinutes`, and `formatAvailability` grouping, minute formatting, day order and the empty case.
- `tests/listing.test.ts`: `parseListingForm` accepts a valid list and rejects each invalid case above; the domain requires availability, stores it sorted without extra keys, and snapshots it; the endpoint stores it; the explorer passes it to the page.
- Tests that create services through `createService` (`tests/exchange.test.ts`, `tests/listing.test.ts`) add availability to their inputs, since it becomes required.
- The demo listings in `lib/profile-seed.ts` run through `validateService` before they're inserted, so they get sample availability too. The unused service-insert helper in `lib/exchange-actions.ts` (only its `addBooking` is used, by a test) doesn't validate and is left as is.
- `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass, and a quick browser check covers creating a listing with availability and seeing it in the listing modal.

`docs/service-exchange.md` documents the new field and form parameter.

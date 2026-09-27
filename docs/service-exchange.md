# Service exchange data model

`lib/exchange-schema.ts` defines MongoDB document types and indexes. `lib/exchange-service.ts` provides server-side validation and transactional operations. References use MongoDB ObjectIds, including references to the existing Better Auth `user` collection. These are TypeScript schemas with application validation, not MongoDB collection validators; application writes must use the domain operations.

| Collection | Contents |
| --- | --- |
| `user` | Existing authentication fields plus optional `bio`, `zipCode`, `countryCode`; server-managed `rating`, `numberOfReviews`, and `reviews`. |
| `genre` | Name, unique slug, description, active flag. Categories are managed server-side. |
| `service` | Provider (`userId`), genre, title, description, location, delivery mode, pricing type/rate, frequency, weekly availability, status, timestamps. |
| `booking` | Service and participants, immutable category, description, delivery/location, image-ID and pricing snapshot, agreed duration/total, optional schedule, status and completion timestamps. |
| `creditAccount` | One account per user; available and held balances. |
| `creditTransaction` | Append-only balance deltas, account/booking references, operation type, unique idempotency key, creation time. |
| `review` | Completed booking, author, other participant, rating from 1–5, comment. One per author per booking. |

## Credit units and pricing

Every credit field, including rates and ledger deltas, uses integer hundredths: `1000` means **10 credits**. Convert user-entered credit amounts at a future API boundary; never send a decimal credit amount directly to these functions. Fixed pricing charges `creditRate`. Hourly pricing requires positive integer minutes and rounds `creditRate * durationMinutes / 60` once to the nearest hundredth (half up). Rates and totals must fit safe JavaScript integers and be positive. Fixed bookings omit duration.

Delivery modes are `remote`, `in_person`, and `either`. The latter two require a string postal code and uppercase two-letter country code. Postal codes preserve leading zeros. Service states are `active`, `paused`, and `archived`.

A listing's `frequency` is either `{ type: "single" }` or `{ type: "recurring", interval, unit }`, where `interval` is a whole number from 1 to 99 and `unit` is `day`, `week`, or `month` (so "every 2 weeks" is `{ type: "recurring", interval: 2, unit: "week" }`). Only those keys are stored, and booking snapshots copy it. Listings created before the field existed have none and are treated as single-time; no migration is needed.

A listing's `availability` is a list of 1–7 weekly windows `{ day, start, end }`. `day` is 0 (Sunday) to 6 (Saturday), and `start` and `end` are minutes after midnight in New York time, with `start < end` on the same day and at most one window per day. New listings require it. It's stored sorted by day with only those keys, and booking snapshots copy it. Listings created before the field existed have none and show as "Availability not listed"; no migration is needed. `lib/availability.ts` validates and formats it.

## Server interfaces

Construct `createExchangeService(db, client)` with a database and its owning MongoClient. Its methods are:

- `grantWelcome(userId, session?)`: grant 1000 units once to a complete profile. The optional session must already be in a transaction; otherwise the method creates one.
- `createService(userId, input)`: validate a complete provider, active genre, and service fields.
- `requestBooking(requesterId, serviceId, { durationMinutes?, scheduledAt? })`: snapshot an active listing and reserve the total from the requester.
- `transitionBooking(actorId, bookingId, action)`: enforce participant roles and booking transitions, with transactional refunds/payment.
- `createReview(authorId, bookingId, rating, comment)`: derive the subject from the booking and enforce completed-booking participation.

Actor IDs must come from authenticated server sessions, never a client-supplied identity. Booking requests come through `POST /api/bookings`; see "Booking requests" below.

## Listing endpoint and map page

`POST /api/services` publishes a listing for the signed-in user through `createService`. It takes a multipart form: `title`, `genreId`, `description`, `deliveryMode`, `zipCode` (5 digits; optional only for `remote`, and stored with country `US`), `coins` (a whole number, stored as `creditRate = coins × 100`), `per` (`hour` → `hourly`, `service` → `fixed`), `frequency` (`single` or `recurring`, with `interval` and `unit` when recurring), `availability` (a JSON array of `{ day, start, end }` with `HH:MM` 24-hour times, at most 1,000 characters), and up to five `images` (JPEG, PNG, or WebP). Like the profile endpoints it requires the configured `Origin`, a complete account, and the shared 20-per-minute mutation limit; it rejects unknown or repeated fields. The whole request is capped at 4 MiB, below Vercel's 4.5 MB function limit, and the form shrinks larger photos in the browser first. Photos are validated by signature and stored in GridFS with `{ ownerId, purpose: "service" }` metadata before the listing is created; if creation fails they are deleted. It returns `201 { success: true, id }` or `{ error: { code, message } }` with 400, 401, 403, 413, 429, or 503.

The map page (`/`) loads the 200 newest active listings in active categories with `getExplorerData` (`lib/listing-data.ts`). It shows each provider's review average and count, never their contact details, plus the viewer's available balance. Contact on a listing opens a request form when both people have turned on texts. Optional user fields are declared in auth configuration but are not editable through the existing name-only profile endpoint.

The provider can accept or decline a requested booking. Either participant can cancel a requested or accepted booking. The provider marks an accepted booking delivered (`awaiting_confirmation`); the requester confirms to complete and pay. Repeating an authorized transition whose target is already current is a no-op. Invalid transitions fail without changing balances. Decline/cancel release held credits; completion removes the requester's hold and increases the provider's available balance. There is no automatic settlement or dispute workflow.

Each requestBooking call creates a new booking; transport-level retries should not blindly repeat that call. Settlement and grants use deterministic ledger keys and state checks for idempotency. The domain exposes no ledger editing operation. Direct administrative database writes can bypass these application rules.

## Booking requests

- **Turning on texts:**
  - Complete accounts are registered with Photon at the start of a session, after Google profile completion, and when someone taps "Turn on texts" (`POST /api/texts`, which returns `{ number }`).
  - That registration stores `photonUserId` and `photonNumber` on the user.
  - The first text barter receives from a phone sets `textsEnabledAt`.
  - Changing the phone number unsets all three.
- **`POST /api/bookings`:**
  - Takes JSON `{ serviceId, window, hours, note }`.
  - `window` is one of the listing's availability windows, or null for listings without any. `hours` is 1–8 for hourly listings. `note` is at most 300 characters.
  - It needs the configured `Origin`, a complete account, the shared rate limit, and texts turned on for both people.
  - It calls `requestBooking`, which stores `preferredWindow` and `note` and holds the total. It then texts the provider, and after that the requester.
  - If the provider's text fails, the request is cancelled and the coins are returned (503).
  - It returns `201 { success: true, id }`, or `{ error: { code, message } }` with 400, 401, 403, 404, 409, 429 or 503.
- **Replies:**
  - Photon posts incoming texts to `POST /api/photon/webhook`, which verifies `SPECTRUM_WEBHOOK_SECRET`, skips message IDs it has seen (the `photonMessage` collection, 7-day TTL), and answers 200. It then handles the text in `after()`.
  - YES or NO, with the request code when several are waiting, accepts or declines through `transitionBooking`, and both people are texted.

## Setup and existing users

MongoDB must support multi-document transactions (a replica set or sharded cluster, including Atlas). Run `npm run db:indexes` to install both authentication and exchange indexes. Startup also builds the exchange indexes in the background; a failure there is logged and never blocks authentication. Duplicate existing records must be resolved before unique indexes can be installed. No production database migration is executed by the source changes alone.

Every new session (registration or sign-in) grants missing welcome credits to complete users after the authentication transaction commits. A failed grant is logged and never blocks authentication; the next session or profile update retries it. Google profile completion and its welcome grant commit together. Incomplete users receive no credits. Users who already have a welcome ledger entry skip the grant transaction entirely. Providers without a credit account (for example, accounts created before welcome grants existed) get an empty one when their service is first booked, so settlement can always pay them.

**Verification:** requests require both people to have turned on texts, which means texting barter from their own phone and proves they own the number. Welcome credits still go to accounts whose email and phone are unverified, so add verification or another abuse control before exposing review endpoints. The internal `user.creditGrantVersion` counter serializes first-time grants; it is not client-editable.

Genres are managed server-side. The app inserts eight default categories (Tutoring, Music, Repairs, Pets, Beauty, Creative, Fitness, Tech; see `DEFAULT_GENRES`) in the background at startup and during `npm run db:indexes`, matched by slug; categories that already exist are never changed, so an admin can rename or deactivate them. Other categories must still be inserted by a trusted server/admin process; the profile fixture script creates its own clearly labeled demo categories. Free-text messaging between people, distance search, cash conversion, platform fees, and moderation remain future additions.

## Verification

`npm test` uses temporary MongoDB replica sets and covers onboarding, pricing, reference/location validation, immutable snapshots, concurrent spending, refunds, settlement retries, transaction rollback, and review ownership. `npm run typecheck` and `npm run lint` check static correctness.

## User review fields

`rating` is the average of reviews **received** by the user, `numberOfReviews` is their count, and `reviews` is an array of hexadecimal review-document IDs. Full ratings/comments remain in the `review` collection. New accounts default to `0`, `0`, and `[]`. These fields cannot be set through registration or profile input. Creating a review updates the recipient and review collection in one transaction; duplicate reviews leave the summary unchanged. Concurrent reviews of one recipient are serialized to avoid lost updates.

Existing stored users are not bulk-migrated. Missing summary fields mean no cached summary; the next received review rebuilds all three fields from all existing reviews for that user. Readers needing historical totals before that should query the review collection.

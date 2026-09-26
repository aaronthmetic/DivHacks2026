# Service exchange data model

`lib/exchange-schema.ts` defines MongoDB document types and indexes. `lib/exchange-service.ts` provides server-side validation and transactional operations. References use MongoDB ObjectIds, including references to the existing Better Auth `user` collection. These are TypeScript schemas with application validation, not MongoDB collection validators; application writes must use the domain operations.

| Collection | Contents |
| --- | --- |
| `user` | Existing authentication fields plus optional `bio`, `zipCode`, `countryCode`; server-managed `rating`, `numberOfReviews`, and `reviews`. |
| `genre` | Name, unique slug, description, active flag. Categories are managed server-side. |
| `service` | Provider (`userId`), genre, title, description, location, delivery mode, pricing type/rate, status, timestamps. |
| `booking` | Service and participants, immutable category, description, delivery/location, image-ID and pricing snapshot, agreed duration/total, optional schedule, status and completion timestamps. |
| `creditAccount` | One account per user; available and held balances. |
| `creditTransaction` | Append-only balance deltas, account/booking references, operation type, unique idempotency key, creation time. |
| `review` | Completed booking, author, other participant, rating from 1–5, comment. One per author per booking. |

## Credit units and pricing

Every credit field, including rates and ledger deltas, uses integer hundredths: `1000` means **10 credits**. Convert user-entered credit amounts at a future API boundary; never send a decimal credit amount directly to these functions. Fixed pricing charges `creditRate`. Hourly pricing requires positive integer minutes and rounds `creditRate * durationMinutes / 60` once to the nearest hundredth (half up). Rates and totals must fit safe JavaScript integers and be positive. Fixed bookings omit duration.

Delivery modes are `remote`, `in_person`, and `either`. The latter two require a string postal code and uppercase two-letter country code. Postal codes preserve leading zeros. Service states are `active`, `paused`, and `archived`.

## Server interfaces

Construct `createExchangeService(db, client)` with a database and its owning MongoClient. Its methods are:

- `grantWelcome(userId, session?)`: grant 1000 units once to a complete profile. The optional session must already be in a transaction; otherwise the method creates one.
- `createService(userId, input)`: validate a complete provider, active genre, and service fields.
- `requestBooking(requesterId, serviceId, { durationMinutes?, scheduledAt? })`: snapshot an active listing and reserve the total from the requester.
- `transitionBooking(actorId, bookingId, action)`: enforce participant roles and booking transitions, with transactional refunds/payment.
- `createReview(authorId, bookingId, rating, comment)`: derive the subject from the booking and enforce completed-booking participation.

Actor IDs must come from authenticated server sessions, never a client-supplied identity. No booking HTTP endpoints or UI are included. Optional user fields are declared in auth configuration but are not editable through the existing name-only profile endpoint.

The provider can accept or decline a requested booking. Either participant can cancel a requested or accepted booking. The provider marks an accepted booking delivered (`awaiting_confirmation`); the requester confirms to complete and pay. Repeating an authorized transition whose target is already current is a no-op. Invalid transitions fail without changing balances. Decline/cancel release held credits; completion removes the requester's hold and increases the provider's available balance. There is no automatic settlement or dispute workflow.

Each requestBooking call creates a new booking; transport-level retries should not blindly repeat that call. Settlement and grants use deterministic ledger keys and state checks for idempotency. The domain exposes no ledger editing operation. Direct administrative database writes can bypass these application rules.

## Setup and existing users

MongoDB must support multi-document transactions (a replica set or sharded cluster, including Atlas). Run `npm run db:indexes` to install both authentication and exchange indexes. Startup also builds the exchange indexes in the background; a failure there is logged and never blocks authentication. Duplicate existing records must be resolved before unique indexes can be installed. No production database migration is executed by the source changes alone.

Every new session (registration or sign-in) grants missing welcome credits to complete users after the authentication transaction commits. A failed grant is logged and never blocks authentication; the next session or profile update retries it. Google profile completion and its welcome grant commit together. Incomplete users receive no credits. Users who already have a welcome ledger entry skip the grant transaction entirely. Providers without a credit account (for example, accounts created before welcome grants existed) get an empty one when their service is first booked, so settlement can always pay them.

**Before exposing booking or review endpoints:** welcome credits currently go to accounts whose email and phone are unverified, so scripted sign-ups could farm credits and reviews. Add verification or another abuse control first. The internal `user.creditGrantVersion` counter serializes first-time grants; it is not client-editable.

Genres must be inserted by a trusted server/admin process before listings can be created; the profile fixture script creates its own clearly labeled demo categories. Messaging, structured availability, distance search, cash conversion, platform fees, and moderation remain future additions.

## Verification

`npm test` uses temporary MongoDB replica sets and covers onboarding, pricing, reference/location validation, immutable snapshots, concurrent spending, refunds, settlement retries, transaction rollback, and review ownership. `npm run typecheck` and `npm run lint` check static correctness.

## User review fields

`rating` is the average of reviews **received** by the user, `numberOfReviews` is their count, and `reviews` is an array of hexadecimal review-document IDs. Full ratings/comments remain in the `review` collection. New accounts default to `0`, `0`, and `[]`. These fields cannot be set through registration or profile input. Creating a review updates the recipient and review collection in one transaction; duplicate reviews leave the summary unchanged. Concurrent reviews of one recipient are serialized to avoid lost updates.

Existing stored users are not bulk-migrated. Missing summary fields mean no cached summary; the next received review rebuilds all three fields from all existing reviews for that user. Readers needing historical totals before that should query the review collection.

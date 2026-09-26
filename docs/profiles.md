# Profiles

Signed-in members can visit `/profile` or `/profile/[userId]`. Only the owner sees bookings and the edit link. `/profile/edit` provides separate name, contact, password, and picture forms. Listing and booking cards currently open read-only dialogs.

## Data and compatibility

The canonical picture field is Better Auth's optional `user.image` URL. New accounts without a picture receive `/default-avatar.svg`; older missing images and failed browser loads fall back to that asset. No backfill is needed. Profile reads project public user fields and never serialize another user's contact details or bookings.

Reviews use `?reviewsPage=`, ten entries per page, newest first with an ID tie-breaker. Active requested bookings sort by scheduled date, including overdue items, followed by undated requests. Displayed booking times are labeled UTC. Listing and booking IDs remain available for future management actions.

The normal database initializer installs the added indexes; `npm run db:indexes` can also prepare them explicitly before rollout.

## Account and picture endpoints

- `PATCH /api/profile`: partial `firstName`, `lastName`, `email`, and `phoneNumber`; contact edits require `currentPassword` for credential accounts or a Google sign-in session created within five minutes. Changed identifiers become unverified. Phone numbers must include the country code.
- `POST /api/auth/change-password`: `currentPassword`, `newPassword`; other sessions are always revoked regardless of the client's `revokeOtherSessions` value. Google-only accounts cannot create a password here.
- `POST /api/profile/image`: multipart field `image`, one JPEG/PNG/WebP file up to 5 MiB, with signature validation and a bounded request body.
- `DELETE /api/profile/image`: restores the default picture.

Profile mutations require the configured origin, a complete authenticated account, and a shared per-user mutation rate limit. Images are stored in GridFS with profile-purpose and owner metadata. Failed uploads are cleaned up; replacing a photo deletes the former user-owned image only when no user or service references it. Cleanup failures are logged separately so an already saved photo is not reported as a failed save. Image bytes are served by the existing public, immutable image endpoint.

The Google sign-in endpoint accepts only `provider: "google"` and an optional `reauthenticate: true` flag; reauthentication uses a fixed `/profile/edit` return path. Arbitrary redirects, scopes, provider parameters, and unrelated account operations remain blocked.

## Validation

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`. Integration tests use isolated temporary MongoDB replica sets. If Turbopack is unavailable in the host environment, `npm run build -- --webpack` validates the production bundle with webpack.

## Profile fixtures

Run `npm run db:seed-profile` to seed `john.doe@email.com` in the configured database, or pass another existing complete account's email as a positional argument. The script creates four owner listings (three active, one paused), five listings from a dedicated demo provider, and five bookings. Four dates are 1, 2, 4, and 7 days after the first seed run; an additional request has no schedule.

Each booking reserves one credit. The target must have at least five available credits; no funds are fabricated. All fixture documents, reservations, ledger entries, and the `profileSeed` completion record commit in one transaction. Reruns return the existing fixture counts without adding records, resetting schedules, or reserving credits again. Existing unrelated data and account credentials remain unchanged. The provider has a reserved fictional phone number and `.invalid` email, and no login credentials.

Bookings now snapshot category, delivery mode, location, and image IDs as well as description and pricing. Older bookings may lack the added fields and still render. Snapshot image IDs reference GridFS files; changing a listing's current image list does not rewrite its bookings.

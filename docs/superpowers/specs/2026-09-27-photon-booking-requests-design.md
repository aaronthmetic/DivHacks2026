# Photon booking requests (Part A)

People request services by text. After signing up, a person turns on texts once. Contact on a listing then sends a request that holds the coins, Photon texts both people, and the provider answers YES or NO by text. Part B, specified separately, adds an assistant that helps both people pick the exact time and place after a YES.

## What people see

### Turning on texts

Signup doesn't change, because a phone number is already required for both password and Google accounts. Behind the scenes, barter registers each complete account's phone with Photon, which assigns the barter number that person texts.

Photon can only text someone after they've texted their barter number once. Until a person has done that, the home page shows a banner: "Turn on texts to send and receive requests." Its button asks the server for the person's barter number, registering them with Photon first if needed. It then opens `sms:<number>?&body=Hi%20barter!` on phones; on a computer, it shows the number and the message to send. A "Check again" button refreshes the page.

When that first text arrives, barter records that texts are on and replies: "barter: You're all set. We'll text you here about requests." The banner disappears on the next page load. Because the text comes from the person's own phone, it also verifies the number.

### Contact

The listing modal's Contact button behaves like this:

- **Your own listing:** "Your profile", as now.
- **The provider hasn't turned on texts:** no button. The text "Requests aren't available for this provider yet" appears instead.
- **You haven't turned on texts:** Contact shows the turn-on step from the banner instead of the form.
- **Otherwise:** Contact switches the modal to a request form, with a Back link.
  - **Time:** pick one of the provider's availability windows, e.g. "Sat 10 AM–2 PM". Listings created before availability existed skip this, and the text says "Any time".
  - **Hours:** 1 to 8 whole hours, for hourly listings only.
  - **Note:** optional, at most 300 characters.
  - **Total:** the coins the request will hold, next to your balance.
  - **Send request:** creates the booking, which holds the coins, and closes the form with "Request sent. We'll text you when <provider> answers." Here and in the error messages below, `<provider>` is the provider's first name.

The requester's profile page already lists their open bookings with status, so new requests appear there without changes.

### The texts

Every text starts with "barter:" and names people by first name or full name, never with pronouns.

To the provider, when a request is created:

```
barter: Barry Chen wants your Guitar Lessons
1 hour · 5 coins (already held)
Prefers Sat 10 AM–2 PM
Barry offers: Calculus Tutoring, Bike Tune-Ups
Note: "Total beginner, have my own guitar"

Reply YES or NO (request 7F3A)
```

- The second line is `N hour(s) · C coin(s) (already held)` for hourly listings, and `1 service · C coin(s) (already held)` for fixed-price ones. Coins are shown the way the app shows them elsewhere (`credits / 100`, so `2.5 coins` is possible).
- The "Prefers" line uses `formatAvailability([window])`, or reads `Prefers any time` for listings without windows.
- "offers" lists up to three of the requester's active listing titles, then `+N more`. The line is left out when they have none.
- The Note line is left out when there's no note.

The other texts:

| When | To | Text |
| --- | --- | --- |
| Request created | Requester | `barter: Your request for Guitar Lessons was sent to Emily Park. We'll text you when Emily answers.` |
| Provider says YES | Provider | `barter: You accepted Barry's Guitar Lessons request. We'll help you both pick a time and place next.` |
| Provider says YES | Requester | `barter: Emily accepted your Guitar Lessons request! We'll help you both pick a time and place next.` |
| Provider says NO | Provider | `barter: You declined Barry's Guitar Lessons request.` |
| Provider says NO | Requester | `barter: Emily can't take your Guitar Lessons request this time. Your 5 coins are back in your balance.` |
| YES or NO with several requests waiting and no code | Provider | `barter: You have 2 requests waiting: Guitar Lessons from Barry (7F3A), Piano Lessons from Sam (19C2). Reply YES or NO with the code, like "YES 7F3A".` |
| YES or NO with no request waiting | Sender | `barter: You don't have any requests waiting for an answer.` |
| The request was already answered or cancelled | Sender | `barter: That request was already answered or cancelled.` |
| Anything else | Sender | `barter: Reply YES or NO to answer a request. We'll text you when there's news.` |

### Replies

- **Parsing:** a reply is case-insensitive and trimmed. `yes`, `y` and `accept` mean yes; `no`, `n` and `decline` mean no. Either may be followed by a request code, optionally with `#`. Trailing punctuation is ignored, so "Yes!", "YES 7f3a" and "no #7F3A" all work.
- **Codes:** a request's code is the last four characters of its booking ID, in uppercase hex. The handler matches any 4–6 character suffix of a waiting request's ID. If a code matches more than one waiting request, which is rare, the waiting-list reply shows six-character codes.
- **Which request:** a reply applies to the sender's requests as provider that have status `requested`. Without a code, it applies only when exactly one is waiting.

## Data

- **`user`** gets three server-managed fields. Clients can't set them through any endpoint.
  - `photonUserId` (string): Photon's user ID.
  - `photonNumber` (E.164 string): the assigned barter number.
  - `textsEnabledAt` (Date): the time of the first inbound text.
  - When a phone number changes, the profile update unsets all three in the same transaction, so the person turns texts on again for the new number.
- **`booking`** gets `preferredWindow` (an `AvailabilityWindow`, absent for "Any time") and `note` (trimmed, 1–300 characters, absent when empty). `requestBooking` accepts both as options and validates them: the window must equal one of the listing's windows, and a window is required when the listing has any.
- **`photonMessage`** is a new collection, `{ _id: <Photon message ID>, receivedAt }`, with a TTL index that expires entries after 7 days. The webhook inserts before handling a message, so a duplicate delivery hits the unique ID and is skipped.

Senders are found by `user.phoneNumber`, which already has a unique index.

## Components

- **`lib/photon-users.ts`**
  - `registerPhotonUser({ phoneNumber, firstName, lastName })` calls `POST https://spectrum.photon.codes/projects/{SPECTRUM_PROJECT_ID}/users/`.
  - It authenticates with `Authorization: Basic base64(projectId:projectSecret)` and sends `{ type: "shared", phoneNumber, firstName, lastName }`.
  - It returns `{ id, assignedPhoneNumber }`. Photon returns the existing user when a phone repeats. Server-only.
- **`lib/texting.ts`**
  - `ensurePhotonUser(db, userId, register)` registers a complete user once and stores `photonUserId` and `photonNumber`; later calls return the stored number without calling Photon.
  - `enableTexts(db, phoneNumber)` sets `textsEnabledAt` if it's missing and reports whether it changed.
  - It also defines the `Messenger` interface, `{ send(phoneNumber: string, text: string): Promise<void> }`. The real messenger wraps `sendDirectMessage` from `lib/photon.ts`, and tests pass a fake.
- **`lib/booking-texts.ts`:** pure functions that build every text above from plain data (names, title, pricing, hours, window, offers, note, code).
- **`lib/booking-requests.ts`:** `createBookingRequest(request, auth, db, client, origin, messenger)`.
  - **Checks:** the same as the listing endpoint (configured `Origin`, session, complete profile, shared 20-per-minute limit). It also parses JSON `{ serviceId, window, hours, note }`, rejecting unknown fields, and requires `textsEnabledAt` for both the requester and the provider.
  - **Booking:** it calls `requestBooking`, with `durationMinutes = hours × 60` for hourly listings.
  - **Texts:** it texts the provider, then the requester.
  - **Responses:** `201 { success: true, id }`, or `{ error: { code, message } }`.
- **`app/api/bookings/route.ts`:** `POST`, a thin wrapper like `app/api/services/route.ts`.
- **`app/api/texts/route.ts`:** `POST` with the same `Origin` and session checks. It runs `ensurePhotonUser` and returns `{ number }` for the banner, with 503 if Photon can't be reached.
- **`lib/booking-replies.ts`:** `handleInboundText(db, client, messenger, { senderPhone, text })`. It holds the reply logic above: enabling texts, parsing, finding the request, `transitionBooking(provider, booking, "accept" | "decline")`, and the reply texts. It never throws to its caller; failures are logged.
- **`app/api/photon/webhook/route.ts`:** `POST`, Node runtime.
  - It verifies and parses the delivery with spectrum-ts's webhook support, using `SPECTRUM_WEBHOOK_SECRET`. Photon signs `v0:<timestamp>:<raw body>` with HMAC-SHA256 and rejects signatures older than 5 minutes.
  - It keeps only inbound text messages whose sender is a phone number, and inserts the message ID into `photonMessage`.
  - It responds 200, then runs `handleInboundText` inside Next's `after()`, so the work finishes after the response on Vercel.
- **Registration hooks:**
  - In `lib/auth-config.ts`, the `session.create.after` hook calls `ensurePhotonUser` for complete users, next to the welcome grant.
  - `updateProfile` calls it after a Google profile is completed.
  - Both calls are best effort: failures are logged and retried at the next sign-in.
- **UI:**
  - `components/barter/texts-banner.tsx`.
  - `components/barter/request-form.tsx`, shown inside `listing-modal.tsx`.
  - `getExplorerData` adds `textsEnabled` for the viewer and `providerTextsEnabled` for each listing.
- **`scripts/photon-webhook.ts`** (`npm run photon:webhook -- <url>`)
  - It calls `POST https://spectrum.photon.codes/projects/{id}/webhooks/` with `{ webhookUrl, schemaVersion: "normalized-events.v1", eventTypes: ["message.received"] }`.
  - It prints the signing secret, which Photon shows only once.

## Errors and edge cases

- **The provider's text fails:** the endpoint cancels the booking as the requester, which returns the held coins. It then responds 503 with "We couldn't reach <provider> by text, so you weren't charged."
- **The requester's confirmation text fails:** logged only; the request stands.
- **Webhook deliveries:**
  - A bad or stale signature gets 401.
  - Events other than inbound text get 200 and are ignored.
  - A duplicate message ID gets 200 and does nothing.
- **Senders:**
  - Texts from numbers that aren't a barter user are ignored and logged. So are texts from Apple email handles, which can't be matched to a phone.
- **Answering an answered request:** a second YES or NO gets the already-answered reply. `transitionBooking` already treats repeating the current state as a no-op.
- **Photon filters:** Photon throttles repeated identical texts and senders whose sent-to-received ratio is lopsided. Every text includes names and titles, so they vary.
- **Capacity:** Pro allows 100 registered users.

## Security

- The webhook trusts nothing without a valid signature.
- The project and webhook secrets stay on the server.
- Contact requires texts on for both people. Turning texts on means texting from your own phone, which is the phone verification that `docs/service-exchange.md` asks for before booking endpoints go live.
- Requests use the existing rate limit and origin check.
- Provider phone numbers never reach the page; people only see barter's number.

## Setup

1. Deploy, then run `npm run photon:webhook -- https://barter2026.vercel.app/api/photon/webhook`, or add the webhook in Photon's dashboard with the same settings.
2. Put the printed secret in `.env.local` and in Vercel as `SPECTRUM_WEBHOOK_SECRET`.
3. Make sure Vercel also has `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET`.
4. People already registered in Photon (Barry and Emily) need barter accounts with the same phone numbers, and they text their barter number once more, so barter records that texts are on.

`README.md` and `docs/service-exchange.md` document the endpoints, the texts and this setup.

## Testing

- **Unit tests, with no network access:**
  - The text builders.
  - Reply parsing.
  - `handleInboundText` with a fake messenger and a temporary database: first text enables texts; YES and NO with and without a code; several waiting requests; a colliding code; no request waiting; already answered; an unknown sender.
- **The request endpoint:**
  - Its checks: origin, session, complete profile, rate limit, and texts on for each side.
  - Window, hours and note validation.
  - Coins held.
  - A failing provider text returning the coins.
- **Webhook verification:** a correctly signed delivery, a forged one and a stale one, all signed in the test with a known secret.
- **`ensurePhotonUser`:** it calls the register function once and reuses the stored number afterwards.
- **Manual run:** end to end on the live site with Barry's and Emily's phones: turn on texts, request, accept, then request again and decline.

## Out of scope

- **Part B:** the assistant that coordinates time and place, and storing conversation history.
- Accepting or declining on the web.
- Cancelling by text.
- Reminders.
- Relaying free text between the two people.

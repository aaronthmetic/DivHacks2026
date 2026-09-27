# Photon Booking Requests (Part A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People turn on texts once, then request services from a listing's Contact button. Photon texts both people, and the provider answers YES or NO by text.

**Architecture:**
- Small server modules own each concern:
  - Photon registration: `lib/photon-users.ts`.
  - Texting state: `lib/texting.ts`.
  - The wording of every text: `lib/booking-texts.ts`.
  - The request endpoint: `lib/booking-requests.ts`.
  - Reply handling: `lib/booking-replies.ts`.
  - Webhook verification: `lib/photon-webhook.ts`.
- Next.js routes are thin wrappers around those modules.
- Sending goes through a `Messenger` interface, so tests use a fake and never text anyone.
- The existing exchange domain holds and returns coins. `requestBooking` gains a chosen availability window and a note.

**Tech Stack:** Next.js 16.3 (App Router, `after()` from `next/server`), React 19, TypeScript, MongoDB Node driver, spectrum-ts 12.10.1 plus `@spectrum-ts/core/webhook`, and `node:test` with `tsx` and `mongodb-memory-server`.

Spec: `docs/superpowers/specs/2026-09-27-photon-booking-requests-design.md`

## Global Constraints

- **Texts:** every text starts with `barter:` and names people by first or full name, never with pronouns. The wording is fixed by the spec and by the `lib/booking-texts.ts` constants in Task 2. For a listing without windows, the request text's time line is `Prefers any time`.
- **Replies:**
  - Parsing is case-insensitive and trimmed. `yes`, `y` and `accept` mean yes; `no`, `n` and `decline` mean no.
  - Either may be followed by a 4–6 character hex code, optionally prefixed with `#`. Trailing `.`, `!` and `?` are ignored.
  - A request code is the last 4 characters of the booking ID, in uppercase hex. Codes match any 4–6 character suffix. The waiting list uses 6 characters when two listed codes collide.
- **Requests:**
  - Hours are whole numbers from 1 to 8, for hourly listings only.
  - The note is trimmed, at most 300 characters, and left off when blank.
  - The window must equal one of the listing's windows, and is required when the listing has any. Listings without windows take no window.
- **The provider's text fails:** cancel the booking as the requester, which returns the coins. Respond 503 with `We couldn't reach <first name> by text, so you weren't charged.`
- **Endpoint checks:**
  - `POST /api/bookings` and `POST /api/texts` check the configured `Origin`, the session, a complete profile, and the shared 20-per-minute limit (`consumeProfileLimit`).
  - Requests also need `textsEnabledAt` on both people.
- **User fields:**
  - `photonUserId`, `photonNumber` and `textsEnabledAt` are server-managed.
  - A phone number change unsets all three in the same update.
  - `photonMessage` entries expire after 7 days (TTL on `receivedAt`).
- **Photon REST:**
  - Calls go to `https://spectrum.photon.codes`, with `Authorization: Basic base64(SPECTRUM_PROJECT_ID:SPECTRUM_PROJECT_SECRET)`.
  - Users: `POST /projects/{id}/users/` with `{ type: "shared", phoneNumber, firstName, lastName }`.
  - Webhooks: `POST /projects/{id}/webhooks/` with `{ webhookUrl, schemaVersion: "normalized-events.v1", eventTypes: ["message.received"] }`.
- **Webhook:**
  - Verify with `verifySpectrumSignature` from `@spectrum-ts/core/webhook`, using `SPECTRUM_WEBHOOK_SECRET`.
  - Answer 200, then handle the text inside `after()`.
- **Tests:** tests never reach the network. Photon registration (`RegisterPhoton`) and sending (`Messenger`) are always fakes in tests.
- **Style:** match the surrounding code. Lib files use long single-line statements and terse comments; tests use `node:test` with `node:assert/strict`.
- **Commands:** one test file with `node --import tsx --test tests/<file>.test.ts`. The full checks are `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Texting foundations

**Files:**
- Create: `lib/photon-users.ts`, `lib/texting.ts`
- Modify: `lib/mongodb.ts`, `scripts/auth-indexes.ts`
- Test: `tests/texting.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `lib/photon-users.ts`: `PHOTON_API` (string), `type PhotonPerson = { phoneNumber: string; firstName: string; lastName: string }`, and `type RegisterPhoton = (person: PhotonPerson) => Promise<{ id: string; assignedPhoneNumber: string }>`.
  - `photonConfigured(): boolean`, `photonAuthorization(): { projectId: string; header: string }`, and `registerPhotonUser: RegisterPhoton`.
  - `lib/texting.ts`: `interface Messenger { send(phoneNumber: string, text: string): Promise<void> }`, `ensureTextingIndexes(db): Promise<void>`, and `ensurePhotonUser(db, userId: ObjectId, register: RegisterPhoton): Promise<string>`.
  - `enableTexts(db, phoneNumber: string): Promise<boolean>` and `claimInboundMessage(db, messageId: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/texting.test.ts`:

```ts
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { registerPhotonUser, type PhotonPerson, type RegisterPhoton } from "../lib/photon-users";
import { claimInboundMessage, enableTexts, ensurePhotonUser, ensureTextingIndexes } from "../lib/texting";

let server: MongoMemoryReplSet, client: MongoClient, db: Db;
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("texting");
});
after(async () => { await client?.close(); await server?.stop(); });

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
}

test("registerPhotonUser posts a shared user with the project's Basic auth", async () => {
  const saved = { id: process.env.SPECTRUM_PROJECT_ID, secret: process.env.SPECTRUM_PROJECT_SECRET };
  const realFetch = globalThis.fetch;
  process.env.SPECTRUM_PROJECT_ID = "project-1";
  process.env.SPECTRUM_PROJECT_SECRET = "secret-1";
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Response.json({ succeed: true, data: { id: "photon-user-1", assignedPhoneNumber: "+15550001111" } });
  }) as typeof fetch;
  try {
    const person = { phoneNumber: "+12025550100", firstName: "Barry", lastName: "Chen" };
    assert.deepEqual(await registerPhotonUser(person), { id: "photon-user-1", assignedPhoneNumber: "+15550001111" });
    assert.equal(calls[0].url, "https://spectrum.photon.codes/projects/project-1/users/");
    assert.equal((calls[0].init.headers as Record<string, string>).authorization, `Basic ${Buffer.from("project-1:secret-1").toString("base64")}`);
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { type: "shared", ...person });
    globalThis.fetch = (async () => Response.json({ succeed: false }, { status: 400 })) as typeof fetch;
    await assert.rejects(registerPhotonUser(person), /status 400/);
  } finally {
    globalThis.fetch = realFetch;
    restore("SPECTRUM_PROJECT_ID", saved.id);
    restore("SPECTRUM_PROJECT_SECRET", saved.secret);
  }
});

test("ensurePhotonUser registers a complete user once and keeps the barter number", async () => {
  const id = new ObjectId();
  await db.collection("user").insertOne({ _id: id, firstName: "Barry", lastName: "Chen", phoneNumber: "+12025550111", profileCompletedAt: new Date() });
  const calls: PhotonPerson[] = [];
  const register: RegisterPhoton = async (person) => { calls.push(person); return { id: "photon-1", assignedPhoneNumber: "+15550009999" }; };
  assert.equal(await ensurePhotonUser(db, id, register), "+15550009999");
  assert.equal(await ensurePhotonUser(db, id, register), "+15550009999");
  assert.deepEqual(calls, [{ phoneNumber: "+12025550111", firstName: "Barry", lastName: "Chen" }]);
  const stored = await db.collection("user").findOne({ _id: id });
  assert.equal(stored?.photonUserId, "photon-1");
  assert.equal(stored?.photonNumber, "+15550009999");
  const incomplete = new ObjectId();
  await db.collection("user").insertOne({ _id: incomplete, firstName: "No", lastName: "Phone", profileCompletedAt: null });
  await assert.rejects(ensurePhotonUser(db, incomplete, register), /Complete your profile/);
  assert.equal(calls.length, 1);
});

test("enableTexts records only the first text from a phone", async () => {
  const id = new ObjectId();
  await db.collection("user").insertOne({ _id: id, phoneNumber: "+12025550112" });
  assert.equal(await enableTexts(db, "+12025550112"), true);
  const first = (await db.collection("user").findOne({ _id: id }))?.textsEnabledAt;
  assert.ok(first instanceof Date);
  assert.equal(await enableTexts(db, "+12025550112"), false);
  assert.deepEqual((await db.collection("user").findOne({ _id: id }))?.textsEnabledAt, first);
  assert.equal(await enableTexts(db, "+12025550199"), false);
});

test("incoming message IDs are claimed once and expire after a week", async () => {
  await ensureTextingIndexes(db);
  assert.equal(await claimInboundMessage(db, "msg-1"), true);
  assert.equal(await claimInboundMessage(db, "msg-1"), false);
  const ttl = (await db.collection("photonMessage").indexes()).find((index) => index.key.receivedAt === 1);
  assert.equal(ttl?.expireAfterSeconds, 604800);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/texting.test.ts`
Expected: FAIL with `Cannot find module` for `../lib/photon-users`.

- [ ] **Step 3: Create `lib/photon-users.ts`**

```ts
// Registers people with Photon so it can text them. Server-only: it uses the project secret.
export const PHOTON_API = "https://spectrum.photon.codes";

export type PhotonPerson = { phoneNumber: string; firstName: string; lastName: string };
export type RegisterPhoton = (person: PhotonPerson) => Promise<{ id: string; assignedPhoneNumber: string }>;

export function photonConfigured() {
  return Boolean(process.env.SPECTRUM_PROJECT_ID && process.env.SPECTRUM_PROJECT_SECRET);
}

/** Photon's REST API takes Basic auth with the project ID and secret. */
export function photonAuthorization() {
  const projectId = process.env.SPECTRUM_PROJECT_ID, secret = process.env.SPECTRUM_PROJECT_SECRET;
  if (!projectId || !secret) throw new Error("Set SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET.");
  return { projectId, header: `Basic ${Buffer.from(`${projectId}:${secret}`).toString("base64")}` };
}

// Photon returns the existing user when a phone number is registered again, so this is safe to repeat.
export const registerPhotonUser: RegisterPhoton = async ({ phoneNumber, firstName, lastName }) => {
  const { projectId, header } = photonAuthorization();
  const response = await fetch(`${PHOTON_API}/projects/${encodeURIComponent(projectId)}/users/`, {
    method: "POST",
    headers: { authorization: header, "content-type": "application/json" },
    body: JSON.stringify({ type: "shared", phoneNumber, firstName, lastName }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null);
  const user = payload?.data;
  if (!response.ok || typeof user?.id !== "string" || typeof user?.assignedPhoneNumber !== "string") throw new Error(`Photon user registration failed with status ${response.status}.`);
  return { id: user.id, assignedPhoneNumber: user.assignedPhoneNumber };
};
```

- [ ] **Step 4: Create `lib/texting.ts`**

```ts
import { MongoServerError, type Db, type ObjectId } from "mongodb";
import { InputError, isProfileComplete } from "./auth-validation";
import type { RegisterPhoton } from "./photon-users";

/** Sends one text. The real one wraps Photon (lib/photon-messenger.ts); tests pass a fake. */
export interface Messenger { send(phoneNumber: string, text: string): Promise<void> }

// Incoming Photon message IDs are kept a week, so at-least-once webhook deliveries are handled once.
const MESSAGE_TTL_SECONDS = 7 * 24 * 60 * 60;
const messages = (db: Db) => db.collection<{ _id: string; receivedAt: Date }>("photonMessage");

export async function ensureTextingIndexes(db: Db) {
  await messages(db).createIndex({ receivedAt: 1 }, { expireAfterSeconds: MESSAGE_TTL_SECONDS });
}

/** Registers a complete user with Photon once and returns the barter number they text. */
export async function ensurePhotonUser(db: Db, userId: ObjectId, register: RegisterPhoton): Promise<string> {
  const user = await db.collection("user").findOne({ _id: userId });
  if (!user || !isProfileComplete({ firstName: user.firstName, lastName: user.lastName, phoneNumber: user.phoneNumber, profileCompletedAt: user.profileCompletedAt })) throw new InputError("Complete your profile to continue.");
  if (typeof user.photonNumber === "string") return user.photonNumber;
  const registered = await register({ phoneNumber: user.phoneNumber, firstName: user.firstName, lastName: user.lastName });
  // Matching the phone too means a number changed meanwhile isn't paired with the old registration.
  await db.collection("user").updateOne({ _id: userId, phoneNumber: user.phoneNumber }, { $set: { photonUserId: registered.id, photonNumber: registered.assignedPhoneNumber } });
  return registered.assignedPhoneNumber;
}

/** Records the first text from this phone. True only the first time. */
export async function enableTexts(db: Db, phoneNumber: string) {
  const result = await db.collection("user").updateOne({ phoneNumber, textsEnabledAt: { $exists: false } }, { $set: { textsEnabledAt: new Date() } });
  return result.modifiedCount === 1;
}

/** Claims an incoming message ID. False when it was already handled. */
export async function claimInboundMessage(db: Db, messageId: string) {
  try {
    await messages(db).insertOne({ _id: messageId, receivedAt: new Date() });
    return true;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) return false;
    throw error;
  }
}
```

- [ ] **Step 5: Install the TTL index at startup and in `npm run db:indexes`**

In `lib/mongodb.ts`, add `import { ensureTextingIndexes } from "./texting";` after the `ensureAuthIndexes` import. Then, directly after the `void ensureDefaultGenres(db)...` line, add:

```ts
        void ensureTextingIndexes(db).catch((error) => logAuthFailure("Texting index setup", error));
```

In `scripts/auth-indexes.ts`, add `import { ensureTextingIndexes } from "../lib/texting";` after the `ensureAuthIndexes` import. Replace the `console.log(...)` line with these two lines:

```ts
    await ensureTextingIndexes(client.db(process.env.MONGODB_DB));
    console.log("Authentication, exchange and texting indexes and default categories are ready.");
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --import tsx --test tests/texting.test.ts`
Expected: PASS with `# fail 0`, 4 tests.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: exit code 0.

```bash
git add lib/photon-users.ts lib/texting.ts lib/mongodb.ts scripts/auth-indexes.ts tests/texting.test.ts
git commit -m "Add Photon user registration and texting state" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The texts

**Files:**
- Create: `lib/booking-texts.ts`
- Modify: `lib/listing-data.ts:11-14` (the `priceLabel` function)
- Test: `tests/booking-texts.test.ts`

**Interfaces:**
- Consumes: `formatAvailability` from `lib/availability.ts`, and `AvailabilityWindow` from `lib/exchange-schema.ts`.
- Produces:
  - In `lib/listing-data.ts`: `coinsLabel(credits: number): string` (`"1 coin"`, `"5 coins"`, `"2.5 coins"`).
  - In `lib/booking-texts.ts`: the constants `WELCOME_TEXT`, `NO_REQUESTS_TEXT`, `ALREADY_ANSWERED_TEXT` and `HELP_TEXT`, and `bookingCode(id: ObjectId | string, length = 4): string`.
  - `type RequestDetails = { requesterName; requesterFirstName; title; pricingType: "fixed" | "hourly"; totalCredits: number; hours?: number; window?: AvailabilityWindow; offers: string[]; note?: string; code: string }`, and `requestText(details: RequestDetails): string`.
  - `requestSentText({ title, providerName, providerFirstName }): string`.
  - `acceptedTexts({ title, requesterFirstName, providerFirstName }): { provider: string; requester: string }`.
  - `declinedTexts({ title, requesterFirstName, providerFirstName, totalCredits }): { provider: string; requester: string }`.
  - `waitingListText(items: { title: string; requesterFirstName: string; code: string }[]): string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/booking-texts.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { ObjectId } from "mongodb";
import { ALREADY_ANSWERED_TEXT, HELP_TEXT, NO_REQUESTS_TEXT, WELCOME_TEXT, acceptedTexts, bookingCode, declinedTexts, requestSentText, requestText, waitingListText } from "../lib/booking-texts";
import { coinsLabel, priceLabel } from "../lib/listing-data";

const barry = { requesterName: "Barry Chen", requesterFirstName: "Barry", title: "Guitar Lessons" };

test("the provider's request text lists the details and the reply code", () => {
  assert.equal(
    requestText({ ...barry, pricingType: "hourly", totalCredits: 500, hours: 1, window: { day: 6, start: 600, end: 840 }, offers: ["Calculus Tutoring", "Bike Tune-Ups"], note: "Total beginner, have my own guitar", code: "7F3A" }),
    "barter: Barry Chen wants your Guitar Lessons\n1 hour · 5 coins (already held)\nPrefers Sat 10 AM–2 PM\nBarry offers: Calculus Tutoring, Bike Tune-Ups\nNote: \"Total beginner, have my own guitar\"\n\nReply YES or NO (request 7F3A)",
  );
  assert.equal(
    requestText({ ...barry, pricingType: "fixed", totalCredits: 250, offers: ["A", "B", "C", "D", "E"], code: "19C2" }),
    "barter: Barry Chen wants your Guitar Lessons\n1 service · 2.5 coins (already held)\nPrefers any time\nBarry offers: A, B, C +2 more\n\nReply YES or NO (request 19C2)",
  );
  assert.equal(
    requestText({ ...barry, pricingType: "hourly", totalCredits: 1500, hours: 3, offers: [], code: "0B1D" }),
    "barter: Barry Chen wants your Guitar Lessons\n3 hours · 15 coins (already held)\nPrefers any time\n\nReply YES or NO (request 0B1D)",
  );
});

test("answers and confirmations name both people", () => {
  assert.equal(requestSentText({ title: "Guitar Lessons", providerName: "Emily Park", providerFirstName: "Emily" }), "barter: Your request for Guitar Lessons was sent to Emily Park. We'll text you when Emily answers.");
  assert.deepEqual(acceptedTexts({ title: "Guitar Lessons", requesterFirstName: "Barry", providerFirstName: "Emily" }), {
    provider: "barter: You accepted Barry's Guitar Lessons request. We'll help you both pick a time and place next.",
    requester: "barter: Emily accepted your Guitar Lessons request! We'll help you both pick a time and place next.",
  });
  assert.deepEqual(declinedTexts({ title: "Guitar Lessons", requesterFirstName: "Barry", providerFirstName: "Emily", totalCredits: 500 }), {
    provider: "barter: You declined Barry's Guitar Lessons request.",
    requester: "barter: Emily can't take your Guitar Lessons request this time. Your 5 coins are back in your balance.",
  });
  assert.equal(declinedTexts({ title: "Piano", requesterFirstName: "Sam", providerFirstName: "Emily", totalCredits: 100 }).requester, "barter: Emily can't take your Piano request this time. Your 1 coin is back in your balance.");
  assert.equal(
    waitingListText([{ title: "Guitar Lessons", requesterFirstName: "Barry", code: "7F3A" }, { title: "Piano Lessons", requesterFirstName: "Sam", code: "19C2" }]),
    "barter: You have 2 requests waiting: Guitar Lessons from Barry (7F3A), Piano Lessons from Sam (19C2). Reply YES or NO with the code, like \"YES 7F3A\".",
  );
  assert.equal(WELCOME_TEXT, "barter: You're all set. We'll text you here about requests.");
  assert.equal(NO_REQUESTS_TEXT, "barter: You don't have any requests waiting for an answer.");
  assert.equal(ALREADY_ANSWERED_TEXT, "barter: That request was already answered or cancelled.");
  assert.equal(HELP_TEXT, "barter: Reply YES or NO to answer a request. We'll text you when there's news.");
});

test("request codes are the uppercase end of the booking ID, and coins read naturally", () => {
  assert.equal(bookingCode("64b7f0c2a1b2c3d4e5f67f3a"), "7F3A");
  assert.equal(bookingCode(new ObjectId("64b7f0c2a1b2c3d4e5f67f3a"), 6), "F67F3A");
  assert.equal(coinsLabel(100), "1 coin");
  assert.equal(coinsLabel(250), "2.5 coins");
  assert.equal(priceLabel({ creditRate: 100, pricingType: "fixed" }), "1 coin / service");
  assert.equal(priceLabel({ creditRate: 250, pricingType: "hourly" }), "2.5 coins / hour");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/booking-texts.test.ts`
Expected: FAIL with `Cannot find module` for `../lib/booking-texts`.

- [ ] **Step 3: Share the coin wording in `lib/listing-data.ts`**

Replace the `priceLabel` function (lines 11-14) with:

```ts
/** "1 coin", "5 coins" or "2.5 coins", from integer hundredths. */
export function coinsLabel(credits: number) {
  const amount = coins(credits);
  return `${amount} ${amount === "1" ? "coin" : "coins"}`;
}

export function priceLabel({ creditRate, pricingType }: Pick<ServiceDocument, "creditRate" | "pricingType">) {
  return `${coinsLabel(creditRate)} / ${pricingType === "hourly" ? "hour" : "service"}`;
}
```

- [ ] **Step 4: Create `lib/booking-texts.ts`**

```ts
import type { ObjectId } from "mongodb";
import { formatAvailability } from "./availability";
import type { AvailabilityWindow } from "./exchange-schema";
import { coinsLabel } from "./listing-data";

// Every text barter sends about requests. People are named, never referred to with pronouns.

export const WELCOME_TEXT = "barter: You're all set. We'll text you here about requests.";
export const NO_REQUESTS_TEXT = "barter: You don't have any requests waiting for an answer.";
export const ALREADY_ANSWERED_TEXT = "barter: That request was already answered or cancelled.";
export const HELP_TEXT = "barter: Reply YES or NO to answer a request. We'll text you when there's news.";

/** The code people reply with: the end of the booking ID, uppercase. */
export function bookingCode(id: ObjectId | string, length = 4) {
  return String(id).slice(-length).toUpperCase();
}

export type RequestDetails = {
  requesterName: string; requesterFirstName: string; title: string;
  pricingType: "fixed" | "hourly"; totalCredits: number; hours?: number;
  window?: AvailabilityWindow; offers: string[]; note?: string; code: string;
};

export function requestText(details: RequestDetails) {
  const { hours = 1, offers } = details;
  const amount = details.pricingType === "hourly" ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "1 service";
  const offered = offers.length > 3 ? `${offers.slice(0, 3).join(", ")} +${offers.length - 3} more` : offers.join(", ");
  return [
    `barter: ${details.requesterName} wants your ${details.title}`,
    `${amount} · ${coinsLabel(details.totalCredits)} (already held)`,
    `Prefers ${details.window ? formatAvailability([details.window]) : "any time"}`,
    ...(offers.length ? [`${details.requesterFirstName} offers: ${offered}`] : []),
    ...(details.note ? [`Note: "${details.note}"`] : []),
    "",
    `Reply YES or NO (request ${details.code})`,
  ].join("\n");
}

export function requestSentText({ title, providerName, providerFirstName }: { title: string; providerName: string; providerFirstName: string }) {
  return `barter: Your request for ${title} was sent to ${providerName}. We'll text you when ${providerFirstName} answers.`;
}

type Answer = { title: string; requesterFirstName: string; providerFirstName: string };

export function acceptedTexts({ title, requesterFirstName, providerFirstName }: Answer) {
  return {
    provider: `barter: You accepted ${requesterFirstName}'s ${title} request. We'll help you both pick a time and place next.`,
    requester: `barter: ${providerFirstName} accepted your ${title} request! We'll help you both pick a time and place next.`,
  };
}

export function declinedTexts({ title, requesterFirstName, providerFirstName, totalCredits }: Answer & { totalCredits: number }) {
  const refund = coinsLabel(totalCredits);
  return {
    provider: `barter: You declined ${requesterFirstName}'s ${title} request.`,
    requester: `barter: ${providerFirstName} can't take your ${title} request this time. Your ${refund} ${refund === "1 coin" ? "is" : "are"} back in your balance.`,
  };
}

export function waitingListText(waiting: { title: string; requesterFirstName: string; code: string }[]) {
  const items = waiting.map((item) => `${item.title} from ${item.requesterFirstName} (${item.code})`).join(", ");
  return `barter: You have ${waiting.length} requests waiting: ${items}. Reply YES or NO with the code, like "YES ${waiting[0].code}".`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --import tsx --test tests/booking-texts.test.ts tests/listing.test.ts`
Expected: PASS with `# fail 0`. `listing.test.ts` confirms that `priceLabel` still reads the same.

- [ ] **Step 6: Commit**

```bash
git add lib/booking-texts.ts lib/listing-data.ts tests/booking-texts.test.ts
git commit -m "Add the booking request texts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Requests carry a window and a note

**Files:**
- Modify: `lib/exchange-schema.ts` (the `Booking` interface), `lib/exchange-service.ts` (`requestBooking` and two helpers)
- Test: `tests/exchange.test.ts`

**Interfaces:**
- Consumes: `AvailabilityWindow` (already in `lib/exchange-schema.ts`).
- Produces:
  - `Booking.preferredWindow?: AvailabilityWindow` and `Booking.note?: string`.
  - `requestBooking(requesterId, serviceId, options: { durationMinutes?: number; scheduledAt?: Date; preferredWindow?: AvailabilityWindow; note?: string })`, which rejects with `Choose one of the provider's available times.`, `This listing has no time windows to choose from.` or `A note can be at most 300 characters.`

- [ ] **Step 1: Update the existing calls and add the new test**

Every listing in `tests/exchange.test.ts` comes from `fixture()`, whose `availability` is `[{ day: 1, start: 540, end: 1020 }]`, so every request now has to name that window. Add this line directly after the `fixture` function:

```ts
// The fixture's only availability window; requests must pick it.
const slot = { day: 1, start: 540, end: 1020 };
```

Then give every `requestBooking` call the window, so each rejection still tests the rule it was written for:
- In the tests "concurrent bookings…", "snapshots, authorized transitions…", "hourly bookings…", "a failed settlement…", "received review fields…", "inherited property names…" and "a provider without a credit account…", change every `domain.requestBooking(requester, service._id)` and `domain.requestBooking(provider, service._id)` to add a third argument, `{ preferredWindow: slot }`.
- In "hourly bookings…", change `domain.requestBooking(requester, service._id, { durationMinutes: 90 })` to `domain.requestBooking(requester, service._id, { durationMinutes: 90, preferredWindow: slot })`.
- In "listings retain validated image IDs…", change `domain.requestBooking(requester, service._id, { scheduledAt })` to `domain.requestBooking(requester, service._id, { scheduledAt, preferredWindow: slot })`.
- In "both booking paths share rounding…", change `domain.requestBooking(requester, service._id, options)` to `domain.requestBooking(requester, service._id, { ...options, preferredWindow: slot })`. Also change `domain.requestBooking(requester, service._id, { ...options, scheduledAt })` to `domain.requestBooking(requester, service._id, { ...options, scheduledAt, preferredWindow: slot })`. Leave the `addBooking` calls unchanged.

That covers all 12 calls. Check with `grep -c "preferredWindow: slot" tests/exchange.test.ts`, which should print `12`.

Then add this test at the end of the file:

```ts
test("requests carry a chosen availability window and an optional note", async () => {
  const { domain, c, requester, service } = await fixture(100);
  await assert.rejects(domain.requestBooking(requester, service._id), /available times/);
  await assert.rejects(domain.requestBooking(requester, service._id, { preferredWindow: { day: 2, start: 540, end: 1020 } }), /available times/);
  await assert.rejects(domain.requestBooking(requester, service._id, { preferredWindow: slot, note: "x".repeat(301) }), /300 characters/);
  const booking = await domain.requestBooking(requester, service._id, { preferredWindow: { ...slot, extra: true } as never, note: "  Bring a mat  " });
  const stored = await c.bookings.findOne({ _id: booking._id });
  assert.deepEqual(stored?.preferredWindow, slot);
  assert.equal(stored?.note, "Bring a mat");
  const blank = await domain.requestBooking(requester, service._id, { preferredWindow: slot, note: "   " });
  assert.equal("note" in (await c.bookings.findOne({ _id: blank._id }))!, false);
  // Listings from before availability existed take requests without a window.
  const { availability: _availability, ...legacyFields } = service;
  void _availability;
  const legacy = { ...legacyFields, _id: new ObjectId() };
  await c.services.insertOne(legacy);
  await assert.rejects(domain.requestBooking(requester, legacy._id, { preferredWindow: slot }), /no time windows/);
  const anyTime = await domain.requestBooking(requester, legacy._id);
  assert.equal("preferredWindow" in (await c.bookings.findOne({ _id: anyTime._id }))!, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/exchange.test.ts`
Expected: FAIL only in "requests carry a chosen availability window and an optional note", with `Missing expected rejection`. The domain doesn't check windows yet. The other tests still pass, because the domain ignores the extra option.

- [ ] **Step 3: Add the booking fields**

In `lib/exchange-schema.ts`, in the `Booking` interface, directly after the line `durationMinutes?: number; totalCredits: number; scheduledAt?: Date;`, add:

```ts
  /** The listing window the requester picked; absent for listings without windows. */
  preferredWindow?: AvailabilityWindow; note?: string;
```

- [ ] **Step 4: Validate and store them in `requestBooking`**

In `lib/exchange-service.ts`, directly after the `storedAvailability` function, add:

```ts
/** The requester's note, trimmed; undefined when blank. */
function requestNote(note: unknown) {
  if (note === undefined) return undefined;
  requireValue(typeof note === "string" && note.trim().length <= 300, "A note can be at most 300 characters.");
  return note.trim() || undefined;
}
/** The listing window the requester picked; required whenever the listing has windows. */
function chosenWindow(service: Service, window: AvailabilityWindow | undefined): AvailabilityWindow | undefined {
  const windows = service.availability ?? [];
  if (!windows.length) {
    requireValue(window === undefined, "This listing has no time windows to choose from.");
    return undefined;
  }
  const match = window && windows.find((item) => item.day === window.day && item.start === window.start && item.end === window.end);
  requireValue(match, "Choose one of the provider's available times.");
  return { day: match.day, start: match.start, end: match.end };
}
```

Replace the first two lines of `requestBooking` (its signature and `return transaction(async (session) => {`) with:

```ts
    async requestBooking(requesterId: ObjectId, serviceId: ObjectId, options: { durationMinutes?: number; scheduledAt?: Date; preferredWindow?: AvailabilityWindow; note?: string } = {}) {
      const note = requestNote(options.note);
      return transaction(async (session) => {
```

In the same method, directly after `validateScheduledAt(options.scheduledAt);`, add:

```ts
        const preferredWindow = chosenWindow(service, options.preferredWindow);
```

Then in the `const booking: Booking = { ... }` line, replace `...(options.scheduledAt ? { scheduledAt: options.scheduledAt } : {}), totalCredits,` with:

```ts
...(options.scheduledAt ? { scheduledAt: options.scheduledAt } : {}), ...(preferredWindow ? { preferredWindow } : {}), ...(note ? { note } : {}), totalCredits,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --import tsx --test tests/exchange.test.ts tests/listing.test.ts tests/profile-seed.test.ts`
Expected: PASS with `# fail 0`.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: exit code 0.

```bash
git add lib/exchange-schema.ts lib/exchange-service.ts tests/exchange.test.ts
git commit -m "Let booking requests carry a chosen window and a note" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The request endpoint

**Files:**
- Create: `lib/photon-messenger.ts`, `lib/booking-requests.ts`, `app/api/bookings/route.ts`
- Test: `tests/bookings.test.ts`

**Interfaces:**
- Consumes: `Messenger` (Task 1), `requestText`, `requestSentText` and `bookingCode` (Task 2), `requestBooking` with `preferredWindow` and `note` (Task 3), plus the existing `transitionBooking`, `apiError` and `consumeProfileLimit`.
- Produces:
  - `photonMessenger: Messenger`.
  - `parseBookingRequest(value: unknown): { serviceId: ObjectId; window?: AvailabilityWindow; hours?: number; note?: string }`.
  - `createBookingRequest(request, auth, db, client, origin, messenger): Promise<Response>`.
  - `POST /api/bookings`.

- [ ] **Step 1: Write the failing tests**

Create `tests/bookings.test.ts`:

```ts
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createAuth, type Auth } from "../lib/auth-config";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { bookingCode } from "../lib/booking-texts";
import { createBookingRequest } from "../lib/booking-requests";
import { ensureDefaultGenres, ensureExchangeIndexes, exchangeCollections } from "../lib/exchange-schema";
import { createExchangeService } from "../lib/exchange-service";

let server: MongoMemoryReplSet, client: MongoClient, db: Db, auth: Auth;
const origin = "http://localhost:3000";
const saturday = { day: 6, start: 600, end: 840 };

before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("bookings");
  await ensureAuthIndexes(db); await ensureExchangeIndexes(db); await ensureDefaultGenres(db);
  auth = createAuth(db, client, { baseURL: origin, secret: "booking-test-secret-at-least-thirty-two-chars" });
});
after(async () => { await client?.close(); await server?.stop(); });

// Signs someone up (which grants 10 welcome coins) and optionally turns their texts on.
async function person(number: number, firstName: string, lastName: string, texts = true) {
  const phone = `+12025550${String(500 + number)}`;
  const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": `192.0.2.${number}` }, body: JSON.stringify({ firstName, lastName, email: `booker${number}@example.com`, phoneNumber: phone, password: "booking-test-password!" }) }));
  assert.equal(response.status, 200, await response.clone().text());
  const id = new ObjectId((await response.json()).user.id);
  if (texts) await db.collection("user").updateOne({ _id: id }, { $set: { textsEnabledAt: new Date() } });
  return { id, phone, cookie: response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
async function listing(providerId: ObjectId, overrides: Record<string, unknown> = {}) {
  const genreId = (await exchangeCollections(db).genres.findOne({ slug: "music" }))!._id;
  return createExchangeService(db, client).createService(providerId, { genreId, title: "Guitar Lessons", description: "Beginner lessons.", deliveryMode: "remote", pricingType: "hourly", creditRate: 200, status: "active", availability: [saturday], ...overrides });
}
function messenger(failFor?: string) {
  const sent: { phone: string; text: string }[] = [];
  return { sent, async send(phone: string, text: string) { if (phone === failFor) throw new Error("Photon is down"); sent.push({ phone, text }); } };
}
function post(cookie: string, body: unknown, via: ReturnType<typeof messenger>, requestOrigin = origin) {
  return createBookingRequest(new Request(`${origin}/api/bookings`, { method: "POST", headers: { cookie, origin: requestOrigin, "content-type": "application/json" }, body: JSON.stringify(body) }), auth, db, client, origin, via);
}

test("a request holds the coins and texts the provider, then the requester", async () => {
  const barry = await person(1, "Barry", "Chen", false), emily = await person(2, "Emily", "Park", false);
  await listing(barry.id, { title: "Calculus Tutoring" });
  const guitar = await listing(emily.id);
  const body = { serviceId: guitar._id.toHexString(), window: saturday, hours: 2, note: " Bring a capo " };
  const texts = messenger();
  assert.equal((await post("", body, texts)).status, 401);
  assert.equal((await post(barry.cookie, body, texts, "https://evil.example")).status, 403);
  assert.equal((await post(barry.cookie, body, texts)).status, 403);
  await db.collection("user").updateOne({ _id: barry.id }, { $set: { textsEnabledAt: new Date() } });
  assert.equal((await post(barry.cookie, body, texts)).status, 409);
  await db.collection("user").updateOne({ _id: emily.id }, { $set: { textsEnabledAt: new Date() } });
  const response = await post(barry.cookie, body, texts);
  assert.equal(response.status, 201, await response.clone().text());
  const booking = await exchangeCollections(db).bookings.findOne({ _id: new ObjectId((await response.json()).id) });
  assert.deepEqual(booking?.preferredWindow, saturday);
  assert.equal(booking?.note, "Bring a capo");
  assert.equal(booking?.totalCredits, 400);
  assert.equal((await exchangeCollections(db).accounts.findOne({ userId: barry.id }))?.heldCredits, 400);
  assert.deepEqual(texts.sent, [
    { phone: emily.phone, text: `barter: Barry Chen wants your Guitar Lessons\n2 hours · 4 coins (already held)\nPrefers Sat 10 AM–2 PM\nBarry offers: Calculus Tutoring\nNote: "Bring a capo"\n\nReply YES or NO (request ${bookingCode(booking!._id)})` },
    { phone: barry.phone, text: "barter: Your request for Guitar Lessons was sent to Emily Park. We'll text you when Emily answers." },
  ]);
});

test("invalid requests are rejected before anything is held", async () => {
  const sam = await person(3, "Sam", "Lee"), provider = await person(4, "Ana", "Diaz");
  const guitar = await listing(provider.id);
  const fixed = await listing(provider.id, { title: "Tune-up", pricingType: "fixed", creditRate: 300 });
  const texts = messenger();
  const base = { serviceId: guitar._id.toHexString(), window: saturday, hours: 1 };
  for (const bad of [{ serviceId: "nope" }, { extra: true }, { window: { day: 1, start: 600, end: 840 } }, { window: { ...saturday, day: "6" } }, { hours: 0 }, { hours: 9 }, { hours: 1.5 }, { hours: undefined }, { note: 5 }, { note: "x".repeat(301) }]) {
    assert.equal((await post(sam.cookie, { ...base, ...bad }, texts)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await post(sam.cookie, { ...base, serviceId: new ObjectId().toHexString() }, texts)).status, 404);
  assert.equal((await post(sam.cookie, { serviceId: fixed._id.toHexString(), window: saturday }, texts)).status, 201);
  assert.equal(await exchangeCollections(db).bookings.countDocuments({ requesterId: sam.id }), 1);
});

test("a failed text to the provider cancels the request and returns the coins", async () => {
  const kim = await person(5, "Kim", "Ng"), provider = await person(6, "Lou", "Reed");
  const guitar = await listing(provider.id);
  const texts = messenger(provider.phone);
  const response = await post(kim.cookie, { serviceId: guitar._id.toHexString(), window: saturday, hours: 1 }, texts);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.message, "We couldn't reach Lou by text, so you weren't charged.");
  assert.equal((await exchangeCollections(db).bookings.findOne({ requesterId: kim.id }))?.status, "cancelled");
  const account = await exchangeCollections(db).accounts.findOne({ userId: kim.id });
  assert.equal(account?.availableCredits, 1000);
  assert.equal(account?.heldCredits, 0);
  assert.deepEqual(texts.sent, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/bookings.test.ts`
Expected: FAIL with `Cannot find module` for `../lib/booking-requests`.

- [ ] **Step 3: Create `lib/photon-messenger.ts`**

```ts
import { sendDirectMessage } from "./photon";
import type { Messenger } from "./texting";

// The real messenger. Photon's SDK sends over gRPC, so routes using it run on Node, never edge.
export const photonMessenger: Messenger = {
  async send(phoneNumber, text) {
    await sendDirectMessage(phoneNumber, text);
  },
};
```

- [ ] **Step 4: Create `lib/booking-requests.ts`**

```ts
import { ObjectId, type Db, type MongoClient } from "mongodb";
import type { Auth } from "./auth-config";
import { logAuthFailure } from "./auth-errors";
import { InputError, isProfileComplete, objectBody, onlyFields } from "./auth-validation";
import { bookingCode, requestSentText, requestText } from "./booking-texts";
import { exchangeCollections, type AvailabilityWindow } from "./exchange-schema";
import { createExchangeService } from "./exchange-service";
import { apiError, consumeProfileLimit } from "./profile-service";
import type { Messenger } from "./texting";

const MAX_HOURS = 8;

/** Checks the request form's JSON. The domain checks the window against the listing. */
export function parseBookingRequest(value: unknown): { serviceId: ObjectId; window?: AvailabilityWindow; hours?: number; note?: string } {
  const body = objectBody(value);
  onlyFields(body, ["serviceId", "window", "hours", "note"]);
  if (typeof body.serviceId !== "string" || !/^[a-f\d]{24}$/i.test(body.serviceId)) throw new InputError("Choose a listing.");
  let window: AvailabilityWindow | undefined;
  if (body.window !== undefined && body.window !== null) {
    const entry = body.window as Record<string, unknown>;
    if (typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join() !== "day,end,start" || ![entry.day, entry.start, entry.end].every(Number.isInteger)) throw new InputError("Choose one of the provider's available times.");
    window = { day: entry.day as number, start: entry.start as number, end: entry.end as number };
  }
  if (body.hours !== undefined && (!Number.isInteger(body.hours) || (body.hours as number) < 1 || (body.hours as number) > MAX_HOURS)) throw new InputError(`Choose from 1 to ${MAX_HOURS} hours.`);
  if (body.note !== undefined && typeof body.note !== "string") throw new InputError("A note must be text.");
  return { serviceId: new ObjectId(body.serviceId), window, hours: body.hours as number | undefined, note: body.note as string | undefined };
}

// The provider is texted first: a request the provider never hears about must not keep the coins held.
export async function createBookingRequest(request: Request, auth: Auth, db: Db, client: MongoClient, origin: string, messenger: Messenger) {
  try {
    if (request.headers.get("origin") !== origin) return apiError(403, "INVALID_ORIGIN", "This request is not allowed.");
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!isProfileComplete(session.user)) return apiError(403, "PROFILE_INCOMPLETE", "Complete your profile to continue.");
    if (!await consumeProfileLimit(db, session.user.id)) return apiError(429, "RATE_LIMITED", "Too many requests. Please wait a minute and try again.");
    let body: unknown;
    try { body = await request.json(); } catch { throw new InputError("Send the request as JSON."); }
    const input = parseBookingRequest(body);
    const c = exchangeCollections(db);
    const service = await c.services.findOne({ _id: input.serviceId, status: "active" });
    if (!service) return apiError(404, "LISTING_NOT_FOUND", "This listing is no longer available.");
    const requesterId = new ObjectId(session.user.id);
    const [requester, provider] = await Promise.all([requesterId, service.userId].map((_id) => db.collection("user").findOne({ _id })));
    if (!requester?.textsEnabledAt) return apiError(403, "TEXTS_OFF", "Turn on texts to send requests.");
    if (!provider?.textsEnabledAt) return apiError(409, "PROVIDER_UNAVAILABLE", "Requests aren't available for this provider yet.");
    const hourly = service.pricingType === "hourly";
    if (hourly && input.hours === undefined) throw new InputError("Choose how many hours.");
    const domain = createExchangeService(db, client);
    const booking = await domain.requestBooking(requesterId, service._id, { ...(hourly ? { durationMinutes: input.hours! * 60 } : {}), preferredWindow: input.window, note: input.note });
    const offers = (await c.services.find({ userId: requesterId, status: "active" }, { projection: { title: 1 } }).sort({ createdAt: -1 }).toArray()).map((s) => s.title);
    try {
      await messenger.send(provider.phoneNumber, requestText({ requesterName: requester.name, requesterFirstName: requester.firstName, title: service.title, pricingType: service.pricingType, totalCredits: booking.totalCredits, hours: input.hours, window: booking.preferredWindow, offers, note: booking.note, code: bookingCode(booking._id) }));
    } catch (error) {
      logAuthFailure("Booking request text", error);
      await domain.transitionBooking(requesterId, booking._id, "cancel");
      return apiError(503, "PROVIDER_UNREACHABLE", `We couldn't reach ${provider.firstName} by text, so you weren't charged.`);
    }
    await messenger.send(requester.phoneNumber, requestSentText({ title: service.title, providerName: provider.name, providerFirstName: provider.firstName })).catch((error) => logAuthFailure("Booking confirmation text", error));
    return Response.json({ success: true, id: booking._id.toHexString() }, { status: 201 });
  } catch (error) {
    if (error instanceof InputError) return apiError(400, "INVALID_INPUT", error.message);
    logAuthFailure("Booking request", error);
    return apiError(503, "UNAVAILABLE", "We could not send your request. Please try again.");
  }
}
```

- [ ] **Step 5: Create `app/api/bookings/route.ts`**

```ts
import { logAuthFailure } from "@/lib/auth-errors";
import { getAuth } from "@/lib/auth";
import { createBookingRequest } from "@/lib/booking-requests";
import { getMongo } from "@/lib/mongodb";
import { photonMessenger } from "@/lib/photon-messenger";
import { apiError } from "@/lib/profile-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await getAuth();
    const { db, client } = await getMongo();
    return await createBookingRequest(request, auth, db, client, new URL(process.env.BETTER_AUTH_URL!).origin, photonMessenger);
  } catch (error) {
    logAuthFailure("Booking request initialization", error);
    return apiError(503, "UNAVAILABLE", "We could not send your request. Please try again.");
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --import tsx --test tests/bookings.test.ts`
Expected: PASS with `# fail 0`, 3 tests. The only log line should be the expected `[auth] Booking request text` from the failing-provider test.

- [ ] **Step 7: Typecheck, lint and commit**

Run: `npm run typecheck && npm run lint`
Expected: both exit with code 0.

```bash
git add lib/photon-messenger.ts lib/booking-requests.ts app/api/bookings/route.ts tests/bookings.test.ts
git commit -m "Add the booking request endpoint with Photon texts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Answering by text

**Files:**
- Create: `lib/booking-replies.ts`
- Test: `tests/replies.test.ts`

**Interfaces:**
- Consumes: `Messenger` and `enableTexts` (Task 1), the texts and `bookingCode` (Task 2), `requestBooking` with `preferredWindow` (Task 3), and the existing `transitionBooking`.
- Produces:
  - `type Reply = { answer: "yes" | "no"; code?: string }` and `parseReply(text: string): Reply | null`.
  - `handleInboundText(db, client, messenger, { senderPhone, text }): Promise<void>`, which never throws.

- [ ] **Step 1: Write the failing tests**

Create `tests/replies.test.ts`:

```ts
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createAuth, type Auth } from "../lib/auth-config";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { handleInboundText, parseReply } from "../lib/booking-replies";
import { ALREADY_ANSWERED_TEXT, HELP_TEXT, NO_REQUESTS_TEXT, WELCOME_TEXT, bookingCode } from "../lib/booking-texts";
import { ensureDefaultGenres, ensureExchangeIndexes, exchangeCollections } from "../lib/exchange-schema";
import { createExchangeService } from "../lib/exchange-service";

let server: MongoMemoryReplSet, client: MongoClient, db: Db, auth: Auth;
const origin = "http://localhost:3000";
const saturday = { day: 6, start: 600, end: 840 };

before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("replies");
  await ensureAuthIndexes(db); await ensureExchangeIndexes(db); await ensureDefaultGenres(db);
  auth = createAuth(db, client, { baseURL: origin, secret: "reply-test-secret-at-least-thirty-two-chars!" });
});
after(async () => { await client?.close(); await server?.stop(); });

async function person(number: number, firstName: string, texts = true) {
  const phone = `+12025550${String(600 + number)}`;
  const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": `192.0.2.${number}` }, body: JSON.stringify({ firstName, lastName: "Tester", email: `replier${number}@example.com`, phoneNumber: phone, password: "reply-test-password!!" }) }));
  assert.equal(response.status, 200, await response.clone().text());
  const id = new ObjectId((await response.json()).user.id);
  if (texts) await db.collection("user").updateOne({ _id: id }, { $set: { textsEnabledAt: new Date() } });
  return { id, phone };
}
async function request(requesterId: ObjectId, providerId: ObjectId, title = "Guitar Lessons") {
  const domain = createExchangeService(db, client);
  const genreId = (await exchangeCollections(db).genres.findOne({ slug: "music" }))!._id;
  const service = await domain.createService(providerId, { genreId, title, description: "Lessons.", deliveryMode: "remote", pricingType: "fixed", creditRate: 100, status: "active", availability: [saturday] });
  return domain.requestBooking(requesterId, service._id, { preferredWindow: saturday });
}
function messenger() {
  const sent: { phone: string; text: string }[] = [];
  return { sent, async send(phone: string, text: string) { sent.push({ phone, text }); } };
}

test("replies are YES or NO with an optional code", () => {
  assert.deepEqual(parseReply("yes"), { answer: "yes" });
  assert.deepEqual(parseReply("  Yes! "), { answer: "yes" });
  assert.deepEqual(parseReply("ACCEPT 7f3a"), { answer: "yes", code: "7F3A" });
  assert.deepEqual(parseReply("n #19C2"), { answer: "no", code: "19C2" });
  assert.deepEqual(parseReply("decline AA7F3A."), { answer: "no", code: "AA7F3A" });
  for (const text of ["yes please", "maybe", "no 7F3", "yes 1234567", ""]) assert.equal(parseReply(text), null, text);
});

test("the first text turns texts on; later chatter gets help", async () => {
  const newcomer = await person(1, "Nia", false);
  const texts = messenger();
  await handleInboundText(db, client, texts, { senderPhone: newcomer.phone, text: "Hi barter!" });
  assert.ok((await db.collection("user").findOne({ _id: newcomer.id }))?.textsEnabledAt instanceof Date);
  await handleInboundText(db, client, texts, { senderPhone: newcomer.phone, text: "what's up" });
  await handleInboundText(db, client, texts, { senderPhone: "+12025550999", text: "YES" });
  assert.deepEqual(texts.sent, [{ phone: newcomer.phone, text: WELCOME_TEXT }, { phone: newcomer.phone, text: HELP_TEXT }]);
});

test("YES accepts the only waiting request and NO declines with a refund", async () => {
  const barry = await person(2, "Barry"), emily = await person(3, "Emily");
  const first = await request(barry.id, emily.id);
  const texts = messenger();
  await handleInboundText(db, client, texts, { senderPhone: emily.phone, text: "Yes" });
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: first._id }))?.status, "accepted");
  assert.deepEqual(texts.sent, [
    { phone: emily.phone, text: "barter: You accepted Barry's Guitar Lessons request. We'll help you both pick a time and place next." },
    { phone: barry.phone, text: "barter: Emily accepted your Guitar Lessons request! We'll help you both pick a time and place next." },
  ]);
  const second = await request(barry.id, emily.id, "Piano Lessons");
  texts.sent.length = 0;
  await handleInboundText(db, client, texts, { senderPhone: emily.phone, text: "no" });
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: second._id }))?.status, "declined");
  assert.equal((await exchangeCollections(db).accounts.findOne({ userId: barry.id }))?.heldCredits, 100);
  assert.deepEqual(texts.sent.map((text) => text.text), [
    "barter: You declined Barry's Piano Lessons request.",
    "barter: Emily can't take your Piano Lessons request this time. Your 1 coin is back in your balance.",
  ]);
  texts.sent.length = 0;
  await handleInboundText(db, client, texts, { senderPhone: emily.phone, text: "yes" });
  await handleInboundText(db, client, texts, { senderPhone: emily.phone, text: `yes ${bookingCode(second._id)}` });
  assert.deepEqual(texts.sent.map((text) => text.text), [NO_REQUESTS_TEXT, ALREADY_ANSWERED_TEXT]);
});

test("with several requests waiting, the code picks one", async () => {
  const sam = await person(4, "Sam"), lou = await person(5, "Lou"), ana = await person(6, "Ana");
  const guitar = await request(sam.id, ana.id), piano = await request(lou.id, ana.id, "Piano Lessons");
  const texts = messenger();
  await handleInboundText(db, client, texts, { senderPhone: ana.phone, text: "YES" });
  assert.deepEqual(texts.sent, [{ phone: ana.phone, text: `barter: You have 2 requests waiting: Guitar Lessons from Sam (${bookingCode(guitar._id)}), Piano Lessons from Lou (${bookingCode(piano._id)}). Reply YES or NO with the code, like "YES ${bookingCode(guitar._id)}".` }]);
  await handleInboundText(db, client, texts, { senderPhone: ana.phone, text: `YES ${bookingCode(piano._id).toLowerCase()}` });
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: piano._id }))?.status, "accepted");
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: guitar._id }))?.status, "requested");
});

test("codes that collide are listed with six characters", async () => {
  const kim = await person(7, "Kim"), jo = await person(8, "Jo");
  const template = await request(kim.id, jo.id);
  const bookings = exchangeCollections(db).bookings;
  await bookings.deleteOne({ _id: template._id });
  const { _id: _unused, ...fields } = template;
  void _unused;
  const a = new ObjectId("aaaaaaaaaaaaaaaaaaaa7f3a"), b = new ObjectId("bbbbbbbbbbbbbbbbbbbb7f3a");
  await bookings.insertMany([{ ...fields, _id: a }, { ...fields, _id: b }]);
  const texts = messenger();
  await handleInboundText(db, client, texts, { senderPhone: jo.phone, text: "yes 7F3A" });
  assert.deepEqual(texts.sent.map((text) => text.text), ["barter: You have 2 requests waiting: Guitar Lessons from Kim (AA7F3A), Guitar Lessons from Kim (BB7F3A). Reply YES or NO with the code, like \"YES AA7F3A\"."]);
  await handleInboundText(db, client, texts, { senderPhone: jo.phone, text: "yes bb7f3a" });
  assert.equal((await bookings.findOne({ _id: b }))?.status, "accepted");
  assert.equal((await bookings.findOne({ _id: a }))?.status, "requested");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/replies.test.ts`
Expected: FAIL with `Cannot find module` for `../lib/booking-replies`.

- [ ] **Step 3: Create `lib/booking-replies.ts`**

```ts
import type { Db, Document, MongoClient, WithId } from "mongodb";
import { logAuthFailure } from "./auth-errors";
import { InputError } from "./auth-validation";
import { ALREADY_ANSWERED_TEXT, HELP_TEXT, NO_REQUESTS_TEXT, WELCOME_TEXT, acceptedTexts, bookingCode, declinedTexts, waitingListText } from "./booking-texts";
import { exchangeCollections, type Booking } from "./exchange-schema";
import { createExchangeService } from "./exchange-service";
import { enableTexts, type Messenger } from "./texting";

export type Reply = { answer: "yes" | "no"; code?: string };

const REPLY = /^(yes|y|accept|no|n|decline)(?:\s+#?([0-9a-f]{4,6}))?[.!?]*$/i;

/** "Yes!", "YES 7f3a" and "no #7F3A" are replies; anything else is null. */
export function parseReply(text: string): Reply | null {
  const match = REPLY.exec(text.trim());
  if (!match) return null;
  const answer = ["yes", "y", "accept"].includes(match[1].toLowerCase()) ? "yes" : "no";
  return match[2] ? { answer, code: match[2].toUpperCase() } : { answer };
}

// Handles one incoming text. Never throws: Photon won't retry after the webhook's 200, so failures are logged.
export async function handleInboundText(db: Db, client: MongoClient, messenger: Messenger, { senderPhone, text }: { senderPhone: string; text: string }) {
  try {
    const user = await db.collection("user").findOne({ phoneNumber: senderPhone });
    if (!user) { logAuthFailure("Text from a number without a barter account"); return; }
    if (await enableTexts(db, senderPhone)) { await messenger.send(senderPhone, WELCOME_TEXT); return; }
    const reply = parseReply(text);
    if (!reply) { await messenger.send(senderPhone, HELP_TEXT); return; }
    await answer(db, client, messenger, user, reply);
  } catch (error) {
    logAuthFailure("Incoming text", error);
  }
}

type Person = WithId<Document>;
const hex = (booking: { _id: { toHexString(): string } }) => booking._id.toHexString().toUpperCase();

async function answer(db: Db, client: MongoClient, messenger: Messenger, provider: Person, reply: Reply) {
  const bookings = exchangeCollections(db).bookings;
  const phone = String(provider.phoneNumber);
  const waiting = await bookings.find({ providerId: provider._id, status: "requested" }).sort({ createdAt: 1, _id: 1 }).toArray();
  const matches = reply.code ? waiting.filter((booking) => hex(booking).endsWith(reply.code!)) : waiting;
  if (matches.length === 1) return decide(db, client, messenger, provider, matches[0], reply.answer);
  if (matches.length > 1) return messenger.send(phone, waitingListText(await listItems(db, matches)));
  if (reply.code) {
    const answered = await bookings.find({ providerId: provider._id, status: { $ne: "requested" } }, { projection: { _id: 1 } }).sort({ updatedAt: -1 }).limit(50).toArray();
    if (answered.some((booking) => hex(booking).endsWith(reply.code!))) return messenger.send(phone, ALREADY_ANSWERED_TEXT);
    if (waiting.length) return messenger.send(phone, waitingListText(await listItems(db, waiting)));
  }
  return messenger.send(phone, NO_REQUESTS_TEXT);
}

async function decide(db: Db, client: MongoClient, messenger: Messenger, provider: Person, booking: Booking, answer: "yes" | "no") {
  const phone = String(provider.phoneNumber);
  try {
    await createExchangeService(db, client).transitionBooking(provider._id as Booking["providerId"], booking._id, answer === "yes" ? "accept" : "decline");
  } catch (error) {
    // Another reply or a cancellation got there first.
    if (error instanceof InputError) return messenger.send(phone, ALREADY_ANSWERED_TEXT);
    throw error;
  }
  const requester = await db.collection("user").findOne({ _id: booking.requesterId });
  const names = { title: booking.serviceSnapshot.title, requesterFirstName: String(requester?.firstName ?? "the requester"), providerFirstName: String(provider.firstName) };
  const texts = answer === "yes" ? acceptedTexts(names) : declinedTexts({ ...names, totalCredits: booking.totalCredits });
  await messenger.send(phone, texts.provider);
  if (typeof requester?.phoneNumber === "string") await messenger.send(requester.phoneNumber, texts.requester);
}

// Lists waiting requests with their codes, using six characters when two four-character codes collide.
async function listItems(db: Db, bookings: Booking[]) {
  const requesters = await db.collection("user").find({ _id: { $in: bookings.map((booking) => booking.requesterId) } }, { projection: { firstName: 1 } }).toArray();
  const firstName = new Map(requesters.map((requester) => [requester._id.toHexString(), String(requester.firstName)]));
  const short = bookings.map((booking) => bookingCode(booking._id));
  const length = new Set(short).size < short.length ? 6 : 4;
  return bookings.map((booking) => ({ title: booking.serviceSnapshot.title, requesterFirstName: firstName.get(booking.requesterId.toHexString()) ?? "someone", code: bookingCode(booking._id, length) }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test tests/replies.test.ts`
Expected: PASS with `# fail 0`, 5 tests. The only log line should be the expected `[auth] Text from a number without a barter account`.

- [ ] **Step 5: Typecheck, lint and commit**

Run: `npm run typecheck && npm run lint`
Expected: both exit with code 0.

```bash
git add lib/booking-replies.ts tests/replies.test.ts
git commit -m "Answer booking requests with YES or NO texts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Photon webhook

**Files:**
- Modify: `package.json` and `package-lock.json` (adding `@spectrum-ts/core`)
- Create: `lib/photon-webhook.ts`, `app/api/photon/webhook/route.ts`
- Test: `tests/webhook.test.ts`

**Interfaces:**
- Consumes: `claimInboundMessage` (Task 1), `handleInboundText` (Task 5), `photonMessenger` (Task 4), and `isE164` from `lib/phone.ts`.
- Produces:
  - `type InboundText = { id: string; senderPhone: string; text: string }` and `parseInboundText(rawBody: string): InboundText | null`.
  - `receiveWebhook(request: Request, db: Db, secret: string, now?: number): Promise<{ response: Response; inbound?: InboundText }>`.
  - `POST /api/photon/webhook`.

- [ ] **Step 1: Add the webhook verifier package**

`spectrum-ts` pins `@spectrum-ts/core` 12.10.1 and doesn't re-export its `./webhook` entry. Depend on it directly, at the same version:

Run: `npm install --save-exact @spectrum-ts/core@12.10.1`
Expected: `package.json` gains `"@spectrum-ts/core": "12.10.1"`, and `node_modules` still has one copy (`npm ls @spectrum-ts/core` shows a single version).

- [ ] **Step 2: Write the failing tests**

Create `tests/webhook.test.ts`:

```ts
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { parseInboundText, receiveWebhook } from "../lib/photon-webhook";

let server: MongoMemoryReplSet, client: MongoClient, db: Db;
const secret = "whsec-test";
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("webhook");
});
after(async () => { await client?.close(); await server?.stop(); });

// Signs a delivery the way Photon does: HMAC-SHA256 over "v0:<unix seconds>:<body>".
function signed(body: string, { key = secret, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const signature = createHmac("sha256", key).update(`v0:${timestamp}:${body}`).digest("hex");
  return new Request("http://localhost:3000/api/photon/webhook", { method: "POST", headers: { "x-spectrum-signature": `v0=${signature}`, "x-spectrum-timestamp": String(timestamp), "content-type": "application/json" }, body });
}
function delivery(message: Record<string, unknown> = {}) {
  return JSON.stringify({ event: "message.received", message: { id: "msg-1", direction: "inbound", sender: { id: "+12025550700" }, space: { id: "any;-;+12025550700" }, content: { type: "text", text: "YES 7F3A" }, ...message } });
}

test("a signed inbound text is handed over once", async () => {
  const first = await receiveWebhook(signed(delivery()), db, secret);
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.inbound, { id: "msg-1", senderPhone: "+12025550700", text: "YES 7F3A" });
  const repeat = await receiveWebhook(signed(delivery()), db, secret);
  assert.equal(repeat.response.status, 200);
  assert.equal(repeat.inbound, undefined);
});

test("forged, stale or unsigned deliveries are rejected", async () => {
  assert.equal((await receiveWebhook(signed(delivery({ id: "msg-2" }), { key: "someone-else" }), db, secret)).response.status, 401);
  assert.equal((await receiveWebhook(signed(delivery({ id: "msg-3" }), { timestamp: Math.floor(Date.now() / 1000) - 600 }), db, secret)).response.status, 401);
  const unsigned = new Request("http://localhost:3000/api/photon/webhook", { method: "POST", body: delivery({ id: "msg-4" }) });
  assert.equal((await receiveWebhook(unsigned, db, secret)).response.status, 401);
});

test("other deliveries are acknowledged and ignored", async () => {
  for (const message of [{ id: "msg-5", direction: "outbound" }, { id: "msg-6", content: { type: "attachment" } }, { id: "msg-7", sender: { id: "person@icloud.com" } }]) {
    const result = await receiveWebhook(signed(delivery(message)), db, secret);
    assert.equal(result.response.status, 200, JSON.stringify(message));
    assert.equal(result.inbound, undefined, JSON.stringify(message));
  }
  assert.equal(parseInboundText("not json"), null);
  assert.equal(parseInboundText(JSON.stringify({ event: "message.received" })), null);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --import tsx --test tests/webhook.test.ts`
Expected: FAIL with `Cannot find module` for `../lib/photon-webhook`.

- [ ] **Step 4: Create `lib/photon-webhook.ts`**

```ts
import { verifySpectrumSignature } from "@spectrum-ts/core/webhook";
import type { Db } from "mongodb";
import { isE164 } from "./phone";
import { claimInboundMessage } from "./texting";

export type InboundText = { id: string; senderPhone: string; text: string };

/** Reads an inbound text out of Photon's normalized webhook JSON; null for anything else. */
export function parseInboundText(rawBody: string): InboundText | null {
  let envelope: unknown;
  try { envelope = JSON.parse(rawBody); } catch { return null; }
  const message = (envelope as { message?: Record<string, unknown> } | null)?.message;
  const content = message?.content as { type?: unknown; text?: unknown } | undefined;
  const sender = (message?.sender as { id?: unknown } | undefined)?.id;
  if (!message || message.direction === "outbound" || typeof message.id !== "string" || content?.type !== "text" || typeof content.text !== "string") return null;
  // Apple can deliver from an email handle, which can't be matched to a barter account.
  if (typeof sender !== "string" || !isE164(sender)) return null;
  return { id: message.id, senderPhone: sender, text: content.text };
}

/**
 * Verifies and claims one delivery. Returns the response for Photon and, for a new inbound
 * text, the text to handle after responding.
 */
export async function receiveWebhook(request: Request, db: Db, secret: string, now = Date.now()): Promise<{ response: Response; inbound?: InboundText }> {
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const verified = await verifySpectrumSignature({ rawBody, headers: Object.fromEntries(request.headers), secret, now });
  if (!verified.ok) return { response: new Response("Invalid signature.", { status: 401 }) };
  const inbound = parseInboundText(new TextDecoder().decode(rawBody));
  if (!inbound || !await claimInboundMessage(db, inbound.id)) return { response: new Response(null, { status: 200 }) };
  return { response: new Response(null, { status: 200 }), inbound };
}
```

- [ ] **Step 5: Create `app/api/photon/webhook/route.ts`**

```ts
import { after } from "next/server";
import { logAuthFailure } from "@/lib/auth-errors";
import { handleInboundText } from "@/lib/booking-replies";
import { getMongo } from "@/lib/mongodb";
import { photonMessenger } from "@/lib/photon-messenger";
import { receiveWebhook } from "@/lib/photon-webhook";

export const runtime = "nodejs";

// Photon posts each incoming text here (register it with npm run photon:webhook). Replies are sent
// inside after(), so the function stays alive past the 200 on Vercel.
export async function POST(request: Request) {
  const secret = process.env.SPECTRUM_WEBHOOK_SECRET;
  if (!secret) {
    logAuthFailure("Photon webhook: SPECTRUM_WEBHOOK_SECRET is not set");
    return new Response("Not configured.", { status: 503 });
  }
  try {
    const { db, client } = await getMongo();
    const { response, inbound } = await receiveWebhook(request, db, secret);
    if (inbound) after(() => handleInboundText(db, client, photonMessenger, inbound));
    return response;
  } catch (error) {
    // A 5xx makes Photon retry; the message wasn't claimed, so the retry is handled normally.
    logAuthFailure("Photon webhook", error);
    return new Response("Unavailable.", { status: 503 });
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --import tsx --test tests/webhook.test.ts`
Expected: PASS with `# fail 0`, 3 tests.

- [ ] **Step 7: Typecheck, lint, build and commit**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all exit with code 0. The build lists `ƒ /api/photon/webhook` and `ƒ /api/bookings`.

```bash
git add package.json package-lock.json lib/photon-webhook.ts app/api/photon/webhook/route.ts tests/webhook.test.ts
git commit -m "Receive Photon texts through a signed webhook" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Registering people and turning on texts

**Files:**
- Create: `lib/texts-setup.ts`, `app/api/texts/route.ts`
- Modify: `lib/auth-config.ts` (the `AuthEnvironment` type and the `session.create.after` hook), `lib/auth.ts`, `lib/profile-service.ts` (`updateProfile`), `app/api/profile/complete/route.ts`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Consumes: `RegisterPhoton`, `registerPhotonUser` and `photonConfigured` (Task 1), and `ensurePhotonUser` (Task 1).
- Produces:
  - `AuthEnvironment.registerPhoton?: RegisterPhoton`.
  - `updateProfile(request, auth, db, origin, complete, registerPhoton?: RegisterPhoton)`.
  - `turnOnTexts(request, auth, db, origin, register: RegisterPhoton | undefined): Promise<Response>`, which responds `200 { number }`.
  - `POST /api/texts`.

- [ ] **Step 1: Write the failing tests**

In `tests/auth.test.ts`, extend the imports:
- Add `turnOnTexts` from `../lib/texts-setup`.
- Add `type PhotonPerson` and `type RegisterPhoton` from `../lib/photon-users`.

Keep the existing `updateProfile` import.

In the Google completion test, replace the line `assert.equal((await updateProfile(profileRequest(body, cookies, true), auth, db, origin, true)).status, 200);` with:

```ts
  const registered: PhotonPerson[] = [];
  const registerPhoton: RegisterPhoton = async (person) => { registered.push(person); return { id: "photon-google", assignedPhoneNumber: "+15550008888" }; };
  assert.equal((await updateProfile(profileRequest(body, cookies, true), auth, db, origin, true, registerPhoton)).status, 200);
  assert.deepEqual(registered, [{ phoneNumber: "+12025550999", firstName: "Chosen", lastName: "Name" }]);
```

In the test "contact edits require the password, normalize identifiers, and refresh session data", replace the line `await db.collection("user").updateOne({ _id: new ObjectId(user.user.id) }, { $set: { emailVerified: true, phoneNumberVerified: true } });` with:

```ts
  await db.collection("user").updateOne({ _id: new ObjectId(user.user.id) }, { $set: { emailVerified: true, phoneNumberVerified: true, photonUserId: "photon-old", photonNumber: "+15550006666", textsEnabledAt: new Date() } });
```

and directly after `assert.equal(session?.user.phoneNumberVerified, false);` in that test, add:

```ts
  const texting = await db.collection("user").findOne({ _id: new ObjectId(user.user.id) });
  assert.deepEqual([texting?.photonUserId, texting?.photonNumber, texting?.textsEnabledAt], [undefined, undefined, undefined]);
```

At the end of the file, add:

```ts
test("new sessions register complete accounts with Photon once", async () => {
  const people: PhotonPerson[] = [];
  const texting = createAuth(db, client, { ...env, registerPhoton: async (person) => { people.push(person); return { id: "photon-session", assignedPhoneNumber: "+15550005555" }; } });
  const data = account();
  assert.equal((await request("/sign-up/email", data, "", texting)).status, 200);
  assert.equal((await request("/sign-in/email", { email: data.email, password: data.password }, "", texting)).status, 200);
  assert.deepEqual(people, [{ phoneNumber: data.phoneNumber, firstName: "Zoë", lastName: "王" }]);
  assert.equal((await db.collection("user").findOne({ phoneNumber: data.phoneNumber }))?.photonNumber, "+15550005555");
});

test("turning on texts returns the barter number to text", async () => {
  const user = await register();
  const registerPhoton: RegisterPhoton = async () => ({ id: "photon-texts", assignedPhoneNumber: "+15550007777" });
  const post = (cookies: string, requestOrigin = origin, register: RegisterPhoton | undefined = registerPhoton) => turnOnTexts(new Request(`${origin}/api/texts`, { method: "POST", headers: { cookie: cookies, origin: requestOrigin } }), auth, db, origin, register);
  assert.equal((await post("")).status, 401);
  assert.equal((await post(user.cookie, "https://evil.example")).status, 403);
  assert.equal((await post(user.cookie, origin, undefined)).status, 503);
  const response = await post(user.cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { number: "+15550007777" });
});
```

The `createAuth` import already exists in this file. So do `client`, `env`, `account`, `request` and `register`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/auth.test.ts`
Expected: FAIL with `Cannot find module` for `../lib/texts-setup`.

- [ ] **Step 3: Register at the start of each session**

In `lib/auth-config.ts`:
- Add `import type { RegisterPhoton } from "./photon-users";` and `import { ensurePhotonUser } from "./texting";` with the other imports.
- In `AuthEnvironment`, after `googleClientSecret?: string;`, add:

```ts
  /** Registers complete accounts with Photon; omitted in tests and when Photon isn't configured. */
  registerPhoton?: RegisterPhoton;
```

Replace the `session: { create: { after: async (session) => { ... } } },` block with:

```ts
      session: { create: { after: async (session) => {
        try {
          const userId = new ObjectId(session.userId);
          const record = await db.collection("user").findOne({ _id: userId });
          if (record && isProfileComplete({ firstName: record.firstName, lastName: record.lastName, phoneNumber: record.phoneNumber, profileCompletedAt: record.profileCompletedAt })) {
            await createExchangeService(db, client).grantWelcome(userId);
          }
        } catch (error) {
          logAuthFailure("Welcome credit grant", error);
        }
        // Registering with Photon is also secondary to signing in. Incomplete accounts wait until they finish.
        if (env.registerPhoton) {
          await ensurePhotonUser(db, new ObjectId(session.userId), env.registerPhoton).catch((error: unknown) => {
            if (!(error instanceof InputError)) logAuthFailure("Photon registration", error);
          });
        }
      } } },
```

In `lib/auth.ts`, add `import { photonConfigured, registerPhotonUser } from "./photon-users";`. In the `createAuth(db, client, { ... })` call, add `registerPhoton: photonConfigured() ? registerPhotonUser : undefined` after `googleClientSecret: process.env.GOOGLE_CLIENT_SECRET`.

- [ ] **Step 4: Register after Google completion, and start over when the phone changes**

In `lib/profile-service.ts`:
- Add `import type { RegisterPhoton } from "./photon-users";` and `import { ensurePhotonUser } from "./texting";`.
- Change the signature to `export async function updateProfile(request: Request, auth: Auth, db: Db, origin: string, complete: boolean, registerPhoton?: RegisterPhoton) {`.

Inside the transaction, replace these lines:

```ts
      if ("phoneNumber" in updates && updates.phoneNumber !== current.phoneNumber) updates.phoneNumberVerified = false;
      const result = await db.collection("user").updateOne(
        { _id: userId, ...(complete ? { profileCompletedAt: null } : {}) },
        { $set: updates }, { session: transactionSession },
      );
```

with:

```ts
      // Texts were turned on for the old number, so a new number starts over.
      const phoneChanged = "phoneNumber" in updates && updates.phoneNumber !== current.phoneNumber;
      if (phoneChanged) updates.phoneNumberVerified = false;
      const result = await db.collection("user").updateOne(
        { _id: userId, ...(complete ? { profileCompletedAt: null } : {}) },
        { $set: updates, ...(phoneChanged ? { $unset: { photonUserId: "", photonNumber: "", textsEnabledAt: "" } } : {}) }, { session: transactionSession },
      );
```

Replace the `return Response.json({ success: true });` that follows the transaction with:

```ts
    // Registering with Photon never fails the save; the next sign-in retries it.
    if (complete && registerPhoton) await ensurePhotonUser(db, new ObjectId(session.user.id), registerPhoton).catch((error) => logAuthFailure("Photon registration", error));
    return Response.json({ success: true });
```

In `app/api/profile/complete/route.ts`, add `import { photonConfigured, registerPhotonUser } from "@/lib/photon-users";`. Change the `updateProfile(...)` call's last argument, `true`, to `true, photonConfigured() ? registerPhotonUser : undefined`.

- [ ] **Step 5: Create `lib/texts-setup.ts` and `app/api/texts/route.ts`**

`lib/texts-setup.ts`:

```ts
import { ObjectId, type Db } from "mongodb";
import type { Auth } from "./auth-config";
import { logAuthFailure } from "./auth-errors";
import { InputError, isProfileComplete } from "./auth-validation";
import type { RegisterPhoton } from "./photon-users";
import { apiError, consumeProfileLimit } from "./profile-service";
import { ensurePhotonUser } from "./texting";

// The "Turn on texts" button: registers the account with Photon if needed and returns the number to text.
export async function turnOnTexts(request: Request, auth: Auth, db: Db, origin: string, register: RegisterPhoton | undefined) {
  try {
    if (request.headers.get("origin") !== origin) return apiError(403, "INVALID_ORIGIN", "This request is not allowed.");
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!isProfileComplete(session.user)) return apiError(403, "PROFILE_INCOMPLETE", "Complete your profile to continue.");
    if (!await consumeProfileLimit(db, session.user.id)) return apiError(429, "RATE_LIMITED", "Too many requests. Please wait a minute and try again.");
    if (!register) return apiError(503, "TEXTS_UNAVAILABLE", "Texting isn't set up yet.");
    return Response.json({ number: await ensurePhotonUser(db, new ObjectId(session.user.id), register) });
  } catch (error) {
    if (error instanceof InputError) return apiError(400, "INVALID_INPUT", error.message);
    logAuthFailure("Turning on texts", error);
    return apiError(503, "UNAVAILABLE", "We couldn't reach our texting service. Please try again.");
  }
}
```

`app/api/texts/route.ts`:

```ts
import { logAuthFailure } from "@/lib/auth-errors";
import { getAuth } from "@/lib/auth";
import { getMongo } from "@/lib/mongodb";
import { photonConfigured, registerPhotonUser } from "@/lib/photon-users";
import { apiError } from "@/lib/profile-service";
import { turnOnTexts } from "@/lib/texts-setup";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await getAuth();
    const { db } = await getMongo();
    return await turnOnTexts(request, auth, db, new URL(process.env.BETTER_AUTH_URL!).origin, photonConfigured() ? registerPhotonUser : undefined);
  } catch (error) {
    logAuthFailure("Texts initialization", error);
    return apiError(503, "UNAVAILABLE", "We couldn't reach our texting service. Please try again.");
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --import tsx --test tests/auth.test.ts tests/texting.test.ts`
Expected: PASS with `# fail 0`.

- [ ] **Step 7: Typecheck, lint and commit**

Run: `npm run typecheck && npm run lint`
Expected: both exit with code 0.

```bash
git add lib/texts-setup.ts app/api/texts/route.ts lib/auth-config.ts lib/auth.ts lib/profile-service.ts app/api/profile/complete/route.ts tests/auth.test.ts
git commit -m "Register accounts with Photon and add the turn-on-texts endpoint" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The banner, Contact and the request form

**Files:**
- Create: `components/barter/texts-banner.tsx`, `components/barter/request-form.tsx`
- Modify: `lib/barter/data.ts` (the `Service` type), `lib/listing-data.ts` (`getExplorerData`), `app/page.tsx`, `components/barter/explorer.tsx`, `components/barter/listing-modal.tsx:1-85`
- Test: `tests/listing.test.ts`

**Interfaces:**
- Consumes:
  - `POST /api/texts` → `{ number }` (Task 7).
  - `POST /api/bookings` with `{ serviceId, window, hours?, note? }` (Task 4).
  - `formatAvailability` from `lib/availability.ts`.
- Produces:
  - `Service.pricingType`, `Service.creditRate` and `Service.providerTextsEnabled`.
  - `getExplorerData(...)` returns `textsEnabled: boolean`.
  - Components: `TurnOnTexts({ className? })`, `TextsBanner()` and `RequestForm({ service, balance, onBack, onSent })`.
  - `ListingModal({ service, balance, textsEnabled, onClose })`.

- [ ] **Step 1: Update the explorer test**

In `tests/listing.test.ts`, in "the explorer lists active listings with provider ratings and labels", replace the `tags: [...], availability: storedAvailability,` line of the expected listing with:

```ts
    tags: ["12 coins / service", "In person", "One time"], availability: storedAvailability, pricingType: "fixed", creditRate: 1200, providerTextsEnabled: false,
```

and directly after `assert.equal(data.balance, 10);`, add:

```ts
  assert.equal(data.textsEnabled, false);
  await db.collection("user").updateMany({ _id: { $in: [viewer.id, provider.id] } }, { $set: { textsEnabledAt: new Date() } });
  const texting = await getExplorerData(db, viewer.id.toHexString());
  assert.equal(texting.textsEnabled, true);
  assert.equal(texting.listings.find((listing) => listing.id === shown._id.toHexString())?.providerTextsEnabled, true);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/listing.test.ts`
Expected: FAIL in the explorer test with `Expected values to be strictly deep-equal`.

- [ ] **Step 3: Add the fields and viewer state**

In `lib/barter/data.ts`, in the `Service` type, directly after the `availability` field, add:

```ts
  /** Pricing for the request form's total; the rate is in integer hundredths of a coin. */
  pricingType: "fixed" | "hourly";
  creditRate: number;
  /** Whether the provider has turned on texts, so Contact can send them requests. */
  providerTextsEnabled: boolean;
```

In `lib/listing-data.ts`, in `getExplorerData`:
- Change the return type to `Promise<{ listings: Service[]; categories: CategoryOption[]; balance: number; textsEnabled: boolean }>`.
- Change `const [services, genres, account] = await Promise.all([` to `const [services, genres, account, viewerUser] = await Promise.all([`. Add this entry after the `c.accounts.findOne(...)` entry:

```ts
    db.collection("user").findOne({ _id: viewer }, { projection: { textsEnabledAt: 1 } }),
```

- Change the provider projection to `{ projection: { name: 1, rating: 1, numberOfReviews: 1, textsEnabledAt: 1 } }`.
- In the listing object, replace `providerId: s.userId.toHexString(), providerName: owner?.name || "Member", own: s.userId.equals(viewer),` with:

```ts
      pricingType: s.pricingType, creditRate: s.creditRate, providerTextsEnabled: Boolean(owner?.textsEnabledAt),
      providerId: s.userId.toHexString(), providerName: owner?.name || "Member", own: s.userId.equals(viewer),
```

- In the returned object, after `balance: (account?.availableCredits ?? 0) / 100,`, add `textsEnabled: Boolean(viewerUser?.textsEnabledAt),`.

In `app/page.tsx`, change `const { listings, categories, balance } = await getExplorerData(db, user.id);` to `const { listings, categories, balance, textsEnabled } = await getExplorerData(db, user.id);`, and add `textsEnabled={textsEnabled}` after `balance={balance}`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/listing.test.ts`
Expected: PASS with `# fail 0`.

- [ ] **Step 5: Create `components/barter/texts-banner.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

const button = "h-10 rounded-[8px] bg-barter-navy px-5 text-[15px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60";

// "+15551234567" → "(555) 123-4567"; other formats are shown as they are.
function displayNumber(number: string) {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(number);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : number;
}

/** Gets the viewer's barter number, then offers to open Messages with it. */
export function TurnOnTexts({ className }: { className?: string }) {
  const router = useRouter();
  const [number, setNumber] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/texts", { method: "POST" });
      const data = await response.json().catch(() => null);
      if (response.ok && typeof data?.number === "string") setNumber(data.number);
      else setError(data?.error?.message ?? "We couldn't turn on texts. Please try again.");
    } catch {
      setError("Unable to connect. Please try again.");
    }
    setBusy(false);
  }

  if (!number) {
    return (
      <div className={className}>
        <button type="button" onClick={start} disabled={busy} className={button}>
          {busy ? "One moment…" : "Turn on texts"}
        </button>
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      <a href={`sms:${number}?&body=Hi%20barter!`} className={cn(button, "flex items-center")}>
        Open Messages
      </a>
      <p className="text-[15px]">
        or text “Hi barter!” to <span className="font-bold">{displayNumber(number)}</span>
      </p>
      <button type="button" onClick={() => router.refresh()} className="text-[15px] font-bold underline">
        Check again
      </button>
    </div>
  );
}

export function TextsBanner() {
  return (
    <section aria-label="Turn on texts" className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 bg-barter-periwinkle/15 px-6 py-3 lg:px-10">
      <p className="text-[15px] font-semibold text-barter-navy">Turn on texts to send and receive requests.</p>
      <TurnOnTexts />
    </section>
  );
}
```

- [ ] **Step 6: Create `components/barter/request-form.tsx`**

```tsx
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
      <button type="button" onClick={onBack} className="font-mono text-[15px] font-bold underline">
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
                  <input type="radio" checked={slot === index} onChange={() => setSlot(index)} className="size-[18px] accent-barter-navy" />
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
```

- [ ] **Step 7: Wire Contact in `components/barter/listing-modal.tsx`**

Replace lines 1–85 (the imports and the `ListingModal` function) with the code below. `Rating` and `Gallery`, from line 87 on, stay as they are.

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Star, X } from "lucide-react";
import type { Service } from "@/lib/barter/data";
import { formatAvailability } from "@/lib/availability";
import { starFill } from "@/lib/profile-display";
import { cn } from "@/lib/utils";
import { Modal } from "./modal";
import { RequestForm } from "./request-form";
import { ServiceArt } from "./results";
import { TurnOnTexts } from "./texts-banner";
import { useState } from "react";

const contactButton = "flex h-14 shrink-0 items-center justify-center rounded-[10px] bg-barter-navy px-10 font-mono text-xl font-extrabold text-white transition-opacity hover:opacity-90 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-barter-blue lg:h-[68px] lg:text-2xl";

export function ListingModal({
  service,
  balance,
  textsEnabled,
  onClose,
}: {
  service: Service | null;
  balance: number;
  textsEnabled: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={service !== null}
      onClose={onClose}
      labelledBy="listing-title"
      closeOnBackdrop
      className="lg:max-h-[min(843px,calc(100dvh-4rem))]"
    >
      {/* Keyed so each listing starts on its details, not a previous listing's request form. */}
      {service && <ListingBody key={service.id} service={service} balance={balance} textsEnabled={textsEnabled} onClose={onClose} />}
    </Modal>
  );
}

function ListingBody({ service, balance, textsEnabled, onClose }: { service: Service; balance: number; textsEnabled: boolean; onClose: () => void }) {
  const router = useRouter();
  const [view, setView] = useState<"details" | "request" | "sent">("details");
  const providerFirstName = service.providerName.split(" ")[0];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 pb-8 lg:pt-[42px] lg:pr-[59px] lg:pb-[58px] lg:pl-[66px]">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2
            id="listing-title"
            className="font-mono text-[28px] leading-tight font-extrabold break-words lg:text-[40px]"
          >
            {service.title}
          </h2>
          <Rating service={service} className="mt-2 lg:hidden" />
        </div>
        <Rating service={service} className="hidden lg:flex lg:pt-2" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 lg:ml-3"
        >
          <X className="size-8 lg:size-10" strokeWidth={2.5} />
        </button>
      </div>
      {view === "request" ? (
        textsEnabled ? (
          <RequestForm
            service={service}
            balance={balance}
            onBack={() => setView("details")}
            onSent={() => {
              setView("sent");
              // Shows the new balance and the booking on the profile page.
              router.refresh();
            }}
          />
        ) : (
          <section aria-labelledby="request-texts" className="mt-8 max-w-[640px]">
            <h3 id="request-texts" className="font-mono text-xl font-bold lg:text-2xl">Turn on texts first</h3>
            <p className="mt-3 font-mono text-base text-barter-gray lg:text-lg">
              barter texts you when {providerFirstName} answers, so texts need to be on before you send a request.
            </p>
            <TurnOnTexts className="mt-5" />
            <button type="button" onClick={() => setView("details")} className="mt-6 font-mono text-[15px] font-bold underline">
              Back
            </button>
          </section>
        )
      ) : (
        <>
          <Gallery service={service} />
          <div className="mt-7 flex flex-col gap-6 lg:mt-8 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
            <section aria-labelledby="listing-description" className="min-w-0 lg:max-w-[770px]">
              <h3 id="listing-description" className="font-mono text-xl font-bold lg:text-2xl">
                Description
              </h3>
              <p className="mt-4 font-mono text-base whitespace-pre-wrap text-barter-gray [overflow-wrap:anywhere] lg:mt-5 lg:text-xl">
                {service.description}
              </p>
              <ul aria-label="Details" className="mt-5 flex flex-wrap gap-2 font-mono text-sm font-bold">
                {[...new Set([service.category, service.location, ...service.tags])].map((detail) => (
                  <li key={detail} className="rounded-lg bg-barter-read px-3 py-1.5">
                    {detail}
                  </li>
                ))}
              </ul>
              <h3 className="mt-6 font-mono text-xl font-bold lg:mt-8 lg:text-2xl">Availability</h3>
              <p className="mt-3 font-mono text-base text-barter-gray lg:mt-4 lg:text-xl">
                {formatAvailability(service.availability)}
                {service.availability.length > 0 && " (New York time)"}
              </p>
            </section>
            <Contact service={service} sent={view === "sent"} providerFirstName={providerFirstName} onContact={() => setView("request")} />
          </div>
        </>
      )}
    </div>
  );
}

function Contact({ service, sent, providerFirstName, onContact }: { service: Service; sent: boolean; providerFirstName: string; onContact: () => void }) {
  if (service.own) {
    return <Link href="/profile" aria-label="View your profile" className={contactButton}>Your profile</Link>;
  }
  if (sent) {
    return <p role="status" className="max-w-[260px] font-mono text-base font-bold lg:text-lg">Request sent. We&apos;ll text you when {providerFirstName} answers.</p>;
  }
  if (!service.providerTextsEnabled) {
    return <p className="max-w-[260px] font-mono text-base text-barter-gray lg:text-lg">Requests aren&apos;t available for this provider yet</p>;
  }
  return (
    <button type="button" onClick={onContact} aria-label={`Contact ${service.providerName}`} className={contactButton}>
      Contact
    </button>
  );
}
```

- [ ] **Step 8: Show the banner and pass viewer state in `components/barter/explorer.tsx`**

- After `import { ListingModal } from "./listing-modal";`, add `import { TextsBanner } from "./texts-banner";`.
- In the destructured props, change `  balance,\n  areas,` to `  balance,\n  textsEnabled,\n  areas,`.
- In the props type, change `  balance: number;\n  areas: ZipArea[];` to:

```tsx
  balance: number;
  /** Whether the viewer has turned on texts. */
  textsEnabled: boolean;
  areas: ZipArea[];
```

- Directly before `      <main className="relative flex min-h-0 flex-1 bg-[#e9ecef]">`, add:

```tsx
      {!textsEnabled && <TextsBanner />}

```

- In `<ListingModal`, add `balance={balance}` and `textsEnabled={textsEnabled}` after `service={selected}`.

- [ ] **Step 9: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit with code 0.

- [ ] **Step 10: Check it in the browser**

The home page needs a signed-in account, so check the pieces on a temporary page. Create `app/texts-check/page.tsx`:

```tsx
// TEMPORARY: texts and Contact check page. Delete before committing.
"use client";

import { useState } from "react";
import { ListingModal } from "@/components/barter/listing-modal";
import { TextsBanner } from "@/components/barter/texts-banner";
import type { Service } from "@/lib/barter/data";

const base: Service = {
  id: "check", title: "Guitar Lessons", description: "Beginner lessons.", category: "Music", images: [],
  rating: 4.5, ratingCount: 2, location: "Remote", zip: null, tags: ["2 coins / hour", "Remote", "One time"],
  availability: [{ day: 1, start: 1020, end: 1200 }, { day: 6, start: 600, end: 840 }],
  pricingType: "hourly", creditRate: 200, providerTextsEnabled: true,
  providerId: "p", providerName: "Emily Park", own: false,
};

export default function TextsCheck() {
  const [mode, setMode] = useState<"on" | "viewer-off" | "provider-off">("on");
  return (
    <div>
      <TextsBanner />
      <div className="flex gap-2 p-4">
        {(["on", "viewer-off", "provider-off"] as const).map((value) => (
          <button key={value} type="button" onClick={() => setMode(value)} className="border px-3 py-1">{value}</button>
        ))}
      </div>
      <ListingModal service={{ ...base, id: mode, providerTextsEnabled: mode !== "provider-off" }} balance={12} textsEnabled={mode !== "viewer-off"} onClose={() => {}} />
    </div>
  );
}
```

With the dev server running, open `/texts-check`, then:

1. In the page's console, stub the two endpoints:

   ```js
   window.sent = null;
   const realFetch = window.fetch;
   window.fetch = (url, init) => {
     if (String(url).includes("/api/texts")) return Promise.resolve(Response.json({ number: "+15551234567" }));
     if (String(url).includes("/api/bookings")) { window.sent = JSON.parse(init.body); return Promise.resolve(Response.json({ success: true, id: "x" }, { status: 201 })); }
     return realFetch(url, init);
   };
   ```

2. **Mode "provider-off":** the modal shows "Requests aren't available for this provider yet" and no Contact button.
3. **Mode "viewer-off":** Contact shows "Turn on texts first". Click **Turn on texts**. Expect **Open Messages** with `href="sms:+15551234567?&body=Hi%20barter!"` and the text "(555) 123-4567".
4. **Mode "on":**
   - Contact shows the form with the windows "Mon 5–8 PM" and "Sat 10 AM–2 PM", the hours select, the note field, and "Total: 2 coins · Your balance: 12 coins".
   - Pick Sat, choose 3 hours ("Total: 6 coins"), type the note "Bring a capo", and click **Send request**.
   - Expect `window.sent` to be `{"serviceId":"on","window":{"day":6,"start":600,"end":840},"hours":3,"note":"Bring a capo"}`, and the modal to show "Request sent. We'll text you when Emily answers."
5. **Banner:** the banner at the top shows "Turn on texts to send and receive requests."

Then delete the page:

```bash
rm -r app/texts-check
```

- [ ] **Step 11: Run the full checks and commit**

Run: `npm test && npm run build`
Expected: the tests report `# fail 0` and the build exits with code 0.

```bash
git status --short   # expect no app/texts-check
git add components/barter/texts-banner.tsx components/barter/request-form.tsx components/barter/listing-modal.tsx components/barter/explorer.tsx lib/barter/data.ts lib/listing-data.ts app/page.tsx tests/listing.test.ts
git commit -m "Add the texts banner, Contact states and the request form" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Webhook registration script and docs

**Files:**
- Create: `scripts/photon-webhook.ts`
- Modify: `package.json` (scripts), `.env.example`, `README.md`, `docs/service-exchange.md`

**Interfaces:**
- Consumes: `PHOTON_API` and `photonAuthorization()` (Task 1).
- Produces: `npm run photon:webhook -- <https url>`.

- [ ] **Step 1: Create `scripts/photon-webhook.ts`**

```ts
// Registers barter's webhook with Photon and prints the signing secret, which Photon shows only once.
// Usage: npm run photon:webhook -- https://barter2026.vercel.app/api/photon/webhook
import { PHOTON_API, photonAuthorization } from "../lib/photon-users";

async function main() {
  const webhookUrl = process.argv[2];
  if (!webhookUrl?.startsWith("https://")) throw new Error("Pass the webhook's https URL, like: npm run photon:webhook -- https://barter2026.vercel.app/api/photon/webhook");
  const { projectId, header } = photonAuthorization();
  const response = await fetch(`${PHOTON_API}/projects/${encodeURIComponent(projectId)}/webhooks/`, {
    method: "POST",
    headers: { authorization: header, "content-type": "application/json" },
    body: JSON.stringify({ webhookUrl, schemaVersion: "normalized-events.v1", eventTypes: ["message.received"] }),
  });
  const payload = await response.json().catch(() => null);
  const secret = payload?.data?.signingSecret;
  if (!response.ok || typeof secret !== "string") throw new Error(`Photon didn't register the webhook (status ${response.status}): ${JSON.stringify(payload?.error ?? payload)}`);
  console.log("Webhook registered. Add this line to .env.local and to Vercel's environment variables:");
  console.log(`SPECTRUM_WEBHOOK_SECRET=${secret}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
```

In `package.json`, add this script after `"relay"`:

```json
    "photon:webhook": "tsx --env-file=.env.local scripts/photon-webhook.ts",
```

Run: `npm run photon:webhook`, with no URL.
Expected: it prints "Pass the webhook's https URL…" and exits with code 1, without calling Photon.

- [ ] **Step 2: Document the setting in `.env.example`**

After the `SPECTRUM_PROJECT_SECRET=` line, add:

```
# Signing secret printed by npm run photon:webhook (Photon shows it only once).
SPECTRUM_WEBHOOK_SECRET=
```

- [ ] **Step 3: Add a README section**

In `README.md`, directly before the `## Relay (two-way messaging test)` heading, add:

```markdown
## Booking requests by text

Contact on a listing sends a booking request through Photon:
- The requester's coins are held.
- The provider gets a text with the details and a short code, and replies YES or NO.
- Both people get texts about the outcome.

Both people must turn on texts first, using the banner on the home page. That also proves they own their phone. The exact wording of every text is in `lib/booking-texts.ts`.

Setup, once per deployment:

1. Deploy, then run `npm run photon:webhook -- https://<your-site>/api/photon/webhook`. It registers the webhook and prints its signing secret, which Photon shows only once.
2. Set `SPECTRUM_WEBHOOK_SECRET` to that secret in `.env.local` and in Vercel's environment variables, next to `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET`.
3. Each person signs up with the phone they text from and taps **Turn on texts** once.

Replies reach only the deployed site, so test the full loop there. Photon's Pro plan allows 100 registered people.
```

- [ ] **Step 4: Update `docs/service-exchange.md`**

1. Replace `No booking HTTP endpoints or UI are included.` with ``Booking requests come through `POST /api/bookings`; see "Booking requests" below.``
2. Replace `Contact on a listing opens the provider's profile until messaging exists.` with `Contact on a listing opens a request form when both people have turned on texts.`
3. Replace the paragraph that starts `**Before exposing booking or review endpoints:**` with:

   ```markdown
   **Verification:** requests require both people to have turned on texts, which means texting barter from their own phone and proves they own the number. Welcome credits still go to accounts whose email and phone are unverified, so add verification or another abuse control before exposing review endpoints. The internal `user.creditGrantVersion` counter serializes first-time grants; it is not client-editable.
   ```

4. Replace `Messaging, distance search,` with `Free-text messaging between people, distance search,`.
5. Directly before the `## Setup and existing users` heading, add:

   ```markdown
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
   ```

- [ ] **Step 5: Full checks and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all exit with code 0, and the tests report `# fail 0`.

```bash
git add scripts/photon-webhook.ts package.json .env.example README.md docs/service-exchange.md
git commit -m "Add the Photon webhook script and document booking requests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Report back**

Report the results. Push to `main` only when the user asks: pull first, then push straight to `main` if there are no conflicts. Then walk the user through the one-time setup: run the webhook script against the live site, and add `SPECTRUM_WEBHOOK_SECRET` to `.env.local` and Vercel.

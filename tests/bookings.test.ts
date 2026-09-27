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

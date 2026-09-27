import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createAuth, type Auth } from "../lib/auth-config";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { REQUEST_LIFETIME_MS, authorizeCron, expireStaleRequests, handleExpiryCron } from "../lib/booking-expiry";
import { expiredTexts } from "../lib/booking-texts";
import { ensureDefaultGenres, ensureExchangeIndexes, exchangeCollections } from "../lib/exchange-schema";
import { createExchangeService } from "../lib/exchange-service";

let server: MongoMemoryReplSet, client: MongoClient, db: Db, auth: Auth;
const origin = "http://localhost:3000";
const saturday = { day: 6, start: 600, end: 840 };
const HOUR = 60 * 60 * 1000;

before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("expiry");
  await ensureAuthIndexes(db); await ensureExchangeIndexes(db); await ensureDefaultGenres(db);
  auth = createAuth(db, client, { baseURL: origin, secret: "expiry-test-secret-at-least-thirty-two-chars!" });
});
after(async () => { await client?.close(); await server?.stop(); });

let personCount = 0;
async function person(firstName: string) {
  const number = ++personCount;
  const phone = `+12025550${700 + number}`;
  const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": `192.0.2.${number}` }, body: JSON.stringify({ firstName, lastName: "Tester", email: `expiry${number}@example.com`, phoneNumber: phone, password: "expiry-test-password!!" }) }));
  assert.equal(response.status, 200, await response.clone().text());
  return { id: new ObjectId((await response.json()).user.id), phone };
}

/** A requested booking for a fixed-price "Guitar Lessons" service, so `totalCredits === creditRate`. */
async function requestFixture(requesterId: ObjectId, providerId: ObjectId, title = "Guitar Lessons", creditRate = 100) {
  const domain = createExchangeService(db, client);
  const genreId = (await exchangeCollections(db).genres.findOne({ slug: "music" }))!._id;
  const service = await domain.createService(providerId, { genreId, title, description: "Lessons.", deliveryMode: "remote", pricingType: "fixed", creditRate, status: "active", availability: [saturday] });
  return domain.requestBooking(requesterId, service._id, { preferredWindow: saturday });
}
async function age(bookingId: ObjectId, ageMs: number, now: Date) {
  await exchangeCollections(db).bookings.updateOne({ _id: bookingId }, { $set: { createdAt: new Date(now.getTime() - ageMs) } });
}
function messenger(failFor?: string) {
  const sent: { phone: string; text: string }[] = [];
  return { sent, async send(phone: string, text: string) { if (phone === failFor) throw new Error("Photon is down"); sent.push({ phone, text }); } };
}

test("a request older than 48 hours is cancelled, refunds the requester and texts both people", async () => {
  const barry = await person("Barry"), emily = await person("Emily");
  const booking = await requestFixture(barry.id, emily.id);
  const now = new Date();
  await age(booking._id, 49 * HOUR, now);
  const before_ = await exchangeCollections(db).accounts.findOne({ userId: barry.id });
  const texts = messenger();

  const expired = await expireStaleRequests(db, client, texts, now);

  assert.equal(expired, 1);
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: booking._id }))?.status, "cancelled");
  const after_ = await exchangeCollections(db).accounts.findOne({ userId: barry.id });
  assert.equal(after_!.availableCredits, before_!.availableCredits + booking.totalCredits);
  assert.equal(after_!.heldCredits, before_!.heldCredits - booking.totalCredits);
  const expected = expiredTexts({ title: "Guitar Lessons", requesterFirstName: "Barry", providerFirstName: "Emily", totalCredits: booking.totalCredits });
  assert.deepEqual(texts.sent, [
    { phone: barry.phone, text: expected.requester },
    { phone: emily.phone, text: expected.provider },
  ]);
});

test("a 47-hour-old request and an old accepted booking are untouched", async () => {
  const kim = await person("Kim"), jo = await person("Jo");
  const fresh = await requestFixture(kim.id, jo.id, "Piano Lessons");
  const now = new Date();
  await age(fresh._id, 47 * HOUR, now);

  const sam = await person("Sam"), ana = await person("Ana");
  const accepted = await requestFixture(sam.id, ana.id, "Repair");
  await createExchangeService(db, client).transitionBooking(ana.id, accepted._id, "accept");
  await age(accepted._id, 96 * HOUR, now);

  const texts = messenger();
  const expired = await expireStaleRequests(db, client, texts, now);

  assert.equal(expired, 0);
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: fresh._id }))?.status, "requested");
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: accepted._id }))?.status, "accepted");
  assert.deepEqual(texts.sent, []);
});

test("running twice cancels once and texts once", async () => {
  const nia = await person("Nia"), leo = await person("Leo");
  const booking = await requestFixture(nia.id, leo.id, "Tutoring");
  const now = new Date();
  await age(booking._id, 50 * HOUR, now);
  const texts = messenger();

  const first = await expireStaleRequests(db, client, texts, now);
  const second = await expireStaleRequests(db, client, texts, now);

  assert.equal(first, 1);
  assert.equal(second, 0);
  assert.equal(texts.sent.length, 2);
});

test("two sweeps running at once cancel once and text each person once", async () => {
  const uma = await person("Uma"), vic = await person("Vic");
  const booking = await requestFixture(uma.id, vic.id, "Pottery");
  const now = new Date();
  await age(booking._id, 49 * HOUR, now);
  const texts = messenger();

  const [first, second] = await Promise.all([expireStaleRequests(db, client, texts, now), expireStaleRequests(db, client, texts, now)]);

  assert.equal(first + second, 1);
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: booking._id }))?.status, "cancelled");
  assert.equal(await exchangeCollections(db).transactions.countDocuments({ bookingId: booking._id, type: "release" }), 1);
  assert.deepEqual(texts.sent.map((t) => t.phone), [uma.phone, vic.phone]);
});

test("a YES that lands mid-sweep wins: the booking stays accepted, keeps its coins held, and nobody hears it expired", async () => {
  const ivy = await person("Ivy"), max = await person("Max"), ren = await person("Ren"), tia = await person("Tia");
  const older = await requestFixture(ivy.id, max.id, "Baking");
  const newer = await requestFixture(ren.id, tia.id, "Knitting");
  const now = new Date();
  await age(older._id, 51 * HOUR, now);
  await age(newer._id, 50 * HOUR, now);
  const held = (await exchangeCollections(db).accounts.findOne({ userId: ren.id }))!.heldCredits;
  const texts = messenger();
  // The sweep has already read both requests as waiting; Tia's YES commits while it texts about the older one.
  const racing = { async send(phone: string, text: string) {
    if (phone === ivy.phone) await createExchangeService(db, client).transitionBooking(tia.id, newer._id, "accept");
    await texts.send(phone, text);
  } };

  const expired = await expireStaleRequests(db, client, racing, now);

  assert.equal(expired, 1);
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: older._id }))?.status, "cancelled");
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: newer._id }))?.status, "accepted");
  assert.equal((await exchangeCollections(db).accounts.findOne({ userId: ren.id }))!.heldCredits, held);
  assert.deepEqual(texts.sent.map((t) => t.phone), [ivy.phone, max.phone]);
});

test("a non-ASCII authorization header of the right length is refused with 401, not a throw", async () => {
  // "é" is one character but two UTF-8 bytes: "Bearer s3cr3é" has the string length of "Bearer s3cr3t", not its byte length.
  const response = await handleExpiryCron(new Request("http://localhost/api/cron/expire-requests", { headers: { authorization: "Bearer s3cr3é" } }), db, client, messenger(), "s3cr3t");
  assert.equal(response.status, 401);
  assert.equal(await response.text(), "Unauthorized.");
});

test("a messenger that throws for one phone still sends the other text and handles the next booking", async () => {
  const abe = await person("Abe"), bea = await person("Bea");
  const carl = await person("Carl"), dee = await person("Dee");
  const bookingA = await requestFixture(abe.id, bea.id, "Coaching");
  const bookingB = await requestFixture(carl.id, dee.id, "Repair");
  const now = new Date();
  await age(bookingA._id, 50 * HOUR, now);
  await age(bookingB._id, 49 * HOUR, now);
  const texts = messenger(abe.phone); // Abe's phone (booking A's requester) fails to send.

  const expired = await expireStaleRequests(db, client, texts, now);

  assert.equal(expired, 2);
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: bookingA._id }))?.status, "cancelled");
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: bookingB._id }))?.status, "cancelled");
  const phones = texts.sent.map((t) => t.phone);
  assert.ok(!phones.includes(abe.phone), "the failing send was not recorded as sent");
  assert.ok(phones.includes(bea.phone), "booking A's other text still went out");
  assert.ok(phones.includes(carl.phone) && phones.includes(dee.phone), "the next booking was still fully handled");
});

test("limit is respected", async () => {
  const now = new Date();
  const ids: ObjectId[] = [];
  for (let i = 0; i < 3; i++) {
    const requester = await person(`Req${i}`), provider = await person(`Prov${i}`);
    const booking = await requestFixture(requester.id, provider.id, `Service ${i}`);
    await age(booking._id, (50 + i) * HOUR, now); // i=0 is youngest of the three stale ones, i=2 is oldest.
    ids.push(booking._id);
  }
  const texts = messenger();

  const expired = await expireStaleRequests(db, client, texts, now, 2);

  assert.equal(expired, 2);
  const statuses = await Promise.all(ids.map(async (id) => (await exchangeCollections(db).bookings.findOne({ _id: id }))?.status));
  assert.deepEqual(statuses, ["requested", "cancelled", "cancelled"]); // the two oldest were cancelled, oldest first.
});

test("handleExpiryCron checks the secret and reports the count", async () => {
  const req = (headers?: HeadersInit) => new Request("http://localhost/api/cron/expire-requests", { headers });
  const texts = messenger();

  const noSecret = await handleExpiryCron(req(), db, client, texts, undefined);
  assert.equal(noSecret.status, 503);
  assert.equal(await noSecret.text(), "Not configured.");

  const missingHeader = await handleExpiryCron(req(), db, client, texts, "s3cr3t");
  assert.equal(missingHeader.status, 401);
  assert.equal(await missingHeader.text(), "Unauthorized.");

  const wrongHeader = await handleExpiryCron(req({ authorization: "Bearer nope" }), db, client, texts, "s3cr3t");
  assert.equal(wrongHeader.status, 401);
  assert.equal(await wrongHeader.text(), "Unauthorized.");

  const zed = await person("Zed"), win = await person("Win");
  const stale = await requestFixture(zed.id, win.id, "Session");
  await age(stale._id, 49 * HOUR, new Date());

  const ok = await handleExpiryCron(req({ authorization: "Bearer s3cr3t" }), db, client, texts, "s3cr3t");
  assert.equal(ok.status, 200);
  // >= 1, not necessarily exactly 1: other tests in this file share the database and may have left
  // their own stale (but over-the-limit) "requested" bookings behind for this real-time sweep to catch too.
  const body = await ok.json();
  assert.equal(typeof body.expired, "number");
  assert.ok(body.expired >= 1, `expected at least 1 expired, got ${body.expired}`);
  assert.equal((await exchangeCollections(db).bookings.findOne({ _id: stale._id }))?.status, "cancelled");
});

test("authorizeCron decides without the database: 503 without a secret, 401 when wrong, null when right", async () => {
  const req = (authorization?: string) => new Request("http://localhost/api/cron/expire-requests", authorization ? { headers: { authorization } } : {});
  for (const secret of [undefined, ""]) {
    const denied = authorizeCron(req("Bearer "), secret);
    assert.equal(denied?.status, 503);
    assert.equal(await denied?.text(), "Not configured.");
  }
  for (const header of [undefined, "Bearer nope", "bearer s3cr3t", "Bearer s3cr3", "Bearer s3cr3é", `Bearer ${"é".repeat(6)}`]) {
    const denied = authorizeCron(req(header), "s3cr3t");
    assert.equal(denied?.status, 401, `header ${header}`);
    assert.equal(await denied?.text(), "Unauthorized.");
  }
  assert.equal(authorizeCron(req("Bearer s3cr3t"), "s3cr3t"), null);
});

test("REQUEST_LIFETIME_MS is 48 hours", () => {
  assert.equal(REQUEST_LIFETIME_MS, 48 * HOUR);
});

test("a failed lookup after a cancel doesn't stop the sweep", async () => {
  const lee = await person("Lee"), max = await person("Max");
  const first = await requestFixture(lee.id, max.id), second = await requestFixture(lee.id, max.id, "Piano Lessons");
  const now = new Date();
  await age(first._id, 49 * HOUR, now);
  await age(second._id, 50 * HOUR, now);
  // Users can't be read, as if the database failed right after each cancel.
  const failingUsers = new Proxy(db, {
    get: (target, property) => property === "collection"
      ? (name: string) => (name === "user" ? { findOne: () => Promise.reject(new Error("user lookup failed")) } : target.collection(name))
      : Reflect.get(target, property),
  });
  const texts = messenger();
  await assert.doesNotReject(expireStaleRequests(failingUsers, client, texts, now));
  for (const booking of [first, second]) assert.equal((await exchangeCollections(db).bookings.findOne({ _id: booking._id }))?.status, "cancelled");
  assert.ok(!texts.sent.some((sent) => sent.phone === lee.phone || sent.phone === max.phone));
});

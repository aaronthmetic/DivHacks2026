import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createAuth, type Auth } from "../lib/auth-config";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { InputError } from "../lib/auth-validation";
import { bookingCode } from "../lib/booking-texts";
import { activeBookings, confirm, propose } from "../lib/coordination";
import { ensureDefaultGenres, ensureExchangeIndexes, exchangeCollections } from "../lib/exchange-schema";
import { createExchangeService } from "../lib/exchange-service";

let server: MongoMemoryReplSet, client: MongoClient, db: Db, auth: Auth;
const origin = "http://localhost:3000";
const saturday = { day: 6, start: 600, end: 840 };

before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("coordination");
  await ensureAuthIndexes(db); await ensureExchangeIndexes(db); await ensureDefaultGenres(db);
  auth = createAuth(db, client, { baseURL: origin, secret: "coordination-test-secret-at-least-32-characters!" });
});
after(async () => { await client?.close(); await server?.stop(); });

let counter = 0;
async function person(firstName: string) {
  const number = ++counter;
  const phone = `+1202555${String(1000 + number).padStart(4, "0")}`;
  const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": `192.0.4.${number}` }, body: JSON.stringify({ firstName, lastName: "Tester", email: `coord${number}@example.com`, phoneNumber: phone, password: "coordination-password!!" }) }));
  assert.equal(response.status, 200, await response.clone().text());
  const id = new ObjectId((await response.json()).user.id);
  await db.collection("user").updateOne({ _id: id }, { $set: { textsEnabledAt: new Date() } });
  return { id, phone, firstName };
}

/** A requested booking between requester and provider, not yet accepted. */
async function requestedBooking(requesterId: ObjectId, providerId: ObjectId, title = "Guitar Lessons") {
  const domain = createExchangeService(db, client);
  const genreId = (await exchangeCollections(db).genres.findOne({ slug: "music" }))!._id;
  const service = await domain.createService(providerId, { genreId, title, description: "Lessons.", deliveryMode: "remote", pricingType: "fixed", creditRate: 100, status: "active", availability: [saturday] });
  return domain.requestBooking(requesterId, service._id, { preferredWindow: saturday });
}

/** An accepted booking between requester and provider, refetched from the database. */
async function acceptedBooking(requesterId: ObjectId, providerId: ObjectId, title = "Guitar Lessons") {
  const created = await requestedBooking(requesterId, providerId, title);
  await createExchangeService(db, client).transitionBooking(providerId, created._id, "accept");
  return (await exchangeCollections(db).bookings.findOne({ _id: created._id }))!;
}

async function setCreatedAt(bookingId: ObjectId, createdAt: Date) {
  await exchangeCollections(db).bookings.updateOne({ _id: bookingId }, { $set: { createdAt } });
}

test("activeBookings lists accepted bookings for both roles, newest first, with the other person's details", async () => {
  const barry = await person("Barry"), emily = await person("Emily"), kim = await person("Kim");
  const older = await acceptedBooking(barry.id, emily.id, "Guitar Lessons"); // emily is provider
  await setCreatedAt(older._id, new Date("2026-01-01T00:00:00Z"));
  const newer = await acceptedBooking(emily.id, kim.id, "Piano Lessons"); // emily is requester
  await setCreatedAt(newer._id, new Date("2026-02-01T00:00:00Z"));
  // A still-pending request for emily must not show up alongside her accepted bookings.
  await requestedBooking(barry.id, emily.id, "Voice Lessons");

  const list = await activeBookings(db, emily.id);
  assert.equal(list.length, 2);
  assert.equal(list[0].booking._id.toHexString(), newer._id.toHexString());
  assert.equal(list[0].role, "requester");
  assert.equal(list[0].other.id.toHexString(), kim.id.toHexString());
  assert.equal(list[0].other.firstName, "Kim");
  assert.equal(list[0].other.phoneNumber, kim.phone);
  assert.equal(list[0].code, bookingCode(newer._id));
  assert.equal(list[1].booking._id.toHexString(), older._id.toHexString());
  assert.equal(list[1].role, "provider");
  assert.equal(list[1].other.id.toHexString(), barry.id.toHexString());
  assert.equal(list[1].other.firstName, "Barry");
  assert.equal(list[1].other.phoneNumber, barry.phone);
  assert.equal(list[1].code, bookingCode(older._id));

  const fromBarry = await activeBookings(db, barry.id);
  assert.equal(fromBarry.length, 1);
  assert.equal(fromBarry[0].role, "requester");
  assert.equal(fromBarry[0].other.id.toHexString(), emily.id.toHexString());
  assert.equal(fromBarry[0].other.firstName, "Emily");
  assert.equal(fromBarry[0].other.phoneNumber, emily.phone);
});

test("activeBookings falls back to 'someone' and no phone number when the other person's record is missing", async () => {
  const dee = await person("Dee"), fran = await person("Fran");
  const booking = await acceptedBooking(dee.id, fran.id, "Repair"); // dee is requester, fran is provider
  await exchangeCollections(db).bookings.updateOne({ _id: booking._id }, { $set: { providerId: new ObjectId() } });

  const list = await activeBookings(db, dee.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].role, "requester");
  assert.equal(list[0].other.firstName, "someone");
  assert.equal(list[0].other.phoneNumber, undefined);
});

test("codes widen to six characters when two active bookings' ids share the last four hex characters", async () => {
  const kay = await person("Kay"), jo = await person("Jo");
  const template = await acceptedBooking(kay.id, jo.id, "Guitar Lessons");
  const bookings = exchangeCollections(db).bookings;
  await bookings.deleteOne({ _id: template._id });
  const { _id: _unused, ...fields } = template;
  void _unused;
  const a = new ObjectId("aaaaaaaaaaaaaaaaaaaa7f3a"), b = new ObjectId("bbbbbbbbbbbbbbbbbbbb7f3a");
  await bookings.insertMany([{ ...fields, _id: a }, { ...fields, _id: b }]);

  const list = await activeBookings(db, jo.id);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((item) => item.code).sort(), ["AA7F3A", "BB7F3A"]);
});

test("propose validates the booking, the actor, the time and the place", async () => {
  const barry = await person("Barry2"), emily = await person("Emily2"), outsider = await person("Otto");
  const booking = await acceptedBooking(barry.id, emily.id);
  const now = new Date("2026-06-01T12:00:00Z");
  const validStart = new Date(now.getTime() + 2 * 60 * 60_000);

  await assert.rejects(propose(db, outsider.id, booking._id, { startsAt: validStart }, now), (error: unknown) => error instanceof InputError && error.message === "That booking isn't yours.");
  await assert.rejects(propose(db, barry.id, new ObjectId(), { startsAt: validStart }, now), (error: unknown) => error instanceof InputError && error.message === "That booking isn't yours.");

  const pending = await requestedBooking(barry.id, emily.id);
  await assert.rejects(propose(db, emily.id, pending._id, { startsAt: validStart }, now), (error: unknown) => error instanceof InputError && error.message === "That booking isn't accepted, so its time can't be changed.");

  await assert.rejects(propose(db, barry.id, booking._id, { startsAt: new Date("not a date") }, now), (error: unknown) => error instanceof InputError && error.message === "That time isn't valid.");
  await assert.rejects(propose(db, barry.id, booking._id, { startsAt: new Date(now.getTime() + 10 * 60_000) }, now), (error: unknown) => error instanceof InputError && error.message === "Pick a time at least 30 minutes from now.");
  await assert.rejects(propose(db, barry.id, booking._id, { startsAt: new Date(now.getTime() + 61 * 24 * 60 * 60_000) }, now), (error: unknown) => error instanceof InputError && error.message === "Pick a time within the next 60 days.");
  await assert.rejects(propose(db, barry.id, booking._id, { startsAt: validStart, place: "x".repeat(121) }, now), (error: unknown) => error instanceof InputError && error.message === "Keep the place under 120 characters.");

  const cleaned = await propose(db, barry.id, booking._id, { startsAt: validStart, place: "  Butler   Library\n\n" }, now);
  assert.equal(cleaned.place, "Butler Library");
  const noPlace = await propose(db, barry.id, booking._id, { startsAt: validStart, place: "   \n\t " }, now);
  assert.equal(noPlace.place, undefined);
});

test("a second proposal fully replaces the first", async () => {
  const barry = await person("Barry3"), emily = await person("Emily3");
  const booking = await acceptedBooking(barry.id, emily.id);
  const now = new Date("2026-06-01T12:00:00Z");
  const first = new Date(now.getTime() + 2 * 60 * 60_000), second = new Date(now.getTime() + 5 * 60 * 60_000);

  await propose(db, emily.id, booking._id, { startsAt: first, place: "Butler Library" }, now);
  await propose(db, emily.id, booking._id, { startsAt: second }, new Date(now.getTime() + 60_000));

  const stored = await exchangeCollections(db).bookings.findOne({ _id: booking._id });
  assert.equal(stored?.proposal?.startsAt.getTime(), second.getTime());
  assert.equal(stored?.proposal?.place, undefined);
  assert.equal(Object.hasOwn(stored?.proposal ?? {}, "place"), false);
});

test("confirm validates the booking, the actor and the proposal", async () => {
  const barry = await person("Barry4"), emily = await person("Emily4"), outsider = await person("Ozzy");
  const booking = await acceptedBooking(barry.id, emily.id);
  const now = new Date("2026-06-01T12:00:00Z");
  const validStart = new Date(now.getTime() + 2 * 60 * 60_000);

  await assert.rejects(confirm(db, outsider.id, booking._id, now, now), (error: unknown) => error instanceof InputError && error.message === "That booking isn't yours.");
  await assert.rejects(confirm(db, barry.id, new ObjectId(), now, now), (error: unknown) => error instanceof InputError && error.message === "That booking isn't yours.");

  const pending = await requestedBooking(barry.id, emily.id);
  await assert.rejects(confirm(db, barry.id, pending._id, now, now), (error: unknown) => error instanceof InputError && error.message === "That booking isn't accepted, so its time can't be changed.");

  await assert.rejects(confirm(db, barry.id, booking._id, now, now), (error: unknown) => error instanceof InputError && error.message === "There's no suggested time to confirm.");

  const proposal = await propose(db, emily.id, booking._id, { startsAt: validStart, place: "Butler Library" }, now);
  await assert.rejects(confirm(db, emily.id, booking._id, proposal.createdAt, now), (error: unknown) => error instanceof InputError && error.message === "Only the other person can confirm this suggestion.");
  await assert.rejects(confirm(db, barry.id, booking._id, new Date(proposal.createdAt.getTime() + 1), now), (error: unknown) => error instanceof InputError && error.message === "The suggestion changed. Check the latest one.");
  await assert.rejects(confirm(db, barry.id, booking._id, proposal.createdAt, new Date(validStart.getTime() + 1)), (error: unknown) => error instanceof InputError && error.message === "That suggested time has passed. Suggest a new one.");
});

test("confirm succeeds, setting scheduledAt and place and clearing the proposal", async () => {
  const barry = await person("Barry5"), emily = await person("Emily5");
  const booking = await acceptedBooking(barry.id, emily.id);
  const now = new Date("2026-06-01T12:00:00Z");
  const validStart = new Date(now.getTime() + 2 * 60 * 60_000);

  const proposal = await propose(db, emily.id, booking._id, { startsAt: validStart, place: "Butler Library" }, now);
  const result = await confirm(db, barry.id, booking._id, proposal.createdAt, now);
  assert.equal(result.scheduledAt.getTime(), validStart.getTime());
  assert.equal(result.place, "Butler Library");

  const stored = await exchangeCollections(db).bookings.findOne({ _id: booking._id });
  assert.equal(stored?.scheduledAt?.getTime(), validStart.getTime());
  assert.equal(stored?.place, "Butler Library");
  assert.equal(stored?.proposal, undefined);
});

test("a time-only proposal on confirm keeps the earlier agreed place", async () => {
  const barry = await person("Barry6"), emily = await person("Emily6");
  const booking = await acceptedBooking(barry.id, emily.id);
  const now = new Date("2026-06-01T12:00:00Z");
  const firstStart = new Date(now.getTime() + 2 * 60 * 60_000);
  const firstProposal = await propose(db, emily.id, booking._id, { startsAt: firstStart, place: "Butler Library" }, now);
  await confirm(db, barry.id, booking._id, firstProposal.createdAt, now);

  const later = new Date(now.getTime() + 60_000);
  const secondStart = new Date(now.getTime() + 5 * 60 * 60_000);
  const secondProposal = await propose(db, emily.id, booking._id, { startsAt: secondStart }, later);
  const result = await confirm(db, barry.id, booking._id, secondProposal.createdAt, later);

  assert.equal(result.scheduledAt.getTime(), secondStart.getTime());
  assert.equal(result.place, "Butler Library");
  const stored = await exchangeCollections(db).bookings.findOne({ _id: booking._id });
  assert.equal(stored?.place, "Butler Library");
  assert.equal(stored?.scheduledAt?.getTime(), secondStart.getTime());
});

test("a proposal that changes between reading and confirming is rejected", async () => {
  const barry = await person("Barry7"), emily = await person("Emily7");
  const booking = await acceptedBooking(barry.id, emily.id);
  const now = new Date("2026-06-01T12:00:00Z");
  const staleStart = new Date(now.getTime() + 2 * 60 * 60_000);
  const stale = await propose(db, emily.id, booking._id, { startsAt: staleStart, place: "Butler Library" }, now);

  const later = new Date(now.getTime() + 60_000);
  const freshStart = new Date(now.getTime() + 3 * 60 * 60_000);
  const fresh = await propose(db, emily.id, booking._id, { startsAt: freshStart }, later);

  await assert.rejects(confirm(db, barry.id, booking._id, stale.createdAt, later), (error: unknown) => error instanceof InputError && error.message === "The suggestion changed. Check the latest one.");

  const stored = await exchangeCollections(db).bookings.findOne({ _id: booking._id });
  assert.equal(stored?.proposal?.createdAt.getTime(), fresh.createdAt.getTime());
  assert.equal(stored?.scheduledAt, undefined);
});

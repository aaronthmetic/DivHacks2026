import { rebuildAllUserRatings } from "../lib/review-ratings";
import { addBooking } from "../lib/exchange-actions";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { ensureExchangeIndexes, exchangeCollections } from "../lib/exchange-schema";
import { calculateCredits, createExchangeService } from "../lib/exchange-service";

let server: MongoMemoryReplSet, client: MongoClient, db: Db;
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("exchange_test");
  await ensureExchangeIndexes(db);
});
after(async () => { await client?.close(); await server?.stop(); });
async function fixture(rate = 600) {
  const domain = createExchangeService(db, client), c = exchangeCollections(db);
  const provider = new ObjectId(), requester = new ObjectId(), genreId = new ObjectId();
  await db.collection("user").insertMany([provider, requester].map((_id) => ({ _id, firstName: "Test", lastName: "User", phoneNumber: "+12025550123", profileCompletedAt: new Date() })));
  await c.genres.insertOne({ _id: genreId, name: "Tutoring", slug: genreId.toHexString(), description: "Lessons", isActive: true });
  await Promise.all([domain.grantWelcome(provider), domain.grantWelcome(requester)]);
  const input = { genreId, title: "Lesson", description: "One lesson", pricingType: "fixed" as const, creditRate: rate, deliveryMode: "in_person" as const, zipCode: "00123", countryCode: "US", status: "active" as const, availability: [{ day: 1, start: 540, end: 1020 }] };
  const service = await domain.createService(provider, input);
  return { domain, c, provider, requester, service, input };
}
// The fixture's only availability window; requests must pick it.
const slot = { day: 1, start: 540, end: 1020 };
test("pricing uses integer hundredths and rounds once", () => {
  assert.equal(calculateCredits("fixed", 125), 125);
  assert.equal(calculateCredits("hourly", 125, 90), 188);
  assert.equal(calculateCredits("hourly", 100, 1), 2);
  for (const rate of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => calculateCredits("fixed", rate));
  for (const minutes of [undefined, 0, -1, 1.5]) assert.throws(() => calculateCredits("hourly", 100, minutes));
  assert.throws(() => calculateCredits("hourly", Number.MAX_SAFE_INTEGER, 120));
});
test("welcome grants are exactly once under concurrency and require complete profiles", async () => {
  const { domain, c, requester } = await fixture();
  await Promise.all(Array.from({ length: 5 }, () => domain.grantWelcome(requester)));
  assert.equal((await c.accounts.findOne({ userId: requester }))?.availableCredits, 1000);
  assert.equal(await c.transactions.countDocuments({ idempotencyKey: `welcome:${requester}` }), 1);
  const fresh = new ObjectId();
  await db.collection("user").insertOne({ _id: fresh, firstName: "Fresh", lastName: "User", phoneNumber: "123", profileCompletedAt: new Date() });
  await Promise.all(Array.from({ length: 5 }, () => domain.grantWelcome(fresh)));
  assert.equal((await c.accounts.findOne({ userId: fresh }))?.availableCredits, 1000);
  const incomplete = new ObjectId();
  await db.collection("user").insertOne({ _id: incomplete });
  await assert.rejects(domain.grantWelcome(incomplete));
  await assert.rejects(domain.grantWelcome(new ObjectId()));
});
test("listing validation preserves ZIP strings and rejects missing references and locations", async () => {
  const { domain, service, provider, input } = await fixture();
  assert.equal(service.zipCode, "00123");
  await assert.rejects(domain.createService(provider, { ...input, zipCode: undefined }));
  await assert.rejects(domain.createService(provider, { ...input, genreId: new ObjectId() }));
  await assert.rejects(domain.createService(new ObjectId(), input));
});
test("concurrent bookings cannot overspend and cancellation refunds once", async () => {
  const { domain, c, requester, provider, service } = await fixture();
  const outcomes = await Promise.allSettled([domain.requestBooking(requester, service._id, { preferredWindow: slot }), domain.requestBooking(requester, service._id, { preferredWindow: slot })]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  const booking = await c.bookings.findOne({ requesterId: requester });
  assert.ok(booking);
  let account = await c.accounts.findOne({ userId: requester });
  assert.equal(account?.availableCredits, 400); assert.equal(account?.heldCredits, 600);
  await assert.rejects(domain.requestBooking(provider, service._id, { preferredWindow: slot }));
  await assert.rejects(domain.transitionBooking(new ObjectId(), booking._id, "cancel"));
  await Promise.all([domain.transitionBooking(requester, booking._id, "cancel"), domain.transitionBooking(provider, booking._id, "cancel")]);
  account = await c.accounts.findOne({ userId: requester });
  assert.equal(account?.availableCredits, 1000); assert.equal(account?.heldCredits, 0);
  assert.equal(await c.transactions.countDocuments({ bookingId: booking._id, type: "release" }), 1);
});
test("snapshots, authorized transitions, duplicate settlement and participant reviews", async () => {
  const { domain, c, requester, provider, service } = await fixture();
  const booking = await domain.requestBooking(requester, service._id, { preferredWindow: slot });
  await c.services.updateOne({ _id: service._id }, { $set: { title: "Changed", creditRate: 999 } });
  assert.equal((await c.bookings.findOne({ _id: booking._id }))?.serviceSnapshot.title, "Lesson");
  await assert.rejects(domain.createReview(requester, booking._id, 5, "Early"));
  await assert.rejects(domain.transitionBooking(requester, booking._id, "accept"));
  await assert.rejects(domain.transitionBooking(provider, booking._id, "deliver"));
  await domain.transitionBooking(provider, booking._id, "accept");
  await domain.transitionBooking(provider, booking._id, "deliver");
  await assert.rejects(domain.transitionBooking(requester, booking._id, "cancel"));
  // Either participant can finish; nobody else can.
  await assert.rejects(domain.transitionBooking(new ObjectId(), booking._id, "confirm"), /not allowed/);
  await Promise.all([domain.transitionBooking(requester, booking._id, "confirm"), domain.transitionBooking(requester, booking._id, "confirm")]);
  assert.equal((await c.accounts.findOne({ userId: provider }))?.availableCredits, 1600);
  const payer = await c.accounts.findOne({ userId: requester });
  assert.equal(payer?.availableCredits, 400); assert.equal(payer?.heldCredits, 0);
  assert.equal(await c.transactions.countDocuments({ bookingId: booking._id, type: "payment" }), 1);
  await assert.rejects(domain.createReview(new ObjectId(), booking._id, 5, "Outsider"));
  await assert.rejects(domain.createReview(requester, booking._id, 6, "Invalid"));
  const review = await domain.createReview(requester, booking._id, 5, "Helpful");
  assert.ok(review.subjectUserId.equals(provider));
  await assert.rejects(domain.createReview(requester, booking._id, 4, "Duplicate"));
  await domain.createReview(provider, booking._id, 5, "Good exchange");
});
test("expiring a waiting request cancels it and refunds the requester", async () => {
  const { domain, c, requester, service } = await fixture();
  const booking = await domain.requestBooking(requester, service._id, { preferredWindow: slot });
  assert.equal(await domain.expireRequest(booking._id), true);
  assert.equal((await c.bookings.findOne({ _id: booking._id }))?.status, "cancelled");
  const account = await c.accounts.findOne({ userId: requester });
  assert.equal(account?.availableCredits, 1000); assert.equal(account?.heldCredits, 0);
  assert.equal(await c.transactions.countDocuments({ bookingId: booking._id, type: "release" }), 1);
});
test("expiring an accepted or cancelled booking changes nothing and refunds nothing", async () => {
  const { domain, c, requester, provider, service } = await fixture(100);
  const accepted = await domain.requestBooking(requester, service._id, { preferredWindow: slot });
  const cancelled = await domain.requestBooking(requester, service._id, { preferredWindow: slot });
  const expired = await domain.requestBooking(requester, service._id, { preferredWindow: slot });
  // A YES that commits between the sweep's read and its cancel wins.
  await domain.transitionBooking(provider, accepted._id, "accept");
  await domain.transitionBooking(requester, cancelled._id, "cancel");
  await domain.expireRequest(expired._id);
  const ids = [accepted._id, cancelled._id, expired._id];
  const bookings = await c.bookings.find({ _id: { $in: ids } }).sort({ _id: 1 }).toArray(), account = await c.accounts.findOne({ userId: requester });
  const releases = await c.transactions.countDocuments({ type: "release" });
  for (const id of [...ids, new ObjectId()]) assert.equal(await domain.expireRequest(id), false);
  assert.deepEqual(await c.bookings.find({ _id: { $in: ids } }).sort({ _id: 1 }).toArray(), bookings);
  assert.equal(bookings.find((b) => b._id.equals(accepted._id))?.status, "accepted");
  assert.deepEqual(await c.accounts.findOne({ userId: requester }), account);
  assert.equal(account?.heldCredits, 100);
  assert.equal(await c.transactions.countDocuments({ type: "release" }), releases);
});
test("hourly bookings lock duration and total; decline releases credits", async () => {
  const { domain, c, provider, requester, input } = await fixture();
  const service = await domain.createService(provider, { ...input, pricingType: "hourly", creditRate: 125 });
  await assert.rejects(domain.requestBooking(requester, service._id, { preferredWindow: slot }));
  const booking = await domain.requestBooking(requester, service._id, { durationMinutes: 90, preferredWindow: slot });
  assert.equal(booking.totalCredits, 188); assert.equal(booking.durationMinutes, 90);
  await domain.transitionBooking(provider, booking._id, "decline");
  assert.equal((await c.accounts.findOne({ userId: requester }))?.availableCredits, 1000);
});

test("a failed settlement rolls back both booking status and payer debit", async () => {
  const { domain, c, requester, provider, service } = await fixture();
  const booking = await domain.requestBooking(requester, service._id, { preferredWindow: slot });
  await domain.transitionBooking(provider, booking._id, "accept");
  await domain.transitionBooking(provider, booking._id, "deliver");
  const providerAccount = await c.accounts.findOne({ userId: provider });
  assert.ok(providerAccount);
  await c.accounts.deleteOne({ _id: providerAccount._id });
  await assert.rejects(domain.transitionBooking(requester, booking._id, "confirm"));
  assert.equal((await c.bookings.findOne({ _id: booking._id }))?.status, "awaiting_confirmation");
  const payer = await c.accounts.findOne({ userId: requester });
  assert.equal(payer?.availableCredits, 400); assert.equal(payer?.heldCredits, 600);
  assert.equal(await c.transactions.countDocuments({ bookingId: booking._id, type: "payment" }), 0);
  await c.accounts.insertOne(providerAccount);
  await domain.transitionBooking(requester, booking._id, "confirm");
  assert.equal((await c.accounts.findOne({ userId: provider }))?.availableCredits, 1600);
});

test("received review fields track concurrent reviews and reject duplicate changes", async () => {
  const { domain, c, requester, provider, service } = await fixture(100);
  const bookings = await Promise.all([domain.requestBooking(requester, service._id, { preferredWindow: slot }), domain.requestBooking(requester, service._id, { preferredWindow: slot })]);
  for (const booking of bookings) {
    await domain.transitionBooking(provider, booking._id, "accept");
    await domain.transitionBooking(provider, booking._id, "deliver");
    await domain.transitionBooking(requester, booking._id, "confirm");
  }
  const reviews = await Promise.all(bookings.map((booking, i) => domain.createReview(requester, booking._id, i ? 4 : 1, "Review")));
  const subject = await db.collection("user").findOne({ _id: provider });
  assert.equal(subject?.rating, 2.5);
  assert.equal(subject?.numberOfReviews, 2);
  assert.deepEqual([...subject!.reviews].sort(), reviews.map((r) => r._id.toHexString()).sort());
  await assert.rejects(domain.createReview(requester, bookings[0]._id, 5, "Duplicate"));
  assert.deepEqual(await db.collection("user").findOne({ _id: provider }), subject);
  assert.equal(await c.reviews.countDocuments({ subjectUserId: provider }), 2);
  assert.equal((await db.collection("user").findOne({ _id: requester }))?.numberOfReviews, undefined);
});

test("inherited property names are not booking actions", async () => {
  const { domain, c, provider, requester, service } = await fixture();
  const booking = await domain.requestBooking(requester, service._id, { preferredWindow: slot });
  for (const action of ["__proto__", "constructor", "toString"]) {
    await assert.rejects(domain.transitionBooking(provider, booking._id, action as "accept"), /Invalid action/);
  }
  assert.equal((await c.bookings.findOne({ _id: booking._id }))?.status, "requested");
});

test("a provider without a credit account still gets paid", async () => {
  const { domain, c, provider, requester, service } = await fixture();
  await c.accounts.deleteOne({ userId: provider });
  const booking = await domain.requestBooking(requester, service._id, { preferredWindow: slot });
  await domain.transitionBooking(provider, booking._id, "accept");
  await domain.transitionBooking(provider, booking._id, "deliver");
  await domain.transitionBooking(requester, booking._id, "confirm");
  assert.equal((await c.accounts.findOne({ userId: provider }))?.availableCredits, 600);
});

test("grantWelcome refuses a caller session that is not in a transaction", async () => {
  const { domain, requester } = await fixture();
  const session = client.startSession();
  try {
    await assert.rejects(domain.grantWelcome(requester, session), /active transaction/);
  } finally { await session.endSession(); }
});

test("listings retain validated image IDs and bookings preserve full snapshots", async () => {
  const { domain, c, provider, requester, input } = await fixture(100);
  const images = [new ObjectId(), new ObjectId()];
  const service = await domain.createService(provider, { ...input, creditRate: 100, images });
  assert.deepEqual((await c.services.findOne({ _id: service._id }))?.images, images);
  await assert.rejects(domain.createService(provider, { ...input, images: ["invalid" as unknown as ObjectId] }), /GridFS ObjectIds/);
  const scheduledAt = new Date("2030-01-02T14:00:00Z");
  const booking = await domain.requestBooking(requester, service._id, { scheduledAt, preferredWindow: slot });
  assert.deepEqual(booking.serviceSnapshot, { title: service.title, description: service.description, pricingType: "fixed", creditRate: 100, genreId: service.genreId, deliveryMode: "in_person", zipCode: "00123", countryCode: "US", availability: [{ day: 1, start: 540, end: 1020 }], images });
  await c.services.updateOne({ _id: service._id }, { $set: { images: [], deliveryMode: "remote", zipCode: "99999", creditRate: 500, description: "Changed" } });
  assert.deepEqual((await c.bookings.findOne({ _id: booking._id }))?.serviceSnapshot, booking.serviceSnapshot);
  assert.equal(booking.scheduledAt?.toISOString(), scheduledAt.toISOString());
});

test("both booking paths share rounding, snapshots, and optional schedule validation", async () => {
  const { domain, provider, requester, input } = await fixture();
  const service = await domain.createService(provider, { ...input, creditRate: 100, pricingType: "hourly" });
  const options = { durationMinutes: 2 };
  const booking = await domain.requestBooking(requester, service._id, { ...options, preferredWindow: slot });
  const lowLevel = await addBooking(db, { serviceId: service._id, requesterId: requester, ...options });
  assert.equal(booking.totalCredits, 3); assert.equal(lowLevel.totalCredits, 3);
  assert.deepEqual(lowLevel.serviceSnapshot, booking.serviceSnapshot);
  assert.equal(booking.scheduledAt, undefined);
  for (const scheduledAt of [new Date(NaN), "2030-01-01" as unknown as Date]) {
    await assert.rejects(domain.requestBooking(requester, service._id, { ...options, scheduledAt, preferredWindow: slot }), /Invalid scheduled date/);
    await assert.rejects(addBooking(db, { serviceId: service._id, requesterId: requester, ...options, scheduledAt }), /Invalid scheduled date/);
  }
});

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


test("rating repair resets empty users and stays correct alongside new reviews", async () => {
  const { domain, c, requester, provider, service } = await fixture(100);
  const booking = await domain.requestBooking(requester, service._id, { preferredWindow: slot });
  await domain.transitionBooking(provider, booking._id, "accept");
  await domain.transitionBooking(provider, booking._id, "deliver");
  await domain.transitionBooking(requester, booking._id, "confirm");
  await db.collection("user").updateMany({ _id: { $in: [provider, requester] } }, {
    $set: { rating: 5, numberOfReviews: null, reviews: ["stale"] },
  });
  await c.reviews.insertOne({ _id: new ObjectId(), bookingId: new ObjectId(), authorId: requester,
    subjectUserId: provider, rating: 2, comment: "Earlier", createdAt: new Date(0) });
  await Promise.all([rebuildAllUserRatings(db), domain.createReview(requester, booking._id, 5, "New")]);
  const subject = await db.collection("user").findOne({ _id: provider });
  assert.equal(subject?.rating, 3.5);
  assert.equal(subject?.numberOfReviews, 2);
  assert.equal(subject?.reviews.length, 2);
  const empty = await db.collection("user").findOne({ _id: requester });
  assert.deepEqual([empty?.rating, empty?.numberOfReviews, empty?.reviews], [0, 0, []]);
  await rebuildAllUserRatings(db);
  assert.deepEqual(await db.collection("user").findOne({ _id: provider }), subject);
});

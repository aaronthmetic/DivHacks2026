import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createAuth, type Auth } from "../lib/auth-config";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { updateBooking } from "../lib/booking-actions";
import { ensureDefaultGenres, ensureExchangeIndexes, exchangeCollections } from "../lib/exchange-schema";
import { createExchangeService } from "../lib/exchange-service";
import { getExplorerData } from "../lib/listing-data";
import { getNotifications, markNotificationRead } from "../lib/notification-data";
import { submitReview } from "../lib/review-service";

let server: MongoMemoryReplSet, client: MongoClient, db: Db, auth: Auth;
const origin = "http://localhost:3000";
const saturday = { day: 6, start: 600, end: 840 };

before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("notifications");
  await ensureAuthIndexes(db); await ensureExchangeIndexes(db); await ensureDefaultGenres(db);
  auth = createAuth(db, client, { baseURL: origin, secret: "notification-test-secret-at-least-32-chars" });
});
after(async () => { await client?.close(); await server?.stop(); });

// Signs someone up, which grants 10 welcome coins.
async function person(number: number, firstName: string, lastName: string) {
  const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": `192.0.2.${number}` }, body: JSON.stringify({ firstName, lastName, email: `notify${number}@example.com`, phoneNumber: `+12025550${String(600 + number)}`, password: "notification-test-password!" }) }));
  assert.equal(response.status, 200, await response.clone().text());
  return { id: new ObjectId((await response.json()).user.id), cookie: response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
async function listing(providerId: ObjectId, creditRate = 500) {
  const genreId = (await exchangeCollections(db).genres.findOne({ slug: "music" }))!._id;
  return createExchangeService(db, client).createService(providerId, { genreId, title: "Guitar Lessons", description: "Beginner lessons.", deliveryMode: "remote", pricingType: "fixed", creditRate, status: "active", availability: [saturday] });
}
function notificationsOf(userId: ObjectId) {
  return exchangeCollections(db).notifications.find({ userId }).sort({ createdAt: 1, _id: 1 }).toArray();
}
function finish(cookie: string, bookingId: ObjectId | string, body: unknown = { action: "confirm" }, requestOrigin = origin) {
  return updateBooking(new Request(`${origin}/api/bookings/${bookingId}`, { method: "PATCH", headers: { cookie, origin: requestOrigin, "content-type": "application/json" }, body: JSON.stringify(body) }), String(bookingId), auth, db, client, origin);
}
function review(cookie: string, body: unknown) {
  return submitReview(new Request(`${origin}/api/reviews`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) }), auth, db, client, origin);
}

test("booking changes and reviews notify the other person by first name", async () => {
  const emily = await person(1, "Emily", "Park"), barry = await person(2, "Barry", "Chen");
  const service = await listing(emily.id);
  const domain = createExchangeService(db, client);
  const card = async (viewer: ObjectId) => (await getExplorerData(db, viewer.toHexString())).listings.find((item) => item.id === service._id.toHexString());
  const booking = await domain.requestBooking(barry.id, service._id, { preferredWindow: saturday });
  assert.deepEqual((await notificationsOf(emily.id)).map((n) => [n.type, n.message, n.href]), [
    ["booking_requested", "Barry requested Guitar Lessons. Reply YES or NO to our text to answer.", undefined],
  ]);
  assert.deepEqual((await notificationsOf(barry.id)).map((n) => [n.type, n.message, n.href, n.read]), [
    ["system", "Your request for Guitar Lessons was sent to Emily. We're holding 5 coins until Emily answers.", "/profile", false],
  ]);
  // Only the requester's card carries the booking; it's what shows "Finish Barter".
  assert.deepEqual((await card(barry.id))?.booking, { id: booking._id.toHexString(), status: "requested" });
  assert.equal((await card(emily.id))?.booking, undefined);
  await domain.transitionBooking(emily.id, booking._id, "accept");
  assert.equal((await notificationsOf(barry.id)).at(-1)?.message, "Emily accepted your Guitar Lessons request.");
  assert.equal((await card(barry.id))?.booking?.status, "accepted");
  assert.deepEqual((await card(emily.id))?.toFinish, [{ id: booking._id.toHexString(), requesterFirstName: "Barry" }]);
  await domain.transitionBooking(barry.id, booking._id, "confirm");
  const completed = (await notificationsOf(emily.id)).at(-1)!;
  assert.deepEqual([completed.type, completed.message, completed.href], ["booking_completed", "Barry finished the Guitar Lessons barter. 5 coins were added to your balance.", `/bookings/${booking._id}/review`]);
  assert.equal((await card(barry.id))?.booking, undefined);
  assert.equal((await card(emily.id))?.toFinish, undefined);
  await domain.createReview(barry.id, booking._id, 5, "Great lesson");
  assert.equal((await notificationsOf(emily.id)).at(-1)?.message, "Barry left you a 5-star review for Guitar Lessons.");
});

test("either person can finish a booking, straight from accepted, and it pays the held coins once", async () => {
  const provider = await person(3, "Pat", "Provider"), requester = await person(4, "Riley", "Requester");
  const service = await listing(provider.id, 700);
  const domain = createExchangeService(db, client), c = exchangeCollections(db);
  const booking = await domain.requestBooking(requester.id, service._id, { preferredWindow: saturday });
  await domain.transitionBooking(provider.id, booking._id, "accept");
  // Both finishing at once: the second confirm sees the booking completed and changes nothing.
  await Promise.all([domain.transitionBooking(provider.id, booking._id, "confirm"), domain.transitionBooking(requester.id, booking._id, "confirm")]);
  assert.equal((await c.bookings.findOne({ _id: booking._id }))?.status, "completed");
  const [payer, earner] = await Promise.all([c.accounts.findOne({ userId: requester.id }), c.accounts.findOne({ userId: provider.id })]);
  assert.deepEqual([payer?.availableCredits, payer?.heldCredits, earner?.availableCredits], [300, 0, 1700]);
  assert.equal(await c.transactions.countDocuments({ bookingId: booking._id, type: { $in: ["payment", "earning"] } }), 2);
  assert.equal(await c.notifications.countDocuments({ bookingId: booking._id, type: "booking_completed" }), 1);
});

test("the finish endpoint checks the origin, session, action and participant", async () => {
  const provider = await person(5, "Quinn", "Provider"), requester = await person(6, "Sam", "Requester");
  const service = await listing(provider.id);
  const domain = createExchangeService(db, client);
  const booking = await domain.requestBooking(requester.id, service._id, { preferredWindow: saturday });
  assert.equal((await finish(requester.cookie, booking._id, { action: "confirm" }, "https://evil.example")).status, 403);
  assert.equal((await finish("", booking._id)).status, 401);
  assert.equal((await finish(requester.cookie, "nope")).status, 400);
  assert.equal((await finish(requester.cookie, booking._id, { action: "accept" })).status, 400);
  assert.equal((await finish(requester.cookie, booking._id, { action: "confirm", status: "completed" })).status, 400);
  const early = await finish(requester.cookie, booking._id);
  assert.equal(early.status, 400);
  assert.match((await early.json()).error.message, /Invalid booking transition/);
  await domain.transitionBooking(provider.id, booking._id, "accept");
  const outsider = await person(13, "Omar", "Outsider");
  const byOutsider = await finish(outsider.cookie, booking._id);
  assert.equal(byOutsider.status, 400);
  assert.match((await byOutsider.json()).error.message, /not allowed/);
  // The owner of the listing finishes it, and the requester is told and sent to review.
  const done = await finish(provider.cookie, booking._id);
  assert.equal(done.status, 200, await done.clone().text());
  assert.deepEqual(await done.json(), { success: true, id: booking._id.toHexString(), status: "completed" });
  const told = (await notificationsOf(requester.id)).at(-1)!;
  assert.deepEqual([told.type, told.message, told.href], ["booking_completed", "Quinn finished the Guitar Lessons barter. Your 5 coins were paid to them.", `/bookings/${booking._id}/review`]);
  assert.equal((await finish(requester.cookie, booking._id)).status, 200);
});

test("notifications list newest first and only their owner can mark them read", async () => {
  const owner = await person(7, "Olive", "Owner"), other = await person(8, "Otto", "Other");
  const { notifications } = exchangeCollections(db);
  const older = new ObjectId(), newer = new ObjectId();
  await notifications.insertMany([
    { _id: older, userId: owner.id, type: "system", message: "Older", read: false, createdAt: new Date(Date.now() - 1000) },
    { _id: newer, userId: owner.id, type: "system", message: "Newer", href: "/profile", read: false, createdAt: new Date() },
  ]);
  const listed = await getNotifications(db, owner.id.toHexString());
  assert.deepEqual(listed.map((n) => [n.message, n.href, n.read]), [["Newer", "/profile", false], ["Older", undefined, false]]);
  assert.ok(!("href" in listed[1]));
  assert.deepEqual(await getNotifications(db, other.id.toHexString()), []);
  const mark = (cookie: string, id: string, requestOrigin = origin) => markNotificationRead(new Request(`${origin}/api/notifications/${id}`, { method: "PATCH", headers: { cookie, origin: requestOrigin } }), id, auth, db, origin);
  assert.equal((await mark(owner.cookie, newer.toHexString(), "https://evil.example")).status, 403);
  assert.equal((await mark("", newer.toHexString())).status, 401);
  assert.equal((await mark(owner.cookie, "nope")).status, 400);
  assert.equal((await mark(other.cookie, newer.toHexString())).status, 404);
  assert.equal((await notifications.findOne({ _id: newer }))?.read, false);
  assert.equal((await mark(owner.cookie, newer.toHexString())).status, 200);
  const saved = await notifications.findOne({ _id: newer });
  assert.equal(saved?.read, true);
  assert.ok(saved?.readAt instanceof Date);
});

test("reviews go through the domain: completed bookings only, once per person, and the rating updates", async () => {
  const provider = await person(9, "Vera", "Provider"), requester = await person(10, "Will", "Requester");
  const service = await listing(provider.id);
  const domain = createExchangeService(db, client);
  const booking = await domain.requestBooking(requester.id, service._id, { preferredWindow: saturday });
  const body = { bookingId: booking._id.toHexString(), rating: 4, comment: "Helpful" };
  assert.equal((await review("", body)).status, 401);
  assert.equal((await review(requester.cookie, { ...body, extra: 1 })).status, 400);
  const early = await review(requester.cookie, body);
  assert.equal(early.status, 400);
  assert.match((await early.json()).error.message, /completed bookings/);
  await domain.transitionBooking(provider.id, booking._id, "accept");
  await domain.transitionBooking(requester.id, booking._id, "confirm");
  const created = await review(requester.cookie, body);
  assert.equal(created.status, 201, await created.clone().text());
  const reviewed = await db.collection("user").findOne({ _id: provider.id });
  assert.deepEqual([reviewed?.rating, reviewed?.numberOfReviews], [4, 1]);
  assert.equal((await review(requester.cookie, body)).status, 409);
  assert.equal((await db.collection("user").findOne({ _id: provider.id }))?.numberOfReviews, 1);
});

test("an expired request tells the requester their coins are back", async () => {
  const provider = await person(11, "Xena", "Provider"), requester = await person(12, "Yuri", "Requester");
  const service = await listing(provider.id, 100);
  const domain = createExchangeService(db, client);
  const booking = await domain.requestBooking(requester.id, service._id, { preferredWindow: saturday });
  assert.equal(await domain.expireRequest(booking._id), true);
  assert.equal((await notificationsOf(requester.id)).at(-1)?.message, "Your Guitar Lessons request expired without an answer. Your 1 coin is back in your balance.");
});

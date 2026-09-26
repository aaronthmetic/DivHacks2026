import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { getProfileData, reviewPage } from "../lib/profile-data";
import { starFill } from "../lib/profile-display";
import { updateProfileImage, validateProfileImage, MAX_PROFILE_IMAGE_BYTES } from "../lib/profile-image";
import { createAuth, type Auth } from "../lib/auth-config";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { ensureExchangeIndexes } from "../lib/exchange-schema";
let server: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let auth: Auth;
const origin = "http://localhost:3000";
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("profiles");
  await ensureAuthIndexes(db); await ensureExchangeIndexes(db);
  auth = createAuth(db, client, { baseURL: origin, secret: "profile-test-secret-at-least-thirty-two-characters" });
});
after(async () => { await client?.close(); await server?.stop(); });

test("profile DTOs protect privacy, filter listings, order bookings, and paginate reviews", async () => {
  const owner = new ObjectId(), visitor = new ObjectId();
  await db.collection("user").insertMany([
    { _id: owner, name: "Owner", email: "private@example.com", phoneNumber: "+12025550199", rating: 3.7, numberOfReviews: 11 },
    { _id: visitor, name: "Visitor", email: "visitor@example.com" },
  ]);
  const createdAt = new Date();
  await db.collection("service").insertMany(["active", "paused", "archived"].map(status => ({ userId: owner, status, title: status, description: "Details", creditRate: 250, pricingType: "fixed", deliveryMode: "remote", createdAt })));
  const now = Date.now();
  const makeBooking = (title: string, status: string, time?: number, requesterId = owner) => ({ serviceSnapshot: { title, description: "Booked details" }, status, requesterId, providerId: visitor, totalCredits: 250, ...(time === undefined ? {} : { scheduledAt: new Date(time) }) });
  await db.collection("booking").insertMany([
    makeBooking("Later", "accepted", now + 100000), makeBooking("Unscheduled", "requested"), makeBooking("Soon", "requested", now + 1000),
    makeBooking("Overdue", "awaiting_confirmation", now - 1000), makeBooking("Cancelled", "cancelled", now), makeBooking("Completed", "completed", now), makeBooking("Incoming", "accepted", now, visitor),
  ]);
  const reviewIds = Array.from({ length: 11 }, () => new ObjectId());
  await db.collection("review").insertMany(reviewIds.map((_id, i) => ({ _id, bookingId: new ObjectId(), subjectUserId: owner, authorId: visitor, rating: 4, comment: `Review ${i}`, createdAt })));
  const owned = (await getProfileData(db, owner.toHexString(), owner.toHexString(), "1"))!;
  assert.equal(owned.image, "/default-avatar.svg"); assert.equal(owned.isOwner, true);
  assert.deepEqual(owned.listings.map(s => s.title), ["paused", "active"]);
  assert.deepEqual(owned.bookings.map(b => b.title), ["Overdue", "Soon", "Later", "Unscheduled"]);
  assert.equal(owned.reviews.length, 10); assert.equal(owned.reviewPages, 2);
  assert.equal(owned.reviews[0].id, reviewIds[10].toHexString());
  const second = (await getProfileData(db, owner.toHexString(), visitor.toHexString(), "2"))!;
  assert.equal(second.isOwner, false); assert.equal(second.bookings.length, 0);
  assert.deepEqual(second.listings.map(s => s.title), ["active"]);
  assert.equal(second.reviews.length, 1); assert.equal(second.reviews[0].id, reviewIds[0].toHexString());
  assert.equal(JSON.stringify(second).includes("private@example.com"), false);
  assert.equal(JSON.stringify(second).includes("+12025550199"), false);
  assert.equal((await getProfileData(db, visitor.toHexString(), owner.toHexString(), "bad"))!.rating, 0);
  assert.equal(await getProfileData(db, "invalid", owner.toHexString(), "1"), null);
  assert.equal(await getProfileData(db, new ObjectId().toHexString(), owner.toHexString(), "1"), null);
});

test("fractional star fills and review page bounds", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(i => Math.round(starFill(3.7, i))), [100, 100, 100, 70, 0]);
  assert.equal(starFill(NaN, 0), 0); assert.equal(starFill(-1, 0), 0); assert.equal(starFill(8, 4), 100);
  for (const value of ["-1", "bad", "0", ["2"], "1.5", "9999999999999999999999"]) assert.equal(reviewPage(value, 3), 1);
  assert.equal(reviewPage("99", 3), 3);
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=", "base64");
test("photo validation rejects unsupported, mismatched, empty, and oversized files", () => {
  validateProfileImage(png, "image/png");
  validateProfileImage(Buffer.from([255, 216, 255, 224]), "image/jpeg");
  validateProfileImage(Buffer.from("RIFFxxxxWEBP"), "image/webp");
  assert.throws(() => validateProfileImage(png, "image/jpeg"));
  assert.throws(() => validateProfileImage(Buffer.from("<svg/>"), "image/svg+xml"));
  assert.throws(() => validateProfileImage(Buffer.alloc(0), "image/png"));
  assert.throws(() => validateProfileImage(Buffer.alloc(MAX_PROFILE_IMAGE_BYTES + 1), "image/png"));
});
async function photoUser(number: number) {
  const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": `192.0.2.${number}` }, body: JSON.stringify({ firstName: "Photo", lastName: "Owner", email: `photo${number}@example.com`, phoneNumber: `+12025550${String(number).padStart(3, "0")}`, password: "photo-test-password!" }) }));
  assert.equal(response.status, 200, await response.clone().text());
  return { cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; "), id: new ObjectId((await response.json()).user.id) };
}
function photoRequest(cookie: string, method = "POST", requestOrigin = origin, data = png) {
  const form = new FormData(); form.set("image", new File([new Uint8Array(data)], "photo.png", { type: "image/png" }));
  return new Request(`${origin}/api/profile/image`, { method, headers: { cookie, origin: requestOrigin }, ...(method === "POST" ? { body: form } : {}) });
}
test("photo uploads are authenticated, replace owned images, and reset to the default", async () => {
  const user = await photoUser(1);
  assert.equal((await updateProfileImage(photoRequest(""), auth, db, origin)).status, 401);
  assert.equal((await updateProfileImage(photoRequest(user.cookie, "POST", "https://evil.example"), auth, db, origin)).status, 403);
  assert.equal((await updateProfileImage(photoRequest(user.cookie, "POST", origin, Buffer.from("bad")), auth, db, origin)).status, 400);
  const upload = () => updateProfileImage(photoRequest(user.cookie), auth, db, origin);
  const first = await upload(); assert.equal(first.status, 200);
  const firstImage = (await first.json()).image;
  const second = await upload(); assert.equal(second.status, 200);
  const image = (await second.json()).image;
  assert.notEqual(image, firstImage);
  assert.equal(await db.collection("images.files").countDocuments({ "metadata.ownerId": user.id }), 1);
  assert.equal(await db.collection("images.chunks").countDocuments({ files_id: new ObjectId(firstImage.split("/").pop()) }), 0);
  const session = await auth.api.getSession({ headers: new Headers({ cookie: user.cookie }) });
  assert.equal(session?.user.image, image);
  assert.equal((await updateProfileImage(photoRequest(user.cookie, "DELETE"), auth, db, origin)).status, 200);
  assert.equal((await db.collection("user").findOne({ _id: user.id }))?.image, "/default-avatar.svg");
  assert.equal(await db.collection("images.files").countDocuments({ "metadata.ownerId": user.id }), 0);
});
test("photo cleanup preserves images referenced by a service or another user", async () => {
  const user = await photoUser(2);
  const result = await updateProfileImage(photoRequest(user.cookie), auth, db, origin);
  const image = (await result.json()).image;
  const id = new ObjectId(image.split("/").pop());
  await db.collection("service").insertOne({ images: [id] });
  await updateProfileImage(photoRequest(user.cookie, "DELETE"), auth, db, origin);
  assert.ok(await db.collection("images.files").findOne({ _id: id }));
});
test("a failed user update cleans up the new upload and preserves the old photo", async () => {
  const user = await photoUser(3);
  const first = await updateProfileImage(photoRequest(user.cookie), auth, db, origin);
  const image = (await first.json()).image;
  const failedDb = new Proxy(db, { get(target, key) {
    if (key === "collection") return (name: string) => {
      const collection = target.collection(name);
      if (name !== "user") return collection;
      return new Proxy(collection, { get(target, key) { if (key === "findOneAndUpdate") return async () => { throw new Error("Simulated save failure"); }; const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } });
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.equal((await updateProfileImage(photoRequest(user.cookie), auth, failedDb, origin)).status, 503);
  assert.equal(await db.collection("images.files").countDocuments({ "metadata.ownerId": user.id }), 1);
  assert.equal((await db.collection("user").findOne({ _id: user.id }))?.image, image);
});

test("photo body limits and incomplete profiles fail without creating images", async () => {
  const user = await photoUser(4);
  const oversized = photoRequest(user.cookie, "POST", origin, Buffer.alloc(MAX_PROFILE_IMAGE_BYTES + 65537));
  assert.equal((await updateProfileImage(oversized, auth, db, origin)).status, 413);
  await db.collection("user").updateOne({ _id: user.id }, { $set: { profileCompletedAt: null } });
  assert.equal((await updateProfileImage(photoRequest(user.cookie), auth, db, origin)).status, 403);
  assert.equal(await db.collection("images.files").countDocuments({ "metadata.ownerId": user.id }), 0);
});

test("a failed GridFS upload leaves the existing profile and storage intact", async () => {
  const user = await photoUser(5);
  const failedDb = new Proxy(db, { get(target, key) {
    if (key === "collection") return (name: string) => {
      const collection = target.collection(name);
      if (name !== "images.chunks") return collection;
      return new Proxy(collection, { get(target, key) { if (key === "insertOne") return async () => { throw new Error("Simulated upload failure"); }; const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } });
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.equal((await updateProfileImage(photoRequest(user.cookie), auth, failedDb, origin)).status, 503);
  assert.equal(await db.collection("images.files").countDocuments({ "metadata.ownerId": user.id }), 0);
  assert.equal((await db.collection("user").findOne({ _id: user.id }))?.image, "/default-avatar.svg");
});

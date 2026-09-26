import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { seedProfile } from "../lib/profile-seed";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { ensureExchangeIndexes } from "../lib/exchange-schema";
import { getProfileData } from "../lib/profile-data";
let server: MongoMemoryReplSet, client: MongoClient;
let count = 0;
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
});
after(async () => { await client?.close(); await server?.stop(); });
async function fixture(availableCredits = 1000) {
  const db = client.db(`seed_${++count}`);
  await ensureAuthIndexes(db); await ensureExchangeIndexes(db);
  const id = new ObjectId(), now = new Date();
  await db.collection("user").insertOne({ _id: id, email: "john.doe@email.com", name: "John Doe", firstName: "John", lastName: "Doe", phoneNumber: "+12025550123", profileCompletedAt: now, image: "/keep.png", rating: 4.5, numberOfReviews: 2 });
  await db.collection("creditAccount").insertOne({ _id: new ObjectId(), userId: id, availableCredits, heldCredits: 0, createdAt: now, updatedAt: now });
  return { db, id };
}
async function counts(db: Db) {
  return Promise.all(["user", "genre", "service", "booking", "creditAccount", "creditTransaction", "profileSeed"].map(name => db.collection(name).countDocuments()));
}
test("seeding produces four owner listings and five correctly ordered bookings without changing user details", async () => {
  const { db, id } = await fixture();
  const before = await db.collection("user").findOne({ _id: id });
  const now = new Date("2030-04-01T12:00:00Z");
  const result = await seedProfile(db, client, undefined, now);
  assert.equal(result.created, true); assert.equal(result.listings, 4); assert.equal(result.bookings, 5);
  assert.equal(result.availableCredits, 5); assert.equal(result.heldCredits, 5);
  assert.deepEqual(await db.collection("user").findOne({ _id: id }), before);
  const owner = (await getProfileData(db, id.toHexString(), id.toHexString(), "1"))!;
  const visitor = (await getProfileData(db, id.toHexString(), result.providerId, "1"))!;
  assert.equal(owner.listings.length, 4); assert.equal(owner.bookings.length, 5);
  assert.equal(visitor.listings.length, 3); assert.equal(visitor.bookings.length, 0);
  assert.deepEqual(owner.bookings.map(b => b.title), ["Demo: Walking photography lesson", "Demo: Plant care visit", "Demo: Writing feedback", "Demo: Coding consultation", "Demo: Interview practice"]);
  assert.ok(owner.bookings[0].lines.includes("10027, US"));
  assert.ok(owner.bookings[0].lines.includes("60 minutes"));
  assert.equal(owner.bookings[4].lines[0], "Not scheduled");
  const bookings = await db.collection("booking").find({ requesterId: id }).sort({ _id: 1 }).toArray();
  assert.deepEqual(bookings.filter(b => b.scheduledAt).map(b => (b.scheduledAt.getTime() - now.getTime()) / 86400000), [7, 1, 4, 2]);
  for (const b of bookings) {
    assert.equal(b.totalCredits, 100); assert.ok(!b.providerId.equals(id));
    assert.ok(b.serviceSnapshot.genreId); assert.deepEqual(b.serviceSnapshot.images, []);
    assert.ok(await db.collection("creditTransaction").findOne({ bookingId: b._id, type: "reserve", availableDelta: -100, heldDelta: 100 }));
  }
  assert.equal(await db.collection("account").countDocuments({ userId: new ObjectId(result.providerId) }), 0);
  const priorCounts = await counts(db);
  const again = await seedProfile(db, client, undefined, new Date("2031-01-01"));
  assert.equal(again.created, false); assert.equal(again.availableCredits, 5);
  assert.deepEqual(await counts(db), priorCounts);
  assert.deepEqual(await db.collection("booking").find({ requesterId: id }).sort({ _id: 1 }).toArray(), bookings);
});
test("insufficient credits roll back fixtures, provider, categories, and completion marker", async () => {
  const { db, id } = await fixture(499);
  const priorCounts = await counts(db);
  await assert.rejects(seedProfile(db, client), /five available credits/);
  assert.deepEqual(await counts(db), priorCounts);
  assert.equal((await db.collection("creditAccount").findOne({ userId: id }))?.availableCredits, 499);
});
test("a late ledger failure rolls back credit holds and every fixture write", async () => {
  const { db, id } = await fixture();
  // Deliberately reject reservation inserts after the account update in the transaction.
  await db.command({ collMod: "creditTransaction", validator: { type: { $ne: "reserve" } }, validationLevel: "strict" });
  const priorCounts = await counts(db);
  await assert.rejects(seedProfile(db, client));
  assert.deepEqual(await counts(db), priorCounts);
  const account = await db.collection("creditAccount").findOne({ userId: id });
  assert.equal(account?.availableCredits, 1000); assert.equal(account?.heldCredits, 0);
});
test("concurrent seed attempts reserve once and complete exactly once", async () => {
  const { db } = await fixture();
  const results = await Promise.all([seedProfile(db, client), seedProfile(db, client)]);
  assert.equal(results.filter(r => r.created).length, 1);
  assert.equal(await db.collection("booking").countDocuments(), 5);
  assert.equal(await db.collection("creditTransaction").countDocuments(), 5);
  assert.equal((await seedProfile(db, client)).availableCredits, 5);
});

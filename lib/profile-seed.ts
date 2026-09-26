import { MongoServerError, ObjectId, type Db, type Document, type MongoClient } from "mongodb";
import { InputError, isProfileComplete, normalizeEmail } from "./auth-validation";
import { calculateCredits, validateService } from "./exchange-service";
import { snapshotService, validateScheduledAt } from "./booking-snapshot";
import { exchangeCollections, type Booking, type Service } from "./exchange-schema";
import { DEFAULT_AVATAR } from "./profile-display";

const PROVIDER_ID = new ObjectId("d00000000000000000000001");
const FIXTURE_KEY = "profile-demo-v1";
function completeProfile(user: Document) {
  return isProfileComplete({ firstName: user.firstName, lastName: user.lastName, phoneNumber: user.phoneNumber, profileCompletedAt: user.profileCompletedAt });
}
interface SeedRecord {
  _id: string; userId: ObjectId; providerId: ObjectId; createdAt: Date;
  listingIds: ObjectId[]; providerListingIds: ObjectId[]; bookingIds: ObjectId[];
}

/** Administrative fixtures only. All documents, holds and ledger entries commit together. */
export async function seedProfile(db: Db, client: MongoClient, email = "john.doe@email.com", now = new Date()) {
  validateScheduledAt(now);
  const user = await db.collection("user").findOne({ email: normalizeEmail(email) });
  if (!user || !completeProfile(user)) throw new InputError("The target user must exist and have a complete profile.");
  if (user._id.equals(PROVIDER_ID)) throw new InputError("The demo provider cannot be the target user.");
  const c = exchangeCollections(db);
  const seeds = db.collection<SeedRecord>("profileSeed");
  const key = `${FIXTURE_KEY}:${user._id.toHexString()}`;
  let created = false;
  try {
    created = await client.withSession(session => session.withTransaction(async () => {
      if (await seeds.findOne({ _id: key }, { session })) return false;
      const current = await db.collection("user").findOne({ _id: user._id }, { session });
      if (!current || !completeProfile(current)) throw new InputError("The target profile is no longer complete.");
      const record: SeedRecord = { _id: key, userId: user._id, providerId: PROVIDER_ID, createdAt: now, listingIds: [], providerListingIds: [], bookingIds: [] };
      // The unique _id serializes simultaneous seed attempts; rollback removes it on failure.
      await seeds.insertOne(record, { session });
      await db.collection("user").updateOne({ _id: PROVIDER_ID }, { $setOnInsert: {
        name: "Demo Service Provider", firstName: "Demo", lastName: "Service Provider",
        email: "profile-demo-provider@example.invalid", phoneNumber: "+12025550198",
        emailVerified: false, phoneNumberVerified: false, profileCompletedAt: now,
        image: DEFAULT_AVATAR, rating: 0, numberOfReviews: 0, reviews: [],
        fixtureKey: FIXTURE_KEY, createdAt: now, updatedAt: now,
      } }, { upsert: true, session });
      const provider = await db.collection("user").findOne({ _id: PROVIDER_ID }, { session });
      if (!provider || provider.fixtureKey !== FIXTURE_KEY || !completeProfile(provider)) throw new InputError("The demo provider identifier is already in use or incomplete.");
      // The fixture provider has no authentication account or sessions and starts at zero.
      await c.accounts.updateOne({ userId: PROVIDER_ID }, { $setOnInsert: { _id: new ObjectId(), userId: PROVIDER_ID, availableCredits: 0, heldCredits: 0, createdAt: now, updatedAt: now } }, { upsert: true, session });
      const genreIds: ObjectId[] = [];
      for (const [slug, name] of [["profile-demo-learning", "Demo: Learning"], ["profile-demo-everyday", "Demo: Everyday help"]]) {
        await c.genres.updateOne({ slug }, { $setOnInsert: { _id: new ObjectId(), slug, name, description: "Profile display test fixtures", isActive: true } }, { upsert: true, session });
        const genre = await c.genres.findOne({ slug, isActive: true }, { session });
        if (!genre || genre.name !== name || genre.description !== "Profile display test fixtures") throw new InputError("The demo category slug is already in use or inactive.");
        genreIds.push(genre._id);
      }
      function listing(owner: ObjectId, title: string, index: number, paused = false): Service {
        const inPerson = index % 2 === 1;
        const result: Service = {
          _id: new ObjectId(), userId: owner, genreId: genreIds[index % 2], title,
          description: `${title}. A sample service for testing profile cards and booking details.`,
          deliveryMode: inPerson ? "in_person" : "remote", ...(inPerson ? { zipCode: "10027", countryCode: "US" } : {}),
          pricingType: inPerson ? "hourly" : "fixed", creditRate: 100,
          images: [], status: paused ? "paused" : "active", createdAt: new Date(now.getTime() + index), updatedAt: now,
        };
        validateService(result);
        return result;
      }
      const ownListings = ["Demo: Math tutoring", "Demo: Neighborhood errands", "Demo: Resume feedback", "Demo: Bike maintenance"].map((title, index) => listing(user._id, title, index, index === 3));
      const providerListings = ["Demo: Coding consultation", "Demo: Walking photography lesson", "Demo: Writing feedback", "Demo: Plant care visit", "Demo: Interview practice"].map((title, index) => listing(PROVIDER_ID, title, index));
      await c.services.insertMany([...ownListings, ...providerListings], { session });
      const offsets = [7, 1, 4, 2, undefined];
      const bookings: Booking[] = providerListings.map((service, index) => {
        const scheduledAt = offsets[index] === undefined ? undefined : new Date(now.getTime() + offsets[index]! * 86400000);
        validateScheduledAt(scheduledAt);
        const durationMinutes = service.pricingType === "hourly" ? 60 : undefined;
        return {
          _id: new ObjectId(), serviceId: service._id, providerId: service.userId, requesterId: user._id,
          serviceSnapshot: snapshotService(service), ...(durationMinutes ? { durationMinutes } : {}),
          ...(scheduledAt ? { scheduledAt } : {}), totalCredits: calculateCredits(service.pricingType, service.creditRate, durationMinutes),
          status: index === 1 || index === 3 ? "accepted" : "requested", createdAt: now, updatedAt: now,
        };
      });
      const total = bookings.reduce((sum, booking) => sum + booking.totalCredits, 0);
      const account = await c.accounts.findOne({ userId: user._id }, { session });
      if (!account || !Number.isSafeInteger(account.availableCredits) || !Number.isSafeInteger(account.heldCredits) || account.heldCredits < 0 || account.availableCredits < total || account.heldCredits > Number.MAX_SAFE_INTEGER - total) throw new InputError("The target needs at least five available credits and a valid credit account.");
      await c.accounts.updateOne({ _id: account._id }, { $inc: { availableCredits: -total, heldCredits: total }, $set: { updatedAt: now } }, { session });
      await c.bookings.insertMany(bookings, { session });
      await c.transactions.insertMany(bookings.map(booking => ({ _id: new ObjectId(), accountId: account._id, bookingId: booking._id, type: "reserve" as const, availableDelta: -booking.totalCredits, heldDelta: booking.totalCredits, idempotencyKey: `${booking._id}:reserve`, createdAt: now })), { session });
      await seeds.updateOne({ _id: key }, { $set: { listingIds: ownListings.map(s => s._id), providerListingIds: providerListings.map(s => s._id), bookingIds: bookings.map(b => b._id) } }, { session });
      return true;
    }));
  } catch (error) {
    // A competing identical seed may have committed while this transaction waited.
    if (!(error instanceof MongoServerError && error.code === 11000 && await seeds.findOne({ _id: key }))) throw error;
  }
  const record = await seeds.findOne({ _id: key });
  const account = await c.accounts.findOne({ userId: user._id });
  if (!record || !account) throw new Error("Seed verification failed.");
  return { created, userId: user._id.toHexString(), providerId: PROVIDER_ID.toHexString(), listings: record.listingIds.length, providerListings: record.providerListingIds.length, bookings: record.bookingIds.length, availableCredits: account.availableCredits / 100, heldCredits: account.heldCredits / 100 };
}

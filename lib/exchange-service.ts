// Server-side domain operations. Callers must derive actor IDs from authenticated sessions.
import { ObjectId, type ClientSession, type Db, type MongoClient } from "mongodb";
import { snapshotService, validateScheduledAt } from "./booking-snapshot";
import { InputError, isProfileComplete } from "./auth-validation";
import { exchangeCollections, type Booking, type Service } from "./exchange-schema";

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InputError(message);
}
function positiveInteger(value: number) { return Number.isSafeInteger(value) && value > 0; }
function welcomeKey(userId: ObjectId) { return `welcome:${userId}`; }
const bookingTargets = { accept: "accepted", decline: "declined", cancel: "cancelled", deliver: "awaiting_confirmation", confirm: "completed" } as const;
export function calculateCredits(pricingType: Service["pricingType"], creditRate: number, durationMinutes?: number) {
  requireValue(pricingType === "fixed" || pricingType === "hourly", "Invalid pricing type.");
  requireValue(positiveInteger(creditRate), "Rate must be positive integer hundredths of a credit.");
  if (pricingType === "fixed") return creditRate;
  requireValue(durationMinutes !== undefined && positiveInteger(durationMinutes), "An hourly booking requires positive whole minutes.");
  const total = (BigInt(creditRate) * BigInt(durationMinutes) + BigInt(30)) / BigInt(60);
  requireValue(total > BigInt(0) && total <= BigInt(Number.MAX_SAFE_INTEGER), "Invalid total credits.");
  return Number(total);
}
export function validateService(input: Omit<Service, "_id" | "userId" | "createdAt" | "updatedAt">) {
  requireValue(typeof input.title === "string" && input.title.trim().length > 0 && input.title.length <= 200, "A title of at most 200 characters is required.");
  requireValue(typeof input.description === "string" && input.description.trim().length > 0 && input.description.length <= 10000, "A description of at most 10000 characters is required.");
  requireValue(["remote", "in_person", "either"].includes(input.deliveryMode), "Invalid delivery mode.");
  requireValue(["active", "paused", "archived"].includes(input.status), "Invalid service status.");
  requireValue(input.genreId instanceof ObjectId, "Invalid genre ID.");
  calculateCredits(input.pricingType, input.creditRate, 60);
  requireValue(input.images === undefined || (Array.isArray(input.images) && input.images.every(id => id instanceof ObjectId)), "Images must be an array of GridFS ObjectIds.");
  if (input.deliveryMode !== "remote" || input.zipCode !== undefined || input.countryCode !== undefined) {
    requireValue(typeof input.zipCode === "string" && input.zipCode.trim().length > 0 && input.zipCode.length <= 20, "A postal code is required.");
    requireValue(typeof input.countryCode === "string" && /^[A-Z]{2}$/.test(input.countryCode), "Use a two-letter uppercase country code.");
  }
}
export function createExchangeService(db: Db, client: MongoClient) {
  const c = exchangeCollections(db);
  async function transaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    return client.withSession((session) => session.withTransaction(() => fn(session)));
  }
  async function completeUser(userId: ObjectId, session: ClientSession) {
    const user = await db.collection("user").findOne({ _id: userId }, { session });
    requireValue(user && isProfileComplete({ firstName: user.firstName, lastName: user.lastName, phoneNumber: user.phoneNumber, profileCompletedAt: user.profileCompletedAt }), "A complete user profile is required.");
  }
  async function grantWelcome(userId: ObjectId, session: ClientSession) {
    // The ledger is append-only, so an existing key means the grant already committed.
    const key = welcomeKey(userId);
    if (await c.transactions.findOne({ idempotencyKey: key }, { session })) return;
    await completeUser(userId, session);
    // Serialize competing first grants on the user document; a losing transaction retries
    // and then sees the winner's ledger entry above.
    await db.collection("user").updateOne({ _id: userId }, { $inc: { creditGrantVersion: 1 } }, { session });
    const now = new Date();
    const account = await c.accounts.findOneAndUpdate({ userId }, { $setOnInsert: { _id: new ObjectId(), userId, availableCredits: 0, heldCredits: 0, createdAt: now }, $set: { updatedAt: now } }, { upsert: true, returnDocument: "after", session });
    await c.accounts.updateOne({ _id: account!._id }, { $inc: { availableCredits: 1000 } }, { session });
    await c.transactions.insertOne({ _id: new ObjectId(), accountId: account!._id, type: "welcome", availableDelta: 1000, heldDelta: 0, idempotencyKey: key, createdAt: now }, { session });
  }
  // Providers created before welcome grants existed may have no account to receive earnings.
  async function ensureAccount(userId: ObjectId, session: ClientSession) {
    const now = new Date();
    await c.accounts.updateOne({ userId }, { $setOnInsert: { _id: new ObjectId(), userId, availableCredits: 0, heldCredits: 0, createdAt: now, updatedAt: now } }, { upsert: true, session });
  }
  async function move(userId: ObjectId, booking: Booking, type: "reserve" | "release" | "payment" | "earning", availableDelta: number, heldDelta: number, session: ClientSession) {
    const account = await c.accounts.findOneAndUpdate({ userId, availableCredits: { $gte: Math.max(0, -availableDelta), $lte: Number.MAX_SAFE_INTEGER - Math.max(0, availableDelta) }, heldCredits: { $gte: Math.max(0, -heldDelta), $lte: Number.MAX_SAFE_INTEGER - Math.max(0, heldDelta) } }, { $inc: { availableCredits: availableDelta, heldCredits: heldDelta }, $set: { updatedAt: new Date() } }, { session, returnDocument: "after" });
    requireValue(account, "Insufficient credits or invalid account balance.");
    await c.transactions.insertOne({ _id: new ObjectId(), accountId: account._id, bookingId: booking._id, type, availableDelta, heldDelta, idempotencyKey: `${booking._id}:${type}`, createdAt: new Date() }, { session });
  }
  return {
    async grantWelcome(userId: ObjectId, session?: ClientSession) {
      if (session) {
        // Exactly-once relies on the caller's transaction; a plain session would double-credit.
        if (!session.inTransaction()) throw new Error("grantWelcome requires a session in an active transaction.");
        return grantWelcome(userId, session);
      }
      // Already-granted users (every later sign-in) skip the transaction entirely.
      if (await c.transactions.findOne({ idempotencyKey: welcomeKey(userId) }, { projection: { _id: 1 } })) return;
      return transaction((s) => grantWelcome(userId, s));
    },
    async createService(userId: ObjectId, input: Omit<Service, "_id" | "userId" | "createdAt" | "updatedAt">) {
      validateService(input);
      return transaction(async (session) => {
        await completeUser(userId, session);
        requireValue(await c.genres.findOne({ _id: input.genreId, isActive: true }, { session }), "An active genre is required.");
        const now = new Date();
        const service: Service = { _id: new ObjectId(), userId, genreId: input.genreId, title: input.title.trim(), description: input.description.trim(), deliveryMode: input.deliveryMode, pricingType: input.pricingType, creditRate: input.creditRate, status: input.status, images: [...(input.images ?? [])], ...(input.zipCode !== undefined ? { zipCode: input.zipCode.trim(), countryCode: input.countryCode } : {}), createdAt: now, updatedAt: now };
        await c.services.insertOne(service, { session });
        return service;
      });
    },
    async requestBooking(requesterId: ObjectId, serviceId: ObjectId, options: { durationMinutes?: number; scheduledAt?: Date } = {}) {
      return transaction(async (session) => {
        await completeUser(requesterId, session);
        const service = await c.services.findOne({ _id: serviceId, status: "active" }, { session });
        requireValue(service, "Active service not found.");
        requireValue(!service.userId.equals(requesterId), "You cannot book your own service.");
        await completeUser(service.userId, session);
        await ensureAccount(service.userId, session);
        requireValue(await c.genres.findOne({ _id: service.genreId, isActive: true }, { session }), "An active genre is required.");
        validateScheduledAt(options.scheduledAt);
        const totalCredits = calculateCredits(service.pricingType, service.creditRate, options.durationMinutes);
        const now = new Date();
        const booking: Booking = { _id: new ObjectId(), serviceId, providerId: service.userId, requesterId, serviceSnapshot: snapshotService(service), ...(service.pricingType === "hourly" ? { durationMinutes: options.durationMinutes } : {}), ...(options.scheduledAt ? { scheduledAt: options.scheduledAt } : {}), totalCredits, status: "requested", createdAt: now, updatedAt: now };
        await move(requesterId, booking, "reserve", -totalCredits, totalCredits, session);
        await c.bookings.insertOne(booking, { session });
        return booking;
      });
    },
    async transitionBooking(actorId: ObjectId, bookingId: ObjectId, action: "accept" | "decline" | "cancel" | "deliver" | "confirm") {
      // Own-key check: inherited names like "__proto__" must not pass as actions.
      requireValue(Object.hasOwn(bookingTargets, action), "Invalid action.");
      const target = bookingTargets[action];
      return transaction(async (session) => {
        const booking = await c.bookings.findOne({ _id: bookingId }, { session });
        requireValue(booking, "Booking not found.");
        const provider = actorId.equals(booking.providerId), requester = actorId.equals(booking.requesterId);
        requireValue(action === "cancel" ? provider || requester : action === "confirm" ? requester : provider, "This action is not allowed for this user.");
        if (booking.status === target) return booking;
        requireValue(action === "cancel" ? ["requested", "accepted"].includes(booking.status) : action === "deliver" ? booking.status === "accepted" : action === "confirm" ? booking.status === "awaiting_confirmation" : booking.status === "requested", "Invalid booking transition.");
        const now = new Date();
        const changes = { status: target, updatedAt: now, ...(action === "deliver" ? { providerCompletedAt: now } : {}), ...(action === "confirm" ? { requesterConfirmedAt: now } : {}) };
        const result = await c.bookings.updateOne({ _id: bookingId, status: booking.status }, { $set: changes }, { session });
        requireValue(result.modifiedCount === 1, "Booking changed. Retry.");
        const amount = booking.totalCredits;
        if (action === "cancel" || action === "decline") await move(booking.requesterId, booking, "release", amount, -amount, session);
        if (action === "confirm") {
          await move(booking.requesterId, booking, "payment", 0, -amount, session);
          await move(booking.providerId, booking, "earning", amount, 0, session);
        }
        return { ...booking, ...changes };
      });
    },
    async createReview(authorId: ObjectId, bookingId: ObjectId, rating: number, comment: string) {
      requireValue(Number.isInteger(rating) && rating >= 1 && rating <= 5, "Rating must be from 1 to 5.");
      requireValue(typeof comment === "string" && comment.length <= 2000, "Comment must be at most 2000 characters.");
      return transaction(async (session) => {
        const booking = await c.bookings.findOne({ _id: bookingId, status: "completed" }, { session });
        requireValue(booking && (authorId.equals(booking.providerId) || authorId.equals(booking.requesterId)), "Only participants in completed bookings may review.");
        const review = { _id: new ObjectId(), bookingId, authorId, subjectUserId: authorId.equals(booking.providerId) ? booking.requesterId : booking.providerId, rating, comment: comment.trim(), createdAt: new Date() };
        // Serialize reviews of the same user; transaction retries see the latest reviews.
        const subject = await db.collection("user").updateOne(
          { _id: review.subjectUserId }, { $inc: { numberOfReviews: 1 } }, { session },
        );
        requireValue(subject.matchedCount === 1, "Review recipient not found.");
        await c.reviews.insertOne(review, { session });
        // Rebuild from the source records so legacy users also include earlier reviews.
        const received = await c.reviews.find({ subjectUserId: review.subjectUserId }, { session })
          .sort({ createdAt: 1, _id: 1 }).toArray();
        await db.collection("user").updateOne({ _id: review.subjectUserId }, { $set: {
          rating: received.reduce((sum, item) => sum + item.rating, 0) / received.length,
          numberOfReviews: received.length,
          reviews: received.map((item) => item._id.toHexString()),
        } }, { session });
        return review;
      });
    },
  };
}

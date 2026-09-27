import { rebuildUserRatings } from "./review-ratings";
// Server-side domain operations. Callers must derive actor IDs from authenticated sessions.
import { ObjectId, type ClientSession, type Db, type Document, type MongoClient } from "mongodb";
import { snapshotService, validateScheduledAt } from "./booking-snapshot";
import { InputError, isProfileComplete } from "./auth-validation";
import { isValidAvailability } from "./availability";
import { exchangeCollections, type AvailabilityWindow, type Booking, type Notification, type Service, type ServiceFrequency } from "./exchange-schema";
import { coinsLabel } from "./listing-data";

type NotificationInput = Omit<Notification, "_id" | "read" | "readAt" | "createdAt">;

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InputError(message);
}
function positiveInteger(value: number) { return Number.isSafeInteger(value) && value > 0; }
function nameOf(user: Document | null | undefined) {
  if (typeof user?.firstName === "string" && user.firstName.trim()) return user.firstName.trim();
  if (typeof user?.name === "string" && user.name.trim()) return user.name.trim().split(/\s+/)[0];
  return "Someone";
}
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
  requireValue(input.frequency === undefined || validFrequency(input.frequency), "Choose single time, or recurring every 1 to 99 days, weeks, or months.");
  requireValue(isValidAvailability(input.availability), "Choose the days and hours you're available, one time range per day.");
  if (input.deliveryMode !== "remote" || input.zipCode !== undefined || input.countryCode !== undefined) {
    requireValue(typeof input.zipCode === "string" && input.zipCode.trim().length > 0 && input.zipCode.length <= 20, "A postal code is required.");
    requireValue(typeof input.countryCode === "string" && /^[A-Z]{2}$/.test(input.countryCode), "Use a two-letter uppercase country code.");
  }
}
function validFrequency(frequency: ServiceFrequency) {
  if (frequency?.type === "single") return true;
  return frequency?.type === "recurring" && Number.isInteger(frequency.interval) && frequency.interval >= 1 && frequency.interval <= 99
    && ["day", "week", "month"].includes(frequency.unit);
}
/** Copies only the known fields so stray client keys are never stored. */
function storedFrequency(frequency: ServiceFrequency): ServiceFrequency {
  return frequency.type === "single" ? { type: "single" } : { type: "recurring", interval: frequency.interval, unit: frequency.unit };
}
/** Copies only the known fields, sorted by day. */
function storedAvailability(availability: AvailabilityWindow[]): AvailabilityWindow[] {
  return availability.map(({ day, start, end }) => ({ day, start, end })).sort((a, b) => a.day - b.day);
}
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
export function createExchangeService(db: Db, client: MongoClient) {
  const c = exchangeCollections(db);
  async function transaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    return client.withSession((session) => session.withTransaction(() => fn(session)));
  }
  async function completeUser(userId: ObjectId, session: ClientSession) {
    const user = await db.collection("user").findOne({ _id: userId }, { session });
    requireValue(user && isProfileComplete({ firstName: user.firstName, lastName: user.lastName, phoneNumber: user.phoneNumber, profileCompletedAt: user.profileCompletedAt }), "A complete user profile is required.");
    return user;
  }
  // Notification texts name people by first name, like the booking texts do.
  async function firstName(userId: ObjectId, session: ClientSession) {
    const user = await db.collection("user").findOne({ _id: userId }, { projection: { firstName: 1, name: 1 }, session });
    return nameOf(user);
  }
  // Notifications commit or roll back with the change they describe.
  async function notify(session: ClientSession, entries: NotificationInput[]) {
    const createdAt = new Date();
    await c.notifications.insertMany(entries.map((entry) => ({ _id: new ObjectId(), ...entry, read: false, createdAt })), { session });
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
        const service: Service = { _id: new ObjectId(), userId, genreId: input.genreId, title: input.title.trim(), description: input.description.trim(), deliveryMode: input.deliveryMode, pricingType: input.pricingType, creditRate: input.creditRate, status: input.status, images: [...(input.images ?? [])], ...(input.zipCode !== undefined ? { zipCode: input.zipCode.trim(), countryCode: input.countryCode } : {}), ...(input.frequency ? { frequency: storedFrequency(input.frequency) } : {}), availability: storedAvailability(input.availability!), createdAt: now, updatedAt: now };
        await c.services.insertOne(service, { session });
        return service;
      });
    },
    async requestBooking(requesterId: ObjectId, serviceId: ObjectId, options: { durationMinutes?: number; scheduledAt?: Date; preferredWindow?: AvailabilityWindow; note?: string } = {}) {
      const note = requestNote(options.note);
      return transaction(async (session) => {
        const requester = await completeUser(requesterId, session);
        const service = await c.services.findOne({ _id: serviceId, status: "active" }, { session });
        requireValue(service, "Active service not found.");
        requireValue(!service.userId.equals(requesterId), "You cannot book your own service.");
        const provider = await completeUser(service.userId, session);
        await ensureAccount(service.userId, session);
        requireValue(await c.genres.findOne({ _id: service.genreId, isActive: true }, { session }), "An active genre is required.");
        validateScheduledAt(options.scheduledAt);
        const preferredWindow = chosenWindow(service, options.preferredWindow);
        const totalCredits = calculateCredits(service.pricingType, service.creditRate, options.durationMinutes);
        const now = new Date();
        const booking: Booking = { _id: new ObjectId(), serviceId, providerId: service.userId, requesterId, serviceSnapshot: snapshotService(service), ...(service.pricingType === "hourly" ? { durationMinutes: options.durationMinutes } : {}), ...(options.scheduledAt ? { scheduledAt: options.scheduledAt } : {}), ...(preferredWindow ? { preferredWindow } : {}), ...(note ? { note } : {}), totalCredits, status: "requested", createdAt: now, updatedAt: now };
        await move(requesterId, booking, "reserve", -totalCredits, totalCredits, session);
        await c.bookings.insertOne(booking, { session });
        const about = { bookingId: booking._id, serviceId };
        await notify(session, [
          // Providers answer by text, so their notification has nothing to open.
          { userId: service.userId, actorId: requesterId, type: "booking_requested", message: `${nameOf(requester)} requested ${service.title}. Reply YES or NO to our text to answer.`, ...about },
          { userId: requesterId, actorId: service.userId, type: "system", message: `Your request for ${service.title} was sent to ${nameOf(provider)}. We're holding ${coinsLabel(totalCredits)} until ${nameOf(provider)} answers.`, ...about, href: "/profile" },
        ]);
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
        requireValue(action === "cancel" || action === "confirm" ? provider || requester : provider, "This action is not allowed for this user.");
        if (booking.status === target) return booking;
        // Either person can confirm (finish, paying the held coins) once the booking is accepted;
        // the provider's "delivered" step is optional.
        requireValue(action === "cancel" ? ["requested", "accepted"].includes(booking.status) : action === "deliver" ? booking.status === "accepted" : action === "confirm" ? ["accepted", "awaiting_confirmation"].includes(booking.status) : booking.status === "requested", "Invalid booking transition.");
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
        const actor = await firstName(actorId, session), title = booking.serviceSnapshot.title;
        const one = amount === 100;
        const refund = `Your ${coinsLabel(amount)} ${one ? "is" : "are"} back in your balance.`;
        const about = { actorId, bookingId, serviceId: booking.serviceId };
        const toRequester = { ...about, userId: booking.requesterId, href: "/profile" };
        const notice: Record<typeof action, NotificationInput> = {
          accept: { ...toRequester, type: "booking_accepted", message: `${actor} accepted your ${title} request.` },
          decline: { ...toRequester, type: "booking_declined", message: `${actor} declined your ${title} request. ${refund}` },
          cancel: provider
            ? { ...toRequester, type: "booking_cancelled", message: `${actor} cancelled your ${title} booking. ${refund}` }
            : { ...about, userId: booking.providerId, type: "booking_cancelled", message: `${actor} cancelled the ${title} booking.` },
          deliver: { ...toRequester, type: "booking_awaiting_confirmation", message: `${actor} marked ${title} as done. Finish the barter to pay them.` },
          // The other person can now review them.
          confirm: provider
            ? { ...about, userId: booking.requesterId, type: "booking_completed", message: `${actor} finished the ${title} barter. Your ${coinsLabel(amount)} ${one ? "was" : "were"} paid to them.`, href: `/bookings/${bookingId.toHexString()}/review` }
            : { ...about, userId: booking.providerId, type: "booking_completed", message: `${actor} finished the ${title} barter. ${coinsLabel(amount)} ${one ? "was" : "were"} added to your balance.`, href: `/bookings/${bookingId.toHexString()}/review` },
        };
        await notify(session, [notice[action]]);
        return { ...booking, ...changes };
      });
    },
    /** Cancels a request nobody answered and refunds the requester, like their own cancel, but only while it's still waiting. True when it did. */
    async expireRequest(bookingId: ObjectId) {
      return transaction(async (session) => {
        // Matching the status here, not only in the sweep's earlier read, lets a YES or an overlapping sweep win.
        const booking = await c.bookings.findOneAndUpdate({ _id: bookingId, status: "requested" }, { $set: { status: "cancelled", updatedAt: new Date() } }, { session });
        if (!booking) return false;
        await move(booking.requesterId, booking, "release", booking.totalCredits, -booking.totalCredits, session);
        const one = booking.totalCredits === 100;
        await notify(session, [{ userId: booking.requesterId, type: "booking_cancelled", bookingId, serviceId: booking.serviceId, href: "/profile",
          message: `Your ${booking.serviceSnapshot.title} request expired without an answer. Your ${coinsLabel(booking.totalCredits)} ${one ? "is" : "are"} back in your balance.` }]);
        return true;
      });
    },
    async createReview(authorId: ObjectId, bookingId: ObjectId, rating: number, comment: string) {
      requireValue(Number.isInteger(rating) && rating >= 1 && rating <= 5, "Rating must be from 1 to 5.");
      requireValue(typeof comment === "string" && comment.length <= 2000, "Comment must be at most 2000 characters.");
      return transaction(async (session) => {
        const booking = await c.bookings.findOne({ _id: bookingId, status: "completed" }, { session });
        requireValue(booking && (authorId.equals(booking.providerId) || authorId.equals(booking.requesterId)), "Only participants in completed bookings may review.");
        const review = { _id: new ObjectId(), bookingId, authorId, subjectUserId: authorId.equals(booking.providerId) ? booking.requesterId : booking.providerId, rating, comment: comment.trim(), createdAt: new Date() };
        await c.reviews.insertOne(review, { session });
        requireValue(await rebuildUserRatings(db, review.subjectUserId, session), "Review recipient not found.");
        await notify(session, [{ userId: review.subjectUserId, actorId: authorId, type: "review_received", bookingId, serviceId: booking.serviceId, reviewId: review._id, href: "/profile",
          message: `${await firstName(authorId, session)} left you a ${rating}-star review for ${booking.serviceSnapshot.title}.` }]);
        return review;
      });
    },
  };
}

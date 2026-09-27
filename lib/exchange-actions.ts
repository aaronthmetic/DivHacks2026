import { ObjectId, type ClientSession, type Db, type WithId } from "mongodb";
import { snapshotService, validateScheduledAt } from "./booking-snapshot";
import { calculateCredits } from "./exchange-service";
import {
  exchangeCollections,
  type Genre,
  type Service,
  type Booking,
  type CreditAccount,
  type CreditTransaction,
  type Notification,
  type Review,
} from "./exchange-schema";

export async function addGenre(
  db: Db,
  data: { name: string; slug: string; description?: string; isActive?: boolean },
) {
  const { genres } = exchangeCollections(db);
  const genre: Genre = {
    _id: new ObjectId(),
    name: data.name,
    slug: data.slug,
    description: data.description ?? "",
    isActive: data.isActive ?? true,
  };
  await genres.insertOne(genre);
  return genre;
}

export type AddServiceInput = {
  userId: string;
  genreId: string;
  title: string;
  description: string;
  zipCode?: string;
  countryCode?: string;
  deliveryMode: "remote" | "in_person" | "either";
  pricingType: "hourly" | "fixed";
  creditRate: number;
  images?: ObjectId[];
};

export async function addService(db: Db, data: AddServiceInput) {
  const { services } = exchangeCollections(db);
  if (!ObjectId.isValid(data.userId)) throw new Error("Invalid user ID.");
  if (!ObjectId.isValid(data.genreId)) throw new Error("Invalid genre ID.");

  const now = new Date();
  const service: Service = {
    _id: new ObjectId(),
    userId: new ObjectId(data.userId),
    genreId: new ObjectId(data.genreId),
    title: data.title,
    description: data.description,
    ...(data.zipCode !== undefined ? { zipCode: data.zipCode } : {}),
    ...(data.countryCode !== undefined ? { countryCode: data.countryCode } : {}),
    deliveryMode: data.deliveryMode,
    pricingType: data.pricingType,
    creditRate: data.creditRate,
    images: data.images ?? [],
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await services.insertOne(service);
  return service;
}

export type AddBookingInput = {
  serviceId: string;
  requesterId: string;
  durationMinutes?: number;
  scheduledAt?: Date;
};

type BookingActionOptions = { session?: ClientSession };

export async function addBooking(
  db: Db,
  data: AddBookingInput,
  options: BookingActionOptions = {},
) {
  const { services, bookings, accounts } = exchangeCollections(db);
  if (!ObjectId.isValid(data.serviceId)) throw new Error("Invalid service ID.");
  if (!ObjectId.isValid(data.requesterId)) throw new Error("Invalid requester ID.");

  const requesterId = new ObjectId(data.requesterId);
  const service = await services.findOne({
    _id: new ObjectId(data.serviceId),
    status: "active",
  }, { session: options.session });
  if (!service) throw new Error("Service not found or is no longer active.");
  if (service.userId.equals(requesterId)) {
    throw new Error("You cannot book your own service.");
  }
  if (data.scheduledAt) validateScheduledAt(data.scheduledAt);

  // The UI may omit pricingType even when the stored service is hourly.
  // Use the stored pricing type and default an omitted hourly duration to one hour.
  const durationMinutes =
    data.durationMinutes ?? (service.pricingType === "hourly" ? 60 : undefined);
  const totalCredits = calculateCredits(
    service.pricingType,
    service.creditRate,
    durationMinutes,
  );

  const account = await accounts.findOne(
    { userId: requesterId },
    { session: options.session },
  );
  if (!account || account.availableCredits < totalCredits) {
    throw new Error(
      "INSUFFICIENT_CREDITS: You do not have enough credits to book this service.",
    );
  }

  const now = new Date();
  const booking: Booking = {
    _id: new ObjectId(),
    serviceId: service._id,
    providerId: service.userId,
    requesterId,
    serviceSnapshot: snapshotService(service),
    ...(service.pricingType === "hourly" ? { durationMinutes } : {}),
    totalCredits,
    ...(data.scheduledAt ? { scheduledAt: data.scheduledAt } : {}),
    status: "requested",
    createdAt: now,
    updatedAt: now,
  };
  await bookings.insertOne(booking, { session: options.session });

  const notifications = db.collection<Notification>("notification");
  const bookingUrl = `/bookings/${booking._id.toHexString()}`;
  await notifications.insertMany(
    [
      {
        _id: new ObjectId(),
        userId: requesterId,
        actorId: service.userId,
        type: "system",
        message: `Your booking for "${service.title}" was created. You will receive the service once the provider accepts.`,
        bookingId: booking._id,
        serviceId: service._id,
        href: bookingUrl,
        read: false,
        createdAt: now,
      },
      {
        _id: new ObjectId(),
        userId: service.userId,
        actorId: requesterId,
        type: "booking_requested",
        message: `You have a new client for "${service.title}". Open the booking to review their request.`,
        bookingId: booking._id,
        serviceId: service._id,
        href: bookingUrl,
        read: false,
        createdAt: now,
      },
    ],
    { session: options.session },
  );
  return booking;
}

export class BookingAcceptanceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BookingAcceptanceError";
  }
}

/** Accept an existing requested booking. Only its provider may do this. */
export async function acceptBooking(
  db: Db,
  data: { bookingId: string; actorId: string },
  options: BookingActionOptions = {},
) {
  if (!ObjectId.isValid(data.bookingId)) {
    throw new BookingAcceptanceError(400, "INVALID_BOOKING_ID", "Invalid booking ID.");
  }
  if (!ObjectId.isValid(data.actorId)) {
    throw new BookingAcceptanceError(401, "UNAUTHORIZED", "You must be signed in.");
  }

  const { bookings } = exchangeCollections(db);
  const bookingId = new ObjectId(data.bookingId);
  const actorId = new ObjectId(data.actorId);
  const booking = await bookings.findOne(
    { _id: bookingId },
    { session: options.session },
  );

  if (!booking) {
    throw new BookingAcceptanceError(404, "BOOKING_NOT_FOUND", "Booking not found.");
  }
  if (!booking.providerId.equals(actorId)) {
    throw new BookingAcceptanceError(403, "NOT_PROVIDER", "Only the provider can accept this booking.");
  }
  if (booking.status !== "requested") {
    throw new BookingAcceptanceError(409, "BOOKING_NOT_REQUESTED", "Only a requested booking can be accepted.");
  }

  // Conditional update means two simultaneous acceptances cannot both succeed.
  const accepted = await bookings.findOneAndUpdate(
    { _id: bookingId, providerId: actorId, status: "requested" },
    { $set: { status: "accepted", updatedAt: new Date() } },
    { returnDocument: "after", session: options.session },
  );
  if (!accepted) {
    throw new BookingAcceptanceError(409, "BOOKING_STATUS_CHANGED", "The booking status has changed.");
  }
  return accepted;
}

/** Development-only shortcut used by the existing Test Accepted Booking button. */
export async function createAcceptedTestBooking(
  db: Db,
  data: AddBookingInput,
  options: BookingActionOptions = {},
) {
  if (process.env.NODE_ENV !== "development") {
    throw new BookingAcceptanceError(403, "TEST_ONLY", "Test bookings are only available in development.");
  }

  const booking = await addBooking(db, data, options);
  // The real provider acceptance path above enforces provider identity. This
  // shortcut deliberately supplies the provider for a local development test.
  return acceptBooking(db, {
    bookingId: booking._id.toHexString(),
    actorId: booking.providerId.toHexString(),
  }, options);
}

export async function createCreditAccount(
  db: Db,
  userId: string,
  startingCredits = 0,
) {
  const { accounts } = exchangeCollections(db);
  if (!ObjectId.isValid(userId)) throw new Error("Invalid user ID.");
  const now = new Date();
  const account: CreditAccount = {
    _id: new ObjectId(),
    userId: new ObjectId(userId),
    availableCredits: startingCredits,
    heldCredits: 0,
    createdAt: now,
    updatedAt: now,
  };
  await accounts.insertOne(account);
  return account;
}

export async function addCreditTransaction(
  db: Db,
  data: {
    accountId: string;
    bookingId?: string;
    type: "welcome" | "reserve" | "release" | "payment" | "earning";
    availableDelta: number;
    heldDelta: number;
    idempotencyKey: string;
  },
) {
  const { transactions } = exchangeCollections(db);
  if (!ObjectId.isValid(data.accountId)) throw new Error("Invalid account ID.");
  if (data.bookingId && !ObjectId.isValid(data.bookingId)) {
    throw new Error("Invalid booking ID.");
  }
  const transaction: CreditTransaction = {
    _id: new ObjectId(),
    accountId: new ObjectId(data.accountId),
    ...(data.bookingId ? { bookingId: new ObjectId(data.bookingId) } : {}),
    type: data.type,
    availableDelta: data.availableDelta,
    heldDelta: data.heldDelta,
    idempotencyKey: data.idempotencyKey,
    createdAt: new Date(),
  };
  await transactions.insertOne(transaction);
  return transaction;
}

export async function addReview(
  db: Db,
  data: {
    bookingId: string | ObjectId;
    authorId: string | ObjectId;
    subjectUserId: string | ObjectId;
    rating: number;
    comment: string;
  },
) {
  const { reviews } = exchangeCollections(db);
  const bookingId = typeof data.bookingId === "string" ? new ObjectId(data.bookingId) : data.bookingId;
  const authorId = typeof data.authorId === "string" ? new ObjectId(data.authorId) : data.authorId;
  const subjectUserId = typeof data.subjectUserId === "string" ? new ObjectId(data.subjectUserId) : data.subjectUserId;
  const review: Review = {
    _id: new ObjectId(), bookingId, authorId, subjectUserId,
    rating: data.rating, comment: data.comment, createdAt: new Date(),
  };
  await reviews.insertOne(review);
  return review;
}

export async function initializeUserExchangeFields(db: Db, userId: string) {
  if (!ObjectId.isValid(userId)) throw new Error("Invalid user ID.");
  const users = db.collection<{
    rating?: number;
    numberOfReviews?: number;
    reviews?: string[];
  }>("user");
  await users.updateOne(
    { _id: new ObjectId(userId) },
    { $set: { rating: 0, numberOfReviews: 0, reviews: [] } },
  );
}

export async function updateUserExchangeProfile(
  db: Db,
  userId: string,
  data: { bio?: string; zipCode?: string; countryCode?: string },
) {
  if (!ObjectId.isValid(userId)) throw new Error("Invalid user ID.");
  const users = db.collection("user");
  const update: { bio?: string; zipCode?: string; countryCode?: string } = {};
  if (data.bio !== undefined) update.bio = data.bio;
  if (data.zipCode !== undefined) update.zipCode = data.zipCode;
  if (data.countryCode !== undefined) update.countryCode = data.countryCode;
  if (Object.keys(update).length === 0) return;
  await users.updateOne({ _id: new ObjectId(userId) }, { $set: update });
}

export async function appendReviewToUser(
  db: Db,
  userId: string,
  reviewId: ObjectId,
  newRating: number,
) {
  if (!ObjectId.isValid(userId)) throw new Error("Invalid user ID.");
  const users = db.collection<{
    rating?: number;
    numberOfReviews?: number;
    reviews?: string[];
  }>("user");
  const objectUserId = new ObjectId(userId);
  const user = (await users.findOne({ _id: objectUserId })) as WithId<{
    rating?: number;
    numberOfReviews?: number;
    reviews?: string[];
  }> | null;
  if (!user) throw new Error("User not found");
  const currentReviewCount = user.numberOfReviews ?? 0;
  const nextReviewCount = currentReviewCount + 1;
  const nextRating = ((user.rating ?? 0) * currentReviewCount + newRating) / nextReviewCount;
  await users.updateOne(
    { _id: objectUserId },
    {
      $set: { rating: nextRating },
      $inc: { numberOfReviews: 1 },
      $push: { reviews: reviewId.toHexString() },
    },
  );
  return { rating: nextRating, numberOfReviews: nextReviewCount };
}

import { ObjectId, WithId, type Db } from "mongodb";
import {
  exchangeCollections,
  type Genre,
  type Service,
  type Booking,
  type CreditAccount,
  type CreditTransaction,
  type Review,
} from "./exchange-schema";

// Low-level document helpers. They skip the validation, transactions and credit holds in
// exchange-service.ts, so user-facing flows (bookings, settlement, reviews) should go
// through createExchangeService instead.

export async function addGenre(
  db: Db,
  data: {
    name: string;
    slug: string;
    description?: string;
    isActive?: boolean;
  }
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

export interface AddServiceInput {
  userId: string;
  genreId: string;

  title: string;
  description: string;

  zipCode: string;
  countryCode: string;

  deliveryMode:
    | "remote"
    | "in_person"
    | "either";

  pricingType:
    | "hourly"
    | "fixed";

  creditRate: number;

  // GridFS IDs
  images?: ObjectId[];
}

export async function addService(
  db: Db,
  input: AddServiceInput
): Promise<WithId<Service>> {
  const now = new Date();

  const service: Service = {
    _id: new ObjectId(),
    userId: new ObjectId(input.userId),
    genreId: new ObjectId(input.genreId),

    title: input.title,
    description: input.description,

    zipCode: input.zipCode,
    countryCode: input.countryCode,

    deliveryMode: input.deliveryMode,
    pricingType: input.pricingType,

    creditRate: input.creditRate,
    status: "active",

    // Always create the images field
    images: input.images ?? [],

    createdAt: now,
    updatedAt: now,
  };

  // Same collection the domain service and bookings read ("service", not "services").
  await exchangeCollections(db).services.insertOne(service);

  return service;
}

export async function addBooking(
  db: Db,
  data: {
    serviceId: string | ObjectId;
    requesterId: string | ObjectId;
    durationMinutes?: number;
    scheduledAt?: Date;
  }
) {
  const { services, bookings } = exchangeCollections(db);

  const serviceId =
    typeof data.serviceId === "string"
      ? new ObjectId(data.serviceId)
      : data.serviceId;

  const requesterId =
    typeof data.requesterId === "string"
      ? new ObjectId(data.requesterId)
      : data.requesterId;

  const service = await services.findOne({
    _id: serviceId,
    status: "active",
  });

  if (!service) {
    throw new Error("Service not found");
  }

  let totalCredits = service.creditRate;

  if (service.pricingType === "hourly") {
    if (!data.durationMinutes) {
      throw new Error(
        "durationMinutes is required for hourly services"
      );
    }

    totalCredits = Math.ceil(
      service.creditRate * (data.durationMinutes / 60)
    );
  }

  const now = new Date();

  const booking: Booking = {
    _id: new ObjectId(),

    serviceId: service._id,
    providerId: service.userId,
    requesterId,

    // Save the current service information so later edits to
    // the service don't change the historical booking.
    serviceSnapshot: {
      title: service.title,
      description: service.description,
      pricingType: service.pricingType,
      creditRate: service.creditRate,
    },

    durationMinutes: data.durationMinutes,
    totalCredits,
    scheduledAt: data.scheduledAt,

    status: "requested",

    createdAt: now,
    updatedAt: now,
  };

  await bookings.insertOne(booking);

  return booking;
}


export async function createCreditAccount(
  db: Db,
  userId: string | ObjectId,
  startingCredits = 0
) {
  const { accounts } = exchangeCollections(db);

  const now = new Date();

  const account: CreditAccount = {
    _id: new ObjectId(),

    userId:
      typeof userId === "string"
        ? new ObjectId(userId)
        : userId,

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
    accountId: string | ObjectId;
    bookingId?: string | ObjectId;

    type:
      | "welcome"
      | "reserve"
      | "release"
      | "payment"
      | "earning";

    availableDelta: number;
    heldDelta: number;

    idempotencyKey: string;
  }
) {
  const { transactions } = exchangeCollections(db);

  const transaction: CreditTransaction = {
    _id: new ObjectId(),

    accountId:
      typeof data.accountId === "string"
        ? new ObjectId(data.accountId)
        : data.accountId,

    bookingId: data.bookingId
      ? typeof data.bookingId === "string"
        ? new ObjectId(data.bookingId)
        : data.bookingId
      : undefined,

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
  }
) {
  const { reviews } = exchangeCollections(db);

  if (data.rating < 1 || data.rating > 5) {
    throw new Error("Rating must be between 1 and 5");
  }

  const review: Review = {
    _id: new ObjectId(),

    bookingId:
      typeof data.bookingId === "string"
        ? new ObjectId(data.bookingId)
        : data.bookingId,

    authorId:
      typeof data.authorId === "string"
        ? new ObjectId(data.authorId)
        : data.authorId,

    subjectUserId:
      typeof data.subjectUserId === "string"
        ? new ObjectId(data.subjectUserId)
        : data.subjectUserId,

    rating: data.rating,
    comment: data.comment,

    createdAt: new Date(),
  };

  await reviews.insertOne(review);

  return review;
}

export async function initializeUserExchangeFields(
  db: Db,
  userId: string | ObjectId
) {
  const users = db.collection("user");

  const _id =
    typeof userId === "string"
      ? new ObjectId(userId)
      : userId;

  await users.updateOne(
    { _id },
    {
      $set: {
        rating: 0,
        numberOfReviews: 0,
        reviews: [],
      },
    }
  );
}

export async function updateUserExchangeProfile(
  db: Db,
  userId: string | ObjectId,
  data: {
    bio?: string;
    zipCode?: string;
    countryCode?: string;
  }
) {
  const users = db.collection("user");

  const _id =
    typeof userId === "string"
      ? new ObjectId(userId)
      : userId;

  await users.updateOne(
    { _id },
    {
      $set: data,
    }
  );
}

export async function appendReviewToUser(
  db: Db,
  userId: string | ObjectId,
  reviewId: ObjectId,
  newRating: number
) {
  const users = db.collection<{
    rating?: number;
    numberOfReviews?: number;
    reviews?: string[];
  }>("user");

  const _id =
    typeof userId === "string"
      ? new ObjectId(userId)
      : userId;

  const user = await users.findOne({ _id });

  if (!user) {
    throw new Error("User not found");
  }

  const oldRating = user.rating ?? 0;
  const oldCount = user.numberOfReviews ?? 0;

  const newAverage =
    (oldRating * oldCount + newRating) /
    (oldCount + 1);

  await users.updateOne(
    { _id },
    {
      $set: {
        rating: newAverage,
      },

      $inc: {
        numberOfReviews: 1,
      },

      $push: {
        reviews: reviewId.toHexString(),
      },
    }
  );
}
import { ObjectId, type Db } from "mongodb";
import type { Images } from "./image";

export interface UserExchangeFields {
  bio?: string; zipCode?: string; countryCode?: string;
  /** Average of received reviews; 0 means no reviews yet. */
  rating: number;
  numberOfReviews: number;
  /** IDs of received review documents, serialized as hexadecimal strings. */
  reviews: string[];
}
export interface Genre { _id: ObjectId; name: string; slug: string; description: string; isActive: boolean }
export interface Service {
  _id: ObjectId; userId: ObjectId; genreId: ObjectId; title: string; description: string;
  zipCode?: string; countryCode?: string; deliveryMode: "remote" | "in_person" | "either";
  pricingType: "fixed" | "hourly";
  /** All credit amounts are integer hundredths: 100 = 1 credit. */
  creditRate: number; status: "active" | "paused" | "archived"; createdAt: Date; updatedAt: Date;
  /** GridFS image IDs (see lib/gridfs.ts); services created before images have none. */
  images?: Images;
}
export interface Booking {
  _id: ObjectId; serviceId: ObjectId; providerId: ObjectId; requesterId: ObjectId;
  serviceSnapshot: Pick<Service, "title" | "description" | "pricingType" | "creditRate">;
  durationMinutes?: number; totalCredits: number; scheduledAt?: Date;
  status: "requested" | "accepted" | "awaiting_confirmation" | "completed" | "declined" | "cancelled";
  providerCompletedAt?: Date; requesterConfirmedAt?: Date; createdAt: Date; updatedAt: Date;
}
export interface CreditAccount { _id: ObjectId; userId: ObjectId; availableCredits: number; heldCredits: number; createdAt: Date; updatedAt: Date }
export interface CreditTransaction {
  _id: ObjectId; accountId: ObjectId; bookingId?: ObjectId;
  type: "welcome" | "reserve" | "release" | "payment" | "earning";
  availableDelta: number; heldDelta: number; idempotencyKey: string; createdAt: Date;
}
export interface Review { _id: ObjectId; bookingId: ObjectId; authorId: ObjectId; subjectUserId: ObjectId; rating: number; comment: string; createdAt: Date }
export function exchangeCollections(db: Db) {
  return { genres: db.collection<Genre>("genre"), services: db.collection<Service>("service"), bookings: db.collection<Booking>("booking"), accounts: db.collection<CreditAccount>("creditAccount"), transactions: db.collection<CreditTransaction>("creditTransaction"), reviews: db.collection<Review>("review") };
}
export async function ensureExchangeIndexes(db: Db) {
  const c = exchangeCollections(db);
  await Promise.all([
    c.genres.createIndex({ slug: 1 }, { unique: true }),
    c.services.createIndex({ genreId: 1, countryCode: 1, zipCode: 1, status: 1 }),
    c.services.createIndex({ userId: 1, status: 1 }),
    c.bookings.createIndex({ providerId: 1, status: 1, createdAt: -1 }),
    c.bookings.createIndex({ requesterId: 1, status: 1, createdAt: -1 }),
    c.accounts.createIndex({ userId: 1 }, { unique: true }),
    c.transactions.createIndex({ idempotencyKey: 1 }, { unique: true }),
    c.transactions.createIndex({ accountId: 1, createdAt: -1 }),
    c.reviews.createIndex({ subjectUserId: 1, createdAt: 1 }),
    c.reviews.createIndex({ bookingId: 1, authorId: 1 }, { unique: true }),
  ]);
}

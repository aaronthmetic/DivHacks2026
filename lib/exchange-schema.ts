import { ObjectId, type Db } from "mongodb";
import type { Images } from "./image";

export interface UserExchangeFields {
  image?: string | null;
  bio?: string; zipCode?: string; countryCode?: string;
  /** Average of received reviews; 0 means no reviews yet. */
  rating: number;
  numberOfReviews: number;
  /** IDs of received review documents, serialized as hexadecimal strings. */
  reviews: string[];
}
export interface Genre { _id: ObjectId; name: string; slug: string; description: string; isActive: boolean }
/** Whether a listing is offered once or repeats, such as every 2 weeks. */
export type ServiceFrequency =
  | { type: "single" }
  | { type: "recurring"; interval: number; unit: "day" | "week" | "month" };
/** A weekly window in New York time: `day` is 0 (Sunday) to 6 (Saturday); times are minutes after midnight. */
export interface AvailabilityWindow { day: number; start: number; end: number }
export interface Service {
  _id: ObjectId; userId: ObjectId; genreId: ObjectId; title: string; description: string;
  zipCode?: string; countryCode?: string; deliveryMode: "remote" | "in_person" | "either";
  pricingType: "fixed" | "hourly";
  /** All credit amounts are integer hundredths: 100 = 1 credit. */
  creditRate: number; status: "active" | "paused" | "archived"; createdAt: Date; updatedAt: Date;
  /** GridFS image IDs (see lib/gridfs.ts); services created before images have none. */
  images?: Images;
  /** Services created before frequencies existed have none and are single-time. */
  frequency?: ServiceFrequency;
  /** Weekly windows (lib/availability.ts). Required for new listings; older ones have none. */
  availability?: AvailabilityWindow[];
}
/** Added details are optional for bookings created before full snapshots. */
export type ServiceSnapshot = Pick<Service, "title" | "description" | "pricingType" | "creditRate">
  & Partial<Pick<Service, "genreId" | "deliveryMode" | "zipCode" | "countryCode" | "images" | "frequency" | "availability">>;
/** A time and place one person suggested for an accepted booking (lib/coordination.ts). */
export interface BookingProposal { startsAt: Date; place?: string; byUserId: ObjectId; createdAt: Date }
export interface Booking {
  _id: ObjectId; serviceId: ObjectId; providerId: ObjectId; requesterId: ObjectId;
  serviceSnapshot: ServiceSnapshot;
  /** `scheduledAt` and `place` are the agreed time and place, set when a proposal is confirmed. */
  durationMinutes?: number; totalCredits: number; scheduledAt?: Date; place?: string;
  /** The latest proposal the other person hasn't confirmed yet. */
  proposal?: BookingProposal;
  /** The listing window the requester picked; absent for listings without windows. */
  preferredWindow?: AvailabilityWindow; note?: string;
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
    c.services.createIndex({ status: 1, createdAt: -1 }),
    c.bookings.createIndex({ providerId: 1, status: 1, createdAt: -1 }),
    c.bookings.createIndex({ requesterId: 1, status: 1, createdAt: -1 }),
    c.accounts.createIndex({ userId: 1 }, { unique: true }),
    c.transactions.createIndex({ idempotencyKey: 1 }, { unique: true }),
    c.transactions.createIndex({ accountId: 1, createdAt: -1 }),
    c.reviews.createIndex({ subjectUserId: 1, createdAt: 1 }),
    c.reviews.createIndex({ subjectUserId: 1, createdAt: -1, _id: -1 }),
    c.bookings.createIndex({ requesterId: 1, status: 1, scheduledAt: 1, _id: 1 }),
    c.reviews.createIndex({ bookingId: 1, authorId: 1 }, { unique: true }),
    // Finds requests nobody answered (lib/booking-expiry.ts).
    c.bookings.createIndex({ status: 1, createdAt: 1 }),
  ]);
}
/** Categories offered when creating a listing. Admins can deactivate or rename them later. */
export const DEFAULT_GENRES = [
  { slug: "tutoring", name: "Tutoring", description: "Lessons, homework help and test prep" },
  { slug: "music", name: "Music", description: "Instrument and voice lessons" },
  { slug: "repairs", name: "Repairs", description: "Fixing, assembling and maintaining things" },
  { slug: "pets", name: "Pets", description: "Walking, sitting and pet care" },
  { slug: "beauty", name: "Beauty", description: "Hair, nails and grooming" },
  { slug: "creative", name: "Creative", description: "Photography, art and design" },
  { slug: "fitness", name: "Fitness", description: "Training, yoga and coaching" },
  { slug: "tech", name: "Tech", description: "Computer help, websites and setup" },
];
/** Inserts missing default categories without changing existing ones. Safe to run repeatedly. */
export async function ensureDefaultGenres(db: Db) {
  const { genres } = exchangeCollections(db);
  // Upserts on the unique slug are retried by the server if instances race.
  await Promise.all(DEFAULT_GENRES.map((genre) => genres.updateOne(
    { slug: genre.slug },
    { $setOnInsert: { _id: new ObjectId(), ...genre, isActive: true } },
    { upsert: true },
  )));
}

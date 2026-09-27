// Booking rules for agreeing on an accepted booking's time and place. The assistant's tools call these.
import type { Db, ObjectId } from "mongodb";
import { InputError } from "./auth-validation";
import { bookingCode } from "./booking-texts";
import { exchangeCollections, type Booking, type BookingProposal } from "./exchange-schema";

/** An accepted booking as one of its two people sees it. */
export type ActiveBooking = {
  booking: Booking;
  role: "provider" | "requester";
  /** The other person. The phone number is only for sending texts; it never goes to the model. */
  other: { id: ObjectId; firstName: string; phoneNumber?: string };
  /** The booking's code (bookingCode), six characters when two four-character codes in the list collide. */
  code: string;
};

const NOT_YOURS = "That booking isn't yours.";
const NOT_ACCEPTED = "That booking isn't accepted, so its time can't be changed.";

const isParty = (booking: Booking, actorId: ObjectId) => actorId.equals(booking.providerId) || actorId.equals(booking.requesterId);

/** The person's accepted bookings, as provider or requester, newest first, at most 10. */
export async function activeBookings(db: Db, userId: ObjectId): Promise<ActiveBooking[]> {
  const { bookings } = exchangeCollections(db);
  const docs = await bookings.find({ status: "accepted", $or: [{ providerId: userId }, { requesterId: userId }] })
    .sort({ createdAt: -1, _id: -1 }).limit(10).toArray();
  if (!docs.length) return [];
  const otherIds = docs.map((booking) => (booking.providerId.equals(userId) ? booking.requesterId : booking.providerId));
  const others = await db.collection("user").find({ _id: { $in: otherIds } }, { projection: { firstName: 1, phoneNumber: 1 } }).toArray();
  const byId = new Map(others.map((person) => [person._id.toHexString(), person]));
  // The whole batch widens to six characters when any two collide (same rule as listItems in lib/booking-replies.ts).
  const short = docs.map((booking) => bookingCode(booking._id));
  const length = new Set(short).size < short.length ? 6 : 4;
  return docs.map((booking) => {
    const role = booking.providerId.equals(userId) ? "provider" as const : "requester" as const;
    const otherId = role === "provider" ? booking.requesterId : booking.providerId;
    const person = byId.get(otherId.toHexString());
    const phoneNumber = typeof person?.phoneNumber === "string" ? person.phoneNumber : undefined;
    return { booking, role, other: { id: otherId, firstName: String(person?.firstName ?? "someone"), ...(phoneNumber ? { phoneNumber } : {}) }, code: bookingCode(booking._id, length) };
  });
}

// Collapses whitespace and control characters to one space and trims; empty becomes undefined.
function cleanPlace(place: string | undefined): string | undefined {
  if (place === undefined) return undefined;
  const cleaned = place.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();
  if (!cleaned) return undefined;
  if (cleaned.length > 120) throw new InputError("Keep the place under 120 characters.");
  return cleaned;
}

const THIRTY_MINUTES_MS = 30 * 60_000;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60_000;

/** Saves the actor's proposal, replacing any earlier one. Throws InputError when the booking, time or place isn't allowed. */
export async function propose(db: Db, actorId: ObjectId, bookingId: ObjectId, input: { startsAt: Date; place?: string }, now = new Date()): Promise<BookingProposal> {
  const { bookings } = exchangeCollections(db);
  const booking = await bookings.findOne({ _id: bookingId });
  if (!booking || !isParty(booking, actorId)) throw new InputError(NOT_YOURS);
  if (booking.status !== "accepted") throw new InputError(NOT_ACCEPTED);
  if (!(input.startsAt instanceof Date) || Number.isNaN(input.startsAt.getTime())) throw new InputError("That time isn't valid.");
  if (input.startsAt.getTime() < now.getTime() + THIRTY_MINUTES_MS) throw new InputError("Pick a time at least 30 minutes from now.");
  if (input.startsAt.getTime() > now.getTime() + SIXTY_DAYS_MS) throw new InputError("Pick a time within the next 60 days.");
  const place = cleanPlace(input.place);
  const proposal: BookingProposal = { startsAt: input.startsAt, ...(place !== undefined ? { place } : {}), byUserId: actorId, createdAt: now };
  const result = await bookings.updateOne({ _id: bookingId, status: "accepted" }, { $set: { proposal, updatedAt: now } });
  if (result.matchedCount === 0) throw new InputError(NOT_ACCEPTED);
  return proposal;
}

/** Confirms the other person's proposal that the actor saw: sets scheduledAt and place and removes the proposal. Throws InputError otherwise. */
export async function confirm(db: Db, actorId: ObjectId, bookingId: ObjectId, proposalCreatedAt: Date, now = new Date()): Promise<{ scheduledAt: Date; place?: string }> {
  const { bookings } = exchangeCollections(db);
  const booking = await bookings.findOne({ _id: bookingId });
  if (!booking || !isParty(booking, actorId)) throw new InputError(NOT_YOURS);
  if (booking.status !== "accepted") throw new InputError(NOT_ACCEPTED);
  const { proposal } = booking;
  if (!proposal) throw new InputError("There's no suggested time to confirm.");
  if (proposal.byUserId.equals(actorId)) throw new InputError("Only the other person can confirm this suggestion.");
  if (proposal.createdAt.getTime() !== proposalCreatedAt.getTime()) throw new InputError("The suggestion changed. Check the latest one.");
  if (proposal.startsAt.getTime() < now.getTime()) throw new InputError("That suggested time has passed. Suggest a new one.");
  const place = proposal.place ?? booking.place;
  const result = await bookings.updateOne(
    { _id: bookingId, status: "accepted", "proposal.createdAt": proposalCreatedAt, "proposal.byUserId": { $ne: actorId } },
    { $set: { scheduledAt: proposal.startsAt, ...(proposal.place !== undefined ? { place: proposal.place } : {}), updatedAt: now }, $unset: { proposal: "" } },
  );
  if (result.matchedCount === 0) throw new InputError("The suggestion changed. Check the latest one.");
  return { scheduledAt: proposal.startsAt, ...(place !== undefined ? { place } : {}) };
}

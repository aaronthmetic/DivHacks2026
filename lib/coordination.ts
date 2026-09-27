// Booking rules for agreeing on an accepted booking's time and place. The assistant's tools call these.
// STUB: signatures are final; the coordination rules task implements them.
import type { Db, ObjectId } from "mongodb";
import type { Booking, BookingProposal } from "./exchange-schema";

/** An accepted booking as one of its two people sees it. */
export type ActiveBooking = {
  booking: Booking;
  role: "provider" | "requester";
  /** The other person. The phone number is only for sending texts; it never goes to the model. */
  other: { id: ObjectId; firstName: string; phoneNumber?: string };
  /** The booking's code (bookingCode), six characters when two four-character codes in the list collide. */
  code: string;
};

/** The person's accepted bookings, as provider or requester, newest first, at most 10. */
export async function activeBookings(db: Db, userId: ObjectId): Promise<ActiveBooking[]> {
  void db; void userId;
  throw new Error("activeBookings is not implemented yet");
}

/** Saves the actor's proposal, replacing any earlier one. Throws InputError when the booking, time or place isn't allowed. */
export async function propose(db: Db, actorId: ObjectId, bookingId: ObjectId, input: { startsAt: Date; place?: string }, now = new Date()): Promise<BookingProposal> {
  void db; void actorId; void bookingId; void input; void now;
  throw new Error("propose is not implemented yet");
}

/** Confirms the other person's proposal that the actor saw: sets scheduledAt and place and removes the proposal. Throws InputError otherwise. */
export async function confirm(db: Db, actorId: ObjectId, bookingId: ObjectId, proposalCreatedAt: Date, now = new Date()): Promise<{ scheduledAt: Date; place?: string }> {
  void db; void actorId; void bookingId; void proposalCreatedAt; void now;
  throw new Error("confirm is not implemented yet");
}

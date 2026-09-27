import { ObjectId, type Db } from "mongodb";

import { exchangeCollections, reviewRequired, type Booking } from "./exchange-schema";

/** What the review popup needs: which booking, its title, and who finished it when the review is required. */
export type PendingReview = { id: string; serviceTitle: string; required: boolean; requiredBy?: string };

/** The first name of whoever pressed Finish Barter (older bookings: the requester). */
export async function finisherFirstName(db: Db, booking: Pick<Booking, "completedBy" | "requesterId">) {
  const user = await db.collection("user").findOne({ _id: booking.completedBy ?? booking.requesterId }, { projection: { firstName: 1, name: 1 } });
  return (typeof user?.firstName === "string" && user.firstName) || String(user?.name ?? "Your partner").split(" ")[0];
}

/**
 * The viewer's completed booking to review next: one the other person finished is required
 * and comes first, otherwise the newest they haven't reviewed.
 */
export async function pendingReview(db: Db, viewer: ObjectId): Promise<PendingReview | null> {
  const { bookings, reviews } = exchangeCollections(db);
  const completed = bookings.find(
    { status: "completed", $or: [{ requesterId: viewer }, { providerId: viewer }] },
    { projection: { _id: 1, completedBy: 1, providerId: 1, requesterId: 1, "serviceSnapshot.title": 1 } },
  ).sort({ updatedAt: -1 });

  let optional: PendingReview | null = null;
  for await (const booking of completed) {
    if (await reviews.findOne({ bookingId: booking._id, authorId: viewer }, { projection: { _id: 1 } })) continue;
    const review = { id: booking._id.toHexString(), serviceTitle: booking.serviceSnapshot.title, required: false };
    if (reviewRequired(booking, viewer)) return { ...review, required: true, requiredBy: await finisherFirstName(db, booking) };
    optional ??= review;
  }
  return optional;
}
